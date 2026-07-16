# Roadmap de Produto — Rastreamento Geral (2026)

> Documento de controle. Compila tudo que foi analisado, decidido e (parcialmente)
> implementado nas sessões de trabalho sobre a tese de produto da Traffio.
> **Objetivo:** nenhuma decisão aprovada se perde; toda vez que algo aqui mudar
> de status, atualizar este arquivo.
>
> Specs detalhadas relacionadas: [SPEC_TELA_HOJE.md](SPEC_TELA_HOJE.md) ·
> [SPEC_AGENTE_IA_CLAUDE.md](SPEC_AGENTE_IA_CLAUDE.md)

---

## A tese (frase-norte, validada)

> **"O que minha equipe faz agora e quanto dinheiro isso está gerando."**
> Parar de mostrar features e começar a mostrar filas, metas e funil.

A Traffio é o **sistema operacional de receita da clínica** — não um bot, não um
ERP, não um painel de tráfego isolado. Diferencial: é a única plataforma do
nicho com as duas pontas do funil (aquisição/ads + conversa/agenda) e agora
também a única com IA autônoma confiável validada por suíte de evals.

Mercado mapeado: vão entre bots de WhatsApp genéricos (sem gestão) e PMS
tradicionais (Simples Dental, Clinicorp — sem IA real). Referência de produto:
Weave (EUA).

---

## Status por iniciativa

Legenda: ✅ Implementado e em produção · 🟡 Decidido/especificado, não construído · ⚪ Ideia levantada, sem spec

### 1. Tela "Hoje" — centro de comando do atendente

**Status: ✅ Implementado e em produção.**

- Spec completa: [SPEC_TELA_HOJE.md](SPEC_TELA_HOJE.md)
- 6 filas acionáveis (F1 aguardando humano, F2 confirmações, F3 faltas a
  recuperar, F4 follow-ups vencidos, F5 waitlist, F6 agenda do dia)
- `todayService.ts` + `useTodaySnapshot` + `TodayPage.tsx` + componentes
  `QueueCard`/`GoalsStrip`/`PulseRow`
- Estratificação compartilhada com o WorkQueue via `lib/workQueueStrata.ts`
  (fonte única — nunca diverge do FollowUpBoard)
- Metas do mês (agendamentos, taxa de comparecimento) em `tenants.settings.monthly_goals`
- Virou a tela default ao logar (era Agenda)
- i18n completo pt-BR/en/es

**🟡 Pendente desta iniciativa:**
- Meta/número de **faturamento real** — depende do módulo de Orçamentos (item 3)
- Fila de **orçamentos parados** dentro de F4 — depende do módulo de Orçamentos
- Rotas react-router (deep-link, botão voltar) — hoje navegação é por `activeScreen` em memória

**Bug corrigido pós-lançamento (16/07/2026):** `todayService.ts` comparava
`appointments.start_time`/`.end_time` (tipo `time without time zone`) contra
timestamps ISO completos nas filas F2 (confirmações) e F6 (agenda do dia) e
nas metas/pulso do mês — causava 400 silencioso (cada query falha
isoladamente e degrada para vazio) desde que a tela foi construída. Corrigido
para filtrar pela coluna `date` (tipo `date`), mesmo padrão já usado em
`AgendaMestra.tsx`; comparação client-side de "próximos horários de hoje"
também corrigida para comparar hora-do-dia (`Intl.DateTimeFormat` no fuso do
tenant) em vez de ISO completo.

---

### 2. Reorganização do menu por papel

**Status: ✅ Implementado e em produção (16/07/2026).**

5 grupos visuais no menu (cabeçalho discreto acima do primeiro item de cada
grupo, no sidebar desktop e no drawer mobile), mapeando **todos** os itens
existentes (não só os citados na decisão original):

- **Atendimento**: Hoje, Agenda, Conversas (Inbox), Recepção
- **Comercial**: Follow-up (CRM), Pacientes, Orçamentos
- **Clínico**: Corpo Clínico, Procedimentos + módulos dinâmicos por
  especialidade (Odontologia/Odontograma, Prontuário, Nutrição/Plano)
