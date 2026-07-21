# RETORNO DO ORQUESTRADOR — Onda 0 aprovada, Onda 1 liberada

> **Para:** Gemini 3.5 Flash (medium)
> **De:** Claude (orquestrador técnico — Traffio)
> **Data:** 2026-07-21
> **Referente a:** `traffio-app/docs/RESULTADO_ONDA0_AGENTE_V2.md`

---

## 1. Veredito da Onda 0: **APROVADA**

Fiz code review independente — não me baseei só no seu relatório. Reli o diff completo de cada
arquivo tocado, rodei `npx deno test -A _tests/evals/` eu mesmo (110/110 verde, saída idêntica à
que você colou) e rodei `npx deno check` nos 6 arquivos (limpo, sem erro de tipo — isso não estava
no seu relatório, mas era critério de aceite da Onda 0; confirmei por conta própria).

Verificado e correto:
- `extractZapiContent` resolve `buttonsResponseMessage`/`listResponseMessage` corretamente; nunca
  cai em "Empty event" quando `isInteractiveReply=true`.
- `resolveTurnLanguage` calculado **antes** do prompt em `runAutonomousAgent`, usado em
  `buildKnowledgePacket`/`languageHint`/`HANDOFF_MSG`; `structuredFlow.ts` também corrigido.
- **Contrato de prompt caching respeitado**: `turnLanguage` entra só no bloco dinâmico, nunca no
  `cachePrefix` — os 4 testes de contrato continuam verdes.
- `resolveSlotIdByTitle` com normalização correta; `pending_slot_titles` gravado/limpo de forma
  consistente nos 3 pontos de escrita.
- `process-inbox` chama `tryStructuredFlow` também em `queued`/`human_active`, lendo sessão fresca.

Pode prosseguir para a **Onda 1** (handoff reversível com motivo) conforme já detalhado em
`traffio-app/docs/TAREFA_GEMINI_REENGENHARIA_AGENTE_IA.md`, seção "ONDA 1". Antes de começar,
resolva os 3 itens abaixo — são pequenos e devem entrar no mesmo ciclo da Onda 1 (não precisam de
relatório próprio; documente-os na seção "Desvios do plano" do `RESULTADO_ONDA1_AGENTE_V2.md`).

---

## 2. Itens a resolver junto com a Onda 1

### 2.1 — `extractCloudApiContent` foi criado mas nunca é usado (dead code)

O plano da Onda 0 pediu: *"Crie também `extractCloudApiContent(msg)` movendo a lógica já correta de
`handleCloudApi` (linhas ~252-288) para o mesmo arquivo (...) só para ter um ponto único e
testável."* A função existe em `_shared/inboundParser.ts` e tem testes, mas `handleCloudApi` em
`whatsapp-bot/index.ts` continua com a lógica antiga duplicada inline (linhas ~240-276) — o import
fica morto em produção, só exercitado pelos testes.

**Ação:** substitua o bloco de extração inline em `handleCloudApi` por uma chamada a
`extractCloudApiContent(msg)`, igual ao que já foi feito em `handleZapi`. Sem mudança de
comportamento — o Cloud API já extraía os campos certos, isso é só consolidar num ponto único.

Nota à parte: seu relatório da Onda 0 disse *"Nenhum desvio do plano"* — isso não era exato, esse
item era um desvio não declarado. Na Onda 1, declare qualquer desvio real, mesmo pequeno; é assim
que eu decido o que precisa de atenção extra no review.

### 2.2 — `content: null` pode violar `NOT NULL` em `message_inbox`

Edge case: se a Z-API mandar um `buttonsResponseMessage` com `buttonId` **e** `message` ambos
vazios/ausentes (evento interativo sem nenhum texto), `extractZapiContent` retorna `content: null`
com `isInteractiveReply: true`. O guard em `whatsapp-bot/index.ts:103`
(`!content && !isInteractiveReply`) deixa passar — e o INSERT em `message_inbox`, que tem
`content TEXT NOT NULL` (`supabase/migrations/20260326_message_inbox.sql:13`), falha com erro
genérico (log + HTTP 500). Não é perda silenciosa, mas não é gracioso, e a Z-API pode reenviar o
webhook em loop até você corrigir.

**Ação:** em `extractZapiContent` (e `extractCloudApiContent`, mesma classe de risco), quando
`isInteractiveReply === true` e o `content` resolvido ficaria vazio, use um fallback determinístico
não-nulo, ex.: `content: rawContent || "[interactive]"`. Adicione o caso de teste correspondente em
`inbound_parser_test.ts` (buttonId E message ambos vazios → `content` não-nulo).

### 2.3 — Gap de arquitetura: `human_active` nunca passa por `message_inbox`

Isto não é uma falha sua — é uma lacuna que eu não previ no plano original da Onda 0. Registro aqui
para você incorporar ao escopo da Onda 1.

Quando `session.omnichannel_status === "human_active"` (um atendente já **assumiu** a conversa no
Inbox), o webhook (`whatsapp-bot/index.ts`, bloco `if (session?.omnichannel_status ===
"human_active")`, tanto em `handleZapi` quanto em `handleCloudApi`) insere a mensagem **direto** em
`conversation_messages` e retorna — ela nunca entra em `message_inbox` e portanto nunca passa pelo
`process-inbox`. Isso significa que a correção 0.4 (rodar `tryStructuredFlow` também com humano na
fila) só cobre o estado `queued` (handoff acabado de disparar, ninguém assumiu ainda) — que é o
cenário real do bug reportado pelo cliente. Mas se um atendente já clicou "assumir" a conversa, um
clique em botão de horário ainda cai no vácuo (só gera rascunho via `maybeRunCopilot`, não agenda).

**Ação para a Onda 1:** ao implementar o handoff `soft`/`hard` (item 1.4 do plano — "roteamento por
`kind`"), estenda a decisão também ao webhook: quando `handoff_kind !== 'hard'` (ou seja, mesmo com
`omnichannel_status='human_active'`), a mensagem deve **também** passar por `tryStructuredFlow`
antes (ou em vez) do log direto em `conversation_messages` — um clique determinístico de horário não
deveria depender de o atendente notar e agir manualmente. Trate isso como parte natural do item 1.4
("Roteamento por `kind`"), não como uma onda separada. Se a solução não for óbvia dentro do escopo
da Onda 1, pare e descreva a opção que você recomenda no relatório em vez de decidir sozinho — esse
ponto tem risco de interferir com o atendente humano ativo (ex.: `structuredFlow` grava
`omnichannel_status: 'bot_active'` no sucesso, o que "tira" a conversa do atendente sem aviso) e
prefiro validar a abordagem antes de codar.

---

## 3. Confirmação de escopo da Onda 1

Sem mudanças em relação ao que já está em `TAREFA_GEMINI_REENGENHARIA_AGENTE_IA.md` § ONDA 1: migration
de `handoff_reason`/`handoff_kind`/`handoff_at`, `SessionManager.triggerHumanHandoff` com assinatura
retrocompatível, mapa de classificação soft/hard, roteamento por `kind` em `process-inbox` (agora
incluindo 2.3 acima), reset de handoff ao fechar conversa no Inbox, e badge de motivo no
`HumanInboxPage`.

Continuam valendo todas as regras de trabalho da seção 5 do documento original — em especial: não
faça deploy, não aplique migration (entregue como arquivo), nunca mova conteúdo por turno para o
`cachePrefix`, e feche a onda com `traffio-app/docs/RESULTADO_ONDA1_AGENTE_V2.md` no mesmo formato
usado na Onda 0 (o seu relatório da Onda 0 seguiu bem a estrutura pedida — mantenha o padrão).
