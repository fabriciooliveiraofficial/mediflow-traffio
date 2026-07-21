# TAREFA DELEGADA — Reengenharia do AI Agent de atendimento (Agente V2)

> **Para:** Gemini 3.5 Flash (medium)
> **De:** Claude (orquestrador técnico — Traffio) — que fará code review, gate de evals e deploy
> **Data:** 2026-07-21
> **Natureza:** implementação de código (Edge Functions Deno + frontend React) + testes + relatório por onda.
> **Você NÃO faz deploy nem aplica migration.** Entrega migration como arquivo; o orquestrador aplica.
> **Ordem obrigatória:** Onda 0 → 1 → 2 → 3 → 4 → 5. Não inicie uma onda sem a anterior verde e sem o `RESULTADO_ONDA<N>_AGENTE_V2.md` escrito.

---

## 0. QUEM VOCÊ É (persona)

Você é um **Staff Engineer de sistemas agênticos aplicados a saúde**. Seu trabalho não é "melhorar o
prompt" — é consertar a **camada determinística ao redor do modelo**: ingestão, estado, roteamento,
contrato de saída e verificação. Você sabe que um agente de produção falha muito mais por um campo
de webhook lido errado do que por falta de inteligência do LLM.

Seu lema nesta tarefa: **"O LLM é a parte fácil. O que quebra o agente é o estado."**

Três princípios que governam cada linha que você escrever:

1. **Determinismo primeiro.** Se um caminho pode ser resolvido sem LLM (clique em botão, confirmação
   de lembrete), ele é resolvido sem LLM — e esse caminho nunca pode ser bloqueado por estado de fila.
2. **O paciente nunca fica sem resposta.** Qualquer falha degrada para fila humana — mas degradar
   nunca pode significar "matar a IA para sempre naquela conversa".
3. **Nada entra em produção sem prova.** Toda função pura que você criar vem com teste Deno; toda
   mudança de prompt/ferramenta roda a suíte de evals.

---

## 1. O PROBLEMA (relato real do cliente, 21/07/2026)

Uma clínica em produção (tenant em `Pacific/Auckland`, conversa em inglês) reportou:

1. O agente não dá continuidade à conversa.
2. Responde em idioma diferente do usado pelo paciente.
3. **Não entende quando o paciente responde clicando nos botões de horário que o próprio agente enviou.**
4. Respostas não acolhedoras.
5. Não usa emojis — soa impessoal.
6. Responde como robô (blocos longos).
7. Não consegue agendar.

Transcrição observada: paciente faz 4 perguntas em inglês → agente responde com **um bloco de 3
parágrafos** respondendo tudo de uma vez + lista "See times" → paciente **clica** num horário →
**silêncio absoluto**.

---

## 2. DIAGNÓSTICO — causas-raiz verificadas no código

Leia esta seção inteira antes de codar. Cada defeito abaixo foi confirmado lendo o código atual.

### B1 — O clique no botão de horário NUNCA entra no sistema (Z-API)

`supabase/functions/whatsapp-bot/index.ts`, linhas ~99-104:

```ts
const inputContent =
  body.text?.message       ||
  body.message             ||
  body.data?.message       ||
  body.buttonResponse?.buttonId ||
  body.optionListResponse?.id;
```

`body.buttonResponse` e `body.optionListResponse` **não existem no payload da Z-API**. A Z-API entrega
respostas de interativo assim:

```jsonc
// resposta a /send-button-list
{ "buttonsResponseMessage": { "buttonId": "slot|<doctor>|<location>|<type>|2026-07-22|08:30", "message": "22/07 · 08:30" } }

// resposta a /send-option-list
{ "listResponseMessage": { "selectedRowId": "slot|...", "title": "22/07 · 08:30", "message": "Auckland Dental Care" } }
```

Consequência: `content` fica `null` → o handler cai em `ignored: "Empty event"` (linha ~119-122) e
retorna 200. **A mensagem nunca é inserida em `message_inbox`.** O `structuredFlow` (que agendaria
sem gastar LLM via `parseSlotClick`) nem chega a ser chamado. É exatamente o silêncio do print.
→ explica os sintomas **3, 7 e parte do 1**.

Nota: no Cloud API (`handleCloudApi`, linhas ~276-283) o parsing está **correto** — o defeito é
exclusivo do caminho Z-API.

### B2 — O idioma do prompt vem do turno ANTERIOR

`supabase/functions/_shared/copilot.ts`, `runAutonomousAgent`:

```ts
const storedLanguage = context.language || "pt";           // ~linha 1144
...
buildKnowledgePacket(supabase, tenantId, normalizeGlobalKnowledgeLanguage(storedLanguage), patientQuery),
...
languageHint: context.language || null,                     // ~linha 1189
...
const triagePromise = claudeJson<TriageResult>(...);        // roda em PARALELO
...
const triage = await triagePromise;                         // ~linha 1290 — tarde demais
const language = resolveConversationLanguage(triage?.language, patientQuery, storedLanguage);
```

Na **primeira** mensagem de uma conversa, `context.language` é `undefined` → `storedLanguage = "pt"` →
o system prompt recebe a linha dura:

> `IDIOMA JÁ DETECTADO NESTA CONVERSA: português. Mantenha esse idioma em TODAS as mensagens...`