- **Financeiro**: Financeiro (FinancialDashboard), Pagamentos
- **Gestão**: WhatsApp, Comunicações, Inteligência, Marketing (ads),
  Notificações, Assinatura, Configurações

`DashboardLayout.tsx`: `NavItem` ganhou campo `group`; `buildNavItems()`
reordenado para agrupar contiguamente; header de grupo renderizado via
`t('nav.groups.<id>')` sempre que o grupo muda em relação ao item anterior
(oculto quando o sidebar está recolhido). Chaves `nav.groups.*` novas em
`common.json` (3 idiomas).

**Também executado nesta entrega** (itens que já estavam na lista de
pendências deste tópico):
- Renomeado "Dashboard" → **"Marketing"** em `nav.dashboard` (3 idiomas) —
  o rótulo antigo "Analytics Pro" não deixava claro que a tela é o painel de
  ads/campanhas
- Removidos os badges técnicos `Z-API` (WhatsApp), `Softphone`
  (Comunicações) e `AI Hub` (Inteligência) — mantidos apenas badges que
  comunicam valor (`IA` na Agenda, `Staff` na Recepção, `New` nos módulos de
  especialidade)

**🟡 Ainda pendente desta frente:**
- Consolidar múltiplas telas de analytics (Marketing/ads + FinancialDashboard
  + Intelligence) em uma seção "Relatórios" única — não fazia parte do
  agrupamento visual, é uma fusão de páginas mais profunda (ver item 7)

---

### 3. Financeiro gateway-agnóstico / módulo de Orçamentos

**Status: ✅ Implementado e em produção (16/07/2026).**

- Migration `20260716_commercial_proposals.sql`: tabelas `commercial_proposals` +
  `commercial_proposal_items` (pipeline `draft→sent→viewed→approved→paid/lost`,
  moeda snapshot por trigger, `total_cents` mantido por trigger/generated column),
  RPC `commercial_proposals_create` (transação atômica), RLS inline (padrão
  recente do projeto), coluna `billing_records.proposal_id` (link opcional
  recebimento↔orçamento), expansão de `crm_stage_transitions` (`new_lead`/
  `in_contact`/`scheduled` → `proposal`) para viabilizar a sincronização.
- `src/services/proposalService.ts`: CRUD + transições de status + sincronização
  **automática e best-effort** com o funil de CRM via `crm_ensure_journey()` +
  `crm_move_stage()` (porta única — nunca UPDATE direto); integração com
  `BillingService` para registrar recebimentos vinculados e auto-marcar `paid`
  quando a soma bate o total.
- `src/pages/ProposalsPage.tsx`: nova página própria (menu "Orçamentos"), KPIs
  (em aberto/aprovado aguardando pagamento/recebido no mês/taxa de aprovação),
  lista filtrável, modal de criação/edição com itens de linha, drawer de detalhe
  com timeline e ações por status.
- `src/components/channel/SendProposalChannelModal.tsx`: seletor de canal
  (WhatsApp/SMS/E-mail) desacoplado do Inbox, envia via `send-human-message`
  já existente.
- Verificado contra o schema real de produção **antes** de aplicar a migration
  (3ª vez que este projeto confere isso — nenhuma divergência desta vez).

**Bugs corrigidos pós-lançamento (16/07/2026)**, achados via console do
navegador no primeiro teste manual da página nova:
1. `proposalService.ts` usava sintaxe de embed PostgREST inválida
   (`patients:patient_id(...)` — `patient_id` é coluna, não nome de
   relacionamento) → 400 em toda query de `commercial_proposals`. Corrigido
   para `patients(...)`, mesmo padrão de `billingService.ts`.
2. Mesmo após corrigir a sintaxe, a query ainda 400ava: o select pedia a
   coluna `patients.mobile`, que **não existe** em produção (`patients` só
   tem `id, full_name, phone, email` — confirmado via
   `information_schema.columns`). Removida de `LIST_SELECT`/`DETAIL_SELECT`,
   da interface `ProposalPatient` e dos fallbacks `phone || mobile` em
   `resolveChannelAvailability()`/`send()`.

