# SPEC — Reativação da IA com a família Claude (dial de autonomia)

> **Decisão:** família Claude — `claude-sonnet-5` para conversar e operar ferramentas,
> `claude-haiku-4-5-20251001` para classificar/extrair. Modelo pequeno para classificar,
> modelo grande para conversar e decidir ferramenta — nunca o inverso.
>
> **Princípio:** a IA é um dial, não um interruptor. Nenhum nível autônomo entra em
> produção sem a fundação de ingestão (F0) e sem passar na suíte de evals.

## Estado atual (verificado no código, 07/2026)

- [process-inbox](../supabase/functions/process-inbox/index.ts) **não chama agente nenhum** — debounce 1,2s + advisory lock + fusão, e roteia tudo para a fila humana. O comentário "Run ClinicalAgent" é obsoleto.
- [clinicalAgent.ts](../supabase/functions/_shared/clinicalAgent.ts) (V6, OpenAI `gpt-4o-mini`, hardcoded `api.openai.com`) está **dormente**; `clinicalAgent_debug.txt` é o agendador autônomo abandonado (prompt 5.000+ tokens, "Lost-in-the-Middle" documentado em auditoria).
- [chatAgent.ts](../supabase/functions/_shared/chatAgent.ts) é determinístico (sem LLM) — é o motor natural do Nível 1.
- Dial por tenant já existe: `bot_config.active_agent: 'human' | 'ai_assistant' | 'flow_bot'`.
- Chaves de API em `master_config` (key/value) — ex.: `OPENAI_API_KEY` usada pelo embed-knowledge.

## Fases

### F0 — Fundação de ingestão (pré-requisito de qualquer nível)

Alterações no **process-inbox**:

1. **Debounce condicionado ao dial** *(implementado)*: `AI_DEBOUNCE_MS = 10s` aplicado **apenas** quando a IA autônoma vai responder o turno (`active_agent` em `ai_assistant`/`flow_bot` e sessão fora de `human_active`/`queued`). O fluxo humano e o copiloto continuam no debounce curto (1,2s) — o atendente não pode pagar 10s de latência. Mensagens deferidas voltam a `pending` e o próximo ciclo reprocessa a rajada completa fundida.
2. **Cancelar-e-regenerar** *(entra com a F1 — exige um passo de geração para cancelar)*: imediatamente antes de enviar a resposta gerada, verificar se chegaram mensagens novas (`message_inbox.status='pending'` do mesmo telefone após o cutoff). Se sim: **descartar a resposta**, devolver o batch para `pending` e deixar o próximo ciclo reprocessar. Nunca responder a um contexto que já mudou.
3. **Disjuntor de incompreensão** *(implementado — `SessionManager.registerMisunderstanding/resetMisunderstanding`)*: contador `misunderstand_count` no `context` da sessão; na 2ª consecutiva → `triggerHumanHandoff` com contexto preservado, contador zerado. O loop de "desculpa, não entendi" é proibido por construção. O agente (F1+) sinaliza via ferramenta `sinalizar_incompreensao`.
4. **Ficha de estado (slot-filling)** *(implementado — `SessionManager.updateIntake`, merge raso em `context.intake`)*: `{ procedure, for_whom, preferred_window, doctor_pref, ... }` — atualizado a cada turno pelo extrator (Haiku, F1). Mensagens fragmentadas **acumulam** em vez de substituir contexto; a próxima pergunta do agente é sempre o único campo faltante.

### F1 — Camada de provedor + Copiloto (Nível 0)

**`_shared/llmProvider.ts`** — abstração fina de provedor:

- Interface única: `chat({ system, messages, tools, model, maxTokens }) → { text, toolCalls, stopReason }`.
- **Adapter Anthropic** (Messages API via `fetch` em `https://api.anthropic.com/v1/messages`, header `anthropic-version`): system prompt separado do array de mensagens, `tool_use`/`tool_result` como content blocks, `input_schema` nas ferramentas.
- **Adapter OpenAI** mantido para retrocompatibilidade (embeddings continuam OpenAI — não mexer no embed-knowledge nesta fase).
- Config em `master_config`: `ANTHROPIC_API_KEY`, `AI_MODEL_AGENT` (default `claude-sonnet-5`), `AI_MODEL_ROUTER` (default `claude-haiku-4-5-20251001`). Troca de modelo sem redeploy.

