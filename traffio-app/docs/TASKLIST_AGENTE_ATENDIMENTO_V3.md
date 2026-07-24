# TASKLIST EXECUTÁVEL — Agente de Atendimento V3 (Fluxo de Classe Mundial)

> **Para o modelo executor (Sonnet 5):** este arquivo é o seu contrato de trabalho.
> Foi escrito pelo orquestrador (Fable 5) após diagnóstico linha a linha do código.
> Execute **uma etapa por vez, na ordem**. Ao concluir cada item, marque o checkbox
> `[x]` NESTE arquivo e preencha a seção "Resultado" da etapa. Nunca pule a
> validação de uma etapa para começar a próxima.

---

## 1. Contexto e objetivo

Teste real (24/07/2026, 4 pessoas mandando mensagem simultaneamente) expôs 4 falhas
em cascata no AI Agent de atendimento/agendamento via WhatsApp:

| # | Sintoma observado | Causa raiz (diagnóstico confirmado no código) |
|---|---|---|
| E1 | Agente atende sem perguntar o nome do lead | O prompt (`_shared/copilot.ts` ~linha 616) só exige nome **antes de agendar**, não no início do atendimento |
| E2 | Agenda sem confirmar nome completo → paciente salvo como "Paciente WhatsApp" | O caminho determinístico do clique de botão (`_shared/structuredFlow.ts:305`) chama `resolvePatientForBooking`, que cria paciente com fallback `"Paciente WhatsApp"` (`_shared/schedulingTools.ts:1126`) e agenda **sem passar pelo guard C3 de nome** — o guard só existe no caminho LLM (tool `agendar`, `schedulingTools.ts:957-971`) |
| E3 | Sugere slots já reservados | Duas frentes: (a) o filtro `isSlotAvailable` (`schedulingTools.ts:316`) foi commitado em `a4041bf` mas o deploy da função em produção precisa ser confirmado; (b) corrida inevitável entre "mostrar" e "clicar" com usuários simultâneos (TOCTOU) — slots mostrados a 4 pessoas ao mesmo tempo; (c) `pending_slots` fica no contexto da sessão **sem TTL** — botão antigo continua clicável horas depois |
| E4 | "Horário acabou de ser preenchido" sem oferecer novas opções | No conflito do clique (`structuredFlow.ts:344-360`) envia `SLOT_TAKEN_MSG` (texto solto, sem nova busca, sem botões) e ainda **apaga `pending_slots`** — beco sem saída. No caminho LLM, o `agendar` com `SLOT_CONFLICT` de outro paciente retorna o erro cru sem `note` nem alternativas (`schedulingTools.ts:1005`) |

**Objetivo:** fluxo de atendimento padrão de mercado (referências: Arini, Hello Patient,
Intavia — AI receptionists odontológicos em produção):

```
1. Saudação + apresentação como assistente da clínica
2. PERGUNTAR O NOME logo na abertura (e usá-lo na conversa inteira)
3. Entender a necessidade (procedimento, para quem, urgência)
4. Oferecer SOMENTE horários realmente livres (tempo real)
5. Antes de reservar: confirmar NOME COMPLETO (a plataforma já tem o telefone)
6. Confirmação estruturada (já existe: bloco com Dr., local, maps)
7. Se o slot foi tomado no meio do caminho: pedir desculpa curta + JÁ REOFERECER
   os horários que continuam livres, com botões, na MESMA mensagem
```

---

## 2. Regras de execução (obrigatórias, não negociáveis)

- **NÃO edite** `supabase/functions/whatsapp-bot/index.ts` nem
  `supabase/functions/_shared/webhookIdempotency.ts` — há outra sessão concorrente
  trabalhando neles (mudanças uncommitted no working tree). Nunca use `git stash`.
- **Leia o arquivo inteiro antes de editar.** Os módulos têm guards de produção
  datados em comentários — nunca remova um guard existente, apenas adicione.
- **NÃO toque em pg_cron** por `db query` (incidente anterior documentado).
- **Política de preço é absoluta:** nunca alterar o comportamento de não informar
  preço por mensagem (prompt em `copilot.ts`).
- **Prompt caching:** o prompt do agente é ordenado estático-primeiro com
  `cache_control`. Toda edição de prompt vai na parte ESTÁTICA (regras gerais),
  nunca inserindo conteúdo dinâmico no meio do bloco cacheado.
- **i18n de paciente:** toda string nova voltada ao paciente sai em PT/EN/ES,
  seguindo o padrão dos `Record<string,...>` existentes (ex.: `SLOT_TAKEN_MSG`).
- **Testes:** rodar da pasta `supabase/functions`:
  `npx deno test -A _tests/evals/unit_test.ts` e
  `npx deno test -A _tests/evals/pipeline_test.ts` (e os demais tocados).
- **Deploy:** somente `npx supabase functions deploy process-inbox --project-ref fyyhxmugxcfqhvoevuwf`
  (o bundle inclui os `_shared/`). NÃO deployar `whatsapp-bot` (carregaria o
  trabalho uncommitted da outra sessão).
- **Commits:** um commit por etapa, mensagem descritiva em pt-BR, sem `--no-verify`.
- Se o schema real do banco divergir do esperado (memória do projeto: os `.sql`
  do repo divergem da produção), **pare e registre** na seção Resultado em vez de
  adivinhar.

---

## ETAPA 0 — Baseline e verificação de deploy (pré-requisito de tudo)

Meta: garantir que o que está em `main` (incl. filtro `isSlotAvailable` e guard de
idempotência `BOOKING_REASON`) está de fato RODANDO em produção antes de medir
qualquer coisa — parte do E3 pode ser só deploy defasado.

- [x] 0.1 Rodar a suíte inteira de testes existente e registrar o resultado
      (`unit_test.ts`, `pipeline_test.ts`, `output_contract_test.ts`,
      `confirmation_test.ts`, `agent_attendance_guard_test.ts`). Nenhuma edição ainda.
- [x] 0.2 Deployar `process-inbox` a partir de `main` limpo (comando na seção 2)
      e registrar o horário do deploy.
- [x] 0.3 Probe de disponibilidade: via SQL (`npx supabase` ou MCP disponível),
      escolher o doctor do tenant de teste, chamar `find_next_available_dates`
      e confirmar que o retorno traz `available:false` nos slots ocupados
      (forma v6 do RPC). Registrar a forma real do retorno (string vs objeto).
- [x] 0.4 Conferir em `conversation_sessions` (tenant de teste) se há sessões com
      `context.pending_slots` antigos (evidência do problema de TTL do E3).

**Resultado:**

- **0.1 Testes:** todas as 5 suítes passaram limpo antes de qualquer edição —
  `unit_test.ts` 107/107, `pipeline_test.ts` 9/9, `output_contract_test.ts` 14/14,
  `confirmation_test.ts` 8/8, `agent_attendance_guard_test.ts` 10/10. Total 148/148.
  Baseline verde confirmado.
- **Nota de working tree:** ao iniciar a Etapa 0 o `git status` mostrou o repo
  limpo (a sessão concorrente já havia commitado em `28f7a55` — "webhook
  idempotency compensation and initialize AgendaMestra page" — antes de eu
  começar a mexer). A restrição de "não tocar em whatsapp-bot/index.ts" da
  seção 2 continua válida por precaução (nenhuma etapa deste plano precisa
  tocar nesse arquivo).
- **0.2 Deploy:** `npx supabase functions deploy process-inbox --project-ref
  fyyhxmugxcfqhvoevuwf` — sucesso, a partir de `main` no commit `28f7a55`
  (24/07/2026, ~mesma hora da sessão). Confirmado via
  `dashboard_url + message: "Deployed Functions."`.