**🟡 Ainda pendente desta frente:**
- **Recebimento como "Recibo"**: `billing_records`/`FinancialDashboard` continuam
  sendo o livro-caixa geral; o "Registrar recebimento" do orçamento é um modal
  fino próprio (v1 enxuta) que ainda não foi unificado com o `NewBillingModal`
  existente — possível follow-up, não bloqueante.
- **`approved→paid` automático via trigger de banco**: hoje a reconciliação é
  acionada pelo client (`syncPaidStatus` após registrar um recebimento pelo
  próprio módulo); se o recebimento for registrado por outro caminho, o
  auto-`paid` pode não disparar. Fast-follow: trigger em `billing_records`.
- **Geração de link de pagamento Stripe** a partir de um orçamento aprovado —
  Fase 4 do plano Financeiro original, ainda não construída (`useStripeConnection`
  já existe e está pronto para isso).

Decisão de arquitetura (por causa de tenants multi-país sem integração de
gateway viável): **3 objetos separados**

1. **Orçamento** (pipeline comercial): rascunho → enviado → visualizado →
   aprovado → pago/perdido. Zero dependência de gateway. É a fonte de
   "quantas propostas enviadas / paradas / fechadas".
2. **Recebimento** (livro-caixa): registro manual como cidadão de primeira
   classe — pix, dinheiro, maquininha, convênio. A clínica cobra onde quiser;
   a plataforma é a fonte da verdade do caixa.
3. **Cobrança automática** (opcional): só onde Stripe Connect com
   `charges_enabled` existir — acelerador, nunca pré-requisito.

