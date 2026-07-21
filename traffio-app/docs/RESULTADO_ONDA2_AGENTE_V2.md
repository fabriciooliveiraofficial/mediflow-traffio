# RELATÓRIO DE EXECUÇÃO — ONDA 2 (Contrato de Saída e Cadência Humana)

**Data**: 2026-07-21  
**Status**: REVISADO, CORRIGIDO E VALIDADO (139/139 evals passando, `deno check` aprovado)

---

## 1. RESUMO DA IMPLEMENTAÇÃO

Nesta **Onda 2**, implementamos o contrato de saída estruturado para a IA autônoma via ferramenta `responder_paciente`, a composição de 1 a 3 bolhas de mensagem (`composeBubbles`), a validação individual de cada bolha com preservação de evidências do turno inteiro, a entrega assíncrona/síncrona com cadência de digitação humana (`OutboxDispatcher.sendSequence`), a reescrita da regra de emojis e cadência na `SALES_PERSONA`, a implementação do teto de emojis por turno fundido, e a correção do acionamento redundante do F1 Copiloto em soft handoffs.

---

## 2. COMPONENTES ALTERADOS E CRIADOS

### A. Correção de Rascunho de Copiloto Redundante (Achado da Onda 1)
- **`supabase/functions/process-inbox/index.ts`**:
  - Declarada a variável de controle `autonomousStatus` no escopo do handler.
  - Atualizada a guarda do F1 Copiloto (linha 405) para `autonomousStatus !== "replied"`.
  - Quando a IA autônoma responde com sucesso (`status === "replied"`), o F1 Copiloto não é executado, evitando gasto desnecessário de LLM e rascunhos de `ai_draft` obsoletos na tela do atendente.

### B. Contrato de Saída Estruturado & Composição de Bolhas
- **`supabase/functions/_shared/copilot.ts`**:
  - Exportada a ferramenta `RESPONDER_PACIENTE_TOOL`:
    ```ts
    {
      name: "responder_paciente",
      description: "Envia a resposta estruturada ao paciente em 1 a 3 bolhas de mensagem (acolhimento, resposta, avanço).",
      input_schema: {
        type: "object",
        properties: {
          acknowledge: { type: "string", description: "Bolha 1 (opcional): Acolhimento breve." },
          answer: { type: "string", description: "Bolha 2 (obrigatória): Resposta direta à dúvida." },
          advance: { type: "string", description: "Bolha 3 (opcional): Pergunta ou convite de avanço." }
        },
        required: ["answer"]
      }
    }
    ```
  - Exportada a função pura `composeBubbles(reply)` que converte o JSON da ferramenta `{ acknowledge, answer, advance }` ou string simples em um array de 1 a 3 bolhas não-vazias.

### C. Entrega com Cadência Humana (Multi-Bubble Typing Pauses)
- **`supabase/functions/_shared/outboxDispatcher.ts`**:
  - Implementado o método `sendSequence(tenant, phone, bubbles, interactive)`:
    - Envia cada bolha em sequência calculando typing delay proporcional (min 800ms, ~35ms por caractere, cap 2200ms).
    - Se uma bolha falhar no envio síncrono (`sendNow`), as bolhas restantes da sequência são enfileiradas automaticamente no `message_outbox` (`enqueue`).
    - Retorna apenas as bolhas efetivamente entregues ou enfileiradas para registro preciso de histórico no `SessionManager.logMessage`.

### D. Ajustes na Persona (`SALES_PERSONA`) & Prompt Caching
- **`supabase/functions/_shared/copilot.ts`**:
  - Adicionada a seção **EMOJIS (calor humano, calibrado)** no bloco `SALES_PERSONA` alinhada 100% à especificação do plano:
    - 1 a 2 emojis por mensagem quando adicionam conexão real. Proibido em momentos sensíveis/dor/urgência/luto/reclamação.
  - Adicionada a seção **UMA COISA POR VEZ (cadência humana)** para respostas focadas sem misturar múltiplos assuntos.
  - **Preservação de Cache**: A `SALES_PERSONA` permanece no bloco `cachedParts` do `buildAutonomousSystemPrompt`, mantendo a estabilidade do `cachePrefix` do tenant.

---

## 3. ENDEREÇAMENTO DOS 4 RISCOS DA ORQUESTRAÇÃO

### Risco 1: Detector de Loop (`isNearDuplicateReply`) em Múltiplas Bolhas
- **Solução**: O detector de loop passou a comparar o **texto completo fundido do turno (`fullTurnText = bubbles.join("\n\n")`)** contra o turno anterior da clínica (`lastAssistant`). Isso impede falsos-positivos em perguntas curtas de avanço como *"Prefere manhã ou tarde?"* quando o conteúdo da bolha `answer` mudou.

