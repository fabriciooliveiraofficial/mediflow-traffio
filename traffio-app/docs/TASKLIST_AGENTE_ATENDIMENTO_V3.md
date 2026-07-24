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

- [ ] 2.1 Em `_shared/schedulingTools.ts`, criar `bookingGradeName(s): boolean`
      = `plausiblePersonName(s)` **e** ≥ 2 palavras (nome + sobrenome). Não
      alterar `plausiblePersonName` (usada para conversa, primeiro nome é válido).
- [ ] 2.2 Caminho do clique (`_shared/structuredFlow.ts`, bloco `slotClick`):
      ANTES de agendar, resolver o paciente SEM criar registro (consultar
      apenas). Se não existir paciente com `bookingGradeName`:
      **não agendar ainda** — salvar `context.pending_booking_slot = clickContent`
      (+ `pending_booking_slot_at` ISO) e enviar mensagem determinística PT/EN/ES:
      "Perfeito! Esse horário está livre 😊 Para eu finalizar a reserva, qual é o
      seu nome completo?". Retornar `{ matched: true, status: "replied" }`.
- [ ] 2.3 Novo ramo determinístico no início de `tryStructuredFlow`: se
      `context.pending_booking_slot` existe e a mensagem atual é um
      `bookingGradeName` → `atualizar_cadastro` (upsert do paciente com esse nome)
      + agendar o slot pendente + confirmação estruturada (mesmo formato atual) +
      limpar o marker. Se a mensagem NÃO parece nome completo (ex.: só primeiro
      nome, ou outra pergunta): limpar o marker? NÃO — manter o marker por até
      30 min e `return { matched: false }` para o LLM conduzir (o hint da 2.5
      diz ao modelo o que falta). Se o slot pendente expirou/conflitou ao agendar,
      cair no fluxo de reoferta da Etapa 4.
- [ ] 2.4 Em `resolvePatientForBooking` (`schedulingTools.ts:1094`): remover o
      fallback que INSERE `"Paciente WhatsApp"` (linha ~1126) — em contexto de
      agendamento, sem nome ⇒ retornar `{ patient: null, reason: "name_required" }`
      e cada chamador decide (o LLM já tem o guard C3; o clique agora tem a 2.2).
      Auditar TODOS os chamadores de `resolvePatientForBooking` e `ensurePatient`
      (`grep -rn` em `supabase/functions/`) e registrar na seção Resultado quais
      criam paciente placeholder fora do agendamento (ex.: register-lead, sessões)
      — esses NÃO devem ser alterados nesta etapa, só inventariados.
- [ ] 2.5 Hint de fluxo para o LLM (`buildFlowStateHint` em `copilot.ts` ~1199):
      quando `pending_booking_slot` existir, instruir: "há um horário escolhido
      aguardando o NOME COMPLETO; obtenha o nome, chame atualizar_cadastro_paciente
      e então `agendar` com esse slot_id exato".
- [ ] 2.6 Guard C3 do caminho LLM (`agendar` e lista de espera): trocar a
      validação de nome para `bookingGradeName` (hoje aceita nome de 1 palavra).
      Ajustar o texto do `note` para pedir nome COMPLETO.
- [ ] 2.7 Dados existentes: script SQL (somente leitura) listando pacientes
      `full_name = 'Paciente WhatsApp'` do tenant de teste com seus agendamentos
      futuros — salvar a lista na seção Resultado para correção manual pela
      equipe. NÃO deletar nem renomear em massa.
- [ ] 2.8 Testes: unit para `bookingGradeName`; pipeline para: clique sem
      cadastro → pede nome → recebe "Fabricio Oliveira" → agenda; clique sem
      cadastro → recebe "sim" (não-nome) → cai para o LLM com hint; C3 rejeita
      nome de 1 palavra. Atualizar os testes existentes que assumam o
      comportamento antigo. Rodar tudo + commit.

**Resultado (preencher):**

---

## ETAPA 3 — E3: nunca exibir slot ocupado (frescor + TTL de botões)

Meta: além do filtro no fetch (já em código), eliminar as janelas de staleness
que os testes simultâneos expuseram.

- [ ] 3.1 Confirmar (evidência da Etapa 0) que o filtro `isSlotAvailable` está
      ativo em produção. Se o probe 0.3 mostrou o RPC retornando slots SEM a flag
      `available` (forma antiga), o RPC de produção precisa ser atualizado — 
      registrar e PARAR para alinhamento com o usuário (mudança de banco).
- [ ] 3.2 TTL de `pending_slots`: ao gravar `pending_slots`/`pending_slot_titles`
      (em `copilot.ts` ~1579 e `structuredFlow.ts` ~457), gravar também
      `pending_slots_at` (ISO). No matching do clique (`structuredFlow.ts`
      ~284-295): se `pending_slots_at` > 60 min atrás, tratar como expirado —
      não casar dígito/título (evita agendar por índice de uma lista velha);
      clique em `slot|...` cru ainda é validado pelo RPC (atômico), então segue.