**Nada disso tem tabela, service ou UI ainda.** É o maior item pendente do
roadmap e o que fecha a segunda metade da frase-norte ("quanto dinheiro isso
está gerando") para qualquer tenant, em qualquer país.

---

### 4. Canais — Z-API + Meta Cloud API como tier Pro

**Status: 🟡 Decisão de produto tomada; parte técnica (botões Z-API) corrigida como efeito colateral do trabalho de IA.**

Decidido:
- **Z-API** = default (custo fixo ~R$55–99/mês, número existente da clínica).
  Botões funcionam mas são instáveis a updates do WhatsApp — sempre com
  fallback em texto numerado.
- **Meta Cloud API** = tier "Pro" (atendimento receptivo grátis, utility
  ~R$0,03, marketing ~R$0,31 no BR; Traffio como Tech Provider direto, sem
  margem de BSP). Recomendado para quem quer botões garantidos ou faz volume
  de campanhas.
- Marketing em massa vira **recurso metered** nos planos, independente do
  canal, para proteger a margem da plataforma do comportamento de disparo dos tenants.

**O que foi de fato construído:** o formato correto de botões e o fallback
numerado no `outboxDispatcher.ts` (Z-API) — corrigido durante o trabalho do
agente autônomo, não como projeto de canais em si.

**O que falta:**
- UI de upgrade de canal (tenant escolher/migrar para Cloud API)
- Metered billing de mensagens de marketing nos planos
- Onboarding de número na Cloud API dentro da plataforma

---

### 5. Agentes de IA (família Claude) — o que efetivamente foi construído

**Status: ✅ Implementado e em produção — a única frente com execução completa.**

Spec completa: [SPEC_AGENTE_IA_CLAUDE.md](SPEC_AGENTE_IA_CLAUDE.md). Decisão
de modelo: `claude-sonnet-5` (agente conversacional) + `claude-haiku-4-5-20251001`
(triagem/extração).

**F0 — Fundação de ingestão** ✅
- Debounce condicionado ao dial (10s quando IA responde; 1,2s no fluxo humano)
- Disjuntor de incompreensão (2 falhas → handoff humano)
- Ficha de estado / slot-filling (`context.intake`, acumulativo)
- Push do webhook para o worker (substituindo dependência do cron de ~20s)

**Remoção de agentes antigos** ✅
- `clinicalAgent.ts` (OpenAI gpt-4o-mini), `clinicalAgent_debug.txt`,
  `aiInterpreter.ts` (Gemini/OpenAI) — deletados
- Painel super admin (MasterIntelligence) migrado para seletores Claude
  (`AI_MODEL_AGENT`, `AI_MODEL_ROUTER`), chave `ANTHROPIC_API_KEY`

**F1 — Copiloto (Nível 0 do dial)** ✅
- `_shared/llmProvider.ts`: porta única Anthropic, log de uso em `ai_usage_logs`
  (schema real corrigido: `tokens_input`/`tokens_output`/`cost_api_cents`/`price_tenant_cents`)
- `_shared/copilot.ts`: rascunho (Sonnet) + triagem/temperatura de lead (Haiku),
  pacote de conhecimento da clínica (serviços, `clinic_info`, `knowledge_base`)
- **Persona de vendas** (`SALES_PERSONA`): método Acolher→Responder com
  valor→Avançar, fechamento alternativo, sem escassez falsa, vende a
  *avaliação* nunca o tratamento
- **Política de preço absoluta**: preço nunca sai do pacote de conhecimento
  nem é dito por mensagem — deflexão acolhedora + convite à avaliação
  (decisão de produto documentada, vale para todos os níveis)
- UI do rascunho no Inbox (banner "Sugerido pela IA" — Usar/Descartar)
- Dial no Intelligence: Desligado / Copiloto / IA Atende

**Modo "IA Atende" (`ai_always`) — F3, autonomia completa** ✅
- Agente responde diretamente, decide quando transferir (`transfer_to_human`)
- **Agendamento autônomo real**: `_shared/schedulingTools.ts` sobre os RPCs de
  produção (`find_next_available_dates`, `book_appointment`) — listar
  profissionais, ver disponibilidade, agendar, remarcar, buscar agendamentos
- **Slots viram botões clicáveis** (Z-API/Cloud API); clique = caminho 100%
  determinístico (sem LLM) via `parseSlotClick`; resposta por dígito também
  mapeada deterministicamente (`context.pending_slots`)
- **Cancelamento nunca é executado pela IA**: `encaminhar_cancelamento` →
  dentro do horário de atendimento transfere direto (retenção humana); fora
  do horário, acolhe e promete retorno. Horário configurável por tenant
  (`bot_config.business_hours`, UI no Intelligence)
- Fail-safe absoluto: qualquer erro → fila humana; cancelar-e-regenerar no
  envio (mensagem nova durante geração descarta a resposta)
- Visibilidade no Inbox: badge "IA atendendo" (violeta), chip "IA
  respondendo…", chip "Aguardando resposta" (vermelho pulsante) quando é vez
  do humano, bolhas de mensagem da IA em violeta com etiqueta "IA"

**Suíte de evals (gate obrigatório)** ✅
- `supabase/functions/_tests/evals/` — roda o modelo real com o prompt de
  produção contra ferramentas mockadas
- **12 cenários**: preço, insistência em preço, pedido de humano,
  cancelamento, agendamento, remarcação, ferramenta fora do ar (não pode
  inventar horário), dúvida clínica, idiomas EN/ES, idioma pós-ferramentas
  (anti-deriva), identidade (não finge ser humano)
- 13 testes unitários puros (parse de clique, horário de atendimento,
  normalização de slot, formatação de data)
- **Baseline atual: 12/12 verde** (14/07/2026, claude-sonnet-5)
- Regra: mudou prompt/modelo/ferramenta → suíte roda antes do deploy

**Bugs de piloto corrigidos** ✅ (documentados em `copilot_f1_architecture.md`
na memória do projeto)
1. `[object Object]` nos horários — schema do RPC de produção diverge do
   repo (retorna objeto, não string) — `normalizeSlotTime()` corrige
2. Payload de botões Z-API no formato errado — corrigido conforme doc oficial
   + fallback numerado (as opções nunca se perdem)
3. Deriva de idioma após uso de ferramentas — âncora explícita de idioma no
   prompt + notas de ferramenta em inglês neutro
4. Inbox escondia conversas em `bot_active` — aba padrão trocada de "Fila"
   para "Todos"

**F2 — fluxos estruturados determinísticos (recovery + waitlist)** ✅ (16/07/2026)
- Pré-filtro **universal**: `_shared/structuredFlow.ts` roda em `process-inbox`
  ANTES do roteamento por dial (linha ~276), para QUALQUER `active_agent`
  (`human`/`copilot`/`ai_always`) — zero LLM, zero fila humana quando reconhece
  o padrão; senão cai no roteamento de sempre, sem regressão.
- Reconhece 3 padrões: (1) clique em botão de horário/fallback numérico —
  migrado de dentro de `runAutonomousAgent` para o pré-filtro, então agora
  funciona em qualquer dial, não só `ai_always`; (2) resposta "Sim" a uma
  oferta de vaga de `waitlist` — **reserva automaticamente** via
  `book_appointment`, com apologia + handoff humano se a vaga já foi
  preenchida; (3) resposta REMARCAR/RESCHEDULE/REAGENDAR a um
  `recovery_immediate/48h/7d` — oferece horários do médico faltado (RPC
  `find_next_available_dates`) via botões clicáveis.
- Correlação envio→resposta: `process-outbound` grava
  `context.pending_recovery` (via `crm_journeys.patient_id` +
  `outbound_message_queue.reference_id`) e `process-waitlist` grava
  `context.pending_waitlist` (resolvendo `location_id`, ausente em `waitlist`,
  a partir do agendamento cancelado que disparou a notificação) — novo helper
  genérico `sessionManager.updateContext()`.
- `chatAgent.ts` **não foi usado** (código morto confirmado — zero call sites
  em produção; só implementava triagem de agendamento do zero, não parsing de
  resposta a recovery/waitlist). Reaproveitado 100% de `schedulingTools.ts`
  (`fetchAvailableSlots` extraído de `ver_disponibilidade` para reuso fora do
  formato tool-call, nova `WAITLIST_TAKEN_MSG`).
- Escopo explícito: `recall_immediate` e confirmação de agendamento
  (reminder_48h etc.) ficam de fora — ver riscos assumidos abaixo.
- Kill-switch de segurança: `bot_config.structured_flows_enabled` (default
  ligado), toggle em Notificações → Recuperação de Pacientes.
- `deno check` limpo nos 7 arquivos tocados + 13/13 testes unitários do F3
  passando (suíte de evals com modelo real não re-executada nesta entrega —
  a mudança não tocou prompt/modelo/ferramentas do F3, só moveu o slot-click
  para fora de `runAutonomousAgent`).

**Riscos assumidos do F2 (documentados, não resolvidos agora):**
- Caption de recovery customizada pelo tenant (`bot_config.recovery_captions`)
  pode divergir da palavra-chave canônica — nesse caso o F2 simplesmente não
  casa (fallback seguro, sem regressão, só perde a otimização).
- Sem cascata automática de waitlist: vaga já preenchida → transfere para
  humano em vez de notificar o próximo da fila automaticamente.
- Mensagem de waitlist (`process-waitlist/index.ts`) continua só em PT —
  limitação pré-existente, não introduzida por este trabalho.

**🟡 Pendente desta frente:**
- **Camada de provedor Meta Cloud API para o agente** — hoje o envio já
  suporta os dois provedores (dispatcher), mas o agente não foi testado/
  validado especificamente rodando sobre Cloud API em vez de Z-API
- **Teto de uso/custo por tenant** que degrada autonomia (`copilot` em vez de
  cortar atendimento) quando estoura orçamento — mencionado na spec original,
  não implementado
- **Áudio/voz** (transcrição de mensagem de voz do paciente) — fora de escopo, mencionado como fase futura

---

### 6a. Reorganização Inteligência ↔ Notificações (coerência de conteúdo por nome de página)

**Status: ✅ Implementado e em produção (15/07/2026).**

Diagnóstico: a página "Inteligência" misturava o Dial de IA com ~90% de
conteúdo de notificação (Matriz de Canais, NPS, Recall, Recuperação de
Faltas, Saúde do Motor). A página "Notificações" cobria só alertas locais do
navegador (som/toast/push) + SMTP. Migração feita:

- `src/types/botConfig.ts` — tipos extraídos (fonte única, evita import circular)
- `src/hooks/useBotConfig.ts` — fetch/save do `tenants.bot_config` centralizado;
  cada página edita só sua fatia e salva o objeto inteiro (sem risco de
  clobbering entre Dial de IA e automações de notificação)
- `Intelligence.tsx` — enxuta: Header + Dial (Desligado/Copiloto/IA Atende) +
  horário de atendimento + botão Salvar próprio
- `NotificationsPage.tsx` — recebeu Saúde do Motor, Matriz de Canais e
  Automações, Lembretes Universais, Confirmação de Agendamento, NPS,
  Recuperação/Recall
- Verificado com diff automatizado (zero erro de transcrição) + `tsc` + `vite build`

**Reverte o item 7 abaixo**: a ideia original de "Notificações vira só um
sino" foi abandonada — a página tem conteúdo operacional real demais
(motor de envio, NPS, recall) para caber num dropdown. Mantida como página
dedicada, agora com nome e conteúdo coerentes.

---

### 6. IA consciente de jornada (CRM stage-aware) — a fronteira competitiva

**Status: ⚪ Ideia validada em conversa, sem spec nem código.**

Proposta (a que build o "fosso competitivo" que nenhum concorrente tem): o
agente recebe o `crm_journeys.stage_id` da conversa e troca a **abordagem**
por estágio —

| Estágio | Abordagem |
|---|---|
| Lead novo | Acolher + vender a avaliação (comportamento atual) |
| Paciente que faltou | Zero culpa, remarcar em 1 toque |
| Recall (6+ meses) | Reconhecimento + cuidado, sem venda agressiva |
| Orçamento parado | Reancorar valor, remover obstáculo |
| Paciente ativo | Só servir, não vender |

Também proposto: usar as edições/descartes do atendente no copiloto como
sinal de aprendizado por tenant (loop de gabarito humano). **Nada disso foi
desenhado tecnicamente ainda** — é a recomendação de próximo incremento após
o piloto validar a base atual.

---

### 7. O que foi decidido **não fazer** (ou tirar)

- **Módulo de Nutrição** — esconder/descontinuar (dilui posicionamento
  dental). *Não executado ainda — segue visível na plataforma.*
- ~~**Notificações como página no menu** — deveria virar só sino~~ **REVERTIDO
  em 15/07/2026** (ver item 6a): a página ganhou conteúdo operacional real
  demais para virar dropdown; continua como página dedicada.
- **ERP clínico completo** (protético, NF-e, estoque, multi-unidade) — fora
  de escopo permanente, é terreno da Clinicorp.
- **Múltiplas telas de analytics soltas** — consolidar em "Relatórios".
  *Não executado.*
- **Religar os agentes antigos (OpenAI/Gemini)** — removidos permanentemente.

---

## Ordem recomendada dos próximos passos

1. **Validar o piloto do F3** (agendamento autônomo) na Dental Test 4 — mais
   testes reais, rodar a suíte a cada ajuste. *(contínuo, depende de uso real — não é uma tarefa de código isolada)*
2. ~~**Módulo de Orçamentos + caixa gateway-agnóstico** (item 3)~~ **✅ Concluído
   em 16/07/2026.**
3. ~~**Reorganização visual do menu em 5 grupos** (item 2)~~ **✅ Concluído em
   16/07/2026.**
4. ~~**F2 — fluxos estruturados determinísticos** (recovery + waitlist)~~ **✅
   Concluído em 16/07/2026.** Teste ponta a ponta pendente com WhatsApp real
   (ver seção do item 5 acima) — próxima vez que mexer no pipeline de
   inbox/outbound, validar contra o tenant de teste.
5. **Esconder Nutrição, consolidar Relatórios** (item 7) — limpeza rápida
   de posicionamento (a remoção de Notificações do menu foi revertida, ver 6a).
   **← próximo passo de construção recomendado.**
6. **IA consciente de jornada** (item 6) — depois que o volume de dados do
   piloto existir para justificar.
7. **Meta Cloud API como tier Pro** com UI de upgrade e billing metered
   (item 4) — quando houver demanda real de tenant que precise de botões
   garantidos ou volume de campanha.

---

*Última atualização: 16/07/2026 (bugs pós-lançamento do módulo de Orçamentos
e da Tela Hoje corrigidos — ver itens 1 e 3; reorganização visual do menu em
5 grupos concluída — item 2; F2 fluxos estruturados determinísticos
recovery+waitlist concluído — item 5). Ao concluir qualquer item, mover para
a seção correspondente com ✅ e a data/PR relevante.*