**Copiloto no Inbox** — novo valor do dial: `active_agent: 'copilot'`:

- No process-inbox, após logar a mensagem e rotear para a fila humana (fluxo atual intocado), gerar **rascunho** com Sonnet (prompt enxuto + ficha + RAG) e salvar em `context.ai_draft = { text, created_at, based_on_message_id }`.
- HumanInboxPage exibe o rascunho acima do composer: "Sugerido pela IA — [Usar] [Descartar]". **Zero envio automático.** Clique em "Usar" preenche o composer (o humano ainda revisa e envia pelo fluxo existente).
- Triagem quente/frio: Haiku classifica a intenção e grava `context.lead_temperature` — alimenta a fila F1 da tela Hoje e o CRM.

### F2 — Nível 1: fluxos estruturados autônomos

- Confirmações, recovery e waitlist respondidos automaticamente **apenas** quando a resposta do paciente casa com um fluxo fechado (botões da Z-API ou lista numerada — fallback textual obrigatório, ver instabilidade documentada dos botões).
- Motor: **chatAgent determinístico** + Haiku só para casar resposta livre com opção ("pode ser a segunda opção" → slot 2). Sonnet não participa — não há geração livre no Nível 1.

### F3 — Nível 2: agendamento conversacional (gate de evals)

- Sonnet com ferramentas: `ver_disponibilidade`, `agendar`, `remarcar`, `cancelar`, `buscar_meu_agendamento`, `transfer_to_human`, `sinalizar_incompreensao`. O modelo **nunca** gera horário/preço/endereço — só texto conectivo em volta do retorno das ferramentas.
- **Prompt novo: máx. 1.500 tokens**, regras críticas no início e no fim, RAG resumido (não colar a base inteira). O prompt de 5.000 tokens não volta.
- Escopo bloqueado: preço, questões clínicas e reclamações → `transfer_to_human` imediato (regra reforçada por verificação pós-geração: resposta que contém padrão de preço sem tool-result correspondente é descartada → handoff).

## Suíte de evals (gate obrigatório entre fases)

`supabase/functions/_tests/evals/` — cenários em JSONL + runner (Deno) que simula conversas contra o agente com ferramentas mockadas:

| Cenário obrigatório | Aprovação |
|---|---|
| Enxurrada (5 msgs fragmentadas em 10s) | 1 única resposta, contexto fundido correto |
| Remarcação de consulta existente | usa `buscar_meu_agendamento` + `remarcar`, nunca inventa horário |
| Pergunta de preço | `transfer_to_human`, sem valor citado |
| Ferramenta retorna erro | informa contratempo + handoff; **não inventa** disponibilidade |
| 2 incompreensões seguidas | disjuntor dispara handoff |
| Botões indisponíveis | fallback lista numerada, parser aceita dígito |
| pt-BR / en / es | resposta no idioma do paciente |

Regra: mudou prompt, modelo ou ferramenta → roda a suíte. Sem verde, não sobe de nível.

## Custos e salvaguardas

- Conversa típica de agendamento (6–10 turnos): ~R$0,15–0,40 com Sonnet; triagem/extração com Haiku ~R$0,01–0,03. 300 conversas/mês ≈ R$50–120/tenant.
- Contador mensal de tokens por tenant (`bot_config.ai_usage`) com teto suave: excedeu → dial cai para `copilot` + aviso ao tenant (nunca corta o atendimento — degrada a autonomia).
- Logs de cada chamada (modelo, tokens, latência, tool calls) para auditoria e tuning.

## Fora de escopo desta spec

- Áudio/voz (transcrição de áudio do paciente) — fase posterior.
- Trocar o provedor de embeddings (RAG continua OpenAI).
- UI de configuração do dial no Intelligence (usa o campo existente; UI refinada vem com a reorganização do menu).

## Ordem de implementação

1. **F0** no process-inbox (sem LLM — só engenharia; deploy independente e seguro).
2. **F1** llmProvider + ANTHROPIC_API_KEY + copiloto + triagem (primeiro valor visível; risco zero diante do paciente).
3. Suíte de evals rodando com os cenários F2.
4. **F2** estruturado autônomo → medir → **F3** conversacional.