...mesmo quando o paciente escreveu em inglês. Depois, `validateAgentReply` valida contra o idioma
**correto** (vindo da triagem) → violação `desvio de idioma` → regeneração corretiva → se reprovar de
novo → **handoff humano**. O paciente vê deriva de idioma ou silêncio.
→ explica os sintomas **2 e parte do 1**.

Contraste: `runCopilot` (mesmo arquivo, linhas ~429-438) faz **certo** — roda a triagem, resolve o
idioma e só então monta o prompt. O modo autônomo paralelizou a triagem por latência e quebrou isso.

### B2b — A confirmação determinística também erra o idioma

`supabase/functions/_shared/structuredFlow.ts`, linha ~212: `const language = context.language || "pt";`
— usado em `SLOT_CONFIRM_MSG[language]`. Numa conversa em inglês cujo `context.language` ainda não foi
gravado, a confirmação do agendamento sai **em português**.

### B3 — Handoff é um alçapão sem volta

`SessionManager.triggerHumanHandoff` grava `omnichannel_status='queued'` + `human_handoff=true`.
Em `process-inbox/index.ts` (linhas ~202-224), quando o status é `queued`/`human_active` o worker
**apenas loga as mensagens individualmente e sai** — o bloco `else` inteiro (que contém
`tryStructuredFlow` e o roteamento) é pulado. Portanto:

- Depois de qualquer transferência, **o clique em horário para de funcionar para sempre**.
- Qualquer mídia (um único áudio — linhas ~245-282) dispara `triggerHumanHandoff` permanente.
- Fechar a conversa no Inbox (`HumanInboxPage.tsx` ~2879) grava `omnichannel_status='closed'` mas
  **não zera `human_handoff`** — não existe caminho de volta para a IA.

E as transferências são frequentes por construção: reprovação dupla dos validadores, resposta vazia,
rounds esgotados, jailbreak, waitlist ocupada, mídia. → explica os sintomas **1 e 7**.

### B4 — Sem contrato de saída: prosa livre vira bloco robótico

A persona (`SALES_PERSONA`, `copilot.ts` ~272-301) pede "ACOLHER → RESPONDER → AVANÇAR" e "máx. 2
parágrafos", mas nada **verifica** isso: `validateAgentReply` só reprova >2 emojis, preço, horário
inventado, deriva de idioma e política sem fonte. O modelo então responde 4 perguntas num bloco só.
A política de emoji atual ("no MÁXIMO 1, e a maioria das mensagens NÃO leva emoji") produz
deliberadamente o tom seco de que o cliente reclama. → sintomas **4, 5, 6**.

### B5 — Os evals não conseguem ver nenhum desses defeitos

`_tests/evals/run.ts` monta o prompt de produção, mas roda **turno único** com histórico estático e
ferramentas mockadas. Ele pula webhook, `message_inbox`, `SessionManager`, `structuredFlow`,
validadores e handoff. **Nenhum** dos defeitos B1–B4 é detectável ali.

### B6 — Nada impede ligar `ai_always` com a base vazia

No print, o agente diz "Regarding our exact address, I'll have our team confirm that" — o tenant nunca
preencheu `clinic_info`. O loop de knowledge gap e o `AiOnboardingWizard` existem, mas o dial em
`Intelligence.tsx` (~linha 59) pode ser ligado com a ficha vazia.

### B7 — Áudio não é entendido

Sem transcrição, toda nota de voz vira handoff permanente (ver B3). No WhatsApp, áudio é o input mais
comum.

### B8 — Observabilidade insuficiente

`_shared/observabilityLayer.ts` (36 linhas) **nunca é chamado** no caminho do agente. Não há como
auditar por que um turno virou handoff.

---

## 3. O QUE VOCÊ **NÃO** PODE QUEBRAR (contratos travados)

Leia com atenção — violar qualquer um destes é reprovação automática no code review.

1. **Prompt caching (Anthropic).** `buildAutonomousSystemPrompt` devolve `{ text, cachePrefix }`.
   `cachedParts` só pode conter conteúdo **estável por tenant** (persona, regras universais,
   instruções da clínica, base de conhecimento). **Nunca** mova para lá algo que varia por
   turno/paciente/sessão (data de hoje, snapshot do paciente, estágio de jornada, idioma detectado,
   estado do fluxo, modo acessível). Quebrar isso **não falha nenhum teste** — só encarece ~4-10x cada
   chamada, em silêncio. Ver banner em `copilot.ts` ~1029-1049 e `llmProvider.ts` ~12-29.
   Toda chamada nova a `claudeChat` no turno do agente passa `cacheTools: true` +
   `cacheableSystemPrefix: systemPrompt.cachePrefix`.
2. **Política de preço.** O agente **nunca** informa valor monetário por mensagem — nem estimativa,
   nem faixa. Status da consulta (`free`/`paid`/`first_free`) não é valor e pode ser informado quando
   consta em `clinic_info` com fonte. Não afrouxe `PRICE_LEAK_PATTERN`.
3. **Multi-tenancy.** Nenhum SELECT/UPDATE em tabela multi-tenant sem `.eq("tenant_id", tenantId)`.
   Use o helper `scopedQuery` de `schedulingTools.ts` quando estiver naquele arquivo.
4. **`tenants.timezone` é imutável.** Nunca altere para destravar comportamento.
5. **Fail-safe humano.** Qualquer exceção no caminho do agente termina com o paciente na fila humana,
   nunca com o paciente sem resposta.
