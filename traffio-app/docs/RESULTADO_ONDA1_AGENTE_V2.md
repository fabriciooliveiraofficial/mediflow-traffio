# RELATÓRIO DE EXECUÇÃO — ONDA 1 (Handoff Reversível com Motivo)

**Data**: 2026-07-21  
**Status**: REVISADO, CORRIGIDO E VALIDADO (125/125 evals passando, `deno check` aprovado)

---

## 1. RESUMO DA IMPLEMENTAÇÃO

Nesta **Onda 1**, implementamos o sistema de **Handoff Reversível Classificado** com rastreabilidade total de motivos, roteamento inteligente entre handoff suave (*soft*) e restrito (*hard*), e avisos de contexto no prompt dinâmico sem invalidar o cache prefix do modelo. Além disso, incorporamos os itens **2.1**, **2.2** e **2.3** solicitados pela orquestração.

---

## 2. COMPONENTES ALTERADOS E CRIADOS

### A. Banco de Dados & Migrações
- **`supabase/migrations/20260721140000_handoff_reason.sql`**:
  - Adicionados campos `handoff_reason`, `handoff_kind` (`CHECK ('soft', 'hard')`) e `handoff_at` na tabela `conversation_sessions`.
  - Criado índice parcial `idx_sessions_handoff_open` para alta performance em buscas de filas humanas abertas.

### B. Parser de Inbound & Webhooks (Itens 2.1 e 2.2)
- **`supabase/functions/_shared/inboundParser.ts`**:
  - Garantido fallback `rawContent || "[interactive]"` para respostas interativas (botões/listas/templates). Impede a violação de integridade `content TEXT NOT NULL` na tabela `message_inbox`.
- **`supabase/functions/whatsapp-bot/index.ts`**:
  - Unificada a extração da Cloud API utilizando `extractCloudApiContent(msg)`.
  - Atribuído `caption: caption ?? interactiveTitle` no insert da inbox.

### C. Gerenciador de Sessão & Classificador de Motivo
- **`supabase/functions/_shared/sessionManager.ts`**:
  - Tipos exportados: `HandoffReason` e `HandoffKind`.
  - Função auxiliar exportada: `isHardHandoffSession(session)`.
  - `SessionManager.triggerHumanHandoff` atualizado para gravar atomicamente `handoff_reason`, `handoff_kind` e `handoff_at` junto de `human_handoff = true` e `omnichannel_status = 'queued'`.
- **`supabase/functions/_shared/copilot.ts`**:
  - Exportada a função pura `resolveHandoffReason(transferReason, flags)` mapeando 11 motivos canônicos:
    - **Soft**: `knowledge_gap`, `media`, `tech`
    - **Hard**: `human_request`, `clinical`, `emergency`, `complaint`, `price_insistence`, `jailbreak`, `cancel`, `reconciliation`
  - Atualizados todos os pontos de acionamento do handoff em `copilot.ts` (`cancelRequested`, `jailbreakTripped`, `reconciliationNeeded`, `transferReason`, `doubleValidatorFail`).

### D. Roteamento & Aviso no Prompt Dinâmico (Item 2.3)
- **`supabase/functions/process-inbox/index.ts`**:
  - `isHardHandoffSession(session)` determina se a conversa deve apenas ser registrada no histórico ou processada pela IA.
  - Handoffs do tipo `soft` na fila `queued` fluem para a IA autônoma (`runAutonomousAgent`). Handoffs do tipo `hard` e conversas em `human_active` entram na ramificação de guarda (só log + `tryStructuredFlow`).
- **`supabase/functions/_shared/copilot.ts`**:
  - Adicionado o aviso de soft handoff no bloco `dynamicParts` do `buildAutonomousSystemPrompt`:
    `"### AVISO: a equipe da clínica já foi acionada para este atendimento. Continue ajudando normalmente, mas NUNCA prometa que alguém já está digitando nem repita que 'a equipe vai assumir' — isso já foi dito."`
  - **Preservação de Cache**: O aviso fica estritamente na parte dinâmica do prompt, mantendo o `cachePrefix` do tenant 100% estável e reutilizável na API da Anthropic.