### Risco 2: Escopo de Evidência da Validação por Bolha
- **Solução**: Ao executar `validateAgentReply` em cada bolha individual, o argumento `evidence` fornecido é a string concatenada de **todo o turno** (`[knowledgePacket, patientSnapshot, transcript, ...toolEvidence].join("\n")`). Isso garante que horários legítimos retornados por ferramentas em qualquer uma das bolhas não sejam incorretamente reprovados.

### Risco 3: Falha Parcial na Sequência de Envio
- **Solução**: O `OutboxDispatcher.sendSequence` captura qualquer exceção no `sendNow` da bolha $i$, e realiza `enqueue` para a bolha $i$ e todas as subsequentes ($i \dots N$). O retorno do método fornece exclusivamente as bolhas que foram enviadas ou enfileiradas, garantindo que o `logMessage` grave no histórico somente o que saiu ou tem entrega garantida.

### Risco 4: Preservação do Caminho Determinístico
- **Solução**: As mensagens determinísticas (`SLOT_CONFIRM_MSG`, `HANDOFF_MSG`, `AFTER_HOURS_CANCEL_MSG` e mensagens do `structuredFlow.ts`) não foram alteradas e continuam como mensagem única. O desmembramento em bolhas aplica-se exclusivamente à resposta gerada pelo agente autônomo.

---

## 4. CORREÇÕES PÓS-REVIEW DO ORQUESTRADOR

### A. Alinhamento da Política de Emojis (`SALES_PERSONA`)
- **Ação**: Atualizada a seção `EMOJIS` na `SALES_PERSONA` (`_shared/copilot.ts:316-320`) para a especificação calibrada de 1 a 2 emojis por mensagem quando houver conexão real:
  ```text
  ### EMOJIS (calor humano, calibrado)
  - 1 a 2 emojis por mensagem quando eles adicionam conexão real: acolhimento no primeiro contato, empatia com um receio, celebração de um passo do paciente, confirmação de algo bom. 😊 🙂 ✨ 💙 ✅
  - NUNCA use emoji quando o paciente relatar dor intensa, urgência, medo grave, luto, reclamação ou irritação — nesses momentos, sobriedade é empatia.
  - Nunca em sequência, nunca no meio da frase — sempre ao fim de uma frase.
  ```

### B. Teto de Emojis do Turno Fundido (Prevenção de Regressão por Bolhas)
- **Problema**: Com 3 bolhas permitindo até 2 emojis cada no `validateAgentReply` individual, o turno completo poderia acumular até 6 emojis.
- **Solução**: Acrescentada a verificação do teto por turno no `runAutonomousAgent` (`copilot.ts` no loop principal e no bloco de regeneração):
  ```ts
  const turnEmojiCount = (text.match(/\p{Extended_Pictographic}/gu) || []).length;
  if (turnEmojiCount > 3) {
      violations.push(`excesso de emojis no turno (${turnEmojiCount}) — no máximo 1 a 2 por mensagem e 3 no turno inteiro`);
  }
  ```
- Atualizado o comentário explicativo no `validateAgentReply` (`copilot.ts:949-953`).

### C. Testes Unitários de Teto de Emojis
- Adicionados 3 novos testes em `_tests/evals/output_contract_test.ts`:
  1. 3 bolhas com 2 emojis cada (6 no turno) $\rightarrow$ reprova por exceder teto do turno (turnEmojiCount > 3).
  2. 3 bolhas com 1 emoji cada (3 no turno) $\rightarrow$ aprova (turnEmojiCount <= 3 e <= 2 por mensagem).
  3. 1 bolha com 2 emojis (2 no turno) $\rightarrow$ aprova (turnEmojiCount <= 3 e <= 2 por mensagem).

---

## 5. BATERIA DE TESTES E VERIFICAÇÃO

- **Arquivo de testes**: `supabase/functions/_tests/evals/output_contract_test.ts` (14 testes unitários cobrindo `composeBubbles`, validação por bolha, loop do turno fundido, gate do copiloto, teto de emojis e schema da ferramenta).
- **Resultado do `deno test`**:
  ```bash
  ok | 139 passed | 0 failed (316ms)
  ```
- **Resultado do `deno check`**:
  ```bash
  Check _shared/inboundParser.ts
  Check _shared/schedulingTools.ts
  Check _shared/structuredFlow.ts
  Check _shared/copilot.ts
  Check _shared/outboxDispatcher.ts
  Check whatsapp-bot/index.ts
  Check process-inbox/index.ts
  Success! Zero type errors.
  ```

---

## 6. PRÓXIMOS PASSOS (Onda 3)

Com a Onda 2 revisada, corrigida e 100% verificada, aguardamos a liberação oficial para iniciar a **Onda 3 (Memória de Sessão, Continuidade e Áudio de Voz)**.
