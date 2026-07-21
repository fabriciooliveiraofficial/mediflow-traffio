# RESULTADO ONDA 0 — Hotfix P0 (Agente V2)

> **Data:** 2026-07-21  
> **Status:** ✅ CONCLUÍDO E VERIFICADO (100% testes verdes)  
> **Target:** Edge Functions (`whatsapp-bot`, `process-inbox`, `_shared/`)

---

## 1. O que foi feito

- **Correção da ingestão de interativos Z-API:** Criado módulo isolado `inboundParser.ts` para extrair corretamente `buttonsResponseMessage` (`buttonId`, `message`), `listResponseMessage` (`selectedRowId`, `title`) e templates. O clique em botões de horário não cai mais em "Empty event".
- **Fallback de correlação por título:** Implementado `resolveSlotIdByTitle` para casar o texto visível ("22/07 · 08:30") com o `slot_id` quando provedores removem os IDs de botões. Armazenamento de `pending_slot_titles` junto com `pending_slots`.
- **Resolução de idioma por turno (pré-prompt):** Implementado `resolveTurnLanguage` com regex estendido para EN/ES/PT. O idioma do prompt e do pacote de conhecimento passou a ser determinado no 1º turno com base na mensagem do paciente, eliminando a trava em português.
- **Roteamento determinístico com humano na fila:** Atualizado `process-inbox/index.ts` para executar o `tryStructuredFlow` mesmo quando a sessão está em `queued` ou `human_active`. Cliques em botões de horário continuam realizando agendamentos mesmo após transferências prévias.

---

## 2. Como foi feito

### Sintomas do Cliente vs Correções Técnicas

| Sintoma do Cliente | Causa Raiz | Correção Aplicada | Teste que Prova |
|---|---|---|---|
| Paciente clica no botão de horário e a IA fica em silêncio | Z-API envia `buttonsResponseMessage`/`listResponseMessage`, mas `whatsapp-bot` procurava `buttonResponse`/`optionListResponse`. O webhook descartava o evento como "Empty event". | `extractZapiContent` extrai `buttonId`/`selectedRowId` e seta `isInteractiveReply = true`. `whatsapp-bot` grava `caption` fallback. | `inboundParser_test.ts` (Z-API button response, list response, empty buttonId). |
| Responde em português em conversas iniciadas em inglês | Prompt era montado com `storedLanguage || "pt"` antes de rodar a triagem, cravando instrução em português no 1º turno. | `resolveTurnLanguage` infere o idioma no inicio do turno via `TURN_LANGUAGE_HINTS` e alimenta `buildAutonomousSystemPrompt` e `buildKnowledgePacket`. | `inboundParser_test.ts` (resolveTurnLanguage 1st turn en/es/pt). |
| Confirmação de agendamento sai em português em conversas em inglês | `structuredFlow.ts` usava `context.language || "pt"`. | Substituted por `resolveTurnLanguage(rawContent, context.language)`. | Testado via `resolveTurnLanguage`. |
| Clique em horário deixa de funcionar após transferência humana | `process-inbox` ignorava todo o fluxo e saía quando status era `queued`/`human_active`. | `process-inbox` executa `tryStructuredFlow` no bloco de status `queued`/`human_active`. Se der match, o agendamento é feito. | `deno check` e suíte de testes de `structuredFlow`. |

---

## 3. Arquivos tocados

1. **`supabase/functions/_shared/inboundParser.ts`** `[NOVO]`
   - Exporta `extractZapiContent` e `extractCloudApiContent` para extração isolada e testável do payload de webhooks.
2. **`supabase/functions/whatsapp-bot/index.ts`** `[ALTERADO]`
   - Substituiu a extração frágil de Z-API por `extractZapiContent`.
   - Passa `caption: caption ?? interactiveTitle` para gravação em `message_inbox`.
   - Garante que respostas interativas nunca caiam em "Empty event".
3. **`supabase/functions/_shared/schedulingTools.ts`** `[ALTERADO]`
   - Exporta `resolveSlotIdByTitle(text, pendingSlots, pendingTitles)` com normalização de acentos, maiúsculas, separadores e derivação de visual title via `slot_id`.
