import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

export type HandoffKind = "soft" | "hard";
export type HandoffReason =
    | "knowledge_gap" | "media" | "tech"                                   // soft
    | "human_request" | "clinical" | "emergency" | "complaint"
    | "price_insistence" | "jailbreak" | "cancel" | "reconciliation"
    | "data_deletion";                                                     // hard

/**
 * Determina se a sessão está em handoff estrito (hard).
 * Sessões em hard handoff (ou atendidas por humano em human_active) bloqueiam o bot autônomo.
 * Sessões em soft handoff em fila (queued + soft) PERMITEM a execução do agente.
 */
export function isHardHandoffSession(session: {
    omnichannel_status?: string | null;
    human_handoff?: boolean | null;
    handoff_kind?: string | null;
}): boolean {
    if (session.omnichannel_status === "human_active") return true;
    if (session.human_handoff && session.handoff_kind !== "soft") return true;
    return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️  CAMINHO CRÍTICO DE RECEITA — O AI AGENT ATENDE OU NÃO
// ═══════════════════════════════════════════════════════════════════════════
// isAutonomousAgentTurn decide se o AI Agent autônomo RESPONDE este turno. É a
// razão nº 1 pela qual os tenants contratam a plataforma: quando NÃO foi
// assumida por um humano, a conversa TEM que ser atendida pela IA, não cair
// calada na fila humana. Já quebrou em produção (2026-07-22/23) por mudanças
// adjacentes; por isso está isolado aqui, como função pura, TRAVADO por testes
// em _tests/evals/agent_attendance_guard_test.ts.
//
// REGRA (não afrouxar sem atualizar os testes-guarda, que rodam antes de deploy):
//   O AI Agent autônomo responde  ⇔  dial === 'ai_always'  E  a sessão NÃO está
//   em handoff estrito (isHardHandoffSession === false).
//
// Consequência que importa: uma conversa em 'queued'/"Aguardando" com
// human_handoff=false (NÃO assumida por ninguém) NÃO é hard handoff → a IA
// DEVE atender. "Aguardando" no inbox é só o estado transitório até a IA
// responder; nunca significa "pulou a IA".
//
// NÃO cobre a camada determinística (structuredFlow) nem o dial 'copilot'
// (rascunho para humano) — só o turno autônomo do AI Agent.
export function isAutonomousAgentTurn(
    activeAgent: string | null | undefined,
    session: { omnichannel_status?: string | null; human_handoff?: boolean | null; handoff_kind?: string | null },
): boolean {
    return activeAgent === "ai_always" && !isHardHandoffSession(session);
}

export interface Session {
    id: string;
    tenant_id: string;
    patient_phone: string;
    current_state: string;
    context: any;
    recent_messages: any[]; // New Enterprise Column
    conversation_summary: any; // New Enterprise Column
    human_handoff: boolean;
    handoff_reason?: HandoffReason | null;
    handoff_kind?: HandoffKind | null;
    handoff_at?: string | null;
    updated_at: string;
    omnichannel_status: string;
    channel?: string;
}

export class SessionManager {
    constructor(private supabase: SupabaseClient) { }

    /**
     * Retrieves an existing session or creates a new one for the patient.
     */
    async getOrCreateSession(tenantId: string, patientPhone: string): Promise<Session> {
        // Passo 1: Verificar se sessão já existe (evita falha de constraint)
        const { data: existing } = await this.supabase
            .from('conversation_sessions')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('patient_phone', patientPhone)
            .maybeSingle();

        if (existing) return existing as Session;

        // Passo 2: Tentar criar nova sessão com colunas base (compatível com migration 01).
        // Colunas adicionadas na migration 05 (omnichannel_status, recent_messages, etc.)
        // são omitidas aqui para não quebrar se a migration ainda não foi aplicada.
        const baseInsert: any = {
            tenant_id: tenantId,
            patient_phone: patientPhone,
            current_state: 'INIT',
            context: {},
            human_handoff: false,
        };

        const { data: newSession, error: insertError } = await this.supabase
            .from('conversation_sessions')
            .insert(baseInsert)
            .select()
            .single();

        if (!insertError && newSession) return newSession as Session;

        // Passo 3: Se o INSERT falhou (race condition), buscar a sessão criada pelo outro request
        if (insertError) {
            console.warn('Session insert conflict, fetching existing:', insertError.message);
            const { data: raceSession, error: fetchError } = await this.supabase
                .from('conversation_sessions')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('patient_phone', patientPhone)
                .single();

            if (raceSession) return raceSession as Session;
            throw new Error(`Failed to get/create session: ${fetchError?.message}`);
        }

        throw new Error('Failed to create session: unknown error');
    }

    /**
     * Updates the session state and context (Atomic Update).
     */
    async updateState(sessionId: string, newState: string, contextUpdate?: any) {
        const updateData: any = { current_state: newState };
        if (contextUpdate) {
            updateData.context = contextUpdate;
        }
        const { error } = await this.supabase
            .from('conversation_sessions')
            .update(updateData)
            .eq('id', sessionId);
        if (error) console.error("Session update failed:", error);
    }

    /**
     * Logs a message to the history and updates rolling memory.
     * Sincroniza notas internas com a ficha do paciente (Enterprise Sticky Notes).
     */
    async logMessage(sessionId: string, role: 'user' | 'assistant' | 'human' | 'internal', content: string, metadata?: any): Promise<string | undefined> {
        // 1. Log to persistent history table (Audit Trail)
        const { data, error: logError } = await this.supabase
            .from('conversation_messages')
            .insert([{
                session_id:           sessionId,
                role:                 role,
                content:              content,
                media_url:            metadata?.media_url,
                message_type:         metadata?.message_type || 'text',
                file_name:            metadata?.file_name,
                mime_type:            metadata?.mime_type,
                file_size:            metadata?.file_size,
                caption:              metadata?.caption,
                duration_s:           metadata?.duration_s,
                ai_raw_response:      metadata?.ai_raw,
                parsed_intent:        metadata?.intent,
                whatsapp_message_id:  metadata?.whatsapp_message_id,
                replied_to_id:        metadata?.replied_to_id,
            }])
            .select('id')
            .single();

        if (logError) console.error("Failed to log message:", logError);

        // 2. Rolling Memory Update (Enterprise Pattern)
        const { data: session } = await this.supabase
            .from('conversation_sessions')
            .select('tenant_id, patient_phone, recent_messages')
            .eq('id', sessionId)
            .single();

        if (session) {
            // Sincronizar Nota Interna com Ficha do Paciente (Sticky Note Pattern)
            if (role === 'internal' && session.tenant_id && session.patient_phone) {
                console.log(`[SessionManager] Syncing internal note to patient ${session.patient_phone}`);
                await this.supabase
                    .from('patients')
                    .update({ notes: content })
                    .eq('tenant_id', session.tenant_id)
                    .eq('phone', session.patient_phone);
            }

            let recent = session.recent_messages || [];
            recent.push({ role, content, timestamp: new Date().toISOString() });

            // Rolling Logic: Keep last 20 turns
            if (recent.length > 20) recent = recent.slice(-20);

            await this.supabase
                .from('conversation_sessions')
                .update({ recent_messages: recent })
                .eq('id', sessionId);
        }
        
        return data?.id;
    }

    /**
     * BUG FIX #1: Ativa o modo human handoff de forma atômica.
     * Grava human_handoff=true E current_state='HUMAN_HANDOFF' em uma única operação,
     * garantindo que futuras mensagens sejam bloqueadas na guarda do index.ts (linha 73).
     */
    async triggerHumanHandoff(
        sessionId: string,
        contextUpdate?: any,
        opts?: { reason?: HandoffReason | null; kind?: HandoffKind | null },
    ) {
        const reason = opts && "reason" in opts ? opts.reason : "tech";
        const kind = opts && "kind" in opts ? opts.kind : "hard";
        const updateData: any = {
            current_state: "HUMAN_HANDOFF",
            human_handoff: true,
            omnichannel_status: "queued",
            handoff_reason: reason,
            handoff_kind: kind,
            handoff_at: new Date().toISOString(),
        };
        if (contextUpdate) {
            updateData.context = contextUpdate;
        }
        const { error } = await this.supabase
            .from("conversation_sessions")
            .update(updateData)
            .eq("id", sessionId);
        if (error) console.error("triggerHumanHandoff failed:", error);
    }

    /**
     * Reabre uma sessão 'closed' para o roteamento NORMAL (estruturado → IA →
     * humano, conforme o dial do tenant) — nunca força humano.
     *
     * Regra de produto (2026-07-22): conversa fechada é neutra. Só fica presa
     * em fila humana quando um atendente ASSUME ativamente (human_active).
     * Uma conversa apenas fechada, ao receber mensagem nova, deve passar pelo
     * Agente de IA como qualquer conversa comum — ele é quem filtra, agenda,
     * responde dúvidas e decide transferir se for o caso.
     *
     * Bug de produção (2026-07-22): sessão 'closed' com human_handoff=true
     * residual (de handoff anterior ao fechamento antigo, que não zerava esse
     * campo) fazia isHardHandoffSession() classificar como hard handoff — a
     * mensagem era logada mas nunca roteada, ficando invisível no Inbox e sem
     * resposta da IA. Esta função limpa TODO o estado de handoff ao reabrir.
     */
    async reopenClosedSession(sessionId: string): Promise<void> {
        const { error } = await this.supabase
            .from("conversation_sessions")
            .update({
                omnichannel_status: "queued",
                human_handoff: false,
                handoff_reason: null,
                handoff_kind: null,
                handoff_at: null,
                closed_at: null,
            })
            .eq("id", sessionId);
        if (error) console.error("reopenClosedSession failed:", error);
    }

    /**
     * Shallow-merge genérico em context (read-modify-write). Usado pelos
     * marcadores de correlação do F2 (pending_recovery/pending_waitlist) e por
     * qualquer chamador que precise gravar uma fatia de context sem sobrescrever
     * o resto (mesmo padrão de updateIntake, generalizado).
     */
    async updateContext(sessionId: string, patch: Record<string, unknown>): Promise<void> {
        const { data: session } = await this.supabase
            .from('conversation_sessions')
            .select('context')
            .eq('id', sessionId)
            .single();

        const context = { ...(session?.context || {}), ...patch };

        const { error } = await this.supabase
            .from('conversation_sessions')
            .update({ context })
            .eq('id', sessionId);
        if (error) console.error('updateContext failed:', error);
    }

    /**
     * F0 (docs/SPEC_AGENTE_IA_CLAUDE.md) — Ficha de estado (slot-filling).
     * Merge raso em context.intake: mensagens fragmentadas ACUMULAM informação
     * em vez de substituí-la. A próxima pergunta do agente é sempre o campo
     * que falta ({ procedure, for_whom, preferred_window, doctor_pref, ... }).
     */
    async updateIntake(sessionId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
        const { data: session } = await this.supabase
            .from('conversation_sessions')
            .select('context')
            .eq('id', sessionId)
            .single();

        const context = session?.context || {};
        context.intake = { ...(context.intake || {}), ...patch };

        const { error } = await this.supabase
            .from('conversation_sessions')
            .update({ context })
            .eq('id', sessionId);
        if (error) console.error('updateIntake failed:', error);
        return context.intake;
    }

    /**
     * F0 — Disjuntor de incompreensão: na N-ésima falha consecutiva (default 2),
     * transfere para humano com o contexto preservado e zera o contador.
     * Retorna true se o disjuntor disparou — o chamador NÃO deve responder de novo
     * (o loop de "desculpe, não entendi" é proibido por construção).
     */
    async registerMisunderstanding(sessionId: string, threshold: number = 2): Promise<boolean> {
        const { data: session } = await this.supabase
            .from('conversation_sessions')
            .select('context')
            .eq('id', sessionId)
            .single();

        const context = session?.context || {};
        const count = (context.misunderstand_count || 0) + 1;

        if (count >= threshold) {
            context.misunderstand_count = 0;
            await this.triggerHumanHandoff(sessionId, context);
            console.warn(`[SessionManager] Misunderstanding circuit breaker tripped (${count}/${threshold}) — session ${sessionId} handed to human`);
            return true;
        }

        context.misunderstand_count = count;
        const { error } = await this.supabase
            .from('conversation_sessions')
            .update({ context })
            .eq('id', sessionId);
        if (error) console.error('registerMisunderstanding failed:', error);
        return false;
    }

    /**
     * Onda 4 — orçamento de risco cumulativo de jailbreak multi-turno: soma o
     * delta de risco desta mensagem (computeJailbreakRiskDelta) ao acumulado da
     * conversa; ao cruzar o threshold, transfere para humano e zera. Ataques
     * lentos (uma sondagem parcial por turno, nenhuma isoladamente crítica) não
     * disparam nenhum validador de turno único — só o acúmulo.
     */
    async registerJailbreakSignal(sessionId: string, delta: number, threshold: number = 4): Promise<boolean> {
        if (!delta) return false;
        const { data: session } = await this.supabase
            .from('conversation_sessions')
            .select('context')
            .eq('id', sessionId)
            .single();

        const context = session?.context || {};
        const score = (context.jailbreak_risk_score || 0) + delta;

        if (score >= threshold) {
            context.jailbreak_risk_score = 0;
            await this.triggerHumanHandoff(sessionId, context);
            console.warn(`[SessionManager] Jailbreak risk budget tripped (${score}/${threshold}) — session ${sessionId} handed to human`);
            return true;
        }

        context.jailbreak_risk_score = score;
        const { error } = await this.supabase
            .from('conversation_sessions')
            .update({ context })
            .eq('id', sessionId);
        if (error) console.error('registerJailbreakSignal failed:', error);
        return false;
    }

    /** F0 — Turno compreendido: zera o contador do disjuntor (se necessário). */
    async resetMisunderstanding(sessionId: string): Promise<void> {
        const { data: session } = await this.supabase
            .from('conversation_sessions')
            .select('context')
            .eq('id', sessionId)
            .single();

        const context = session?.context || {};
        if (!context.misunderstand_count) return; // nada a zerar — evita write inútil

        context.misunderstand_count = 0;
        const { error } = await this.supabase
            .from('conversation_sessions')
            .update({ context })
            .eq('id', sessionId);
        if (error) console.error('resetMisunderstanding failed:', error);
    }

    /**
     * Fetches history context from Rolling Memory (Fast).
     */
    async getHistory(sessionId: string, limit: number = 10): Promise<{ role: string, content: string }[]> {
        // Now efficiently reads from the session JSONB column
        const { data } = await this.supabase
            .from('conversation_sessions')
            .select('recent_messages')
            .eq('id', sessionId)
            .single();

        const messages = data?.recent_messages || [];
        // Map to simpler format if needed by ContextBuilder
        return messages.map((m: any) => ({ role: m.role, content: m.content }));
    }
}
