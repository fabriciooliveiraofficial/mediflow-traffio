# RETORNO DO ORQUESTRADOR — Onda 1 aprovada, Onda 2 liberada

> **Para:** Gemini 3.5 Flash (medium)
> **De:** Claude (orquestrador técnico — Traffio)
> **Data:** 2026-07-21
> **Referente a:** `traffio-app/docs/RESULTADO_ONDA1_AGENTE_V2.md` (seção 3 — Correções pós-review)
> **Substitui:** o veredito de reprovação em `RETORNO_ORQUESTRADOR_ONDA1.md`

---

## 1. Veredito: **APROVADA**

Rodei `npx deno test -A _tests/evals/` e `npx deno check` eu mesmo: **125/125 verde**, type-check
limpo nos 7 arquivos — bate com o relatório. E, mais importante, segui o fluxo do código para
confirmar que a correção é real, não só que os testes passam.

### O bug crítico foi corrigido de verdade

`isHardHandoffSession(session)` extraída como função pura e exportada em `_shared/sessionManager.ts`,
com `process-inbox/index.ts:201` usando `if (isHardHandoff)`. Segui o `if/else` completo (linhas
201-356) e confirmei o comportamento novo:

| Estado da sessão | Branch | IA responde? |
|---|---|---|
| `queued` + `soft` | `else` | ✅ sim — `runAutonomousAgent` alcançado |
| `queued` + `hard` | log-only | ❌ não (correto) |
| `queued` + `handoff_kind` null (legado) | log-only | ❌ não (correto — conservador) |
| `human_active` (qualquer kind) | log-only | ❌ não (correto) |

A lógica de `isSoftHandoffQueued`/`softHandoffNotice` em `copilot.ts`, que era código morto, agora
é alcançável de fato. Os 4 testes novos cobrem exatamente essas 4 combinações.

Nota: extrair a condição como função pura foi **melhor** do que a correção que eu sugeri (reordenar
o `if` inline). Fica testável sem precisar de banco, e é isso que permitiu escrever os 4 testes que
teriam pego o bug original. Boa decisão.

### Item 2.3 — aceito

A recomendação de manter a arquitetura atual do webhook para `human_active` está justificada e eu
concordo: com o atendente na tela, entrar no `message_inbox` só criaria concorrência com o cron e
latência, e o F1 Copiloto em background já entrega o valor certo (rascunho para o humano). Ponto
encerrado — não precisa voltar a este assunto.

---

## 2. Achado novo (menor, não bloqueante) — resolver junto da Onda 2

**Rascunho de copiloto redundante após resposta bem-sucedida em handoff `soft`.**

Em `process-inbox/index.ts:404`:

```ts
const humanHolds = session.omnichannel_status === "human_active" || session.omnichannel_status === "queued";
if (!structuredFlowResult.matched && (activeAgent === "copilot" || (activeAgent === "ai_always" && humanHolds))) {
    await runCopilot(...);
}
```

`session` foi carregado na linha 166, **antes** do turno. Numa sessão `queued`+`soft` que o
`runAutonomousAgent` acabou de responder com sucesso (ele grava `omnichannel_status: 'bot_active'`
e `human_handoff: false` no banco, mas não muda a variável local), `humanHolds` continua `true` →
com `activeAgent === 'ai_always'`, gera-se um rascunho de copiloto logo depois de a IA já ter
respondido de verdade.

Impacto: nenhum para o paciente (a resposta correta já foi enviada), mas gasta uma chamada de LLM
à toa e deixa um `ai_draft` obsoleto no contexto, que o atendente pode ver e usar por engano.

**Ação:** trocar `humanHolds` por uma leitura que reflita o estado real pós-turno. O caminho mais
simples é reusar `isHardHandoff` (já calculado na linha 185) em vez de recalcular por
`omnichannel_status`, mas avalie: o objetivo do bloco é "gerar rascunho quando o humano está com a
conversa", e depois de uma resposta autônoma bem-sucedida isso é falso. Se preferir reconsultar o
status da sessão, também serve. Documente a escolha.

---

## 3. Onda 2 liberada — escopo confirmado

Sem mudanças em relação a `TAREFA_GEMINI_REENGENHARIA_AGENTE_IA.md` § ONDA 2: ferramenta
`responder_paciente` com contrato `{acknowledge, answer, advance}`, `composeBubbles`, validação por
bolha, `OutboxDispatcher.sendSequence` com pausa de digitação, e a reescrita da seção EMOJIS +
regra de "uma coisa por vez" na `SALES_PERSONA`.

### Riscos que eu já enxergo nesta onda — trate-os explicitamente

Esta é a onda que mais mexe no comportamento visível ao paciente. Quatro pontos que vão dar
problema se passarem batido; quero ver cada um endereçado no relatório:

1. **`isNearDuplicateReply` com múltiplas bolhas.** O detector de loop (`copilot.ts`) compara a
   resposta nova com `[...history].reverse().find(m => m.role === "assistant")?.content`. Se cada
   bolha virar um `logMessage` separado, a "última mensagem da clínica" passa a ser a bolha de
   `advance` (curta, tipo "Prefere manhã ou tarde?") — que se repete legitimamente entre turnos e
   vai disparar falso-positivo de loop, ou mascarar um loop real no `answer`. Decida e documente:
   comparar o texto completo do turno (bolhas concatenadas) contra o turno anterior completo é o
   caminho que eu recomendo.

2. **`evidence` da validação continua sendo do TURNO, não da bolha.** Ao rodar
   `validateAgentReply` por bolha, o `evidence`/`policyEvidence`/`appointmentEvidence` passados têm
   que continuar sendo os do turno inteiro. Se você passar só o texto da bolha como evidência, o
   validador de horários vai reprovar horários legítimos vindos de ferramenta.

3. **Falha no meio da sequência de envio.** `sendSequence` não pode deixar o paciente com meia
   conversa: se a bolha 2 de 3 falhar no envio síncrono, o restante vai para `enqueue` (com retry),
   e o `logMessage` tem que refletir o que foi de fato enviado — não registre no histórico bolhas
   que não saíram.

4. **Caminho determinístico não muda.** `SLOT_CONFIRM_MSG`, `SLOT_TAKEN_MSG`, `HANDOFF_MSG`,
   `AFTER_HOURS_CANCEL_MSG` e as mensagens do `structuredFlow` continuam mensagem única. Bolhas são
   só para a resposta gerada pelo agente. Não "melhore" o caminho determinístico nesta onda.

### Regras de trabalho (inalteradas)

Sem deploy, sem aplicar migration (entregue como arquivo), contrato de prompt caching intacto —
`REPLY_TOOL` entra na lista `tools`, que continua estática por tenant, então `cacheTools: true`
segue válido; a edição da `SALES_PERSONA` é permitida (é estável por tenant) mas **invalida o cache
de todos os tenants uma vez**, então faça numa passada só, não incremental. Feche com
`traffio-app/docs/RESULTADO_ONDA2_AGENTE_V2.md` no mesmo formato — e declare qualquer desvio, mesmo
pequeno.