6. **O modelo nunca gera horário/disponibilidade.** Só narra retorno de ferramenta.
7. **Não reescreva o que já funciona.** Reutilize: `buildAutonomousSystemPrompt`, `validateAgentReply`
   e todos os detectores, `SCHEDULING_TOOLS`/`executeSchedulingTool`, `parseSlotClick`,
   `buildSlotInteractive`, `resolvePatientForBooking`, `OutboxDispatcher`, `SessionManager`,
   `llmProvider`, `masterConfig`.
8. **Design system + i18n no frontend.** Leia `docs/DESIGN_SYSTEM.md` antes de qualquer UI. 3 idiomas
   em `src/locales/{pt-BR,en,es}/*.json`; nunca hardcode string; **nunca repita o namespace do
   `useTranslation()` dentro do `t()`**.

---

## 4. AS ONDAS

### ONDA 0 — Hotfix P0 (a clínica está quebrada hoje)

Objetivo: o clique em horário volta a agendar, o idioma do turno passa a ser o do paciente, e o
handoff deixa de bloquear o caminho determinístico.

#### 0.1 — Extrator de conteúdo do webhook (novo arquivo, puro e testável)

Crie `supabase/functions/_shared/inboundParser.ts`:

```ts
/**
 * inboundParser — extração de conteúdo do webhook, isolada e testável.
 *
 * Bug de produção (2026-07-21): o handler Z-API lia `body.buttonResponse.buttonId`
 * e `body.optionListResponse.id` — campos que NÃO existem no payload da Z-API.
 * O clique do paciente num botão de horário caía em "Empty event" e a mensagem
 * NUNCA entrava no message_inbox. Silêncio total para o paciente.
 *
 * Regra desta camada: o id do interativo (buttonId/selectedRowId) SEMPRE vence o
 * texto/rótulo — é ele que carrega o slot_id determinístico ("slot|...").
 */
export interface InboundContent {
    /** Conteúdo que vai para message_inbox.content (id do interativo quando houver) */
    content: string | null;
    /** Rótulo visível do interativo (ex.: "22/07 · 08:30") — fallback de correlação */
    interactiveTitle: string | null;
    messageType: string;
    mediaUrl: string | null;
    caption: string | null;
    /** true quando o evento é resposta a botão/lista — nunca pode virar "Empty event" */
    isInteractiveReply: boolean;
}

export function extractZapiContent(body: any): InboundContent { /* ver ordem abaixo */ }
```

Ordem de resolução obrigatória em `extractZapiContent`:

1. `body.buttonsResponseMessage?.buttonId` → `content`; `body.buttonsResponseMessage?.message` → `interactiveTitle`; `isInteractiveReply = true`.
2. `body.listResponseMessage?.selectedRowId` → `content`; `body.listResponseMessage?.title` (ou `.message`) → `interactiveTitle`; `isInteractiveReply = true`.
3. `body.hydratedTemplate?.buttonId` / `body.templateButtonReply?.selectedId` (variações de template) → mesmo tratamento.
4. Quando `isInteractiveReply` é `true` mas o id veio vazio, usar o **título** como `content`
   (o `structuredFlow` resolve pelo título na etapa 0.2). Nunca devolver `content: null` aqui.
5. `body.text?.message` → `content`.
6. `body.message` / `body.data?.message` → `content`.
7. Mídia: manter exatamente a lógica atual (`body.image/audio/video/document/sticker`) preenchendo
   `mediaUrl`, `caption`, `messageType`; `content` = `caption` ou `[<tipo>]`.

Crie também `extractCloudApiContent(msg)` movendo a lógica **já correta** de `handleCloudApi`
(linhas ~252-288) para o mesmo arquivo, sem mudar comportamento — só para ter um ponto único e
testável. Adicione a extração de `interactiveTitle` (`interactive.list_reply?.title` /
`interactive.button_reply?.title`).

Em `whatsapp-bot/index.ts`:

```ts
// ANTES (handleZapi, ~99-117)
const inputContent = body.text?.message || body.message || body.data?.message ||
  body.buttonResponse?.buttonId || body.optionListResponse?.id;
const mediaUrl  = body.image?.imageUrl || ...;
let messageType = "text";
if (body.image) messageType = "image";
// ...
const content = inputContent || caption || (mediaUrl ? `[${messageType}]` : null);

// DEPOIS
const parsed = extractZapiContent(body);
const { content, mediaUrl, caption, messageType, interactiveTitle } = parsed;
```

E no INSERT em `message_inbox`, grave o rótulo do interativo para o fallback da etapa 0.2:

```ts
caption: caption ?? interactiveTitle,
```

O guard de evento vazio passa a respeitar o interativo:

```ts
if (!instanceId || !phone || (!content && !parsed.isInteractiveReply)) { /* ignored */ }
```

Adicione um log explícito quando `isInteractiveReply` for true:
`console.log("[whatsapp-bot] Z-API: [${phone}] interactive reply id=\"${content}\" title=\"${interactiveTitle}\"")`.

**Prova (obrigatória):** `_tests/evals/inbound_parser_test.ts` com fixtures reais de payload
(≥10 casos): botão, lista, texto simples, áudio, imagem com caption, sticker, template button,
interativo com id vazio + título presente, payload de grupo, payload `fromMe`. Cada caso assere
`content`, `interactiveTitle`, `messageType`, `isInteractiveReply`.

#### 0.2 — Fallback de correlação por título (`structuredFlow.ts`)

