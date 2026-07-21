# TAREFA DELEGADA — Onda 3: transformar o agente em um SDR/CRC de verdade

> **Para:** Gemini 3.5 Flash (medium)
> **De:** Claude (orquestrador técnico — Traffio) — code review, gate de evals e deploy
> **Data:** 2026-07-22
> **Natureza:** implementação de código (Edge Functions Deno) + testes + relatório.
> **Você NÃO faz deploy nem aplica migration.** Entrega migration como arquivo.
> **Pré-requisito:** Ondas 0, 1 e 2 estão EM PRODUÇÃO (contrato de saída em bolhas, handoff
> reversível, parser de interativo). Esta onda se apoia nelas.
>
> ⚠️ **Esta onda SUBSTITUI o escopo original da "Onda 3"** (memória de sessão + áudio) descrito em
> `TAREFA_GEMINI_REENGENHARIA_AGENTE_IA.md`. Áudio e resumo rolante ficam para depois — o cliente
> repriorizou. Não implemente transcrição de áudio nesta onda.

---

## 0. QUEM VOCÊ É (persona)

Você é um **engenheiro de produto conversacional** que já montou operação de pré-vendas em clínica.
Você sabe a diferença entre um **tirador de pedido** (responde o que perguntaram, agenda, encerra) e
um **SDR/CRC** (acolhe, entende a intenção real, educa com substância, remove objeção, coleta os
dados que a clínica precisa, conduz ao agendamento e deixa o paciente sentindo que foi bem tratado).

Seu lema nesta onda: **"O paciente não quer um formulário com sotaque. Ele quer alguém que entenda
o problema dele e resolva."**

---

## 1. O PROBLEMA (relato literal do cliente, 2026-07-22)

> "O AI Agent não fez um atendimento/agendamento, ele está apenas **tirando pedido**. Eu quero um
> atendente SDR/CRC, que atenda o paciente, filtre a intenção, **cadastre o paciente se ele não
> tiver cadastro**, faça agendamento, gerencie conversas no inbox, responda dúvidas, pesquise
> upcoming consultas, envie mensagens humanas e acolhedoras, envie mensagens estruturadas e humanas.
> Ele simplesmente **agendou um paciente sem cadastrar o cliente, sem nome, sem telefone, sem email,
> sem nenhuma informação adicional**, a conversa é robótica e quadrada, não usa gatilhos ou copy,
> não é acolhedora, e as respostas parecem enviadas por **robô dos anos 1990**."

### 1.1 — O OUTPUT-OURO (referência normativa desta onda)

Este é o texto que o cliente espera. **Ele é o critério de aceite.** Toda decisão de implementação
deve ser avaliada por "isso aproxima ou afasta do output-ouro?".

```
😁 Happy to help you get a clearer picture of dental implants.

A dental implant is essentially a titanium support placed into the jawbone to replace the root of a
missing tooth, later supporting a crown. The exact plan, number of visits, and healing time depend on
your specific case, which is why the dentist examines you first — this includes an X-ray as part of
the evaluation to check bone and tooth condition. Good news: the consultation itself is free, so
there's no cost to get that personalized assessment. 🦷😉

I have morning openings tomorrow 📅 07/23/2026
🕛09:00 am
🕛09:30 am
🕛10:00 am

or Thursday
🕛09:00 am
🕛09:30 am
🕛10:00 am

which works better for you?

[botão: "see times"]
```

### 1.2 — Dissecação do output-ouro (o que exatamente falta hoje)

| Característica do ouro | Estado atual | Item |
|---|---|---|
| Horários **listados no texto**, agrupados por dia, com data | Só vão no botão; texto diz "tenho horários, quer ver?" | **C1** |
| Formato **12h com am/pm** e data `07/23/2026` (locale do tenant) | `SlotOption.title` é `23/07 · 09:00` (24h, DD/MM) sempre | **C1** |
| Rótulo relativo: "tomorrow", "or Thursday" | Inexistente | **C1** |
| ~10 emojis (😁 🦷 😉 📅 🕛×6) | Validador **REPROVA** acima de 2/bolha e 3/turno | **C2** |
| Resposta com **substância** (o que é, quantas visitas, raio-X, consulta grátis) | Persona limita a "no máximo 2 frases" e "uma coisa por vez" | **C4/C5** |
| Paciente **cadastrado com nome real** | Cria `full_name: "Paciente WhatsApp"` sem perguntar nada | **C3** |
| Copy/gatilho honesto ("Good news: the consultation is free") | Persona não orienta a usar redução de risco | **C4** |

---

## 2. DIAGNÓSTICO TÉCNICO — por que o agente escreve assim hoje

Leia esta seção inteira antes de codar. Cada causa foi confirmada no código atual.

### 2.1 — A ferramenta manda o modelo ser breve

`_shared/schedulingTools.ts`, `executeSchedulingTool`, case `ver_disponibilidade`, campo `note`:

```ts
note: slots.length
    ? "The time slots above will be sent to the patient as clickable buttons automatically — present them briefly and invite the patient to pick one. (...)"
```

