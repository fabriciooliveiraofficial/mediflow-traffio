/**
 * process-inbox — Edge Function (Supabase Cron, every 2 seconds)
 *
 * Inbox Worker: Debounce + Context Fusion + Conversation Lock
 *
 * Roteamento por turno (docs/SPEC_AGENTE_IA_CLAUDE.md, docs/ROADMAP_PRODUTO_2026.md):
 *   F2 (pré-filtro determinístico, QUALQUER dial) > F3 (agente autônomo, dial
 *   'ai_always') > fila humana. F1 (copiloto) roda depois, gerando rascunho
 *   para o atendente quando nenhum dos anteriores resolveu.
 *
 * Flow per conversation turn:
 *   1. Fetch all pending messages grouped by (tenant_id, phone)
 *   2. Debounce: skip phones whose last message arrived < DEBOUNCE_MS ago
 *   3. Acquire PostgreSQL advisory lock per phone (prevents parallel runs)
 *   4. Context Fusion: concatenate all pending messages into one user turn
 *   5. Log message + route to human queue
 *   6. Mark messages as done, release lock
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { TenantResolver } from "../_shared/tenantResolver.ts";
import { SessionManager, isHardHandoffSession } from "../_shared/sessionManager.ts";
import { OutboxDispatcher } from "../_shared/outboxDispatcher.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { runCopilot, runAutonomousAgent, wrapUntrustedContent } from "../_shared/copilot.ts";
import { tryStructuredFlow } from "../_shared/structuredFlow.ts";
import { logAgentTurnEvent } from "../_shared/observabilityLayer.ts";
import { runWithConcurrencyLimit } from "../_shared/concurrencyPool.ts";

// How long to wait after the last message before processing (ms).
// Gives the patient time to finish typing multiple messages.
const DEBOUNCE_MS = 1200;

// F0 (docs/SPEC_AGENTE_IA_CLAUDE.md) — debounce estendido quando a IA vai
// responder: pacientes reais fragmentam o pensamento em várias mensagens com
// pausas de 3–5s; a IA só deve gerar resposta após silêncio real. O fluxo
// humano continua no debounce curto (latência importa para o atendente).
const AI_DEBOUNCE_MS = 10_000;

// Item 2 do hardening de carga (docs/DIAGNOSTICO_CONCORRENCIA_AGENTE.md):
// conversas distintas (tenant, phone) já vêm sem contenção entre si (cada
// uma tem seu próprio lease-lock) — processá-las em série desperdiçava o
// tempo do turno de uma esperando a IA da outra terminar. Concorrência
// limitada (não "paralelizar tudo"): o teto real de paralelismo é o rate
// limit da conta Anthropic (RPM/TPM, item 4 do hardening — ainda não
// confirmado), então o default é conservador. Ajustável sem novo deploy via
// Supabase Secret INBOX_WORKER_CONCURRENCY.
const WORKER_CONCURRENCY = Number(Deno.env.get("INBOX_WORKER_CONCURRENCY")) || 5;

// Achado real no teste de carga (docs/DIAGNOSTICO_CONCORRENCIA_AGENTE.md,
// 2026-07-22, N=50 conversas de UM tenant): com o default antigo da RPC (15),
// um ÚNICO tenant lotado se auto-limitava a 15 conversas por tick mesmo com
// WORKER_CONCURRENCY=20 livre para processar mais — as 50 conversas
// avançavam em "ondas" de 15 presas ao ritmo do cron (~20s), não ao ritmo
// real de processamento (~12s/turno). O cap por tenant (item 1) continua
// necessário para proteger tenants pequenos de um vizinho grande — só
// precisa ser alto o bastante para não estrangular um tenant sozinho.
// Ajustável sem novo deploy via Supabase Secret INBOX_PER_TENANT_CAP.
const PER_TENANT_CAP = Number(Deno.env.get("INBOX_PER_TENANT_CAP")) || 50;

console.log("process-inbox v1 — Debounce + Fusion Worker — Initialized");

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl        = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase           = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const now    = Date.now();
    const cutoff = new Date(now - DEBOUNCE_MS).toISOString();

    // --- 1. Claim justo por tenant (porta o padrão do process-outbound) ---
    // A RPC devolve, numa única chamada: (a) reaper de mensagens presas em
    // 'processing' há >5min → 'pending' (recupera worker morto no meio de um
    // turno); (b) conversas distintas (tenant, phone) com pendentes <= cutoff,
    // com CAP POR TENANT (um tenant grande não trava os pequenos —
    // head-of-line blocking) e LIMIT de lote. A RPC só seleciona candidatos;
    // o lease-lock por conversa (abaixo) continua sendo a guarda de
    // concorrência entre invocações. Ver
    // migrations/20260722130000_inbox_fair_claim.sql.
    const { data: batches, error: fetchError } = await supabase.rpc("claim_inbox_conversations", {
      p_cutoff: cutoff,
      p_per_tenant_cap: PER_TENANT_CAP,
    });

    if (fetchError) {
      console.error("[process-inbox] claim_inbox_conversations error:", fetchError.message);
      return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 });
    }

    if (!batches || batches.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), { headers: corsHeaders });
    }

    let processed = 0;
    let failed = 0;

    // Orçamento de relógio: cada invocação PARA de DISPARAR novas conversas
    // quando passa deste tempo, deixando o resto 'pending' para o próximo tick
    // (as em voo terminam normalmente). Evita ser morta pelo timeout do edge no
    // meio de um turno (o que deixava mensagens presas em 'processing').
    // Conservador sob o wall-limit típico do edge (~150s); o reaper da RPC é a
    // rede de segurança final.
    const BUDGET_MS = 100_000;

    async function runOne(batch: { tenant_id: string; phone: string }) {
      const { tenant_id, phone } = batch;
      try {
        await processConversationTurn(supabase, tenant_id, phone, cutoff);
        processed++;
      } catch (turnErr: any) {
        console.error(`[process-inbox] [${phone}] Turn failed:`, turnErr.message, turnErr.stack?.substring(0, 300));
        failed++;
        // Mark messages as failed so they don't block the queue forever
        try {
          const { data: failedMsgs } = await supabase
            .from("message_inbox")
            .select("id")
            .eq("tenant_id", tenant_id)
            .eq("phone", phone)
            .in("status", ["pending", "processing"]);
          if (failedMsgs?.length) {
            await supabase
              .from("message_inbox")
              .update({ status: "failed" })
              .in("id", failedMsgs.map((m: any) => m.id));
          }
        } catch (_) { /* best effort cleanup */ }
      }
    }

    // Dispatcher de concorrência limitada: conversas distintas (tenant, phone)
    // não têm contenção entre si (lease-lock é por conversa), então rodá-las
    // em voo ao mesmo tempo (até WORKER_CONCURRENCY) multiplica o throughput do
    // tick sem precisar de FOR UPDATE SKIP LOCKED — a RPC já devolveu conversas
    // distintas, dedupidas e ordenadas por justiça (item 1). Lógica testada
    // isoladamente em _shared/concurrencyPool.ts.
    const { remaining } = await runWithConcurrencyLimit(batches, runOne, {
      concurrency: WORKER_CONCURRENCY,
      budgetMs: BUDGET_MS,
    });
    if (remaining > 0) {
      console.log(`[process-inbox] orçamento de relógio atingido — ${remaining} conversa(s) ficam para o próximo tick`);
    }

    console.log(`[process-inbox] Processed ${processed} conversation(s), ${failed} failed`);
    return new Response(JSON.stringify({ processed, failed }), { headers: corsHeaders });

  } catch (err: any) {
    console.error("[process-inbox] Fatal error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});

// =============================================================================
// Core: process one conversation turn (debounce + lock + fusion + agent)
// =============================================================================
async function processConversationTurn(
  supabase: any,
  tenantId: string,
  phone: string,
  cutoff: string
): Promise<void> {

  // --- CRITICAL FIX: Instantiate SessionManager ---
  const sessionManager = new SessionManager(supabase);

  // --- 2. Acquire per-phone lease lock (prevents parallel processing) ---
  // NÃO usar pg_try_advisory_lock aqui: advisory lock é de SESSÃO e, via RPC
  // REST com pooling, o unlock pode cair em outra conexão e falhar silencioso —
  // lock ficava preso ~2-3 min travando a fila (visto em produção 2026-07-16).
  // O lease tem TTL: se o worker morrer, expira sozinho e a fila se recupera.
  const { data: lockResult } = await supabase.rpc("try_conversation_lock", {
    p_tenant: tenantId, p_phone: phone, p_ttl_seconds: 120,
  });
  if (!lockResult) {
    // Another worker is already processing this conversation — skip
    console.log(`[process-inbox] [${phone}] Lock busy, skipping`);
    return;
  }

  try {
    // --- 3. Fetch all pending messages for this phone up to debounce cutoff ---
    const { data: messages, error: msgError } = await supabase
      .from("message_inbox")
      .select("id, content, received_at, message_id, media_url, message_type, caption")
      .eq("tenant_id", tenantId)
      .eq("phone", phone)
      .eq("status", "pending")
      .lte("received_at", cutoff)
      .order("received_at", { ascending: true });

    if (msgError || !messages || messages.length === 0) {
      console.log(`[process-inbox] No messages for ${phone} after re-check`);
      return;
    }

    const messageIds = messages.map((m: any) => m.id);
 
     // --- 4. Mark as processing (prevent double-pick by concurrent cron runs) ---
     // claimed_at alimenta o reaper de claim_inbox_conversations: se este worker
     // morrer antes de marcar 'done'/'pending', a mensagem volta à fila em 5min.
     const batchId = crypto.randomUUID();
     // Marca 'processing' + carrega sessão + tenant EM PARALELO: os três são
     // independentes entre si (message_inbox por id, sessão por tenant+phone,
     // tenant por id). Rodá-los em série eram 3 round-trips sequenciais no
     // PostgREST — exatamente o gargalo da cauda de latência sob carga
     // (docs/DIAGNOSTICO_CONCORRENCIA_AGENTE.md). claimed_at alimenta o reaper.
     const [, session, tenantFetch] = await Promise.all([
       supabase
         .from("message_inbox")
         .update({ status: "processing", batch_id: batchId, claimed_at: new Date().toISOString() })
         .in("id", messageIds),
       sessionManager.getOrCreateSession(tenantId, phone),
       supabase.from("tenants").select("*").eq("id", tenantId).maybeSingle(),
     ]);
     const tenantRow = tenantFetch.data;

     // Sessão fechada recebendo mensagem nova NUNCA pode ficar invisível — e
     // reabrir NÃO significa forçar humano. Conversa fechada é neutra: só a
     // conversa ASSUMIDA (human_active) trava com o atendente. Uma conversa só
     // fechada volta ao roteamento normal (estruturado → IA → humano, conforme
     // o dial do tenant) — ver SessionManager.reopenClosedSession.
     if (session.omnichannel_status === "closed") {
       await sessionManager.reopenClosedSession(session.id);
       session.omnichannel_status = "queued";
       session.human_handoff = false;
       session.handoff_kind = null;
       console.log(`[process-inbox] [${phone}] sessão fechada reaberta por mensagem nova — roteamento normal`);
     }

     let lastMessageSnippet = "";
     // F2 — resultado do pré-filtro determinístico (permanece 'unmatched' quando a
     // conversa está em human_active/queued, onde nenhum bot deve responder)
     let structuredFlowResult: Awaited<ReturnType<typeof tryStructuredFlow>> = { matched: false };

     // --- 4b. F0: debounce estendido para conversas tratadas por IA autônoma ---
     // Se o agente de IA vai responder este turno, exigir AI_DEBOUNCE_MS de
     // silêncio do paciente antes de processar — absorve a "enxurrada" de
     // mensagens fragmentadas em um único turno coerente. Com o dial em
     // 'human'/'copilot' este gate nunca adia nada (fluxo humano = latência baixa).
     // (tenantRow já foi carregado acima, em paralelo com sessão e mark-processing.)
      const botConfig = tenantRow?.bot_config || {};
      const activeAgent = botConfig.active_agent ?? (botConfig.enabled ? "ai_assistant" : "human");
      const isHardHandoff = isHardHandoffSession(session);
      let autonomousStatus: string | null = null;
      const aiWillRespond =
        ["ai_always", "ai_assistant", "flow_bot"].includes(activeAgent) &&
        !isHardHandoff;

      if (aiWillRespond) {
        const newestArrival = Math.max(...messages.map((m: any) => new Date(m.received_at).getTime()));
        if (Date.now() - newestArrival < AI_DEBOUNCE_MS) {
          // Paciente ainda pode estar digitando — devolve o batch para a fila;
          // o próximo ciclo do cron reprocessa com a rajada completa fundida.
          console.log(`[process-inbox] [${phone}] AI debounce: last msg ${Date.now() - newestArrival}ms ago (< ${AI_DEBOUNCE_MS}ms) — deferring`);
          await markMessages(supabase, messageIds, "pending");
          return;
        }
      }
 
      if (isHardHandoff) {
        console.log(`[process-inbox] [${phone}] Session is in hard handoff (status=${session.omnichannel_status}, kind=${session.handoff_kind}). Logging ${messages.length} message(s) individually.`);
       
       for (const msg of messages) {
         const typeMap: Record<string, string> = {
           audio: 'audio', áudio: 'audio', image: 'image', imagem: 'image',
           video: 'video', vídeo: 'video', document: 'document', documento: 'document',
           sticker: 'sticker', figurinha: 'sticker'
         };
         const mediaMatch = msg.content?.trim().match(/^\[(áudio|audio|imagem|image|vídeo|video|documento|document|sticker|figurinha)\]$/i);
         const detectedType = mediaMatch ? typeMap[mediaMatch[1].toLowerCase()] : (msg.message_type || 'text');
 
         await sessionManager.logMessage(session.id, 'user', msg.caption || msg.content || `[${detectedType}]`, {
           whatsapp_message_id: msg.message_id,
           message_type: detectedType,
           media_url: msg.media_url,
           caption: msg.caption
         });
       }
 
       const lastMsg = messages[messages.length - 1];
       lastMessageSnippet = lastMsg.caption || lastMsg.content || `[${lastMsg.message_type || 'mídia'}]`;

       // F2 roda MESMO com humano na fila: é 100% determinístico e nunca gera texto
       // livre. Sem isto, o clique num horário já oferecido é ignorado para sempre
       // depois de qualquer transferência (bug de produção 2026-07-21).
       const structuredFlowStartedAt = Date.now();
       structuredFlowResult = await tryStructuredFlow(supabase, {
         tenantId,
         sessionId: session.id,
         phone,
         tenant: tenantRow,
         botConfig,
         sessionManager,
         timezone: tenantRow?.timezone,
       });
       if (structuredFlowResult.matched) {
         console.log(`[process-inbox] [${phone}] fluxo determinístico resolveu o turno com humano na fila`);
         // Onda 5.2 — best-effort, nunca afeta o turno.
         await logAgentTurnEvent(supabase, {
           tenant_id: tenantId, session_id: session.id, phone, route: "structured_flow",
           latency_ms: Date.now() - structuredFlowStartedAt,
         });
       }

     } else {
       // --- 5. Context Fusion: merge multiple messages into one coherent user turn ---
       const fusedContent = messages.map((m: any) => {
         const type = String(m.message_type || "text").toLowerCase();
         const content = m.caption || m.content || `[${type}]`;
         return type === "text" ? content : wrapUntrustedContent(content, type);
       }).join("\n");
 
       console.log(`[process-inbox] [${phone}] Fused ${messages.length} msg(s): "${fusedContent.substring(0, 80)}"`);
       lastMessageSnippet = fusedContent;
 
       // --- 5b. Media/voice guard — categorizar e salvar mídia para visibilidade humana ---
       // Z-API e Cloud API entregam mídia com content vazio ou markers tipo [áudio].
       // Categorizamos para que o atendente veja no chat, mesmo que o bot não processe.
       const mediaMatch = messages.length === 1
         ? messages[0]?.content?.trim().match(/^\[(áudio|audio|imagem|image|vídeo|video|documento|document|sticker|figurinha)\]$/i)
         : null;
       const hasTypedText = messages.some((m: any) => String(m.message_type || "text").toLowerCase() === "text" && !!m.content?.trim() && !/^\[(áudio|audio|imagem|image|vídeo|video|documento|document|sticker|figurinha)\]$/i.test(m.content.trim()));
       const isMediaOnly = !hasTypedText;
 
       if (isMediaOnly) {
         const typeMap: Record<string, string> = {
           audio: 'audio', áudio: 'audio', image: 'image', imagem: 'image',
           video: 'video', vídeo: 'video', document: 'document', documento: 'document',
           sticker: 'sticker', figurinha: 'sticker'
         };
         const detectedType = mediaMatch
           ? typeMap[mediaMatch[1].toLowerCase()]
           : String(messages[0]?.message_type || 'text').toLowerCase();
 
         console.log(`[process-inbox] [${phone}] Media detected (${detectedType}) — saving for human visibility`);
         
         // Buscar URL de mídia do message_inbox (se disponível)
         const { data: rawMsg } = await supabase
           .from('message_inbox')
           .select('media_url, caption')
           .in('id', messageIds)
           .not('media_url', 'is', null)
           .limit(1)
           .maybeSingle();
 
         const incomingWaId = messages[0]?.message_id;
 
         await sessionManager.logMessage(session.id, 'user', rawMsg?.caption || fusedContent || `[${detectedType}]`, {
           whatsapp_message_id: incomingWaId,
           message_type: detectedType,
           media_url: rawMsg?.media_url,
           caption: rawMsg?.caption
         });
 
         // Trigger handoff para que o humano assuma o atendimento de mídia
         if (session.omnichannel_status !== 'human_active' && session.omnichannel_status !== 'queued') {
           await sessionManager.triggerHumanHandoff(session.id);
         }
 
         await markMessages(supabase, messageIds, 'done');
         return;
       }
 
       // --- 7. Log message to history ---
       await sessionManager.logMessage(session.id, "user", fusedContent, {
         whatsapp_message_id: messages[0]?.message_id
       });

       // --- 7b. F2: pré-filtro determinístico universal — roda para QUALQUER dial.
       // Reconhece clique de horário / resposta a recovery / resposta a waitlist
       // sem gastar LLM. Se não reconhecer nada, cai no roteamento normal abaixo
       // sem nenhuma mudança de comportamento.
       const structuredFlowStartedAt2 = Date.now();
       structuredFlowResult = await tryStructuredFlow(supabase, {
         tenantId,
         sessionId: session.id,
         phone,
         tenant: tenantRow,
         botConfig,
         sessionManager,
         timezone: tenantRow?.timezone,
       });

       // --- 8. Roteamento: fluxo estruturado > IA autônoma > fila humana ---
       if (structuredFlowResult.matched) {
         if (structuredFlowResult.status === "failed") {
           console.warn(`[process-inbox] [${phone}] fluxo estruturado falhou — fail-safe para fila humana`);
           await sessionManager.triggerHumanHandoff(session.id);
         }
         // 'replied'/'transferred': a própria função já enviou a mensagem e atualizou o estado
         // Onda 5.2 — best-effort, nunca afeta o turno.
         await logAgentTurnEvent(supabase, {
           tenant_id: tenantId, session_id: session.id, phone, route: "structured_flow",
           latency_ms: Date.now() - structuredFlowStartedAt2,
         });
       } else if (activeAgent === "ai_always") {
         // A IA responde diretamente. Fail-safe: qualquer resultado que não seja
         // uma resposta entregue termina com o paciente na fila humana.
         autonomousStatus = await runAutonomousAgent(supabase, {
           tenantId,
           sessionId: session.id,
           phone,
           clinicName: tenantRow?.name || "",
           botConfig,
           tenant: tenantRow,
           sessionManager,
           timezone: tenantRow?.timezone,
         });

         if (autonomousStatus === "defer") {
           // Mensagem nova chegou durante a geração — devolve o batch e regenera
           await markMessages(supabase, messageIds, "pending");
           return;
         }
         if (autonomousStatus === "failed") {
           console.warn(`[process-inbox] [${phone}] agente autônomo falhou — fail-safe para fila humana`);
           await sessionManager.triggerHumanHandoff(session.id);
         }
         // 'replied': paciente respondido, sessão continua com a IA
         // 'transferred': handoff já feito dentro do agente
       } else {
         console.log(`[process-inbox] [${phone}] Routing message to human queue.`);
         if (session.omnichannel_status !== "human_active" && session.omnichannel_status !== "queued") {
           await sessionManager.triggerHumanHandoff(session.id);
         }
       }
     }
 
     // --- 6. Passive CRM ---
     // REMOVIDO (2026-07-22): o bloco de patient_funnel_stage escrevia numa
     // tabela DROPADA desde a migration 20260701c (funil aposentado, dados
     // absorvidos em crm_journeys — nenhuma página do frontend o lia). Eram
     // 3 round-trips/turno ao PostgREST (2 SELECT + 1 upsert) para o vazio,
     // gerando erro silencioso e somando à cauda de latência sob carga
     // (docs/DIAGNOSTICO_CONCORRENCIA_AGENTE.md § causa raiz). Se rastrear
     // "última interação" de inbound no CRM for desejado, fazer via a porta
     // única crm_move_stage() do CRM Journey Engine — nunca reintroduzir
     // escrita direta a uma tabela de funil.

     // --- 11. F1: Copiloto (Nível 0) — rascunho + triagem para o atendente ---
     // Roda DEPOIS de logar/rotear (o fluxo humano nunca depende disto) e
     // dentro do advisory lock. Falhas são isoladas dentro de runCopilot.
     // No modo ai_always, conversas em handoff estrito (hard/human_active) recebem
     // rascunhos. Se a IA autônoma respondeu com sucesso neste turno (replied),
     // o copiloto não roda para evitar rascunhos obsoletos e desperdício de LLM.
     const humanHolds = isHardHandoffSession(session);
     if (!structuredFlowResult.matched && autonomousStatus !== "replied" && (activeAgent === "copilot" || (activeAgent === "ai_always" && humanHolds))) {
       await runCopilot(supabase, {
         tenantId,
         sessionId: session.id,
         phone,
         clinicName: tenantRow?.name || "",
         botConfig,
       });
     }

     // --- 12. Mark inbox messages as done ---
     await markMessages(supabase, messageIds, "done");

  } finally {
    // Always release the lease (se falhar, o TTL de 120s expira sozinho)
    await supabase.rpc("release_conversation_lock", { p_tenant: tenantId, p_phone: phone });
  }
}
// =============================================================================
// Helpers
// =============================================================================

async function markMessages(supabase: any, ids: string[], status: string) {
  await supabase
    .from("message_inbox")
    .update({ status })
    .in("id", ids);
}