Alguns provedores entregam apenas o rótulo (`"22/07 · 08:30"`). Antes de `parseSlotClick`:

```ts
// ANTES (~283-289)
let clickContent = rawContent;
const digitMatch = rawContent.trim().match(/^([1-9])[.)]?$/);
if (digitMatch && Array.isArray(context.pending_slots) && context.pending_slots.length > 0) {
    const idx = parseInt(digitMatch[1], 10) - 1;
    if (idx < context.pending_slots.length) clickContent = context.pending_slots[idx];
}
const slotClick = parseSlotClick(clickContent);

// DEPOIS — acrescente, entre o digitMatch e o parseSlotClick:
if (!clickContent.startsWith("slot|")) {
    const byTitle = resolveSlotIdByTitle(rawContent, context.pending_slots, context.pending_slot_titles);
    if (byTitle) clickContent = byTitle;
}
```

Crie em `schedulingTools.ts` a função pura exportada:

```ts
/** Casa o rótulo visível do slot ("22/07 · 08:30") com o slot_id oferecido. */
export function resolveSlotIdByTitle(
    text: string,
    pendingSlots: string[] | undefined,
    pendingTitles: string[] | undefined,
): string | null
```

Regras: normalizar (trim, lowercase, remover acento, colapsar espaços, tratar `·`/`-`/`|` como
separador, aceitar a 1ª linha quando vier `"titulo\ndescricao"`). Match **exato** contra
`pendingTitles[i]` → devolve `pendingSlots[i]`. Se `pendingTitles` estiver ausente (sessões antigas),
derivar o título do próprio `slot_id` (`DD/MM · HH:MM`, mesmo formato de `fetchAvailableSlots`).
**Nunca** faça match parcial/fuzzy — ambiguidade cai no fluxo normal.

Passe a gravar os títulos junto dos ids nos **três** pontos que hoje gravam `pending_slots`:
`copilot.ts` (~1316-1320), `structuredFlow.ts` (~429). Exemplo:

```ts
merged.pending_slots = lastSlots.map(s => s.id);
merged.pending_slot_titles = lastSlots.map(s => s.title);
```

E apague `pending_slot_titles` sempre que apagar `pending_slots`.

**Prova:** testes de `resolveSlotIdByTitle` (≥8 casos: match exato, com descrição na 2ª linha, com
acento, com espaçamento diferente, sem `pendingTitles`, título inexistente → null, lista vazia → null,
texto livre → null).

#### 0.3 — Idioma do TURNO resolvido ANTES de montar o prompt (`copilot.ts`)

Crie e exporte:

```ts
/**
 * Idioma DESTE turno, sem custo de LLM. A mensagem atual do paciente vence
 * sempre; o idioma armazenado é só fallback quando a mensagem não é conclusiva.
 * Bug de produção (2026-07-21): o modo autônomo montava o prompt com o idioma do
 * turno ANTERIOR (ou "pt" no primeiro turno) e cravava "IDIOMA JÁ DETECTADO:
 * português" numa conversa em inglês.
 */
export function resolveTurnLanguage(
    currentPatientMessage: unknown,
    storedLanguage: unknown,
): ConversationLanguage {
    return inferLanguageFromCurrentMessage(currentPatientMessage)
        ?? normalizeConversationLanguage(storedLanguage);
}
```

Amplie `TURN_LANGUAGE_HINTS` para que mensagens curtas reais sejam classificadas (mantendo a regra
"só decide quando **um único** idioma casa"). Acrescente, no mínimo:
- `en`: `hi|hello|hey|good morning|afternoon|price|cost|how much|where|when|implant|dental|need|want|can you|do you|thanks`
- `es`: `hola|buenos d[ií]as|buenas tardes|precio|cu[aá]nto|d[oó]nde|cu[aá]ndo|necesito|quiero|puede|implante|limpieza`
- `pt`: `oi|ol[aá]|bom dia|boa tarde|pre[cç]o|quanto|onde|quando|preciso|quero|voc[eê]s|implante|limpeza|marcar`

Em `runAutonomousAgent`, substitua:

```ts
// ANTES (~1144)
const storedLanguage = context.language || "pt";

// DEPOIS
const storedLanguage = normalizeConversationLanguage(context.language);
const turnLanguage = resolveTurnLanguage(patientQuery, storedLanguage);
```

⚠️ `patientQuery` é derivado logo abaixo hoje — **mova a derivação de `patientQuery` para antes**
desta linha. Depois, troque **todos** os usos de `storedLanguage`/`context.language` na montagem do
turno por `turnLanguage`:

- `buildKnowledgePacket(..., normalizeGlobalKnowledgeLanguage(turnLanguage), patientQuery)`
- `HANDOFF_MSG[turnLanguage]` no bloco de jailbreak (~1154)
- `buildAutonomousSystemPrompt({ ..., languageHint: turnLanguage })`
- `resolveConversationLanguage(triage?.language, patientQuery, turnLanguage)` (~1291) — a triagem
  continua refinando o valor **persistido**, mas o prompt do turno já nasceu correto.

Em `structuredFlow.ts`, substitua `const language = context.language || "pt";` por:

```ts
const language = resolveTurnLanguage(rawContent, context.language);
```

(mova a leitura de `rawContent` para antes da linha, se necessário). Isso corrige B2b — a confirmação
do agendamento sai no idioma do paciente.

