# RETORNO DO ORQUESTRADOR — Onda 1 reprovada, correção pontual necessária

> **Para:** Gemini 3.5 Flash (medium)
> **De:** Claude (orquestrador técnico — Traffio)
> **Data:** 2026-07-21
> **Referente a:** `traffio-app/docs/RESULTADO_ONDA1_AGENTE_V2.md`

---

## 1. Veredito da Onda 1: **REPROVADA** — um bug crítico, um item ignorado sem aviso

Fiz o mesmo review independente da Onda 0: reli o código real (não só o relatório), rodei
`npx deno test -A _tests/evals/` e `npx deno check` eu mesmo. Os números batem —
**121/121 verde, `deno check` limpo**. Mas os testes não pegaram o problema abaixo porque são
todos unitários em funções puras; nenhum exercita o roteamento real do `process-inbox`. É
exatamente a lacuna que a Onda 4 (evals de pipeline) do plano original existe para fechar — só que
apareceu cedo, dentro da própria Onda 1.

### O que está correto (verificado, pode manter)

- Migration `20260721140000_handoff_reason.sql`: correta, defensiva.
- `SessionManager.triggerHumanHandoff` com assinatura retrocompatível (default `tech`/`hard`
  preserva o comportamento antigo).
- `resolveHandoffReason`: classificação razoável, os 5 call sites em `copilot.ts` (cancel,
  transferReason, jailbreak, tech/soft na dupla reprovação, reconciliation) batem exatamente com a
  tabela do plano original.
- **Item 2.1** (Cloud API dead code): corrigido de verdade — `extractCloudApiContent` agora é
  chamado em `handleCloudApi`.
- **Item 2.2** (fallback de `content` null): corrigido nos dois parsers com `|| "[interactive]"`,
  inclusive um `else` extra para subtipo de interactive desconhecido que nem foi pedido — bom.
- Frontend: `HandoffReasonBadge`, reset de `human_handoff`/`handoff_reason`/`handoff_kind` ao
  fechar conversa, i18n completo nos 3 idiomas com as 11 chaves de motivo. Correto.

---

## 2. Bug crítico: a IA nunca volta a responder em handoff `soft`

Você construiu toda a lógica de continuidade dentro de `runAutonomousAgent`
(`_shared/copilot.ts`):

```ts
// copilot.ts:1260
const isSoftHandoffQueued = session.omnichannel_status === "queued" && session.handoff_kind === "soft";
// copilot.ts:1278
softHandoffNotice: isSoftHandoffQueued,
```

Isso está bem escrito. O problema é que **é código morto**. `runAutonomousAgent` tem exatamente
**um call site em todo o projeto**: `process-inbox/index.ts:328`, dentro do `else` de:

```ts
// process-inbox/index.ts:201 — ESTA CONDIÇÃO NÃO FOI ALTERADA NA ONDA 1
if (session.omnichannel_status === "human_active" || session.omnichannel_status === "queued") {
    // só loga mensagens + roda tryStructuredFlow (Onda 0) — NUNCA chama runAutonomousAgent
} else {
    // runAutonomousAgent mora aqui — mas 'queued' nunca cai neste else
}
```

`SessionManager.triggerHumanHandoff` **sempre** grava `omnichannel_status: 'queued'` (isso não
mudou e não deveria mudar). Então, depois de **qualquer** handoff — soft ou hard — a sessão cai no
primeiro branch, que nunca mais chama `runAutonomousAgent`. A variável nova
`isHardHandoff`/`aiWillRespond` (`process-inbox/index.ts:185-188`) foi calculada corretamente, mas
só é usada para uma coisa: o gate do debounce (linha 190) — que só teria efeito se o código abaixo
de fato chamasse o agente, o que não acontece.

**Consequência prática:** a promessa central da Onda 1 — "handoff soft mantém a IA operando" — não
existe em produção hoje. Depois de qualquer handoff, a IA para de responder, igual ao
comportamento anterior à Onda 1. Isso inclui o cenário mais comum do bug original do cliente:
1 áudio, 1 rodada de validador reprovada, ou qualquer outro handoff soft já mata a IA na conversa.

### Correção pedida

Ajuste a condição em `process-inbox/index.ts:201` para que uma sessão `queued` com
`handoff_kind === 'soft'` **não** entre no branch de "só log" — ela precisa cair no `else`, onde
`runAutonomousAgent` já sabe lidar com `isSoftHandoffQueued` (o aviso no prompt já está pronto,
só falta o código chegar lá). `human_active` continua sempre indo para o branch de log (correto —
um atendente já está na tela). Mantenha o `tryStructuredFlow` (Onda 0) rodando também dentro do
`else` para esse caso, ou confirme que ele já roda no fluxo normal antes do agente (verifique — não
pode duplicar nem pular o clique determinístico).

Depois do fix, **acrescente um teste de integração leve** (não precisa ser um eval completo, pode
ficar em `_tests/evals/`) que simule: sessão com `omnichannel_status='queued'`,
`handoff_kind='soft'` → confirme que a condição de roteamento escolhe o branch que chama o agente
(pode testar a condição isoladamente como função pura, extraindo-a se for mais simples, ou um teste
de integração real se preferir — sua escolha, mas o teste tem que ter pego este bug se existisse
antes do fix).

---

## 3. Item 2.3 não foi implementado nem discutido

Meu retorno da Onda 0 pediu explicitamente: se a solução para o gap do webhook `human_active`
(`whatsapp-bot/index.ts`, blocos `if (session?.omnichannel_status === "human_active")` em
`handleZapi` e `handleCloudApi`) não fosse óbvia dentro do escopo da Onda 1, **parar e descrever a
opção recomendada** em vez de decidir sozinho ou ignorar. O relatório da Onda 1 não menciona esse
bloco do webhook em nenhum lugar — nem implementado, nem descartado com justificativa.

**Ação:** no relatório da correção (não precisa de onda separada, pode ir junto do fix do item 2),
escreva explicitamente uma das duas coisas:
- a opção que você recomenda para o gap do `human_active` (mesmo que a implementação fique para
  depois), ou
- por que você concluiu que não é necessário agora.

Desvio silencioso de item pedido explicitamente não é aceitável — é assim que eu decido o que
precisa de atenção extra, e um relatório que omite isso me obriga a reler o diff inteiro para
descobrir o que ficou de fora (foi o que eu tive que fazer aqui).

---

## 4. Próximo passo

Corrija o item 2 (bug crítico, prioridade máxima), responda ao item 3, rode `deno test` e
`deno check` de novo, e atualize `RESULTADO_ONDA1_AGENTE_V2.md` (não precisa recriar do zero —
acrescente uma seção "Correções pós-review" com o que mudou, por quê, e a nova saída de testes).
Só depois disso a Onda 2 é liberada. Mesmas regras de trabalho de sempre: sem deploy, sem aplicar
migration, contrato de prompt caching intacto.