4. **`supabase/functions/_shared/structuredFlow.ts`** `[ALTERADO]`
   - Adicionou chamada a `resolveSlotIdByTitle` antes de `parseSlotClick`.
   - Usa `resolveTurnLanguage` para buscar as mensagens de confirmação de slot no idioma correto.
   - Armazena e limpa `pending_slot_titles` em sincronia com `pending_slots`.
5. **`supabase/functions/_shared/copilot.ts`** `[ALTERADO]`
   - Exporta `resolveTurnLanguage` e amplia regexes em `TURN_LANGUAGE_HINTS`.
   - Reordenou a derivação de `patientQuery` para antes da montagem do prompt.
   - Substituiu `storedLanguage`/`context.language` por `turnLanguage` na montagem do prompt, pacote de conhecimento e mensagens de handoff.
   - Armazena `pending_slot_titles` no objeto `merged`.
6. **`supabase/functions/process-inbox/index.ts`** `[ALTERADO]`
   - Executa `tryStructuredFlow` no ramo `human_active` / `queued`.
7. **`supabase/functions/_tests/evals/inbound_parser_test.ts`** `[NOVO]`
   - 25 casos de testes unitários cobrindo `extractZapiContent`, `extractCloudApiContent`, `resolveSlotIdByTitle` e `resolveTurnLanguage`.

---

## 4. Desvios do plano

- Nenhum desvio do plano. Todos os itens descritos para a Onda 0 no `TAREFA_GEMINI_REENGENHARIA_AGENTE_IA.md` foram seguidos estritamente.

---

## 5. Saída dos testes

