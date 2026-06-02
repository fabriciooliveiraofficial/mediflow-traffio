# Task List: AI Scheduling Agent v2 — Implementacao

> Plano detalhado em: `.claude/plans/glistening-honking-willow.md`
> 
> Arquivos principais:
> - `traffio-app/supabase/functions/_shared/clinicalAgent.ts`
> - `traffio-app/supabase/functions/process-inbox/index.ts`
> - `traffio-app/supabase/functions/_shared/sessionManager.ts`

---

## Pre-requisitos
- [ ] Ler o plano completo em `.claude/plans/glistening-honking-willow.md`
- [ ] Ler os 3 arquivos na integra antes de iniciar qualquer modificacao

---

## TASK 1: Loop Detection (clinicalAgent.ts)
**Prioridade: CRITICA — resolve repeticao de mensagens**

- [x] 1.1 Adicionar funcao `quickHash(str)` antes da classe ClinicalAgent (~linha 89)
- [x] 1.2 Modificar bloco `finish_reason === "stop"` em `processMessage()` (~linha 2606-2608) para incluir loop detection com hash
- [x] 1.3 Armazenar `recent_response_hashes` (array de 3) no `sessionContext`
- [x] 1.4 Se loop detectado 3+ vezes consecutivas: escalar para humano via `humanHandoffRequested`
- [ ] 1.5 Testar: enviar mesma mensagem 3x e verificar que agent varia resposta

---

## TASK 2: Intermediate Message Dedup (clinicalAgent.ts)
**Prioridade: CRITICA — resolve mensagens duplicadas "Verificando..."**

- [x] 2.1 Adicionar propriedade `private _intermediateMessageSent = false` na classe (~linha 481)
- [x] 2.2 Modificar bloco de intermediate message (~linha 2612-2619) para verificar `_intermediateMessageSent` antes de enviar
- [x] 2.3 Enviar no maximo 1 intermediate message por turno
- [ ] 2.4 Testar: verificar que "Verificando..." aparece apenas 1 vez por turno

---

## TASK 3: First-Turn Guarantee (process-inbox/index.ts)
**Prioridade: CRITICA — resolve falta de apresentacao e coleta de nome**

- [x] 3.1 Adicionar bloco de greeting deterministico ANTES de `const agent = new ClinicalAgent(...)` (~linha 460)
  - [x] Se `!sessionCtx.bot_introduced` e `!patientData.full_name`: enviar greeting template via Z-API sem chamar LLM
  - [x] Setar `bot_introduced: true` no context, logar mensagens, marcar como done, retornar
- [x] 3.2 Adicionar bloco de lead capture (nome) APOS greeting
  - [x] Se `bot_introduced` e `!name_captured` e `!patientData.full_name`: verificar se mensagem e provavel nome
  - [x] Salvar nome no funnel + context, enviar confirmacao de WhatsApp, retornar
- [x] 3.3 Adicionar handler de confirmacao de WhatsApp
  - [x] Se `name_captured` e `!phone_confirmed`: verificar "sim"/"nao"
  - [x] Se sim: confirmar e perguntar como ajudar
  - [x] Se nao: pedir numero correto
- [x] 3.4 Adicionar setup de contexto para paciente ja cadastrado
  - [x] Se `!bot_introduced` e `patientData.full_name`: setar context com nome/flags, deixar LLM tratar
- [ ] 3.5 Testar: enviar "Ola" como paciente novo → receber greeting → responder "Maria" → receber confirmacao WhatsApp → responder "sim" → receber "como posso ajudar?"
- [ ] 3.6 Testar: enviar "Ola" como paciente cadastrado → receber greeting personalizado com nome

---

## TASK 4: Phase-Based Tool Restriction (clinicalAgent.ts)
**Prioridade: ALTA — reduz erros de tool calling**