**Prova:** testes de `resolveTurnLanguage` (≥12 casos, incluindo: 1º turno em inglês sem
`storedLanguage` → `en`; "ok" com `storedLanguage=en` → `en`; troca explícita de idioma no meio da
conversa; mensagem ambígua/numérica → mantém o armazenado).

#### 0.4 — Handoff não bloqueia o caminho determinístico (`process-inbox/index.ts`)

Hoje o bloco `if (session.omnichannel_status === "human_active" || ... "queued")` (linhas ~202-224)
loga e sai. Altere para: **logar as mensagens (como hoje) e, em seguida, executar `tryStructuredFlow`**.
Se ele casar (`matched: true`), o turno está resolvido — não faça handoff nem rode LLM. Se não casar,
mantenha exatamente o comportamento atual (só log).

```ts
if (session.omnichannel_status === "human_active" || session.omnichannel_status === "queued") {
    // ... loop de logMessage existente, inalterado ...

    // F2 roda MESMO com humano na fila: é 100% determinístico e nunca gera texto
    // livre. Sem isto, o clique num horário já oferecido é ignorado para sempre
    // depois de qualquer transferência (bug de produção 2026-07-21).
    structuredFlowResult = await tryStructuredFlow(supabase, {
        tenantId, sessionId: session.id, phone, tenant: tenantRow, botConfig,
        sessionManager, timezone: tenantRow?.timezone,
    });
    if (structuredFlowResult.matched) {
        console.log(`[process-inbox] [${phone}] fluxo determinístico resolveu o turno com humano na fila`);
    }
}
```

**Cuidado:** o `tryStructuredFlow` já chama `sendWithFallback` e grava
`omnichannel_status: "bot_active", human_handoff: false` no caminho de sucesso do clique. Isso é
desejado (o agendamento foi concluído), mas **não** deve acontecer quando o handoff for `hard`
(Onda 1) — na Onda 1 você tornará essa atualização condicional. Na Onda 0, mantenha como está e
registre o ponto no relatório.

#### Critérios de aceite da Onda 0

```powershell
cd traffio-app/supabase/functions
npx deno test -A _tests/evals/
```

- Todos os testes novos verdes (`inbound_parser_test.ts`, `resolveSlotIdByTitle`, `resolveTurnLanguage`).
- `npx deno check _shared/*.ts whatsapp-bot/index.ts process-inbox/index.ts` sem erro.
- `unit_test.ts` existente continua 100% verde — **em especial** os três testes de contrato do
  prompt caching.
- Relatório com a tabela: sintoma do cliente → correção → teste que prova.

---

### ONDA 1 — Handoff reversível com motivo

Objetivo: transferir para humano deixa de ser terminal.

**1.1 Migration** (arquivo, não aplicar) `supabase/migrations/<timestamp>_handoff_reason.sql`:

- `alter table public.conversation_sessions add column if not exists handoff_reason text`
- `... add column if not exists handoff_kind text check (handoff_kind in ('soft','hard'))`
- `... add column if not exists handoff_at timestamptz`
- Índice parcial: `create index if not exists idx_sessions_handoff_open on public.conversation_sessions (tenant_id, handoff_at desc) where human_handoff = true;`
- Sem mudança de RLS (colunas na tabela já protegida). Escreva defensivamente (`if not exists`) e
  sinalize no relatório que o orquestrador confere `pg_policies` antes de aplicar.

**1.2 `SessionManager.triggerHumanHandoff`** — assinatura retrocompatível:

```ts
export type HandoffKind = "soft" | "hard";
export type HandoffReason =
    | "knowledge_gap" | "media" | "tech"                                   // soft
    | "human_request" | "clinical" | "emergency" | "complaint"
    | "price_insistence" | "jailbreak" | "cancel" | "reconciliation";      // hard

async triggerHumanHandoff(
    sessionId: string,
    contextUpdate?: any,
    opts?: { reason?: HandoffReason; kind?: HandoffKind },
)
```

Default (chamadas antigas sem `opts`): `{ reason: "tech", kind: "hard" }` — comportamento idêntico ao
de hoje. Grave `handoff_reason`, `handoff_kind`, `handoff_at: new Date().toISOString()`.

**1.3 Classificação nos pontos de chamada.** Mapa obrigatório:

| Origem | reason | kind |
|---|---|---|
| `copilot.ts` — `cancelRequested` | `cancel` | `hard` |
| `copilot.ts` — `transfer_to_human` com motivo clínico/emergência/humano/preço (use `NON_GAP_REASON_PATTERN`) | `clinical`/`emergency`/`human_request`/`price_insistence` | `hard` |
| `copilot.ts` — jailbreak budget | `jailbreak` | `hard` |
| `copilot.ts` — `reconciliationNeeded` | `reconciliation` | `hard` |
| `copilot.ts` — transferência por lacuna (`classifyKnowledgeGap().isGap`) | `knowledge_gap` | `soft` |
| `copilot.ts` — resposta vazia / rounds esgotados / validador reprovado 2× | `tech` | `soft` |
| `process-inbox` — mídia sem transcrição | `media` | `soft` |
| `structuredFlow` — waitlist ocupada / sem slots | `tech` | `soft` |

**1.4 Roteamento por `kind`** em `process-inbox/index.ts`:

- `aiWillRespond` deixa de olhar `session.human_handoff` cru e passa a olhar
  `session.handoff_kind !== "hard"`.