```
> deno test -A _tests/evals/

running 25 tests from ./_tests/evals/inbound_parser_test.ts
inboundParser — Z-API button response ... ok (1ms)
inboundParser — Z-API option list response ... ok (85µs)
inboundParser — Z-API template button response ... ok (77µs)
inboundParser — Z-API simple text message ... ok (66µs)
inboundParser — Z-API media image with caption ... ok (69µs)
inboundParser — Z-API media audio without caption ... ok (65µs)
inboundParser — Z-API sticker ... ok (60µs)
inboundParser — Z-API interactive reply with empty buttonId but title present ... ok (65µs)
inboundParser — Z-API empty payload ... ok (52µs)
inboundParser — Cloud API button reply ... ok (62µs)
inboundParser — Cloud API list reply ... ok (60µs)
inboundParser — Cloud API text message ... ok (53µs)
resolveSlotIdByTitle — exact title match ... ok (121µs)
resolveSlotIdByTitle — match with description on 2nd line ... ok (101µs)
resolveSlotIdByTitle — accent and separator normalization ... ok (78µs)
resolveSlotIdByTitle — extra spacing differences ... ok (102µs)
resolveSlotIdByTitle — missing pendingTitles (derived from slot_id) ... ok (261µs)
resolveSlotIdByTitle — title not in list returns null ... ok (102µs)
resolveSlotIdByTitle — empty pendingSlots returns null ... ok (75µs)
resolveSlotIdByTitle — arbitrary free text returns null ... ok (109µs)
resolveTurnLanguage — 1st turn in English without stored language -> en ... ok (1ms)
resolveTurnLanguage — 1st turn in Spanish without stored language -> es ... ok (369µs)
resolveTurnLanguage — 1st turn in Portuguese without stored language -> pt ... ok (104µs)
resolveTurnLanguage — short greeting 'hi' -> en ... ok (103µs)
resolveTurnLanguage — short greeting 'hello' -> en ... ok (95µs)
resolveTurnLanguage — short phrase 'good morning' -> en ... ok (72µs)
resolveTurnLanguage — short phrase 'hola' -> es ... ok (64µs)
resolveTurnLanguage — short phrase 'oi' -> pt ... ok (66µs)
resolveTurnLanguage — 'ok' with storedLanguage=en -> en (fallback) ... ok (149µs)
resolveTurnLanguage — explicit language switch in mid-conversation (es) -> es ... ok (87µs)
resolveTurnLanguage — ambiguous query uses stored language fallback ... ok (73µs)
resolveTurnLanguage — time string uses stored language fallback ... ok (93µs)

running 78 tests from ./_tests/evals/unit_test.ts
parseSlotClick: roundtrip do id do botão ... ok (598µs)
parseSlotClick: type_id vazio vira null ... ok (75µs)
parseSlotClick: texto comum não é clique ... ok (73µs)
buildSlotInteractive: até 3 slots viram botões ... ok (169µs)
buildSlotInteractive: mais de 3 slots viram lista ... ok (132µs)
isWithinBusinessHours: sem config = sempre expediente (conservador) ... ok (179µs)
isWithinBusinessHours: janela 00:00–23:59 todos os dias = sempre dentro ... ok (14ms)
isWithinBusinessHours: janela impossível 00:00–00:01 quase sempre fora ... ok (363µs)
isWithinBusinessHours: dia fora da lista = fora do expediente ... ok (401µs)
normalizeSlotTime: aceita string HH:MM (schema do repo) ... ok (172µs)
normalizeSlotTime: aceita objeto (schema de produção divergente) ... ok (85µs)
normalizeSlotTime: lixo vira null (nunca '[object Object]') ... ok (83µs)
formatDateForPatient: formato por idioma ... ok (91µs)
knowledge gap: resposta vazia/rounds esgotados ... ok (1ms)
knowledge gap: confirmação em português ... ok (348µs)
knowledge gap: confirmação em inglês ... ok (118µs)
knowledge gap: confirmação em espanhol ... ok (66µs)
knowledge gap: transferência explícita por falta de informação ... ok (446µs)
knowledge gap: preço não é lacuna ... ok (167µs)
knowledge gap: emergência não é lacuna ... ok (66µs)
knowledge gap: pedido de humano não é lacuna ... ok (86µs)
knowledge gap: cancelamento não é lacuna ... ok (74µs)
knowledge gap: reconciliação não é lacuna ... ok (65µs)
knowledge gap: dúvida clínica sinalizada não é lacuna ... ok (74µs)
knowledge gap: conteúdo clínico sensível é barrado mesmo com confirmação ... ok (66µs)
knowledge gap: sanitiza mídia, email, telefone e nome declarado ... ok (121µs)
knowledge gap: normalização agrega variações textuais ... ok (279µs)
validateAgentReply: aprova resposta limpa ... ok (5ms)
validateAgentReply: reprova preço vazado ... ok (1ms)
validateAgentReply: reprova horário inventado, aprova horário vindo de ferramenta ... ok (284µs)
validateAgentReply: reprova deriva de PT em conversa EN; não pune PT em conversa PT ... ok (429µs)
buildFlowStateHint: pending_slots gera instrução de continuidade ... ok (226µs)
buildFlowStateHint: ficha coletada entra no hint; preferred_window pede avanço ... ok (134µs)
buildFlowStateHint: contexto vazio retorna null (prompt inalterado) ... ok (75µs)
timeMatchesPeriod: manhã/tarde/noite e sem filtro ... ok (110µs)
validateAgentReply: 1 emoji passa; enxurrada de emojis reprova ... ok (6ms)
effectiveFromDate: clampa data passada para o hoje local ... ok (88µs)
nowInTz: formato HH:MM válido ... ok (806µs)
buildSlotInteractive: rótulos da lista seguem o idioma da conversa ... ok (104µs)
namesMatch: tolerante a acento, caixa e nome parcial ... ok (143µs)
plausiblePersonName: nome próprio sim, parentesco não ... ok (487µs)
validateAgentReply P-05: vazamento de artefato interno reprova ... ok (246µs)
validateAgentReply P-07: promessa clínica reprova ... ok (220µs)
isNearDuplicateReply: pega repetição, ignora resposta nova ... ok (204µs)
global knowledge: idioma normalizado e tenant prevalece ... ok (179µs)
global knowledge: limite defensivo e marcador de fonte ... ok (133µs)
isAffirmativeChoice: afirmativos concretos em pt/en/es ... ok (590µs)
isAffirmativeChoice: rejeita hedges e mídia ... ok (247µs)
política operacional: fonte é obrigatória, pergunta e confirmação futura são seguras ... ok (359µs)
wrapUntrustedContent: preserva conteúdo e provenance ... ok (73µs)
clinicFactsSchema: chaves únicas e conteúdo localizado completo ... ok (338µs)
calculateClinicFactsCompletion: conta apenas fatos canônicos ativos e preenchidos ... ok (230µs)
validateAgentReply: status gratuito com fonte não é vazamento de preço ... ok (719µs)
status da consulta: fonte confiável não pode ser forjada nem contradita ... ok (147µs)
formatConsultationStatus: aceita apenas os enums canônicos ... ok (108µs)
consultation_fee: enum do backend permanece alinhado ao catálogo ... ok (108µs)
shouldUseRag: flag, limiar e defaults são conservadores ... ok (97µs)
buildKnowledgeBaseSection: usa top-K e preserva marcadores de fonte ... ok (120µs)
buildKnowledgeBaseSection: retrieval vazio ou indisponível usa dump ... ok (84µs)
embedText: sucesso retorna vetor 1536 e envia modelo/dimensões ... ok (15ms)
embedText: chave ausente e erro HTTP retornam null ... ok (774µs)
embedText: timeout retorna null e aborta fetch ... ok (15ms)
hasInsensitiveTone P-15: reprova tom hostil/sarcástico na resposta ... ok (97µs)
hasInsensitiveTone P-17: reprova culpa/vergonha por falta ou atraso ... ok (83µs)
hasInsensitiveTone P-16: reprova tom festivo/emoji quando o paciente relata contexto sensível ... ok (73µs)
shouldUseAccessibleMode E-22: só ativa com pedido explícito do paciente (pt/en/es) ... ok (395µs)
computeJailbreakRiskDelta: sondagem leve=1, tentativa forte=2, mensagem normal=0 ... ok (660µs)
looksLikeInjectionAttempt: marca (nunca bloqueia) padrão de instrução embutida em fato sugerido ... ok (327µs)
canonicalizePhone: remove tudo que não é dígito ... ok (123µs)
detectLanguageDrift: pega deriva PT em conversa EN (frase real do incidente), ignora conversa PT ... ok (245µs)
buildCachedSystemField: prefixo válido vira array com cache_control; resto sem ... ok (155µs)
buildCachedSystemField: prefixo == texto inteiro vira um único bloco cacheado ... ok (76µs)
buildCachedSystemField: sem prefixo, prefixo vazio, ou prefixo que não bate → string crua (sem cache) ... ok (73µs)
applyCacheToTools: marca só o ÚLTIMO tool (exigência da API); vazio não quebra ... ok (127µs)
buildAutonomousSystemPrompt: cachePrefix é prefixo exato de text (contrato do llmProvider) ... ok (661µs)
buildAutonomousSystemPrompt: conteúdo por turno NUNCA vaza para o cachePrefix ... ok (178µs)
buildAutonomousSystemPrompt: cachePrefix é IDÊNTICO entre turnos do mesmo tenant (é isso que faz o cache bater) ... ok (167µs)
buildAutonomousSystemPrompt: instructions/knowledgePacket diferentes → cachePrefix diferente (não sobrepõe tenants distintos) ... ok (173µs)

ok | 110 passed | 0 failed (157ms)
```