**"present them briefly"** é literalmente a instrução que produz o "tenho horários disponíveis, quer
ver?". O modelo está obedecendo.

### 2.1B — ⚠️ PARTE DO PROBLEMA NÃO É CÓDIGO: a base de conhecimento está vazia

**Leia isto antes de assumir que tudo se resolve com prompt.** A camada de inteligência da Traffio
já é completa. `src/config/clinicFactsSchema.ts` define a ficha canônica que o tenant preenche na
página **Inteligência**, e `buildKnowledgePacket()` (`_shared/copilot.ts`) injeta tudo no system
prompt a cada turno. As chaves canônicas já existentes incluem:

```
consultation_fee · first_consultation_process · payment_methods · installment_options
accepted_insurance · written_estimate · address · parking · accessibility · public_transport
business_hours · languages_spoken · contact_channels · dental_anxiety_support
sedation_availability · children_served · children_minimum_age · urgent_appointments
evaluation_includes_xray · first_visit_documents · cancellation_policy
late_arrival_tolerance · rescheduling_policy · appointment_confirmation · companion_policy
```

Agora confira o output-ouro da §1.1 contra essa lista:

| Afirmação do ouro | Origem |
|---|---|
| "titanium support placed into the jawbone…" | `global_knowledge` (odontologia geral — já existe) |
| "this includes an **X-ray** as part of the evaluation" | fato canônico **`evaluation_includes_xray`** |
| "the consultation itself is **free**" | fato canônico **`consultation_fee`** |
| "plan, number of visits, healing time depend on your case" | comportamento de persona (C4) |
| horários | ferramentas (C1) |

**Todo fato do output-ouro já tem campo próprio na ficha canônica.** A prova de que a base está
vazia neste tenant está no incidente original: o agente respondeu *"Regarding our exact address,
I'll have our team confirm that"* — existe o fato `address`; ele só não estava preenchido.

**Consequência prática para você, Gemini:** implemente C1–C6 normalmente, mas **não confunda
sintoma**. Se, ao testar, o agente ainda disser "vou confirmar com a equipe" para endereço, raio-X,
convênio ou horário de funcionamento, verifique **primeiro** se aquele fato existe em `clinic_info`
para o tenant de teste, antes de mexer em prompt. Registre isso no relatório: qual parte do
resultado veio de código e qual dependia de dado.

**Não implemente ferramenta nova para convênio, urgência ou política** — esses fatos já chegam ao
modelo pelo `buildKnowledgePacket`. Criar tool para eles seria duplicar mecanismo existente.

### 2.2 — Os horários nunca são formatados para o paciente

`fetchAvailableSlotsMulti` devolve `availableForModel`:

```ts
{ date: "2026-07-23", location: "...", professional: "...", slots: [{ time: "09:00", slot_id: "slot|..." }] }
```

Cru: data ISO, hora 24h. E `SlotOption.title` (usado no botão) é montado em `fetchAvailableSlots` como:

```ts
title: `${day}/${m} · ${time}`,   // "23/07 · 09:00"
```

O tenant é `Pacific/Auckland`, locale `en-NZ`, `timeFormat: "12h"`. Existe `getTenantClock()` que já
resolve `timeFormat`, `locale` e `today` (`_shared/schedulingTools.ts`) — **e nada disso é usado na
apresentação.** O relógio é usado só para filtrar passado no RPC.

### 2.3 — O validador de emoji reprovaria o output-ouro

`_shared/copilot.ts`, `validateAgentReply`:

```ts
const emojiCount = (text.match(/\p{Extended_Pictographic}/gu) || []).length;
if (emojiCount > 2) violations.push(`excesso de emojis na mensagem (${emojiCount}) — no máximo 1 a 2 por mensagem`);
```

E em `runAutonomousAgent`, o teto do turno:

```ts
const turnEmojiCount = (text.match(/\p{Extended_Pictographic}/gu) || []).length;
if (turnEmojiCount > 3) { violations.push(`excesso de emojis no turno (${turnEmojiCount}) (...)`); }
```

O output-ouro tem ~10. Reprovaria → regeneração → provável 2ª reprovação → **handoff humano**. Ou
seja: hoje, quanto melhor a resposta, maior a chance de o agente se auto-derrubar.

### 2.4 — ⚠️ ARMADILHA CRÍTICA: o validador de horários quebra com formato 12h

`validateAgentReply`:

```ts
const TIME_MENTION_PATTERN = /\b([01]?\d|2[0-3]):[0-5]\d\b/g;
const allowed = new Set([...opts.evidence.matchAll(TIME_MENTION_PATTERN)].map(m => normalizeHHMM(m[0])));
const invented = [...text.matchAll(TIME_MENTION_PATTERN)].map(m => normalizeHHMM(m[0])).filter(t => !allowed.has(t));
if (invented.length) violations.push(`horário(s) que não veio de ferramenta/contexto: ...`);
```