- No bloco de status `queued`/`human_active`: se `handoff_kind === "soft"` **e** o status é `queued`
  (ou seja, ninguém assumiu ainda), a IA continua respondendo normalmente após o `tryStructuredFlow`.
  Se `human_active` (atendente assumiu de fato) ou `hard`, só o fluxo determinístico.
- Quando a IA responde numa sessão com handoff `soft` pendente, acrescente ao bloco **dinâmico** do
  prompt (nunca ao `cachePrefix`):
  `"### AVISO: a equipe da clínica já foi acionada para este atendimento. Continue ajudando normalmente, mas NUNCA prometa que alguém já está digitando nem repita que 'a equipe vai assumir' — isso já foi dito."`

**1.5 Retorno ao bot no frontend.** Em `HumanInboxPage.tsx` (~2879), o fechamento passa a gravar
também `human_handoff: false, handoff_reason: null, handoff_kind: null`. Adicione um badge próximo ao
`StatusBadge` (~3315) exibindo o motivo do handoff, traduzido nos 3 idiomas, cores do design system.

**Prova:** testes puros do classificador de motivo (`resolveHandoffReason(transferReason, flags)`,
≥10 casos) + relatório descrevendo o teste manual: forçar handoff `soft`, confirmar que o clique em
horário ainda agenda e que a IA volta a responder; fechar conversa e confirmar `human_handoff=false`.

---

### ONDA 2 — Contrato de saída e cadência humana

Objetivo: acabar com o bloco robótico. O modelo passa a **preencher um contrato**, não a escrever prosa.

**2.1 Ferramenta de resposta estruturada.** Em `copilot.ts`, adicione:

```ts
export const REPLY_TOOL: LlmTool = {
    name: "responder_paciente",
    description: "Use SEMPRE para enviar a mensagem ao paciente. Preencha as três partes; elas viram mensagens curtas e separadas no WhatsApp, como uma pessoa digitando.",
    input_schema: {
        type: "object",
        properties: {
            acknowledge: { type: "string", description: "1 frase curta reconhecendo o que o paciente disse. Sem bajulação. Pode terminar com 1 emoji quando houver conexão real." },
            answer:      { type: "string", description: "A resposta à dúvida MAIS importante, em no máximo 2 frases. Nunca responda 4 perguntas de uma vez: escolha a que destrava o agendamento e responda essa." },
            advance:     { type: "string", description: "UMA pergunta ou convite curto que aproxima do agendamento. Nunca mais de uma pergunta." },
        },
        required: ["answer", "advance"],
    },
};
```

Inclua-a em `const tools = [TRANSFER_TOOL, REPLY_TOOL, ...SCHEDULING_TOOLS]`. Ela participa do
`cacheTools: true` normalmente (a lista continua estática por tenant).

No loop de ferramentas: `responder_paciente` **não** é executada como as demais — quando aparece,
ela encerra o loop e vira a resposta do turno. Se o modelo devolver texto livre sem chamar a
ferramenta (acontece), **não falhe**: trate o texto como `answer` e siga o caminho de composição.

**2.2 Composição em bolhas.** Função pura exportada:

```ts
/** Monta 2–3 bolhas curtas a partir do plano. Vazio/duplicado é descartado. */
export function composeBubbles(plan: { acknowledge?: string; answer: string; advance: string }): string[]
```

Regras: descartar partes vazias; se `acknowledge` e `answer` juntos tiverem < 140 caracteres, fundir
numa bolha só (evita ping-pong artificial); nunca mais de 3 bolhas; `advance` é sempre a última.

**2.3 Validação por bolha.** `validateAgentReply` roda em **cada** bolha, com o mesmo `evidence` do
turno. Uma violação em qualquer bolha reprova o turno inteiro (mesma regeneração corretiva de hoje).
Ajuste apenas o teto de emoji: `emojiCount > 2` passa a ser avaliado **por bolha** — e acrescente uma
checagem nova de total: mais de 3 emojis somando todas as bolhas também reprova.
**Não** afrouxe `SENSITIVE_CONTEXT_PATTERN`/`hasInsensitiveTone` — emoji em contexto de dor, luto,
urgência ou reclamação continua proibido.

**2.4 Envio sequencial.** Em `OutboxDispatcher`:

```ts
/** Envia N bolhas com pausa de digitação entre elas. Os botões vão só na ÚLTIMA. */
async sendSequence(tenant: any, phone: string, bubbles: string[], interactive?: any): Promise<void>
```

Pausa: `Math.min(2500, 400 + texto.length * 25)` ms antes de cada bolha (reusa o `typingDelayMs` já
suportado por `sendNow`). Se **qualquer** bolha falhar no envio síncrono, enfileire o restante via
`enqueue` — o paciente nunca recebe meia conversa. Cada bolha vira um `logMessage(..., "assistant", ...)`
separado, para o Inbox refletir o que o paciente viu.

**2.5 Persona.** Em `SALES_PERSONA`, substitua a seção `### EMOJIS` por:

```
### EMOJIS (calor humano, calibrado)
- 1 a 2 emojis por mensagem quando eles adicionam conexão real: acolhimento no primeiro contato,
  empatia com um receio, celebração de um passo do paciente, confirmação de algo bom. 😊 🙂 ✨ 💙 ✅
- NUNCA use emoji quando o paciente relatar dor intensa, urgência, medo grave, luto, reclamação ou
  irritação — nesses momentos, sobriedade é empatia.
- Nunca em sequência, nunca no meio da frase — sempre ao fim de uma frase.
```