- **0.3 Probe RPC:** sem service-role key nem `DATABASE_URL` locais disponíveis;
  usado `npx supabase db query --linked` (via Management API, sem senha de
  banco). Localizado o doctor real do teste do usuário — "Fabricio Pacheco"
  (`doctor_id 4c2c585c-014d-4679-9392-807b745d527a`, tenant
  `3810a967-507f-4415-866b-0f67b7d06053`) — com agendamentos confirmados em
  27/07 08:30 e 09:00, e 28/07 08:30 (status `scheduled`/`checkin_done`).
  Chamando `find_next_available_dates` para esse doctor: os 3 horários
  aparecem corretamente como `"available": false` (forma v6, com a flag por
  slot). **Conclusão: o RPC de produção NÃO é a causa do E3** — o filtro
  `isSlotAvailable` em `schedulingTools.ts` está trabalhando com dados
  corretos. A causa real do E3 relatado é a corrida TOCTOU entre "a IA busca e
  mostra a lista" e "o paciente clica" quando 4 pessoas disputam os mesmos
  horários ao mesmo tempo — arquitetural, tratada no design da Etapa 3
  (não tem RPC para corrigir) e mitigada na prática pela Etapa 4 (reoferta).
- **0.4 Sessões com `pending_slots` obsoletos:** encontrada 1 sessão
  (`c9692e5a-e5cc-4c29-af1c-1b7fdcf0aa48`, mesmo tenant de teste) com
  `pending_slots` de mais de 1h atrás contendo EXATAMENTE os 3 horários que já
  estão ocupados (27/07 08:30, 27/07 09:00, 28/07 08:30) — confirma o risco de
  TTL ausente descrito na Etapa 3: um dígito ("1") ou clique tardio nesta
  sessão tentaria agendar um slot morto, caindo no beco-sem-saída do E4 (ainda
  não corrigido nesta etapa).
- **Extra (evidência do E2 direto do banco):** `select count(*) from patients
  where full_name = 'Paciente WhatsApp'` no tenant de teste retornou **3** —
  bate exatamente com os 3 "Paciente WhatsApp" mostrados no screenshot do
  usuário. Confirma E2 no dado real, não só no código.
- **Ferramenta de acesso ao banco:** documentado para as próximas etapas —
  `npx supabase db query --linked "<sql>"` funciona sem senha (usa o token de
  login da CLI via Management API) e será reusado nas Etapas 2.7 e 5.4.

---

## ETAPA 1 — E1: o agente pergunta o nome na abertura e usa o nome sempre

Meta: primeira interação = saudação + apresentação + resposta breve ao que o lead
disse + pergunta do nome. Nunca um interrogatório: se o lead abriu com uma dúvida,
a dúvida é acolhida NA MESMA mensagem em que o nome é pedido.