A evidência (`toolEvidence`) contém o JSON cru com `"14:00"`. Se você formatar para o paciente como
`02:00 pm`, o validador extrai `02:00`, não acha em `allowed`, e **acusa horário inventado**. Toda
resposta de tarde seria bloqueada.

**Isto é obrigatório resolver junto com C1** — ver solução prescrita em C1.4.

### 2.5 — A persona proíbe justamente o que o cliente quer

`SALES_PERSONA` (`_shared/copilot.ts`) hoje contém:

```
### UMA COISA POR VEZ (cadência humana)
- Responda apenas ao ponto atual da conversa. Não junte múltiplos assuntos em uma única mensagem.
```

E `RESPONDER_PACIENTE_TOOL.input_schema.answer.description`: *"Resposta direta à dúvida (...) —
objetiva e informativa"*, com a persona reforçando brevidade. O output-ouro responde **o que é o
implante + plano/visitas/cicatrização + raio-X + consulta grátis** num parágrafo fluido.

⚠️ **Cuidado para não corrigir demais — e não trocar uma camisa de força por outra.** A regra "uma
coisa por vez" nasceu de uma reclamação anterior do MESMO cliente ("responde 4 perguntas de uma vez,
parece robô"). Mas o cliente esclareceu (2026-07-22) que **não quer a resposta obrigatoriamente num
único parágrafo** — quer *"atendimento acolhedor, humanizado e com habilidades e comportamento de
verdadeiros SDR/CRC, atendimento de alto nível"*.

Ou seja: **o formato é livre; o que muda é o COMPORTAMENTO.** Não substitua o limite rígido de
brevidade por um limite rígido de "parágrafo único". O output-ouro da §1.1 é um *exemplo de bom
atendimento*, não um molde a ser replicado literalmente em toda resposta. Ver C4.

### 2.6 — Agendamento sem cadastro

`_shared/schedulingTools.ts`, `resolvePatientForBooking`:

```ts
const { data: created, error } = await supabase
    .from("patients")
    .insert({ tenant_id: tenantId, phone: canonicalPhone, full_name: fallbackDisplayName?.trim() || "Paciente WhatsApp" })
```

Sem nome real, sem email, sem nada. É exatamente o "agendou sem cadastrar" do relato.

Colunas REAIS de `patients` (verificadas): `full_name`, `cpf`, `email`, `phone`, `birth_date`,
`gender`, `insurance_provider`, `insurance_card_number`, `address_json`, `notes`.

⚠️ **NUNCA peça CPF/RG/documento no chat** — já é regra no `AUTONOMOUS_ADDENDUM` (passivo LGPD em
log de conversa). Colete **nome completo** (obrigatório) e **email** (opcional, para confirmação).

---

## 3. CONTRATOS TRAVADOS (violar = reprovação automática)

1. **Política de preço absoluta.** Nunca valor monetário. O status `free/paid/first_free` da consulta
   pode e **deve** ser informado quando consta em `clinic_info` com fonte — o output-ouro faz isso
   ("the consultation itself is free") e está **correto**. Não afrouxe `PRICE_LEAK_PATTERN`.
2. **Horário só de ferramenta.** O modelo nunca inventa horário. C1 muda a *apresentação*, jamais a
   *origem* do dado.
3. **Prompt caching.** `cachedParts` = estável por tenant. Nada por turno/paciente no `cachePrefix`.
   Editar `SALES_PERSONA` é permitido (invalida cache 1× por tenant) — faça numa passada só.
4. **Multi-tenancy.** Todo SELECT/UPDATE com `.eq("tenant_id", tenantId)` (use `scopedQuery`).
5. **`tenants.timezone` é imutável.**
6. **Contexto sensível continua bloqueando emoji.** `hasInsensitiveTone`/`SENSITIVE_CONTEXT_PATTERN`
   (dor intensa, luto, urgência, reclamação) → **zero** emoji, em qualquer quantidade. C2 **não pode**
   afrouxar isso.
7. **Fail-safe humano.** Qualquer exceção → fila humana, paciente nunca sem resposta.
8. **Reutilize, não reescreva:** `getTenantClock`, `resolveTenantTimeFormat`, `resolveTenantLocale`,
   `formatDateForPatient`, `fetchAvailableSlotsMulti`, `composeBubbles`, `validateAgentReply`,
   `resolvePatientForBooking`, `SessionManager`.

---

## 4. AS IMPLEMENTAÇÕES

### C1 — Horários formatados no texto, no relógio e locale do tenant

**Objetivo:** o agente escreve os horários no corpo da mensagem, agrupados por dia, com rótulo
relativo, no formato do tenant — e o botão continua indo junto.

**C1.1 — Novo helper puro** em `_shared/schedulingTools.ts`, exportado e testável:

```ts
export interface SlotPresentationOptions {
    clock: TenantClock;          // timeFormat, locale, today, timezone
    language: ConversationLanguage; // "pt" | "en" | "es"
}

/**
 * Formata a disponibilidade para o paciente, pronta para o modelo COPIAR no texto.
 * Nunca inventa horário: recebe exatamente o que veio de fetchAvailableSlotsMulti.
 */
export function formatSlotsForPatient(
    available: { date: string; location: string; professional: string; slots: { time: string; slot_id: string }[] }[],
    opts: SlotPresentationOptions,
): string
```

Regras de formatação:
- **Hora:** `clock.timeFormat === "12h"` → `09:00 am` / `02:00 pm` (minúsculo, com espaço).
  `24h` → `09:00` / `14:00`.
- **Data:** reusar `formatDateForPatient(date, language)` → `07/23/2026` (en) / `23/07/2026` (pt/es).
- **Rótulo relativo do dia**, comparando com `clock.today` (fuso do tenant, nunca UTC):
  - D+0 → `today` / `hoje` / `hoy`
  - D+1 → `tomorrow` / `amanhã` / `mañana`
  - D+2..D+6 → nome do dia da semana no idioma (`Thursday` / `quinta-feira` / `jueves`)
  - além disso → só a data
- **Estrutura de saída** (uma linha por horário, prefixo 🕛):

```
tomorrow 📅 07/23/2026
🕛09:00 am
🕛09:30 am
🕛10:00 am

Thursday 📅 07/24/2026
🕛09:00 am
🕛09:30 am
```

- **Não** inclua nome do profissional (regra de produto vigente: paciente compra o procedimento; o
  nome aparece na confirmação). Mantenha.
- Máximo de 2 dias e 3 horários por dia (já é o que `fetchAvailableSlotsMulti` devolve).

**C1.2 — Devolver o texto pronto na tool.** Em `executeSchedulingTool`, case `ver_disponibilidade`,
acrescente ao `data` retornado:

```ts
slots_formatted: formatSlotsForPatient(availableForModel, { clock, language }),
```

⚠️ `executeSchedulingTool` **não recebe `language` hoje**. Adicione como parâmetro (com default
`"pt"` para não quebrar chamadas existentes) e passe o `language` do turno em `runAutonomousAgent`.

**C1.3 — Reescrever o `note`.** Substitua "present them briefly" por instrução que produza o ouro:

```ts
note: slots.length
    ? "Write the message to the patient INCLUDING the `slots_formatted` block EXACTLY as provided (copy it verbatim, keep the emoji and line breaks), then close with ONE short question asking which time works best. The same slots also go as clickable buttons automatically. If the patient picks a time by TEXT, call `agendar` immediately with that option's exact slot_id. Do NOT mention professional names unless the patient asked. Reply in the PATIENT'S language."
    : (period
        ? "No available time slots in that period. Offer to check other periods or days — do not invent times."
        : "No available time slots in this period.")
```

**C1.4 — ⚠️ OBRIGATÓRIO: evitar que o validador acuse os horários formatados.**

Como `slots_formatted` entra em `toolEvidence` (que é `JSON.stringify(outcome.data)`), o texto `09:00 am`
já estará na evidência — mas **`02:00 pm` só aparece se você o gerar**. Como `slots_formatted` é
derivado do mesmo `availableForModel`, ele já contém a string 12h exata. Portanto:

- **Garanta** que `slots_formatted` seja incluído em `outcome.data` (C1.2) — assim `toolEvidence` passa
  a conter as strings 12h e o `allowed` do validador as reconhece.
- **Adicione um teste** que prove isso: slot de `14:00` com tenant `12h` → texto do agente contendo
  `02:00 pm` → `validateAgentReply` retorna **zero** violações de horário.

Sem esse teste eu não aprovo o item — é a armadilha mais provável desta onda.

**Prova C1:** ≥10 testes de `formatSlotsForPatient`: 12h/24h; pt/en/es; D+0/D+1/D+2; virada de mês;
lista vazia → string vazia; 2 dias; horário de tarde em 12h (`14:00`→`02:00 pm`); meia-noite/meio-dia
(`00:00`→`12:00 am`, `12:00`→`12:00 pm`).

---

### C2 — Orçamento de emoji que aceita o output-ouro

**Objetivo:** permitir a riqueza visual do ouro sem reabrir a porta para ruído infantilizado.

**Princípio:** separar **emoji decorativo** (calor humano, no texto corrido) de **emoji estrutural**
(marcador de lista de horários: 🕛 📅). O estrutural é gerado por **nós** (C1), não pelo modelo, e
não deve consumir o orçamento.

**C2.1 — Contagem que ignora o bloco de horários.** Em `_shared/copilot.ts`, crie helper puro:

```ts
const STRUCTURAL_EMOJI = /[\u{1F550}-\u{1F567}\u{1F4C5}]/gu; // 🕐-🕧 e 📅

/** Conta apenas emoji decorativo: ignora os marcadores estruturais de lista de horários. */
export function countDecorativeEmoji(text: string): number
```

Implementação: remover ocorrências de `STRUCTURAL_EMOJI` e então contar `\p{Extended_Pictographic}`.