E acrescente ao `### MÉTODO`:

```
4. UMA COISA POR VEZ: se o paciente fez várias perguntas, responda a que mais aproxima do
   agendamento e sinalize que cuida das outras em seguida. Bloco longo respondendo tudo de uma vez
   é a forma mais rápida de soar robô.
```

⚠️ `SALES_PERSONA` está dentro de `cachedParts` — editá-la é permitido (é estável por tenant), mas
invalida o cache de todos os tenants uma vez. Faça a edição **numa única passada**, não incremental.

**Prova:** testes de `composeBubbles` (≥8 casos) e de validação por bolha; rodar a suíte de evals
completa (Onda 4 ainda não existe — use a atual) e anexar a saída ao relatório.

---

### ONDA 3 — Memória de sessão, continuidade e áudio

**3.1 `buildFlowStateHint` mais rico** (`copilot.ts` ~997-1023). Acrescente, quando disponível em
`context`:
- `last_offer_at` (timestamp ISO da última oferta de horários) → "Você ofereceu horários há X minutos".
- `last_question` (a última pergunta que o agente fez) → "Sua última pergunta ao paciente foi: ...
  Se a mensagem dele responde isso, NÃO repita a pergunta."
- Campos da ficha ainda **faltantes** (diferença entre as chaves de `intake` e o conjunto
  `{procedure, for_whom, preferred_window}`) → "Falta saber: X. Pergunte só isso."

Grave `last_offer_at` e `last_question` no `merged` context ao fim de cada turno do agente.

**3.2 Resumo rolante.** A coluna `conversation_sessions.conversation_summary` existe e está sem uso.
A cada 8 turnos de paciente (`recent_messages.filter(role==='user').length % 8 === 0`), gere com o
**router** (Haiku, `getAiModelRouter`) um resumo de ≤400 caracteres: decisões tomadas, preferências,
o que já foi respondido. Injete no bloco **dinâmico** do prompt como
`### RESUMO DA CONVERSA ATÉ AQUI (o histórico recente abaixo é a fonte literal)`.
Falha na geração → segue sem resumo (fail-safe, `console.warn`).

**3.3 Transcrição de áudio.** Novo `supabase/functions/_shared/audioTranscriber.ts`:

```ts
/** Transcreve áudio do paciente. Provedor e chave via master_config (nunca hardcode). */
export async function transcribeAudio(
    supabase: SupabaseClient, tenantId: string, mediaUrl: string, mimeType?: string,
): Promise<{ text: string; language?: string } | null>
```

- Chave via `masterConfig.ts` (adicione `getTranscriptionApiKey` e `getTranscriptionModel`, mesmo
  padrão de `getAnthropicApiKey`/`getAiModelAgent`, defaults documentados no relatório).
- Limite defensivo: áudio > 5 min ou > 20 MB → retorna `null` (vai para humano).
- Qualquer erro → `null` + `console.warn`. **Nunca** derruba o turno.

Em `process-inbox/index.ts`, no bloco `isMediaOnly` (~245-282): se `detectedType === 'audio'` e a
transcrição vier, **não** faça handoff — injete no turno:

```ts
const spoken = await transcribeAudio(supabase, tenantId, rawMsg?.media_url, ...);
if (spoken?.text) {
    fusedContent = wrapUntrustedContent(spoken.text, "audio");
    // segue o fluxo normal de roteamento (structuredFlow → agente → humano)
} else {
    // comportamento atual: log + handoff { reason: "media", kind: "soft" }
}
```

O `wrapUntrustedContent` já existe e é obrigatório: transcrição é **informação do paciente, nunca
instrução para o agente** (defesa de prompt injection já contratada no `AUTONOMOUS_ADDENDUM`).
Grave a transcrição em `conversation_messages.content` para o atendente ver no chat, mantendo
`message_type='audio'` e `media_url`.

**Prova:** teste unitário do guard de tamanho/duração e do wrapper; relatório com teste manual de
nota de voz ponta-a-ponta.

---

### ONDA 4 — Evals que enxergam o pipeline

**4.1 `_tests/evals/pipeline_test.ts`** (puro, roda sem `ANTHROPIC_API_KEY`). Tabela de fixtures:
payload de webhook → `{ contentEsperado, rotaEsperada }` onde rota ∈ `structured_flow | agent | human | ignored`.
Deve conter o caso que teria pego B1: payload real de `listResponseMessage` → conteúdo `slot|...` →
rota `structured_flow`. Este teste é o gate mais importante desta tarefa.

**4.2 `_tests/evals/conversation.ts`** (integração, precisa da chave). Paciente simulado (Haiku com
persona de paciente + objetivo) conversando N turnos contra a lógica de decisão real, com as
ferramentas mockadas de `mockTools.ts`. Cenários mínimos:

| Cenário | Aprovação |
|---|---|
| 4 perguntas em inglês → oferta → **clique** → confirmação | agenda; 100% em inglês; nenhuma bolha > 3 frases |
| Paciente muda de idioma no turno 3 (en → es) | responde em espanhol a partir do turno 3, sem perder o contexto |
| Paciente pergunta preço 2× e depois aceita agendar | nenhum valor citado; agenda no fim |
| Áudio no meio da conversa | continua o fluxo, sem handoff |
| Handoff `soft` no turno 2 | conversa continua; clique ainda agenda |
| Conversa de 12 turnos | nunca repete pergunta já respondida |