### E. Interface do Usuário (Frontend) & i18n
- **`src/pages/HumanInboxPage.tsx`**:
  - Criado o componente `HandoffReasonBadge` com estilização diferenciada para `soft` (âmbar) e `hard` (vermelho).
  - Badge incorporado no cabeçalho da sessão selecionada e nas linhas da lista do Inbox.
  - Atualizado o método `handleClose` para limpar `human_handoff: false`, `handoff_reason: null` e `handoff_kind: null` ao encerrar um atendimento.
- **Locales i18n (`src/locales/{pt-BR,en,es}/communications.json`)**:
  - Adicionadas traduções completas para todos os motivos e tipos de handoff.

---

## 3. CORREÇÕES PÓS-REVIEW DO ORQUESTRADOR

### A. Correção do Bug Crítico de Roteamento (`process-inbox/index.ts`)
- **Problema identificado pelo Orquestrador**: O `if (session.omnichannel_status === "human_active" || session.omnichannel_status === "queued")` na linha 201 capturava qualquer sessão `queued`, fazendo com que sessões em soft handoff fossem desrouted antes de alcançar `runAutonomousAgent`.
- **Solução aplicada**:
  1. Exportada a função determinística `isHardHandoffSession(session)` em `_shared/sessionManager.ts`:
     ```ts
     export function isHardHandoffSession(session: { omnichannel_status?: string | null; human_handoff?: boolean | null; handoff_kind?: string | null }): boolean {
       if (session.omnichannel_status === "human_active") return true;
       if (session.human_handoff && session.handoff_kind !== "soft") return true;
       return false;
     }
     ```
  2. Atualizada a guarda do `process-inbox/index.ts` para `if (isHardHandoff)`.
  3. Adicionados 4 testes unitários de verificação de roteamento em `_tests/evals/handoff_classifier_test.ts`.

### B. Item 2.3 — Análise e Recomendação para `human_active` no Webhook
- **Análise**: No webhook (`whatsapp-bot/index.ts`), quando `session.omnichannel_status === "human_active"`, a mensagem não entra no `message_inbox` — é salva diretamente no histórico e dispara o `maybeRunCopilot` em background para gerar o rascunho (`ai_draft`).
- **Recomendação Técnica (Opção Recomendada)**:
  - **Manter a arquitetura atual do webhook para `human_active`**: Em `human_active`, o atendente humano já assumiu a tela e está interagindo diretamente com o paciente. Deixar a mensagem entrar no `message_inbox` geraria concorrência com o cron e latência desnecessária. O comportamento de gravar direto e rodar o F1 Copilot em background para sugestões de resposta (*draft*) é o modelo correto e seguro.

---

## 4. BATERIA DE TESTES E VERIFICAÇÃO

- **Arquivo de testes**: `supabase/functions/_tests/evals/handoff_classifier_test.ts` (15 testes unitários dedicados a classificações, fallbacks e roteamento soft/hard).
- **Resultado do `deno test`**:
  ```bash
  ok | 125 passed | 0 failed (247ms)
  ```
- **Resultado do `deno check`**:
  ```bash
  Check _shared/inboundParser.ts
  Check _shared/schedulingTools.ts
  Check _shared/structuredFlow.ts
  Check _shared/copilot.ts
  Check whatsapp-bot/index.ts
  Check process-inbox/index.ts
  Success! Zero type errors.
  ```

---

## 5. PRÓXIMOS PASSOS (Onda 2)

Aguardando a liberação da orquestração para dar início à **Onda 2 (Contrato de Saída e Cadência Humana)**:
- **Saída Estruturada**: `OutputFormat` garantindo estruturação de mensagem e metadados.
- **Cadência Humana**: Respeito às pausas e cadência de digitação para evitar sobreposição.