**C2.2 — Novos tetos.** Em `validateAgentReply`, troque a contagem crua por `countDecorativeEmoji` e
eleve para **3 por bolha**. Em `runAutonomousAgent`, o teto do turno passa a **5 decorativos**
(o ouro usa 3: 😁 🦷 😉). Atualize as mensagens de violação e os comentários.

**C2.3 — NÃO MEXER:** `hasInsensitiveTone` continua usando contagem **crua** (`emojiCount > 0`) para
o gate de contexto sensível. Em dor/luto/urgência/reclamação, **nenhum** emoji — nem estrutural.
Isso significa: em contexto sensível o agente não deve oferecer lista de horários com 🕛; se
precisar oferecer, que seja em texto puro. Documente essa consequência no relatório.

**Prova C2:** o output-ouro completo (cole-o literal no teste) passa por `validateAgentReply` com
**zero** violações; 6 emojis decorativos numa bolha reprovam; mensagem com 8 🕛 e 1 😊 passa; a mesma
mensagem com `patientLastMessage = "estou com muita dor"` reprova por tom insensível.

---

### C3 — Cadastro do paciente (o "C" de CRC)

**Objetivo:** nunca mais agendar um "Paciente WhatsApp".

**C3.1 — Nova ferramenta** em `SCHEDULING_TOOLS`:

```ts
{
    name: "atualizar_cadastro_paciente",
    description: "Cria ou atualiza a ficha do paciente desta conversa. Use assim que souber o nome completo — SEMPRE antes de agendar. O telefone já é conhecido pelo sistema; nunca peça telefone, CPF, RG ou documento.",
    input_schema: {
        type: "object",
        properties: {
            full_name: { type: "string", description: "Nome completo de quem será atendido, como o paciente informou." },
            email:     { type: "string", description: "E-mail, se o paciente informar espontaneamente ou aceitar dar. Opcional." },
            birth_date:{ type: "string", description: "Data de nascimento YYYY-MM-DD, se informada. Opcional." },
            notes:     { type: "string", description: "Observação clínica/contextual relevante dita pelo paciente (ex.: 'tem medo de dentista', 'dente quebrou ontem'). Opcional." },
        },
        required: ["full_name"],
    },
}
```

**C3.2 — Executor.** Novo case em `executeSchedulingTool`:
- Resolve o paciente por telefone (`phoneLookupCandidates`, já existe).
- Se existir → `UPDATE` só dos campos enviados (nunca sobrescreva com vazio).
- Se não existir → `INSERT` com `tenant_id`, `phone` canonicalizado, `full_name`.
- Escopo por `tenant_id` obrigatório.
- Retorne `{ success: true, patient_id, created: boolean }`.
- Nunca aceite `full_name` que seja parentesco — reuse `plausiblePersonName()` (já existe); se
  reprovar, devolva `{ success: false, error: "invalid_name", note: "Ask for the person's actual full name." }`.

**C3.3 — Guard no `agendar`.** Antes do `book_appointment`, se o paciente resolvido tiver
`full_name` ausente ou igual ao placeholder (`"Paciente WhatsApp"`), **não agende**:

```ts
return { data: { success: false, error: "patient_not_registered",
    note: "Before booking, ask the patient's full name in a natural, warm way and call atualizar_cadastro_paciente. Then call agendar again." } };
```

**C3.4 — Persona/fluxo.** No `AUTONOMOUS_ADDENDUM`, acrescente regra de coleta:
- Peça o nome **no momento natural**: depois que o paciente demonstrou interesse em um horário, não
  no primeiro "oi". Ex.: *"Perfeito! Para eu reservar esse horário, qual é o seu nome completo?"*
- E-mail: peça **uma vez**, como benefício ("para eu te enviar a confirmação e o endereço por e-mail"),
  e aceite recusa sem insistir.
- Nunca peça telefone (já temos), nunca peça documento.

**Prova C3:** testes de `plausiblePersonName` no novo caminho; teste do guard (`full_name` placeholder
→ `patient_not_registered`); teste de update parcial (email novo não apaga nome existente).

---

### C4 — Persona SDR/CRC de alto nível (o coração desta onda)

**Objetivo:** trocar "tirador de pedido" por **atendente de verdade**. Editar `SALES_PERSONA` em
`_shared/copilot.ts`.

⚠️ **Esta seção é sobre COMPORTAMENTO, não sobre formato.** Não escreva regra de tamanho, número de
parágrafos ou quantidade de frases. O agente deve poder responder em uma mensagem ou em três, curto
ou detalhado, conforme o momento pedir — como uma pessoa boa de atendimento faz naturalmente.

**C4.1 — Substituir a seção `### UMA COISA POR VEZ`** por:

```
### COMPORTAMENTO DE ATENDIMENTO (SDR/CRC de alto nível)
Você não é um FAQ, nem um formulário, nem um robô de agendamento. Você é a pessoa que recebe o
paciente na clínica. Comporte-se como um atendente excelente:

1. ACOLHER DE VERDADE — reconheça o que a pessoa trouxe antes de despejar informação. Se ela
   demonstrou receio, dor, pressa ou frustração, isso vem PRIMEIRO; o resto vem depois.
2. ENTENDER ANTES DE OFERECER — descubra o que ela realmente precisa (qual procedimento, para quem
   é, se há urgência, se já é paciente da casa). UMA pergunta por vez. Nunca interrogatório.
3. ESCUTA ATIVA — use o que ela já disse. Nunca repita uma pergunta já respondida. Depois que ela
   se apresentar, chame-a pelo nome com naturalidade.
4. EDUCAR COM SUBSTÂNCIA — explique de verdade, no nível de quem não é da área, sempre a partir do
   CONTEXTO DA CLÍNICA. Reduzir a incerteza do paciente é o que faz ele marcar. "Vou verificar"
   quando você TEM o dado é falha de atendimento.
5. TRATAR OBJEÇÃO SEM ATRITO — preço, medo, tempo, "vou pensar": valide o sentimento, reenquadre
   com valor real, mantenha a porta aberta. Nunca pressione, nunca insista duas vezes seguidas.
6. CONDUZIR — toda mensagem termina aproximando de um próximo passo concreto. Quando o interesse
   está claro, prefira o fechamento alternativo ("prefere de manhã ou à tarde?").
7. REGISTRAR SERVINDO — colete nome e e-mail como parte do cuidado ("pra eu já deixar reservado no
   seu nome"), nunca como cadastro burocrático.
8. FECHAR O CICLO — ao concluir algo, diga o que acontece em seguida, para a pessoa não ficar no ar.

FORMATO É LIVRE: uma mensagem ou várias, curta ou detalhada, com ou sem lista — o que soar natural
naquele momento da conversa. Não existe tamanho "certo".

O QUE NUNCA PODE (é isto que soa a robô):
- Resposta genérica ou evasiva quando a informação existe no contexto.
- Despejar uma lista mecânica de respostas desconexas, uma para cada pergunta.
- Repetir a pergunta do paciente antes de respondê-la ("Você perguntou sobre X. Sobre X, ...").
- Tom de protocolo: "prezado(a)", "informamos que", "conforme solicitado", "estamos à disposição".
- Encerrar sem oferecer um próximo passo.
- Fazer o paciente repetir informação que ele já deu.
```

**C4.2 — Acrescentar seção de copy/gatilhos honestos:**

```
### GATILHOS (só os honestos, sempre vindos do CONTEXTO DA CLÍNICA)
- REDUÇÃO DE RISCO: quando a avaliação for gratuita, diga com clareza — é o argumento mais forte
  que você tem ("a avaliação em si é gratuita, então não há custo para receber esse diagnóstico").
- ESPECIFICIDADE gera confiança: cite o que realmente acontece na consulta (ex.: raio-X para avaliar
  osso e dente) quando isso constar no contexto. Nunca invente etapa clínica.
- FACILIDADE: mostre que o próximo passo é pequeno ("são 30 minutos", "tenho horário amanhã cedo").
- NUNCA use escassez inventada, urgência falsa, "última vaga", nem promessa de resultado clínico.
```

**C4.3 — Tom.** Acrescentar em `### QUEM VOCÊ É`:

```
Escreva como uma pessoa real escreve no WhatsApp: contrações naturais, frases de comprimento
variado, zero jargão corporativo. Nada de "prezado(a)", "informamos que", "estamos à disposição".
```

---

### C4B — Lista de espera: "não tenho horário" NUNCA é fim de conversa

**Objetivo:** eliminar o único beco sem saída real do fluxo de agendamento.

Hoje as ferramentas do agente são `listar_profissionais`, `ver_disponibilidade`,
`buscar_meus_agendamentos`, `agendar`, `remarcar`, `encaminhar_cancelamento` e `transfer_to_human`.
**Não existe forma de colocar o paciente na lista de espera** — apesar de toda a infraestrutura já
existir (tabela `waitlist`, Edge Function `process-waitlist`, e o fluxo determinístico de resposta à
oferta de vaga já implementado em `structuredFlow.ts` via `context.pending_waitlist`).

Consequência: quando `ver_disponibilidade` volta vazio, ou quando nenhum horário serve ao paciente,
o agente encerra com "vou verificar com a equipe". Um SDR nunca deixa o lead morrer aí.

**C4B.1 — Nova ferramenta** em `SCHEDULING_TOOLS`:

```ts
{
    name: "adicionar_lista_espera",
    description: "Coloca o paciente na lista de espera para ser avisado assim que abrir um horário. Use SEMPRE que não houver horário disponível, ou quando nenhum dos horários oferecidos servir para o paciente — nunca encerre a conversa sem oferecer esta alternativa.",
    input_schema: {
        type: "object",
        properties: {
            procedure:        { type: "string", description: "Procedimento desejado, como o paciente falou." },
            preferred_period: { type: "string", enum: ["morning", "afternoon", "evening", "any"], description: "Período preferido do paciente." },
            notes:            { type: "string", description: "Restrição relevante dita pelo paciente (ex.: 'só consigo sexta', 'depois das 17h'). Opcional." },
        },
        required: [],
    },
}
```