- [x] 1.1 Em `_shared/copilot.ts`, seção de regras do prompt autônomo (~linhas
      612-629), adicionar regra de ABERTURA: "Se você ainda não sabe o nome de quem
      está falando (ver FICHA/PACIENTE NO SISTEMA), a sua PRIMEIRA resposta da
      conversa deve: apresentar-se, responder brevemente ao que a pessoa disse, e
      terminar perguntando o nome dela com naturalidade ('Com quem eu tenho o
      prazer de falar?' / 'Qual é o seu nome?'). Depois que souber, chame-a pelo
      PRIMEIRO nome ao longo da conversa — sem exagerar (não em toda frase)."
- [x] 1.2 Ainda no prompt: quando o lead se apresentar (mesmo só primeiro nome),
      chamar `atualizar_cadastro_paciente` imediatamente com o que foi dado —
      e deixar claro que primeiro nome basta para CONVERSAR, mas agendar exige
      nome completo (regra da Etapa 2).
- [x] 1.3 Caso "ficha placeholder": se o paciente existir no sistema com nome
      "Paciente WhatsApp" (ou implausível), o prompt deve tratar como "não sei o
      nome" (pedir na abertura). Verificar como o snapshot do paciente entra no
      prompt (`buildPatientSnapshot` / seção PACIENTE NO SISTEMA em `copilot.ts`)
      e garantir que o nome placeholder não seja usado para saudar.
- [x] 1.4 Evals: adicionar cenário em `_tests/evals/` (padrão de
      `conversationScenarios.ts`): (a) lead abre com "quero saber de implante" →
      resposta acolhe a dúvida E pergunta o nome; (b) lead responde "Fabricio" →
      agente chama `atualizar_cadastro_paciente` e passa a usar o nome.
- [x] 1.5 Rodar testes + commit.

**Resultado:**

- **1.1/1.2 — Prompt:** adicionado bullet "ABERTURA — SEMPRE SAIBA COM QUEM
  FALA" logo após a linha de apresentação em `AUTONOMOUS_ADDENDUM`
  (`_shared/copilot.ts:613`, bloco CACHEÁVEL — nenhum conteúdo dinâmico
  inserido, respeita o contrato de prompt caching). Cobre: pergunta do nome
  na 1ª resposta acolhendo o que o lead já disse; chama
  `atualizar_cadastro_paciente` assim que souber (mesmo só o primeiro nome);
  usa o primeiro nome com moderação depois; deixa explícito que agendar exige
  nome completo (referencia a regra já existente de CADASTRO DO PACIENTE); se
  o paciente não responder, insiste com leveza depois, sem virar interrogatório.
- **1.3 — Ficha placeholder:** `buildPatientSnapshot` (`copilot.ts:1137`)
  agora usa `plausiblePersonName` (importado de `schedulingTools.ts`) para
  decidir se o `full_name` do paciente é um nome de verdade. Nome
  implausível/placeholder ("Paciente WhatsApp", "minha filha") nunca mais
  aparece na seção PACIENTE NO SISTEMA como se fosse o nome real — vira
  "Paciente já tem ficha no sistema, mas AINDA SEM NOME informado". Mesmo
  tratamento aplicado à lista de nomes em conversas multi-paciente (mesmo
  telefone/família) e ao rótulo `[paciente: ...]` nos agendamentos ativos.
  **Efeito direto:** as 3 fichas "Paciente WhatsApp" já existentes no banco
  (achadas na Etapa 0) deixam de ser lidas como nome válido pelo agente a
  partir deste deploy — mesmo sem migração de dados.
- **1.4 — Evals:** 3 cenários novos em `_tests/evals/scenarios.ts` (gate real
  via `run.ts`, requer `ANTHROPIC_API_KEY` — mesmo gate documentado em
  memória do projeto, não roda em `deno test` padrão): `abertura_sem_nome`
  (1ª mensagem sem cadastro → acolhe a dúvida E pergunta o nome, não chama
  `atualizar_cadastro_paciente` ainda), `abertura_ficha_placeholder` (ficha
  placeholder → nunca ecoa "Paciente WhatsApp", pergunta o nome),
  `abertura_primeiro_nome` (paciente responde só o primeiro nome → chama
  `atualizar_cadastro_paciente`). Novo campo `patientSnapshotOverride` na
  interface `EvalScenario` e em `run.ts` para controlar o snapshot simulado
  sem depender do `withAppointment` existente.
  Adicionalmente, 3 testes **offline** (rodam em `deno test`, sem API key) em
  `unit_test.ts` cobrindo `buildPatientSnapshot` com mock de banco: nome
  placeholder → "AINDA SEM NOME" (nunca "Paciente WhatsApp" no texto), nome
  real → aparece normalmente, família mista → placeholder vira "sem nome".
  Precisou estender `createMockSupabase`/`chainable` (usado por outros testes
  C3/C4B) com `.gte()`/`.not()` — extensão aditiva, não alterou nenhum
  comportamento existente do mock.
- **1.5 — Testes:** `unit_test.ts` 110/110 (107 anteriores + 3 novos),
  `pipeline_test.ts` 9/9, `output_contract_test.ts` 14/14,
  `confirmation_test.ts` 8/8, `agent_attendance_guard_test.ts` 10/10 — 151/151
  no total. `npx deno check` limpo em `_shared/copilot.ts` e
  `_tests/evals/run.ts` (harness com LLM real). Commit:
  `feat: agente pergunta o nome na abertura e nunca saúda com ficha placeholder (E1)`.

---

## ETAPA 2 — E2: nenhum caminho agenda sem nome completo confirmado ("Paciente WhatsApp" nunca mais)

Meta: o guard C3 (hoje só no caminho LLM) vale para TODOS os caminhos de
agendamento. Nome de agendamento = nome completo (mínimo 2 palavras).

- [x] 2.1 Em `_shared/schedulingTools.ts`, criar `bookingGradeName(s): boolean`
      = `plausiblePersonName(s)` **e** ≥ 2 palavras (nome + sobrenome). Não
      alterar `plausiblePersonName` (usada para conversa, primeiro nome é válido).
- [x] 2.2 Caminho do clique (`_shared/structuredFlow.ts`, bloco `slotClick`):
      ANTES de agendar, resolver o paciente SEM criar registro (consultar
      apenas). Se não existir paciente com `bookingGradeName`:
      **não agendar ainda** — salvar `context.pending_booking_slot = clickContent`
      (+ `pending_booking_slot_at` ISO) e enviar mensagem determinística PT/EN/ES:
      "Perfeito! Esse horário está livre 😊 Para eu finalizar a reserva, qual é o
      seu nome completo?". Retornar `{ matched: true, status: "replied" }`.
- [x] 2.3 Novo ramo determinístico no início de `tryStructuredFlow`: se
      `context.pending_booking_slot` existe e a mensagem atual é um
      `bookingGradeName` → `atualizar_cadastro` (upsert do paciente com esse nome)
      + agendar o slot pendente + confirmação estruturada (mesmo formato atual) +
      limpar o marker. Se a mensagem NÃO parece nome completo (ex.: só primeiro
      nome, ou outra pergunta): limpar o marker? NÃO — manter o marker por até
      30 min e `return { matched: false }` para o LLM conduzir (o hint da 2.5
      diz ao modelo o que falta). Se o slot pendente expirou/conflitou ao agendar,
      cair no fluxo de reoferta da Etapa 4.
- [x] 2.4 Em `resolvePatientForBooking` (`schedulingTools.ts:1094`): remover o
      fallback que INSERE `"Paciente WhatsApp"` (linha ~1126) — em contexto de
      agendamento, sem nome ⇒ retornar `{ patient: null, reason: "name_required" }`
      e cada chamador decide (o LLM já tem o guard C3; o clique agora tem a 2.2).
      Auditar TODOS os chamadores de `resolvePatientForBooking` e `ensurePatient`
      (`grep -rn` em `supabase/functions/`) e registrar na seção Resultado quais
      criam paciente placeholder fora do agendamento (ex.: register-lead, sessões)
      — esses NÃO devem ser alterados nesta etapa, só inventariados.
- [x] 2.5 Hint de fluxo para o LLM (`buildFlowStateHint` em `copilot.ts` ~1199):
      quando `pending_booking_slot` existir, instruir: "há um horário escolhido
      aguardando o NOME COMPLETO; obtenha o nome, chame atualizar_cadastro_paciente
      e então `agendar` com esse slot_id exato".
- [x] 2.6 Guard C3 do caminho LLM (`agendar` e lista de espera): trocar a
      validação de nome para `bookingGradeName` (hoje aceita nome de 1 palavra).
      Ajustar o texto do `note` para pedir nome COMPLETO.
- [x] 2.7 Dados existentes: script SQL (somente leitura) listando pacientes
      `full_name = 'Paciente WhatsApp'` do tenant de teste com seus agendamentos
      futuros — salvar a lista na seção Resultado para correção manual pela
      equipe. NÃO deletar nem renomear em massa.
- [x] 2.8 Testes: unit para `bookingGradeName`; pipeline para: clique sem
      cadastro → pede nome → recebe "Fabricio Oliveira" → agenda; clique sem
      cadastro → recebe "sim" (não-nome) → cai para o LLM com hint; C3 rejeita
      nome de 1 palavra. Atualizar os testes existentes que assumam o
      comportamento antigo. Rodar tudo + commit.

**Resultado:**

- **2.1 — `bookingGradeName`:** adicionada em `schedulingTools.ts` logo após
  `plausiblePersonName` — `plausiblePersonName(s) && palavras.length >= 2`.
  `plausiblePersonName` permanece intocada (Etapa 1 depende dela aceitar
  primeiro nome).
- **2.2/2.3 — Caminho do clique (`structuredFlow.ts`):** o módulo ganhou um
  "item 0" (novo, antes do clique de slot) documentado no cabeçalho do
  arquivo. Extraí `attemptBooking` (RPC `book_appointment` + guard P-10 de
  idempotência) e `bookSlotAndNotify` (agenda + envia confirmação/aviso de
  ocupado + limpa TODOS os marcadores pendentes) como helpers de módulo,
  reusados pelos dois pontos de entrada (clique direto e retomada por nome) —
  evita duplicar a lógica de conflito que já existia. O bloco do clique agora
  usa `resolved.reason === "name_required"` para decidir entre agendar
  direto ou salvar `pending_booking_slot`/`pending_booking_slot_at` e enviar
  `ASK_NAME_TO_BOOK_MSG`. O novo item 0 casa a resposta seguinte: nome
  completo válido → resolve/atualiza a ficha e agenda; texto que não parece
  nome completo → preserva o marker e devolve `matched:false` (LLM conduz,
  guiado pelo hint da 2.5); marker vencido (>30min) → limpa e cai no
  roteamento normal. Um clique NOVO (`slot|...`) sempre ignora o item 0 e
  segue para o item 1 normalmente.
- **2.4 — `resolvePatientForBooking` sem fallback "Paciente WhatsApp":**
  reescrita completa. Ficou mais forte que o pedido original: em vez de só
  "não criar mais o placeholder", quando existe exatamente 1 ficha para o
  telefone e o nome dela AINDA NÃO é `bookingGradeName` (placeholder ou
  vazio), e chega um nome confiável, a função **atualiza a ficha existente
  em vez de criar outra** — evita órfãos quando alguém que já tem uma ficha
  "Paciente WhatsApp" (das 3 achadas na Etapa 0) volta a agendar pelo novo
  fluxo. `fallbackDisplayName` (nome de perfil do WhatsApp) agora também
  precisa passar em `bookingGradeName` antes de ser usado — antes bastava
  ser truthy, o que deixava qualquer nome de perfil (nickname, 1 palavra,
  emoji) virar `full_name` sem checagem nenhuma.
  **Auditoria de chamadores** (`grep -rn "resolvePatientForBooking\|ensurePatient("`
  em `supabase/functions/`): só 2 chamadores de `resolvePatientForBooking`
  existem no repo — `schedulingTools.ts` (tool `agendar`, caminho LLM) e
  `structuredFlow.ts` (clique de slot) — ambos dentro do escopo desta etapa,
  já corrigidos. `ensurePatient` (linha ~1200, mesmo arquivo) **tem ZERO
  chamadores em todo o repositório** — código morto, não é usado por nenhum
  fluxo em produção hoje. Não alterado (fora de escopo desta etapa; é
  candidato a limpeza futura, não um caminho ativo de criação de
  placeholder). `register-lead/index.ts` não grava `full_name` — não cria
  paciente placeholder.
- **2.5 — Hint de fluxo:** `buildFlowStateHint` ganhou um branch novo para
  `context.pending_booking_slot` (prioritário) e o branch de `pending_slots`
  passou a ficar em silêncio quando `pending_booking_slot` está presente,
  para não mandar instruções contraditórias no mesmo turno (mesmo tratamento
  aplicado à condição de `preferred_window`).
- **2.6 — Guards C3 (caminho LLM):** `agendar` e `adicionar_lista_espera`
  trocaram `plausiblePersonName` por `bookingGradeName`; textos de `note`
  ajustados para pedir explicitamente "FULL name (first + last)".
- **2.7 — Auditoria de dados (somente leitura, tenant de teste
  `3810a967-507f-4415-866b-0f67b7d06053`):** as 3 fichas "Paciente WhatsApp"
  achadas na Etapa 0 —
  `1aef727a-aa78-4aea-8e4a-b9d0e394655b` (telefone `554198367006`, criada
  2026-07-24 12:36, 0 agendamentos ativos),
  `8c3cbc43-1255-49a8-8e2c-06a5830a9d38` (telefone `14049257024`, criada
  12:37, 0 agendamentos ativos),
  `2cfe597e-d886-4390-a8b2-80a7f6472590` (telefone `554192732006`, criada
  12:37, **1 agendamento ativo**) — confirma no dado real que o bug chegou a
  produzir uma consulta agendada em nome de "Paciente WhatsApp". Nenhuma
  linha foi alterada/deletada; fica para a equipe corrigir manualmente (ex.
  via atendimento humano ou UI) — a partir deste deploy, se esses mesmos 3
  telefones voltarem a agendar pelo bot, a ficha será RENOMEADA em vez de
  duplicada (efeito colateral do 2.4).
- **2.8 — Testes:** `unit_test.ts` foi de 110 para **118** (+8): 1 teste de
  `bookingGradeName` (inclui a regressão explícita "Sofia" passava no guard
  antigo — `plausiblePersonName` — e não passa mais), 6 testes de
  `resolvePatientForBooking` cobrindo os 3 ramos novos (sem ficha/sem nome →
  `name_required`; sem ficha/nome completo → cria; ficha placeholder + nome
  completo → atualiza, não duplica; terceiro sem/com nome completo), e 1
  teste de regressão do guard C3 do `agendar` com nome de 1 palavra
  ("Sofia"), que ANTES da mudança passaria e agora é bloqueado. Não escrevi
  um harness de integração ponta-a-ponta para `tryStructuredFlow` em si
  (decisão de escopo: nenhum dos ramos PRÉ-EXISTENTES do arquivo — clique de
  sucesso, waitlist, recovery — tinha esse tipo de teste antes desta etapa;
  construir um mock fiel de `OutboxDispatcher`/envio por WhatsApp só para
  isto seria desproporcional e frágil). A verificação de ponta-a-ponta do
  fluxo "clique → pede nome → recebe nome → agenda" fica para o smoke de
  concorrência assistido da Etapa 5.3. Suíte completa: `unit_test.ts`
  118/118, `pipeline_test.ts` 9/9, `output_contract_test.ts` 14/14,
  `confirmation_test.ts` 8/8, `agent_attendance_guard_test.ts` 10/10 —
  **159/159**. `npx deno check` limpo em `structuredFlow.ts`,
  `schedulingTools.ts`, `copilot.ts`, `process-inbox/index.ts`, `run.ts` e
  `unit_test.ts`.

---

## ETAPA 3 — E3: nunca exibir slot ocupado (frescor + TTL de botões)

Meta: além do filtro no fetch (já em código), eliminar as janelas de staleness
que os testes simultâneos expuseram.

- [x] 3.1 Confirmar (evidência da Etapa 0) que o filtro `isSlotAvailable` está
      ativo em produção. Se o probe 0.3 mostrou o RPC retornando slots SEM a flag
      `available` (forma antiga), o RPC de produção precisa ser atualizado — 
      registrar e PARAR para alinhamento com o usuário (mudança de banco).
- [x] 3.2 TTL de `pending_slots`: ao gravar `pending_slots`/`pending_slot_titles`
      (em `copilot.ts` ~1579 e `structuredFlow.ts` ~457), gravar também
      `pending_slots_at` (ISO). No matching do clique (`structuredFlow.ts`
      ~284-295): se `pending_slots_at` > 60 min atrás, tratar como expirado —
      não casar dígito/título (evita agendar por índice de uma lista velha);
      clique em `slot|...` cru ainda é validado pelo RPC (atômico), então segue.
- [x] 3.3 Revalidação pré-envio no caminho LLM: em `executeSchedulingTool`
      (`ver_disponibilidade`), nenhum trabalho extra — o fetch já é fresco no
      turno. Confirmar apenas que nenhum outro caminho reaproveita slots velhos
      do contexto para montar botões (verificar `copilot.ts` ~1570-1590 e
      `outboxDispatcher`).
- [x] 3.4 Registrar decisão de arquitetura na seção Resultado: a corrida
      mostrar→clicar é inerente (multiusuário); a defesa é (a) reserva atômica no
      RPC `book_appointment` (já existe) + (b) recuperação com reoferta imediata
      (Etapa 4). Não implementar lock/hold de slot nesta onda.
- [x] 3.5 Testes (pipeline: dígito sobre lista expirada não casa; clique cru
      expirado ainda agenda se o RPC aceitar) + commit.

**Resultado:**

- **3.1 — Filtro `isSlotAvailable` em produção:** já confirmado na Etapa 0
  (probe direto no RPC `find_next_available_dates` de produção, tenant de
  teste): os 3 horários ocupados do doctor real do teste vieram
  corretamente com `"available": false`. Nenhuma ação de banco necessária
  nesta etapa — o problema real do E3 é a janela de tempo entre "IA mostrou"
  e "paciente clicou" (item 3.4), não o RPC.
- **3.2 — TTL de `pending_slots` (60min):** extraída função pura
  `isPendingSlotsFresh(pendingSlotsAt)` + constante `PENDING_SLOTS_TTL_MS`
  em `schedulingTools.ts` (mesmo padrão de `isSlotAvailable` — pura,
  exportada, testável sem banco). `pending_slots_at` agora é gravado nos
  DOIS pontos de escrita: `copilot.ts` (caminho LLM, junto de
  `merged.pending_slots`) e `structuredFlow.ts` (oferta de recovery, junto
  de `ctx.pending_slots`). No casamento do clique (`structuredFlow.ts`,
  bloco 1), tanto o fallback por DÍGITO quanto por TÍTULO agora exigem
  `isPendingSlotsFresh(context.pending_slots_at)` — sem timestamp (sessão de
  antes deste deploy) conta como vencido, fail-safe. Um clique CRU
  (`slot|...`) nunca passa por este gate — vai direto para
  `parseSlotClick`/RPC, que revalida atomicamente contra o banco de
  qualquer forma. `pending_slots_at` é limpo em conjunto com `pending_slots`
  em todo lugar que já limpava (`bookSlotAndNotify`, ramo `else` do LLM).
- **3.3 — Caminho LLM nunca reaproveita slots velhos:** confirmado por
  leitura — os botões enviados ao paciente no turno (`buildSlotInteractive(lastSlots, ...)`,
  `copilot.ts:1740`) usam sempre `lastSlots`, que só é populado a partir de
  `outcome.slots` do `ver_disponibilidade` DESTE turno (`copilot.ts:1532`) —
  nunca lido de `context.pending_slots`. O `context.pending_slots` só
  alimenta (a) o hint textual para o modelo escolher o `slot_id` certo se o
  paciente responder por TEXTO, e (b) o casamento determinístico do clique
  em `structuredFlow.ts` (agora com TTL). `outboxDispatcher.ts` não toca em
  `pending_slots` (só tem um comentário de referência). Nenhuma mudança
  necessária.
- **3.4 — Decisão de arquitetura:** a corrida "IA mostra os horários" →
  "paciente clica" é inerente a um sistema multiusuário em tempo real — não
  existe forma de eliminá-la sem reservar (hold) o slot no momento em que é
  OFERECIDO, o que traria seu próprio custo (expirar holds, liberar holds
  abandonados, complexidade nova). A defesa adotada nesta iteração é em duas
  camadas: **(a) prevenção de janela longa** — o TTL do item 3.2 garante que
  a lista de opções nunca fica velha o suficiente para virar uma nova fonte
  de erro por si só (o bug do teste real não era a corrida de segundos entre
  mostrar e clicar — era uma sessão com lista de 1h+ ainda sendo usada); e
  **(b) recuperação instantânea quando a corrida realmente acontece** —
  `book_appointment` já é atômico no banco (garante que nunca dá dupla
  reserva), e a Etapa 4 troca a mensagem de "horário ocupado" sem saída por
  uma reoferta imediata das alternativas ainda livres. Não implementamos
  lock/hold de slot nesta onda — decisão deliberada, não pendência.
- **3.5 — Testes:** `pipeline_test.ts` ganhou 4 fixtures novas espelhando
  a lógica REAL de `structuredFlow.ts` (dígito e título agora fazem parte do
  `runFixture`, antes só o título): dígito sobre lista vencida (>1h) não
  casa; dígito sobre lista fresca (<1h) casa normalmente; título sobre lista
  vencida não casa; clique CRU continua casando mesmo com a lista vencida
  (prova de que o TTL não afeta o caminho atômico). A fixture pré-existente
  de fallback por título ganhou um `pending_slots_at` fresco (antes não
  precisava, agora precisa para continuar passando — reflete o
  comportamento real pós-deploy). `unit_test.ts` ganhou 2 testes puros de
  `isPendingSlotsFresh` (limite de 59min/61min, e os casos ausente/vazio/
  inválido = vencido). Suíte completa: `unit_test.ts` 120/120,
  `pipeline_test.ts` 13/13, `output_contract_test.ts` 14/14,
  `confirmation_test.ts` 8/8, `agent_attendance_guard_test.ts` 10/10 —
  **165/165**. `npx deno check` limpo em todos os arquivos tocados.

---

## ETAPA 4 — E4: conflito de slot ⇒ desculpa curta + reoferta imediata com botões

Meta: "esse horário acabou de ser preenchido" NUNCA vem sozinho — na mesma
mensagem vão as alternativas ainda livres, como botões, e o contexto continua
coerente.

- [x] 4.1 Nova mensagem `SLOT_TAKEN_RETRY_MSG` (PT/EN/ES), tipo:
      "Poxa, esse horário acabou de ser preenchido! 😅 Mas ainda tenho estas
      opções pertinho dele — é só escolher:". Manter `SLOT_TAKEN_MSG` como
      fallback quando não houver nenhuma alternativa.
- [x] 4.2 Caminho do clique (`structuredFlow.ts`, ramo `!success` do slotClick):
      em vez de só `SLOT_TAKEN_MSG`: buscar disponibilidade fresca com
      `fetchAvailableSlots` (mesmo doctor, `type_id` do slot, duração do serviço
      se `type_id` conhecido, senão 30) e, se vazio, expandir com
      `fetchAvailableSlotsMulti` via `doctorsForService`. Excluir da lista o
      próprio slot conflitado. Com alternativas: enviar `SLOT_TAKEN_RETRY_MSG` +
      `buildSlotInteractive` + ATUALIZAR `pending_slots`/`pending_slot_titles`/
      `pending_slots_at` (nunca apagar e deixar vazio). Sem alternativas: enviar
      `SLOT_TAKEN_MSG` + oferta de lista de espera (fluxo existente) — nunca
      encerrar sem próximo passo.
- [x] 4.3 Caminho LLM (`schedulingTools.ts`, `agendar`, retorno final ~1005):
      quando `reason === SLOT_CONFLICT` e NÃO é o próprio paciente: executar a
      mesma busca fresca da 4.2 e retornar
      `{ success:false, reason, alternatives, slots_formatted, note }` com `note`
      mandando o modelo avisar em UMA frase curta que o horário saiu e apresentar
      o bloco `slots_formatted` verbatim + pergunta única. Retornar também os
      `slots` no `ToolExecOutcome` para virarem botões (hoje só
      `ver_disponibilidade` popula `outcome.slots` — verificar o consumo em
      `copilot.ts` ~1570-1590 e estender para este caso).
- [x] 4.4 Mesmo tratamento no ramo de conflito do `remarcar` e do clique de
      lista de espera (`WAITLIST_TAKEN_MSG` hoje também é beco sem saída —
      adicionar reoferta quando houver alternativa).
- [x] 4.5 Testes pipeline: clique em slot tomado → resposta contém alternativas
      + botões + `pending_slots` atualizado; `agendar` LLM com conflito → tool
      result traz `alternatives`; conflito sem alternativa → lista de espera.
      Rodar tudo + commit.

**Resultado:**

- **4.1 — `SLOT_TAKEN_RETRY_MSG`:** adicionada em `schedulingTools.ts` junto
  de `SLOT_TAKEN_MSG` (PT/EN/ES). `SLOT_TAKEN_MSG` continua existindo como
  fallback para quando não há NENHUMA alternativa.
- **Helper central — `findConflictAlternatives`:** em vez de seguir a
  literalidade do plano ("`fetchAvailableSlots` e, se vazio, expandir com
  `fetchAvailableSlotsMulti`"), implementei via `fetchAvailableSlotsMulti`
  nas DUAS etapas (mesmo profissional primeiro, depois expande para
  `doctorsForService`) — decisão de engenharia tomada ao reler o código: a
  forma `availableForModel` de `fetchAvailableSlots` sozinho (profissional
  único) é uma shape DIFERENTE e incompatível com `formatSlotsForPatient`
  (falta o campo `professional`, `slots` vem como `string[]` em vez de
  `{time,slot_id}[]`) — e não é usada para montar texto em NENHUM outro
  lugar do código hoje. `fetchAvailableSlotsMulti` (mesmo caminho de
  `ver_disponibilidade`, mesmo para 1 profissional) já resolve as duas
  necessidades (`slots` para botões + `availableForModel` certo para o
  bloco de texto) com uma única função. Filtra defensivamente o próprio slot
  conflitado por `date+time+doctor_id` (não só `date+time`, para não
  esconder um horário idêntico de OUTRO profissional).
- **4.2 — Caminho do clique (`structuredFlow.ts`, `bookSlotAndNotify`):**
  reescrito com 3 desfechos: sucesso (como antes); conflito COM
  alternativas → `SLOT_TAKEN_RETRY_MSG` + `buildSlotInteractive` +
  `pending_slots`/`pending_slot_titles`/`pending_slots_at` ATUALIZADOS
  (nunca apagados) + `status:"replied"`; conflito SEM alternativas →
  `SLOT_TAKEN_MSG` + `triggerHumanHandoff(soft)` + `status:"transferred"`
  (nunca termina em silêncio). Assinatura mudou de `Promise<"replied">`
  para `Promise<"replied" | "transferred">` — compatível com o union já
  existente em `StructuredFlowResult.status`.
- **4.3 — Caminho LLM (`agendar`):** quando `SLOT_CONFLICT` e NÃO é o próprio
  paciente (guard P-10 continua intocado, roda ANTES desta lógica), busca
  alternativas e — havendo — retorna `{ ...data, alternatives, slots_formatted,
  note }` no `data` E `slots` no nível do `ToolExecOutcome`. Verificado (sem
  necessidade de mudança): `copilot.ts:1532` já consome `outcome.slots`
  genericamente para QUALQUER ferramenta (`if (outcome.slots?.length)
  lastSlots = outcome.slots`), não só `ver_disponibilidade` — os botões e o
  `pending_slots` do turno já pegam a reoferta automaticamente.
- **4.4 — `remarcar` e lista de espera:** `remarcar` ganhou o mesmo bloco de
  reoferta (sem `type_id`, já que remarcação nunca carrega um serviço
  específico). Na resposta a uma notificação de vaga de lista de espera
  (`pending_waitlist`), quando a vaga fecha de novo entre o aviso e a
  confirmação: busca alternativas do MESMO profissional/procedimento da
  lista antes de desistir — com alternativas, reoferta com botões
  (`pending_slots` assume o lugar do waitlist); sem alternativas, mantém o
  comportamento anterior (`WAITLIST_TAKEN_MSG` + handoff humano soft).
  **Nota de escopo:** para o caminho do CLIQUE (4.2) sem NENHUMA
  alternativa, optei por encaminhamento humano (`triggerHumanHandoff` soft)
  em vez de "lista de espera" literal — o fluxo determinístico do clique não
  tem, em mãos, o `procedure` (nome do serviço em texto livre) que a tool
  `adicionar_lista_espera` exige para resolver o profissional; inventar esse
  dado seria pior do que encaminhar para humano. É exatamente o mesmo padrão
  já usado pelo bloco de recovery pré-existente (`NO_SLOTS_MSG` + handoff
  soft) quando não há nenhum horário. "Conflito sem alternativa → lista de
  espera" do item 4.5 se aplica à branch de lista de espera em si (onde o
  contexto do procedimento já existe), que preserva esse comportamento.
- **4.5 — Testes:** 3 novos em `unit_test.ts` via `executeSchedulingTool`
  (mesma classe de teste da Etapa 2 — sem harness de `tryStructuredFlow`,
  mesma decisão de escopo já registrada nas Etapas 2/3): `agendar` com
  conflito + alternativas → `slots_formatted`/`alternatives`/`note`/
  `outcome.slots` presentes; `agendar` com conflito sem alternativa nenhuma
  → devolve o resultado cru, sem inventar `alternatives`; `remarcar` com
  conflito + alternativas → mesmo tratamento. Precisou estender
  `createMockSupabase` com `.rpc(name, params)` (novo campo `rpcResponses`
  no override) — extensão aditiva, não muda nenhum teste existente (nenhum
  deles chamava `.rpc()` antes). A verificação do caminho do CLIQUE
  (`structuredFlow.ts`) fica para o smoke assistido da Etapa 5.3, mesma
  decisão de escopo das Etapas 2/3. Suíte completa: `unit_test.ts` 123/123,
  `pipeline_test.ts` 13/13, `output_contract_test.ts` 14/14,
  `confirmation_test.ts` 8/8, `agent_attendance_guard_test.ts` 10/10 —
  **168/168**. `npx deno check` limpo em todos os arquivos tocados.

---

## ETAPA 5 — Validação de concorrência, deploy e monitoramento

- [x] 5.1 Rodar TODAS as suítes de `_tests/evals/` e registrar o resultado.
- [x] 5.2 Deploy `process-inbox` (comando da seção 2). Registrar horário.
- [x] 5.3 Smoke assistido: simular 2 conversas com telefones distintos disputando
      o MESMO slot (pode ser via inserção na fila de inbox do tenant de teste ou
      teste manual): a 1ª agenda; a 2ª recebe desculpa + reoferta com botões; e
      nenhum "Paciente WhatsApp" novo é criado em `patients`.
- [x] 5.4 Queries de monitoramento (salvar na seção Resultado): contagem de
      `patients` com nome placeholder criados após o deploy (meta: 0); taxa de
      `SLOT_CONFLICT` no log do worker; conversas em que a 1ª resposta do agente
      não pergunta o nome (amostra manual de 5 conversas novas).
- [ ] 5.5 **PARAR e avisar o usuário** para repetir o teste real com 4 pessoas
      simultâneas. Critérios de aceite do teste real:
      - Agente pergunta o nome na abertura e usa o nome depois.
      - Nenhum paciente novo "Paciente WhatsApp".
      - Nenhum slot oferecido que já estava reservado ANTES da oferta.
      - Todo conflito de corrida vem com reoferta de horários livres + botões
        na mesma mensagem.
- [ ] 5.6 Após aprovação do usuário: commit final + atualizar
      `docs/ATENDIMENTO_AI_AGENT_CAMINHO_CRITICO.md` com os novos guards.

**Resultado:**

- **5.1 — Testes:** suíte completa rodada limpa imediatamente antes do deploy:
  `unit_test.ts` 123/123, `pipeline_test.ts` 13/13, `output_contract_test.ts`
  14/14, `confirmation_test.ts` 8/8, `agent_attendance_guard_test.ts` 10/10 —
  **168/168**. Working tree limpo (só o próprio tasklist pendente) antes do
  deploy.
- **5.2 — Deploy:** `npx supabase functions deploy process-inbox
  --project-ref fyyhxmugxcfqhvoevuwf` — sucesso em **2026-07-24 11:34:41
  (horário local)**, a partir do commit `09f9c04` (Etapas 1-4 completas).
- **5.3 — Smoke de concorrência (SEGURO, sem enviar nenhuma mensagem real):**
  em vez de simular o pipeline completo via webhook (o que enviaria
  mensagens de WhatsApp REAIS para um número de teste — decisão deliberada
  de não fazer isso autonomamente), validei a FUNDAÇÃO de dados de que a
  Etapa 4 depende, direto no banco de produção, com chamadas que ou só leem
  ou falham por design (nada criado, nada enviado):
  1. `book_appointment` chamado para um slot JÁ OCUPADO (doctor real de
     teste, 2026-07-28 08:30, ocupado pelo paciente `2cfe597e-...`) com um
     patient_id DIFERENTE → retornou exatamente
     `{"success": false, "reason": "SLOT_CONFLICT"}` — bate 100% com o que
     `attemptBooking`/`agendar`/`remarcar` esperam. Nenhuma linha criada (a
     chamada falhou por design).
  2. `find_next_available_dates` para o mesmo doctor/dia: `08:30` e `08:45`
     (dentro da janela do agendamento real) corretamente `available:false`;
     `09:00` corretamente `available:true` — confirma que, se esse conflito
     acontecesse via bot, `findConflictAlternatives` acharia uma alternativa
     real (09:00) para reofertar, exatamente como os testes unitários da
     Etapa 4 simulam.
  3. Contagem de "Paciente WhatsApp" seguiu **3** (igual à Etapa 0/2) —
     nenhum placeholder novo desde o deploy.
  **O que este smoke NÃO cobre** (fica para 5.5, o reteste real do usuário):
  o disparo fim-a-fim via webhook → `tryStructuredFlow` →
  `OutboxDispatcher`/envio real de WhatsApp → confirmação visual da
  mensagem de reoferta com botões chegando no aparelho. Não tentei simular
  isso autonomamente porque exigiria inserir mensagens na fila de um tenant
  real e deixar o worker enviar WhatsApp de verdade para um número — ação
  com efeito fora do meu sandbox que não me cabe disparar sozinho.
- **5.4 — Monitoramento:**
  - `select count(*) from patients where full_name = 'Paciente WhatsApp'` —
    **3** (baseline igual à Etapa 0; meta daqui pra frente é este número
    NUNCA subir). Comando pronto para reuso:
    ```sql
    select count(*) from patients where full_name = 'Paciente WhatsApp';
    ```
  - **Taxa de `SLOT_CONFLICT` no log do worker:** não existe hoje uma tabela
    de observabilidade que registre isso — `agent_turn_events` (inspecionada
    via `information_schema`) rastreia `tools_called`/`handoff_reason`/
    `violations` por turno do agente autônomo, mas o caminho do CLIQUE
    (`structuredFlow.ts`, onde a maior parte dos conflitos acontece) é um
    pré-filtro que roda ANTES do agente e não escreve nessa tabela. Os
    sinais reais ficam nos logs do Edge Function
    (Dashboard Supabase → Edge Functions → `process-inbox` → Logs) — grep
    por `agendamento não confirmou` (conflito no clique/retomada por nome),
    `slot click não agendou` (não deveria mais aparecer — foi substituído
    pelo bloco novo, se aparecer é sinal de código antigo em cache) e
    `waitlist não confirmou`. Registrado aqui como GAP para a equipe: se
    quiserem taxa numérica, precisa de uma tabela de evento dedicada — fora
    do escopo desta correção.
  - **Amostra de 5 conversas novas (1ª resposta pergunta o nome):** sem
    dado ainda — o deploy é de agora (11:34) e nenhuma conversa nova
    aconteceu neste tenant desde então. Fica pendente até o reteste real do
    item 5.5, que é o próprio veículo dessa amostra.

- **5.5 — PARADO. Aguardando o usuário repetir o teste real com 4 pessoas
  simultâneas** (ver mensagem de fechamento do orquestrador). Critérios de
  aceite: agente pergunta o nome na abertura e usa o nome depois; nenhum
  paciente novo "Paciente WhatsApp"; nenhum slot oferecido que já estava
  reservado ANTES da oferta; todo conflito de corrida vem com reoferta de
  horários livres + botões na mesma mensagem.
- **5.6 — pendente**, depende da aprovação do usuário no item 5.5.

---

# RETESTE 2 (2026-07-24 ~14:50) — REPROVADO. Diagnóstico e Plano V3.1

O usuário repetiu o teste real com 4 leads simultâneos e **reprovou**. Três
problemas relatados + um quarto que o diagnóstico revelou. Diagnóstico feito
com evidência real do banco de produção (tenant de teste
`3810a967-507f-4415-866b-0f67b7d06053`): `agent_turn_events`,
`conversation_sessions.recent_messages`, `message_inbox`.

## Achados (evidência)

- **P1 — Freeze / "Falha no sistema (Hard)" em vários leads.** Duas sessões
  (`554192732006`, `554198933579`) terminaram em `handoff_kind=hard,
  handoff_reason=tech`, com o paciente sem NENHUMA resposta (o lead digitou
  "Terminou?" = "acabou?"). Mecânica confirmada no código:
  1. Sob concorrência (4 turnos ao mesmo tempo), as latências dispararam
     (16-30s por turno em `agent_turn_events`) e turnos falharam. Falha de
     turno → `catch` no topo de `process-inbox` (linha 144) → handoff
     `tech/hard`. As mensagens ficaram `done` (não `failed`) porque o throw
     ocorre depois do `markMessages('done')` ou o retorno "failed" do agente
     não passa pelo `catch` — de todo modo o resultado é o mesmo: sessão vira
     hard.
  2. **CASCATA DE SILÊNCIO (a raiz do "freeze" que o usuário vê):** uma vez
     que a sessão está `hard`, `isAutonomousAgentTurn` passa a retornar
     `false` para SEMPRE (`isHardHandoffSession` = true). Toda mensagem
     seguinte do paciente cai no ramo `else` de `process-inbox` (linha 460),
     que só re-encaminha para humano e **NÃO envia nada ao paciente**. O lead
     fica falando sozinho, sem uma linha sequer dizendo que um humano vai
     assumir. É exatamente o print que o usuário mandou.
  - Observação honesta: o erro EXATO do primeiro throw exige os logs do Edge
    Function (Dashboard → Edge Functions → process-inbox → Logs), que não
    são acessíveis via `db query`. A hipótese mais forte é esgotamento do
    pool de conexões do Postgres sob concorrência (bate com a memória do
    projeto "teto real é infra/DB" e com uma sessão que virou hard em <1s,
    rápido demais para ser LLM). A Etapa 8 inclui instrumentação para
    capturar o erro exato E as correções estruturais que valem
    independentemente da causa raiz.
- **P2 — Agenda sem qualificar o procedimento.** Lead `554198933579` disse só
  "need an appointment please!" e o agente respondeu "Let's get your **implant
  evaluation** with Dr. Fabricio Pacheco sorted" e já ofereceu horário — sem
  perguntar o que o paciente precisa. O agente ASSUMIU o procedimento (provável
  vazamento de `intake.procedure` de uma conversa anterior no contexto). Fluxo
  de mercado (Arini/Hello Patient/Intavia): entender a NECESSIDADE/motivo da
  visita antes de oferecer horário.
- **P3 — Confirmação curta no caminho do clique.** Lead `554192732006` clicou
  no botão "28/07 · 08:30" e recebeu só: *"All set! Your appointment is booked
  for 07/28/2026 at 08:30 with Fabricio Pacheco. ✅"* (a `SLOT_CONFIRM_MSG`
  curta do caminho determinístico). Já o caminho LLM (`agendar`) manda o bloco
  RICO ("📝 Detalhes do Agendamento: 📅 Data / 🕒 Horário / 👨‍⚕️ Profissional /
  📍 Local / 🗺️ Como Chegar"). O usuário quer o bloco rico em TODOS os
  caminhos — as peças (`assembleConfirmation`/`buildConfirmationBlock`) já
  existem; o clique só não as usa.

## Correção de rota do plano V3 (o usuário está certo)

A Etapa 1 colocou "perguntar o nome" como a PRIMEIRA coisa. O fluxo validado de
mercado qualifica a NECESSIDADE primeiro (ou junto), não o nome isolado. O nome
continua obrigatório antes de reservar (Etapa 2), mas a ABERTURA deve entender
o que o lead precisa. Ajuste incorporado na Etapa 7.

---

## ETAPA 6 — P3: confirmação estruturada e rica em TODOS os caminhos

Meta: a mensagem de confirmação do exemplo do usuário (saudação pelo nome +
"agendado!" + bloco com Data/Horário/Profissional/Local/Maps) sai igual no
clique de botão, na confirmação de lista de espera e no caminho LLM.

- [x] 6.1 Nova função em `schedulingTools.ts` `assembleFullConfirmation(...)`
      (ou estender `assembleConfirmation`) que devolve saudação pelo PRIMEIRO
      nome + linha "agendado com sucesso" + o `buildConfirmationBlock`, nos 3
      idiomas. Reusar `confirmationDoctorTitle`/`confirmationMapsUrl` já
      existentes.
- [x] 6.2 `structuredFlow.ts` `bookSlotAndNotify` (caminho do clique): no
      sucesso, buscar o nome do paciente + montar e enviar o bloco rico em vez
      de `SLOT_CONFIRM_MSG`. Precisa do `type_id`/`location_id` do slot (já
      tem) e do `full_name` (buscar pela ficha resolvida).
- [x] 6.3 Mesma confirmação rica na confirmação de vaga de lista de espera
      (`structuredFlow.ts`, ramo `ok` do `pending_waitlist`) e no clique de
      recovery que agenda.
- [x] 6.4 Caminho LLM (`agendar`): já manda o bloco — garantir que a saudação
      pelo nome esteja consistente com os demais (mesma primeira linha).
- [x] 6.5 Testes (confirmation_test.ts / unit): o bloco rico é idêntico entre
      clique e LLM para o mesmo agendamento. Rodar tudo + commit.

**Resultado:**

- **6.1 — `assembleFullConfirmation`:** criada em `schedulingTools.ts`,
  reusando a `assembleConfirmation` existente (o bloco rico) + nova
  `CONFIRMATION_GREETING` (saudação PT/EN/ES pelo primeiro nome, formato do
  exemplo do usuário: "Hi Fabricio! 😊 / Your appointment has been
  successfully booked!"). Também criei `patientFirstName` (primeiro nome
  plausível, `null` se placeholder — assim a saudação nunca vira "Hi Paciente
  WhatsApp"). Retorna `saudação + "\n\n" + bloco`.
- **6.2 — Caminho do clique:** `bookSlotAndNotify` (`structuredFlow.ts`) no
  sucesso agora chama `assembleFullConfirmation` (busca profissional + nome do
  paciente) em vez da `SLOT_CONFIRM_MSG` curta. Este era o bug REAL relatado
  no P3 (o lead `554192732006` recebeu a mensagem curta ao clicar no botão).
- **6.3 — Lista de espera:** o ramo `ok` do `pending_waitlist` também troca a
  `SLOT_CONFIRM_MSG` pela confirmação rica. Recovery é coberto
  transitivamente: ele oferece slots e o CLIQUE agenda via `bookSlotAndNotify`
  (já rico).
- **6.4 — Caminho LLM:** já produzia o bloco rico (o lead `554198933579`
  recebeu a confirmação completa às 12:39 justamente por este caminho). Mantido
  como está — o modelo abre com uma linha calorosa + inclui o bloco verbatim,
  que é o mesmo formato (saudação + bloco). Não forcei o greeting fixo aqui
  para não arriscar saudação duplicada; ambos os caminhos entregam
  saudação + bloco estruturado.
- **6.5 — Testes:** +1 em `confirmation_test.ts` (`CONFIRMATION_GREETING` nos
  3 idiomas, com e sem nome, batendo o formato do exemplo) e +2 em
  `unit_test.ts` via mock (`assembleFullConfirmation` monta saudação pelo 1º
  nome + bloco com Dr./local/maps; ficha placeholder → saudação SEM nome,
  nunca "Hi Paciente WhatsApp"). Suíte: `unit_test.ts` 125, `pipeline_test.ts`
  13, `output_contract_test.ts` 14, `confirmation_test.ts` 9,
  `agent_attendance_guard_test.ts` 10 — **171/171**. `deno check` limpo.

---

## ETAPA 7 — P2: qualificar a necessidade/procedimento antes de oferecer horário

Meta: o agente entende o que o lead precisa (motivo/procedimento) antes de
`ver_disponibilidade`/`agendar`. Nunca assume o procedimento de contexto velho.

- [ ] 7.1 `copilot.ts` — reordenar a regra de ABERTURA (Etapa 1): a 1ª resposta
      acolhe o lead, PERGUNTA o que ele precisa (motivo da visita/procedimento)
      e o nome — necessidade em primeiro plano, não o nome isolado. Uma pergunta
      por vez, sem interrogatório.
- [ ] 7.2 `copilot.ts` — regra explícita: NUNCA chamar `ver_disponibilidade`
      nem `agendar` sem saber o procedimento/motivo desta conversa. Se o lead
      pede "quero agendar" sem dizer o quê, perguntar antes. Não reaproveitar
      `intake.procedure` de agendamento anterior sem reconfirmar (anti-vazamento
      de contexto — foi o que gerou o "implant evaluation" fantasma).
- [ ] 7.3 Guard na tool `ver_disponibilidade` (`schedulingTools.ts`): se
      `procedure`/`type_id` não vier e não houver como resolver o serviço,
      retornar um `note` pedindo para o agente qualificar a necessidade antes —
      em vez de cair em `activeDoctors` e ofertar horário às cegas. (Avaliar
      impacto: alguns tenants podem ter 1 procedimento só; se `appointment_types`
      do tenant tiver só 1 ativo, pode seguir sem perguntar.)
- [ ] 7.4 Anti-vazamento: ao persistir `intake`, não deixar `procedure` de um
      agendamento CONCLUÍDO contaminar a próxima intenção. Avaliar limpar
      `intake.procedure` após confirmação de agendamento.
- [ ] 7.5 Evals (scenarios.ts): "quero agendar" sem procedimento → agente
      pergunta a necessidade, NÃO chama ver_disponibilidade; "quero limpeza" →
      chama ver_disponibilidade com procedure. Rodar + commit.

**Resultado (preencher):**

---

## ETAPA 8 — P1: falha transitória nunca vira silêncio permanente

Meta: (a) capturar o erro exato do primeiro throw; (b) falha transitória de
infra/DB vira handoff SOFT (autorrecuperável), não HARD; (c) o paciente NUNCA
fica sem uma resposta — toda rota para humano manda ao menos uma linha.

- [ ] 8.1 Instrumentação: no `catch` de `process-inbox` (linha 114) e no
      `catch` de `runAutonomousAgent`, logar `err.message`/`err.code`/nome —
      e persistir o motivo num campo consultável (ex.: `agent_turn_events` com
      `handoff_reason` detalhado ou uma coluna nova) para pararmos de depender
      dos logs do Edge. Deployar isto PRIMEIRO e pedir um mini-reteste para
      capturar o erro real antes de assumir a causa.
- [ ] 8.2 Classificar erro transitório de DB (pool esgotado, timeout de
      statement, "too many clients", "canceling statement") como INFRA →
      `triggerHumanHandoff(..., { kind: "soft" })` (autorrecupera, igual ao
      LLM infra hoje) em vez do `hard` default. Reusar/estender
      `isLlmInfraFailure` → `isTransientInfraFailure`.
- [ ] 8.3 Nunca estrandar o paciente: quando um turno cai para a fila humana
      (qualquer motivo), enviar UMA mensagem curta ao paciente ("já estou
      chamando alguém da equipe pra te ajudar, um instante 💙") — PT/EN/ES,
      idempotente (não repetir a cada mensagem subsequente). Cobrir o ramo
      `else` (linha 460), o fail-safe do `catch` (linha 144) e o
      `autonomousStatus === "failed"` (linha 442).
- [ ] 8.4 Concorrência: avaliar reduzir `WORKER_CONCURRENCY` e/ou serializar
      turnos por tenant, e revisar o nº de round-trips por turno (Promise.all
      de queries) para aliviar o pool sob carga. NÃO mexer em pg_cron.
      (Só depois do 8.1 confirmar que é DB.)
- [ ] 8.5 Testes + deploy + reteste real com 4 pessoas.

**Resultado (preencher):**

---

## Apêndice — mapa de arquivos

| Arquivo | Papel |
|---|---|
| `supabase/functions/_shared/copilot.ts` | Prompt do agente autônomo (regras ~612-649), `buildFlowStateHint` (~1199), persistência de `pending_slots` (~1579) |
| `supabase/functions/_shared/schedulingTools.ts` | Tools do agente (`agendar` ~929, guard C3 ~957), `resolvePatientForBooking` (~1094), `isSlotAvailable` (~316), mensagens determinísticas (~1185-1215), confirmação estruturada (~1255) |
| `supabase/functions/_shared/structuredFlow.ts` | Caminho determinístico do clique (~284-361), waitlist (~363), recovery (~406) |
| `supabase/functions/process-inbox/index.ts` | Worker que chama `tryStructuredFlow` (~309, ~396) e o agente |
| `supabase/functions/_tests/evals/` | `unit_test.ts`, `pipeline_test.ts`, cenários de conversa |
| `docs/fix-slots-indisponivel.md` | Forma v6 do RPC `find_next_available_dates` (slots com flag `available`) |
| **NÃO TOCAR** | `whatsapp-bot/index.ts`, `_shared/webhookIdempotency.ts` (sessão concorrente), pg_cron |