- [x] 4.1 Adicionar propriedade `private _phaseTools` na classe
- [x] 4.2 Adicionar metodo `getPhaseTools()` que retorna tools filtradas por fase
- [x] 4.3 Setar `_phaseTools` no inicio de `processMessage()` antes do agentic loop
- [x] 4.4 Modificar `callOpenAI()` para usar `this._phaseTools` em vez de `TOOLS`
- [x] 4.5 Adicionar log: `Phase tools: [nomes]`
- [ ] 4.6 Testar: verificar nos logs que tools corretas sao enviadas por fase

---

## TASK 5: Max Turns Enforcement (clinicalAgent.ts)
**Prioridade: ALTA — resolve stuck state**

- [x] 5.1 Adicionar turn tracking no inicio de `processMessage()`: incrementar `total_turns`
- [x] 5.2 Se `total_turns > 25` sem booking: escalar para humano
- [x] 5.3 Adicionar `turns_since_last_tool_success` tracking
- [ ] 5.4 Testar: conversa longa que nao avanca deve escalar para humano

---

## TASK 6: Timeout com Contexto (process-inbox/index.ts)
**Prioridade: MEDIA — melhora experiencia em caso de timeout**

- [x] 6.1 Modificar bloco de timeout (~linha 499-507)
- [x] 6.2 Adicionar mensagens contextuais baseadas no estado:
- [ ] 6.3 Testar: forcar timeout em diferentes fases e verificar mensagem apropriada

---

## TASK 7: Outbound Dedup (process-inbox/index.ts)
**Prioridade: MEDIA — previne mensagem identica em 30s**

- [x] 7.1 Antes de `outbox.sendNow()`: comparar snippet da mensagem com `last_sent_snippet` no context
- [x] 7.2 Se identica e enviada ha menos de 30s: pular envio
- [x] 7.3 Apos envio: salvar `last_sent_snippet` e `last_sent_at` no context
- [ ] 7.4 Testar: verificar que mensagem identica nao e enviada 2x em sequencia

---

## TASK 8: System Prompt Optimization (clinicalAgent.ts)
**Prioridade: MEDIA — reduz tokens e melhora confiabilidade**

- [x] 8.1 Adicionar metodo `getCurrentPhase()` na classe
- [x] 8.2 Modificar `buildSystemPrompt()` para condicionar blocos longos pela fase
- [x] 8.3 Repetir 4 regras criticas no FINAL do prompt (anti lost-in-the-middle)
- [ ] 8.4 Testar: verificar nos logs que prompt size e menor por fase

---

## TASK 9: Tool Failure Recovery (clinicalAgent.ts)
**Prioridade: MEDIA — previne cascata de erros**

- [x] 9.1 Apos execucao de tools no agentic loop: contar failures consecutivas
- [x] 9.2 Se TODAS as tools falharam em um round: incrementar `consecutive_tool_failures`
- [x] 9.3 Se 3+ failures consecutivas: escalar para humano
- [x] 9.4 Resetar contador quando alguma tool tem sucesso
- [ ] 9.5 Testar: simular falha de ferramenta e verificar escalacao

---

## Pos-implementacao

- [x] Deploy Edge Functions: `supabase functions deploy process-inbox && supabase functions deploy whatsapp-bot`
- [ ] Testar fluxo completo E2E via WhatsApp
- [ ] Verificar logs: `supabase functions logs process-inbox --tail`
- [ ] Monitorar primeiras 10 conversas para errosrimeiras 10 conversas para erros

---

## Notas Importantes para o Implementador

1. **NAO criar arquivos novos** — tudo deve ser implementado nos 3 arquivos existentes
2. **NAO remover funcionalidades existentes** — apenas adicionar guards e melhorias
3. **NAO alterar o schema do banco de dados** — os novos campos sao armazenados no JSONB `context` existente
4. **Manter backward compatibility** — sessoes existentes sem os novos campos devem funcionar (usar `|| 0`, `|| []`, etc.)
5. **Ordem de implementacao importa** — Tasks 1-3 sao CRITICAS e devem ser feitas primeiro
6. **Testar cada task individualmente** antes de passar para a proxima
7. **O system prompt em `buildSystemPrompt()` tem ~1350 linhas** (linhas 501-1347) — ao modificar, tomar cuidado para nao quebrar a string template literal