**C4B.2 — Executor.** Novo case em `executeSchedulingTool`:
- **Antes de inserir, verifique a estrutura REAL da tabela `waitlist`** (colunas, NOT NULLs e o que
  `process-waitlist` espera para conseguir notificar). O `structuredFlow.ts` já lê
  `pending_waitlist` com `{ waitlist_id, patient_id, doctor_id, location_id, type_id, date, start_time }`
  — use isso como referência do contrato, mas **confirme no código de `process-waitlist`**.
- ⚠️ **Restrição conhecida (memória do projeto):** `process-waitlist` só notifica entradas com
  `doctor_id` preenchido. Se o paciente não escolheu profissional, resolva o `doctor_id` a partir do
  procedimento (reuse `resolveServiceByName` + `doctorsForService`, já existentes). Se não der para
  resolver, **não crie entrada órfã que nunca será notificada** — devolva erro e deixe o agente
  oferecer transferência humana.
- Exige paciente cadastrado: reuse o mesmo guard do C3 (sem nome real → peça o nome antes).
- Escopo por `tenant_id` obrigatório.
- Retorno: `{ success: true, waitlist_id, note: "Confirm warmly that the patient is on the waitlist and will be notified as soon as a slot opens. Reply in the PATIENT'S language." }`.

**C4B.3 — Persona.** No `AUTONOMOUS_ADDENDUM`, acrescente:

```
- SEM HORÁRIO NÃO É FIM DE PAPO: se não houver horário disponível, ou se nenhum dos horários servir
  para o paciente, ofereça a lista de espera com naturalidade ("te coloco na lista e aviso assim que
  abrir uma vaga — pode ser?") e use adicionar_lista_espera. Nunca encerre com "vou verificar".
```

**Prova C4B:** teste do executor com `doctor_id` resolvível e não-resolvível; teste de que o guard de
cadastro (C3) é respeitado; cenário de eval "paciente pede horário que não existe" → agente chama
`adicionar_lista_espera` e **não** chama `transfer_to_human`.

---

### C5 — Contrato de saída: deixar o `answer` respirar

Em `RESPONDER_PACIENTE_TOOL` (`_shared/copilot.ts`), reescreva as descrições:

```ts
acknowledge: { type: "string", description: "Bolha 1 (opcional): acolhimento curto e caloroso, 1 frase. Pode abrir com 1 emoji quando houver conexão real." },
answer:      { type: "string", description: "Bolha 2 (obrigatória): a resposta de VALOR — explique de verdade, no nível de quem não é da área, usando o CONTEXTO DA CLÍNICA. Extensão LIVRE: o suficiente para reduzir a incerteza do paciente naquele momento, sem encher linguiça. Nunca uma evasiva ('vou verificar') quando o dado está no contexto." },
advance:     { type: "string", description: "Bolha 3 (opcional): quando houver horários disponíveis, COPIE aqui o bloco `slots_formatted` da ferramenta, exatamente como veio, e feche com UMA pergunta curta ('which works better for you?'). Sem horários, apenas o convite de avanço." },
```

⚠️ Mantenha `required: ["answer"]` e `composeBubbles` inalterada — o contrato de 1-3 bolhas da Onda 2
está correto e o output-ouro encaixa nele (acolhimento / resposta / horários+pergunta).

---

### C6 — Evals de qualidade conversacional

**C6.1 — Cenário-ouro** em `_tests/evals/scenarios.ts`: paciente escreve em inglês pedindo
informação sobre implante (o caso real). Asserções **determinísticas** (nada sobre tamanho/formato):
sem preço monetário; contém `slots_formatted` literal; contém `am`/`pm` se o tenant for 12h;
termina com `?`.

**C6.2 — Juiz de comportamento** (`_tests/evals/`): rubrica 0-5, nota mínima **4** em cada eixo.
Os eixos medem **atendimento, não formato** — não avalie tamanho, número de parágrafos ou de frases:

| Eixo | Pergunta ao juiz |
|---|---|
| Acolhimento | A resposta reconhece a pessoa e o que ela trouxe, antes de informar? |
| Substância | Explica de verdade e reduz a incerteza, em vez de evasiva? |
| Escuta ativa | Usa o que o paciente já disse, sem repetir pergunta já respondida? |
| Naturalidade | Soa como pessoa real no WhatsApp, sem tom de protocolo? |
| Condução | Termina com um próximo passo concreto e único? |

Reprovar em qualquer eixo = suíte vermelha.