- [ ] 3.3 Revalidação pré-envio no caminho LLM: em `executeSchedulingTool`
      (`ver_disponibilidade`), nenhum trabalho extra — o fetch já é fresco no
      turno. Confirmar apenas que nenhum outro caminho reaproveita slots velhos
      do contexto para montar botões (verificar `copilot.ts` ~1570-1590 e
      `outboxDispatcher`).
- [ ] 3.4 Registrar decisão de arquitetura na seção Resultado: a corrida
      mostrar→clicar é inerente (multiusuário); a defesa é (a) reserva atômica no
      RPC `book_appointment` (já existe) + (b) recuperação com reoferta imediata
      (Etapa 4). Não implementar lock/hold de slot nesta onda.
- [ ] 3.5 Testes (pipeline: dígito sobre lista expirada não casa; clique cru
      expirado ainda agenda se o RPC aceitar) + commit.

**Resultado (preencher):**

---

## ETAPA 4 — E4: conflito de slot ⇒ desculpa curta + reoferta imediata com botões

Meta: "esse horário acabou de ser preenchido" NUNCA vem sozinho — na mesma
mensagem vão as alternativas ainda livres, como botões, e o contexto continua
coerente.

- [ ] 4.1 Nova mensagem `SLOT_TAKEN_RETRY_MSG` (PT/EN/ES), tipo:
      "Poxa, esse horário acabou de ser preenchido! 😅 Mas ainda tenho estas
      opções pertinho dele — é só escolher:". Manter `SLOT_TAKEN_MSG` como
      fallback quando não houver nenhuma alternativa.
- [ ] 4.2 Caminho do clique (`structuredFlow.ts`, ramo `!success` do slotClick):
      em vez de só `SLOT_TAKEN_MSG`: buscar disponibilidade fresca com
      `fetchAvailableSlots` (mesmo doctor, `type_id` do slot, duração do serviço
      se `type_id` conhecido, senão 30) e, se vazio, expandir com
      `fetchAvailableSlotsMulti` via `doctorsForService`. Excluir da lista o
      próprio slot conflitado. Com alternativas: enviar `SLOT_TAKEN_RETRY_MSG` +
      `buildSlotInteractive` + ATUALIZAR `pending_slots`/`pending_slot_titles`/
      `pending_slots_at` (nunca apagar e deixar vazio). Sem alternativas: enviar
      `SLOT_TAKEN_MSG` + oferta de lista de espera (fluxo existente) — nunca
      encerrar sem próximo passo.
- [ ] 4.3 Caminho LLM (`schedulingTools.ts`, `agendar`, retorno final ~1005):
      quando `reason === SLOT_CONFLICT` e NÃO é o próprio paciente: executar a
      mesma busca fresca da 4.2 e retornar
      `{ success:false, reason, alternatives, slots_formatted, note }` com `note`
      mandando o modelo avisar em UMA frase curta que o horário saiu e apresentar
      o bloco `slots_formatted` verbatim + pergunta única. Retornar também os
      `slots` no `ToolExecOutcome` para virarem botões (hoje só
      `ver_disponibilidade` popula `outcome.slots` — verificar o consumo em
      `copilot.ts` ~1570-1590 e estender para este caso).
- [ ] 4.4 Mesmo tratamento no ramo de conflito do `remarcar` e do clique de
      lista de espera (`WAITLIST_TAKEN_MSG` hoje também é beco sem saída —
      adicionar reoferta quando houver alternativa).
- [ ] 4.5 Testes pipeline: clique em slot tomado → resposta contém alternativas
      + botões + `pending_slots` atualizado; `agendar` LLM com conflito → tool
      result traz `alternatives`; conflito sem alternativa → lista de espera.
      Rodar tudo + commit.

**Resultado (preencher):**

---

## ETAPA 5 — Validação de concorrência, deploy e monitoramento

- [ ] 5.1 Rodar TODAS as suítes de `_tests/evals/` e registrar o resultado.
- [ ] 5.2 Deploy `process-inbox` (comando da seção 2). Registrar horário.
- [ ] 5.3 Smoke assistido: simular 2 conversas com telefones distintos disputando
      o MESMO slot (pode ser via inserção na fila de inbox do tenant de teste ou
      teste manual): a 1ª agenda; a 2ª recebe desculpa + reoferta com botões; e
      nenhum "Paciente WhatsApp" novo é criado em `patients`.
- [ ] 5.4 Queries de monitoramento (salvar na seção Resultado): contagem de
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