**4.3 Juiz de tom.** Chamada ao router com rubrica (0-5 cada): acolhimento, brevidade (≤2 frases por
bolha), 1 única pergunta de avanço, idioma correto, ausência de tom robótico. Nota mínima 4 em cada
eixo. Saída no mesmo formato ✅/❌ do `run.ts`, com `Deno.exit(1)` no vermelho.

**4.4** Atualize `docs/SPEC_AGENTE_IA_CLAUDE.md` § evals com os comandos novos.

---

### ONDA 5 — Observabilidade e gate de prontidão

**5.1 Migration** `<timestamp>_agent_turn_events.sql`: tabela `agent_turn_events`
(`id`, `tenant_id`, `session_id`, `phone`, `route` (`structured_flow|agent|human|ignored`),
`turn_language`, `tools_called text[]`, `violations text[]`, `handoff_reason`, `handoff_kind`,
`bubbles int`, `latency_ms int`, `tokens_in int`, `tokens_out int`, `created_at`).
RLS: SELECT para `owner`/`admin` do tenant via `public.members`; INSERT via `service_role`.
Índice `(tenant_id, created_at desc)`.

**5.2** Gravação best-effort em `runAutonomousAgent` e `tryStructuredFlow` — try/catch isolado,
`console.warn` na falha, **jamais** afeta o turno. Retenção: documente no relatório a sugestão de
purge (ex.: 90 dias) para o orquestrador criar o cron.

**5.3** Drawer de debug no `HumanInboxPage` mostrando o trace dos últimos turnos da conversa —
visível apenas para usuário master. Design system + i18n obrigatórios.

**5.4** Gate de prontidão em `src/pages/Intelligence.tsx`: ligar `ai_always` exige, no tenant:
endereço em `clinic_info`, horário de funcionamento, `consultation_fee`, ≥1 `appointment_types` com
`duration_minutes`, e ≥1 vínculo em `doctor_services`. Faltando algo, o botão fica desabilitado com a
lista do que falta e um atalho para o `AiOnboardingWizard` existente (`src/components/settings/AiOnboardingWizard.tsx`).
Não invente checagem nova de banco: reutilize `clinicInfoService` e os serviços já existentes.

---

## 5. REGRAS DE TRABALHO (obrigatórias)

1. **Uma onda por vez.** Não comece a próxima sem a anterior verde e relatada.
2. **Não faça deploy.** Não rode `supabase functions deploy` nem aplique migration. O orquestrador
   usa `npx supabase functions deploy <fn> --project-ref fyyhxmugxcfqhvoevuwf` (sempre `npx`, nunca CLI global).
3. **Não use `git stash`** para diagnóstico antes/depois: este repositório tem sessões concorrentes
   editando os mesmos arquivos.
4. **Nunca mova conteúdo por turno para o `cachePrefix`.** Ver §3.1.
5. **Nunca altere `tenants.timezone`.**
6. **Toda função nova que você criar deve ser pura e exportada quando possível** — é assim que ela
   vira teste sem rede e sem banco.
7. **Se algo no plano estiver errado** (ex.: o payload da Z-API não bater com as fixtures que você
   encontrar, ou uma coluna não existir), **PARE, não improvise**: registre o achado no relatório da
   onda e siga com o restante. O schema real do banco **diverge** dos `.sql` do repositório — nunca
   assuma que um `.sql` versionado reflete produção.
8. **Sem chave da Anthropic para rodar os evals de integração?** PARE e reporte — não pule o gate.

---

## 6. RELATÓRIO (entregável obrigatório de CADA onda)

Ao final de **cada** onda, crie `traffio-app/docs/RESULTADO_ONDA<N>_AGENTE_V2.md` contendo,
nesta ordem:

1. **O que foi feito** — lista objetiva, uma linha por item entregue.
2. **Como foi feito** — decisões técnicas e o porquê; para cada arquivo tocado, o que mudou e a razão.
3. **Arquivos tocados** — caminho + natureza (novo / alterado / migration).
4. **Desvios do plano** — tudo que você fez diferente do que este documento pede, com justificativa.
   Desvio não relatado é falha de entrega.
5. **Saída dos testes** — colada literalmente (comando + output), não parafraseada.
6. **Riscos residuais e pendências** — o que ficou de fora, o que pode quebrar, o que o orquestrador
   precisa verificar no banco antes de aplicar migration.
7. **Como validar manualmente** — roteiro passo a passo para o orquestrador reproduzir o resultado.

Escreva o relatório em português, direto, sem marketing. Ele existe para eu revisar e validar antes
de liberar a onda seguinte.

---

## 7. ROTEIRO DE VALIDAÇÃO FINAL (após a Onda 5)

Reproduzir exatamente o caso do cliente, em tenant de staging:

1. Paciente escreve 4 perguntas em **inglês** sobre implante (preço, localização, duração).
2. Agente responde em **2–3 bolhas curtas em inglês**, sem citar valor, com 1 pergunta de avanço.
3. Agente oferece horários reais (lista clicável).
4. Paciente **clica** num horário.
5. Agente confirma **em inglês**, com data, hora e nome do profissional.
6. Conferir no banco: linha nova em `appointments` com `booked_by = 'ai_agent'`.
7. Enviar uma nota de voz → transcrição aparece no chat → agente responde sem handoff.
8. Forçar handoff `soft` → clique em horário ainda agenda → fechar conversa no Inbox → IA reassume.