**C6.2b — Cenários de comportamento SDR/CRC** (além do cenário-ouro), cada um com o juiz acima:
- Paciente com **medo** ("tenho pavor de dentista") → acolhimento vem antes de qualquer venda; zero emoji.
- Paciente com **objeção de preço** insistente → mantém a política, reenquadra com valor, não cede número.
- Paciente que **já respondeu** o procedimento em turno anterior → não pergunta de novo.
- Paciente que diz **"vou pensar"** → deixa porta aberta, sem pressionar, sem insistir 2×.
- Paciente que dá o **nome** → passa a usá-lo e chama `atualizar_cadastro_paciente`.

**C6.3 — Teste de regressão inverso (o mais importante):** cole o **output-ouro literal** da §1.1
num teste e assere `validateAgentReply(...) === []`. Este teste é o guardião: se alguém reapertar
emoji/horário no futuro, ele quebra e mostra que a resposta boa voltou a ser rejeitada.

---

## 5. CRITÉRIOS DE ACEITE

```powershell
cd traffio-app/supabase/functions
npx deno test -A _tests/evals/          # unitários — todos verdes
npx deno check _shared/*.ts process-inbox/index.ts whatsapp-bot/index.ts
$env:ANTHROPIC_API_KEY="..."; npx deno run -A _tests/evals/run.ts   # integração
```

- Todos os testes novos verdes; os 139 existentes continuam verdes.
- **Os 3 testes de contrato do prompt caching continuam passando** (não negociável).
- O teste C6.3 (output-ouro passa no validador) **existe e passa**.
- O teste C1.4 (14:00 → "02:00 pm" sem violação) **existe e passa**.
- O cenário C4B (sem horário → `adicionar_lista_espera`, não `transfer_to_human`) **passa**.

### 5.1 — Pré-requisito de DADOS para o teste ponta-a-ponta (não é código)

Os evals usam `KNOWLEDGE_PACKET` mockado (`_tests/evals/run.ts`), então passam independente do banco.
Mas o **teste manual em tenant real só reproduz o output-ouro se a ficha canônica estiver preenchida**.
Antes de validar manualmente, o tenant de teste precisa ter, no mínimo, em `clinic_info`:

| Chave | Por quê | Frase do ouro que depende disso |
|---|---|---|
| `consultation_fee` | status gratuito/pago | *"the consultation itself is free"* |
| `evaluation_includes_xray` | o que a avaliação inclui | *"this includes an X-ray…"* |
| `address` | endereço | evita *"I'll have our team confirm that"* |
| `business_hours` | horário de funcionamento | perguntas de logística |
| `accepted_insurance` | convênios aceitos | pergunta cotidiana |
| `first_consultation_process` | como é a 1ª consulta | substância da resposta |

**Isto é responsabilidade do orquestrador/cliente, não sua.** Você não preenche dado de tenant.
Apenas **declare no relatório** que este pré-requisito existe e se foi (ou não) atendido no seu
teste — para não confundirmos "implementação incompleta" com "base vazia".

---

## 6. REGRAS DE TRABALHO

1. **Não faça deploy. Não aplique migration.** Esta onda provavelmente não precisa de migration —
   se você concluir que precisa, entregue como arquivo e **justifique** no relatório.
2. **Ordem sugerida:** C1 → C2 → C3 → C4 → C4B → C5 → C6. C1 e C2 são acoplados (a formatação só é
   utilizável se o validador aceitá-la) — implemente e teste os dois antes de seguir. C4B depende do
   guard de cadastro do C3.
3. **Nunca mova conteúdo por turno para o `cachePrefix`.**
4. **Se algo neste plano estiver errado** (uma função com assinatura diferente, uma coluna que não
   existe), **PARE, não improvise**: registre no relatório e siga com o resto. O schema real diverge
   dos `.sql` do repositório — não confie neles, confie no código que roda.
5. **Declare TODO desvio** na seção própria do relatório. Nas Ondas 1 e 2 houve itens pedidos que
   saíram diferentes sem constar em "Desvios" — eu descubro relendo o diff, e isso custa um ciclo.
   Declarar "não implementei X porque Y" é aceitável; omitir não é.

---

## 7. RELATÓRIO (entregável obrigatório)

Crie `traffio-app/docs/RESULTADO_ONDA3_SDR_CRC.md` com, nesta ordem:

1. **O que foi feito** — uma linha por item entregue (C1..C6).
2. **Como foi feito** — decisões técnicas e o porquê; por arquivo tocado, o que mudou e a razão.
3. **Arquivos tocados** — caminho + natureza (novo / alterado / migration).
4. **Comparação com o output-ouro** — cole a saída real que o agente produziria para o cenário do
   implante em inglês e compare, item a item, com o ouro da §1.1. Onde ainda difere, e por quê.
5. **Desvios do plano** — tudo que você fez diferente, com justificativa.
6. **Saída dos testes** — colada literalmente (comando + output), não parafraseada.
7. **Riscos residuais e pendências** — inclusive o efeito colateral documentado em C2.3 (contexto
   sensível × lista de horários com emoji).
8. **Como validar manualmente** — roteiro passo a passo para o orquestrador reproduzir.

Escreva em português, direto, sem marketing. O relatório existe para eu revisar e validar antes de
liberar a próxima onda.