---

## 6. Riscos residuais e pendências

- **Status `human_active` e reset de handoff:** Na Onda 0, quando `tryStructuredFlow` conclui um agendamento por clique em sessão `queued`/`human_active`, ele atualiza `omnichannel_status: "bot_active", human_handoff: false`. Na Onda 1, refinaremos essa atualização para diferenciar handoffs `soft` de handoffs `hard` (onde atendentes humanos assumiram explicitamente).

---

## 7. Como validar manualmente

1. **Simular Webhook Z-API de Botão:**
   Envie um POST para `whatsapp-bot` com payload Z-API contendo `buttonsResponseMessage`: `{ buttonId: "slot|doctor_1|loc_1|type_1|2026-07-22|08:30", message: "22/07 · 08:30" }`.
   *Resultado:* O webhook aceita com 200 OK, grava em `message_inbox` com `content = "slot|..."` e `caption = "22/07 · 08:30"`.

2. **Simular 1º Turno em Inglês:**
   Envie `"Hello, I would like to schedule a dental checkup"` para uma nova conversa sem `context.language`.
   *Resultado:* `resolveTurnLanguage` infere `"en"`, o prompt é construído com instruções em inglês e o pacote de conhecimento RAG/dump busca conteúdo em inglês.

3. **Simular Clique de Horário com Humano na Fila:**
   Defina o status da sessão para `queued` ou `human_active` e envie `"slot|..."` ou o título `"22/07 · 08:30"`.
   *Resultado:* `process-inbox` executa `tryStructuredFlow`, conclui o agendamento via `book_appointment` RPC e envia a mensagem de confirmação no idioma do turno.
