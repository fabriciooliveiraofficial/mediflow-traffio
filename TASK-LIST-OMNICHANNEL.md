# Task List: Atendimento Omnichannel + Follow-up Kanban

> Plano detalhado em: `PLANO-OMNICHANNEL.md`
> 
> Referencia de plataformas: Octadesk, 7Bee, Zendesk, Chatwoot, Intercom

---

## Pre-requisitos

- [ ] Ler o plano completo em `PLANO-OMNICHANNEL.md`
- [ ] Ler `src/pages/HumanInboxPage.tsx` (pagina atual de atendimento — ~11.429 linhas)
- [ ] Ler `src/layouts/DashboardLayout.tsx` (navegacao lateral — ~692 linhas)
- [ ] Ler `src/pages/Automacoes.tsx` (Kanban existente em FunilCaptacao)
- [ ] Ler `src/hooks/usePatientFunnel.ts` (hook do funil existente)
- [ ] Ler `src/components/automacoes/PatientStageCard.tsx` (card arrastavel existente)
- [ ] Ler `src/App.tsx` (rotas existentes)
- [ ] Ler `supabase/functions/process-inbox/index.ts` (processamento de mensagens)
- [ ] Ler `supabase/functions/_shared/clinicalAgent.ts` (agent AI)

---

## SPRINT 1: Fundacao — Banco + Status + Estrutura
**Prazo: 1-2 semanas**

### 1.1 Migration SQL
**Arquivo NOVO:** `supabase/migrations/20260407_omnichannel_v2.sql`

- [ ] Criar tabela `agent_availability` (user_id, tenant_id, status, max_concurrent, current_count, skills, last_heartbeat)
- [ ] Criar RLS policies para agent_availability (members podem ver, agente atualiza apenas o proprio)
- [ ] Criar tabela `tags` (id, tenant_id, name, color, category)
- [ ] Criar tabela `conversation_tags` (session_id, tag_id, added_by, added_at)
- [ ] Criar RLS policies para tags e conversation_tags
- [ ] Criar tabela `conversation_transfers` (id, session_id, tenant_id, from_user_id, to_user_id, reason, transferred_at)
- [ ] Criar RLS policies para conversation_transfers
- [ ] Criar tabela `canned_responses` (id, tenant_id, shortcode, title, content, category, created_by, is_active)
- [ ] Criar RLS policies para canned_responses
- [ ] Adicionar campos em `conversation_sessions`: priority, snoozed_until, first_response_at, resolved_at, channel, last_message_preview, last_message_at, unread_count
- [ ] Adicionar campos em `patient_funnel_stage`: assigned_to, lost_reason, deal_value_cents, stage_entered_at, notes, follow_up_date, priority
- [ ] Criar RPC `transfer_conversation(session_id, from_user_id, to_user_id, reason)` — transferencia atomica
- [ ] Criar RPC `auto_assign_conversation(session_id, tenant_id)` — auto-atribuicao round-robin
- [ ] Inserir tags padrao por tenant: "Quente", "Morno", "Frio", "Urgente", "Implante", "Ortodontia", "Convenio", "Particular"
- [ ] Inserir canned responses padrao: /saudacao, /horarios, /preco, /convenio, /preparo, /confirma, /cancela
- [ ] Testar: rodar migration no Supabase, verificar tabelas e RPCs

### 1.2 Hook de Status do Agente
**Arquivo NOVO:** `src/hooks/useAgentStatus.ts`

- [ ] Ao montar: upsert em `agent_availability` com status = 'online'
- [ ] Intervalo de 60s: UPDATE `last_heartbeat = now()`
- [ ] Ao desmontar (beforeunload event): UPDATE status = 'offline'
- [ ] Expor funcao `setStatus(status)` para dropdown
- [ ] Subscription Supabase realtime em `agent_availability` para ver quem esta online
- [ ] Retornar: `{ myStatus, onlineAgents, setStatus, isLoading }`
- [ ] Testar: abrir app → verificar que usuario aparece como online → fechar → offline

### 1.3 Container OmnichannelPage
**Arquivo NOVO:** `src/pages/OmnichannelPage.tsx`

- [ ] Layout com Header contendo:
  - 3 tabs: Inbox | Follow-up | Metricas
  - AgentStatusDropdown (componente de status online/offline)
  - Indicadores: "X na fila | X meus | X total"
- [ ] Renderizar componente correspondente a tab ativa
- [ ] Tab Inbox: renderiza InboxView (refactor do HumanInboxPage)
- [ ] Tab Follow-up: renderiza FollowUpKanban (novo)
- [ ] Tab Metricas: renderiza OmnichannelMetrics (novo)
- [ ] Testar: navegar entre tabs

### 1.4 Componente AgentStatusDropdown
**Arquivo NOVO:** `src/components/omnichannel/AgentStatusDropdown.tsx`

- [ ] Dropdown com opcoes: 🟢 Online, 🟡 Ocupado, ⚪ Ausente, 🔴 Offline
- [ ] Mostra status atual com indicador colorido
- [ ] Ao mudar: chama `setStatus()` do hook
- [ ] Mostra contagem de agentes online: "(3 online)"
- [ ] Testar: mudar status e verificar no banco

### 1.5 Atualizar Navegacao
**Arquivo:** `src/layouts/DashboardLayout.tsx`

- [ ] Renomear item "Atendimento" para "Omnichannel" (manter badge com contagem)
- [ ] Tornar "Omnichannel" expandivel (como "Inteligencia") com sub-itens:
  - Inbox (rota: /dashboard/omnichannel/inbox)
  - Follow-up (rota: /dashboard/omnichannel/followup)
  - Metricas (rota: /dashboard/omnichannel/metrics)
- [ ] Manter badge animado no item pai com contagem da fila
- [ ] Testar: clicar nos sub-itens navega corretamente

### 1.6 Atualizar Rotas
**Arquivo:** `src/App.tsx`

- [ ] Adicionar rota `/dashboard/omnichannel` → OmnichannelPage
- [ ] Adicionar rota `/dashboard/omnichannel/inbox` → OmnichannelPage (tab inbox)
- [ ] Adicionar rota `/dashboard/omnichannel/followup` → OmnichannelPage (tab followup)
- [ ] Adicionar rota `/dashboard/omnichannel/metrics` → OmnichannelPage (tab metrics)
- [ ] Redirecionar `/dashboard/inbox` antigo para `/dashboard/omnichannel/inbox`
- [ ] Testar: URLs funcionam, deep link para cada tab

---

## SPRINT 2: Core Inbox — Conversas + Transferencia + Tags
**Prazo: 1-2 semanas**

### 2.1 Refatorar Lista de Conversas
**Arquivo NOVO:** `src/components/omnichannel/ConversationList.tsx`
(Extrair e reformular logica de HumanInboxPage)

- [ ] 3 tabs: **Fila** (queued) | **Meus** (human_active + meu) | **Todos** (human_active + qualquer)
- [ ] Card de conversa mostra:
  - Avatar/iniciais do paciente (circulo com primeira letra)
  - Nome ou telefone
  - Preview da ultima mensagem (truncado 60 chars)
  - Timer SLA com cor (cinza <5min, ambar 5-10min, vermelho >10min)
  - Tags como pills coloridos
  - Icone de prioridade (se alta/urgente)
  - Badge do agente atribuido (na tab "Todos")
  - Contador de mensagens nao lidas
- [ ] Contagem por tab no badge: "Fila (3)" "Meus (2)" "Todos (8)"
- [ ] Ordenacao: FIFO por padrao, toggle para prioridade
- [ ] Campo de busca (nome/telefone)
- [ ] Filtros dropdown: por tag, por prioridade
- [ ] Realtime: subscription em conversation_sessions para atualizar lista automaticamente
- [ ] Testar: ver conversas em cada tab, filtrar, buscar

### 2.2 Regra de Visibilidade (NAO pode enviar em conversa de outro)
**Arquivo:** `src/components/omnichannel/MessageThread.tsx`

- [ ] Se conversa.assigned_to_user_id === meuId: input habilitado, pode enviar
- [ ] Se conversa.omnichannel_status === 'queued': botao "Assumir" visivel, ao clicar → claim + input habilitado
- [ ] Se conversa.assigned_to_user_id !== meuId (tab Todos): input DESABILITADO
  - Mostrar banner: "👤 Atendido por {nomeDoAgente} — somente leitura"
  - Botao "Solicitar Transferencia" (se supervisor)
- [ ] Testar: abrir conversa de outro agente → input desabilitado

### 2.3 Transferencia entre Agentes
**Arquivo NOVO:** `src/components/omnichannel/TransferModal.tsx`

- [ ] Modal com:
  - Titulo: "Transferir conversa"
  - Lista de agentes online (do hook useAgentStatus)
  - Cada agente mostra: nome, status (🟢/🟡), conversas ativas (X/max)
  - Campo opcional: "Motivo da transferencia"
  - Botoes: [Cancelar] [Transferir]
- [ ] Ao confirmar: chamar RPC `transfer_conversation()`
- [ ] Inserir mensagem de sistema no thread: "🔄 Conversa transferida de {de} para {para}"
- [ ] Notificar agente destino (subscription realtime)
- [ ] Atualizar lista de conversas em tempo real
- [ ] Testar: transferir conversa → aparece na tab "Meus" do outro agente

### 2.4 Tags nas Conversas
**Arquivo NOVO:** `src/components/omnichannel/TagsManager.tsx`
**Arquivo NOVO:** `src/hooks/useConversationTags.ts`

Hook:
- [ ] `getTags(tenantId)` — listar tags disponiveis
- [ ] `getConversationTags(sessionId)` — tags de uma conversa
- [ ] `addTag(sessionId, tagId)` — adicionar tag
- [ ] `removeTag(sessionId, tagId)` — remover tag
- [ ] Subscription realtime em `conversation_tags`

Componente:
- [ ] Exibe tags atuais como pills coloridos com botao X para remover
- [ ] Botao "+" abre dropdown com tags disponiveis (filtro por digitacao)
- [ ] Tags mostradas: [🔥 Quente] [🦷 Implante] [x]
- [ ] Testar: adicionar tag, remover tag, ver no banco

### 2.5 Canned Responses com Variaveis
**Arquivo NOVO:** `src/components/omnichannel/CannedResponsePicker.tsx`
**Arquivo NOVO:** `src/hooks/useCannedResponses.ts`

Hook:
- [ ] `getResponses(tenantId)` — listar respostas ativas
- [ ] `resolveVariables(content, context)` — substituir {{patient_name}}, {{clinic_name}}, etc.

Componente:
- [ ] Ativado quando usuario digita "/" no input de mensagem
- [ ] Dropdown flutuante acima do input com lista filtrada
- [ ] Cada item mostra: shortcode + titulo
- [ ] Ao selecionar: substitui "/" pelo conteudo com variaveis resolvidas
- [ ] Variaveis disponiveis: patient_name, agent_name, clinic_name, phone
- [ ] Testar: digitar "/sau" → ver "/saudacao" → selecionar → texto preenchido

### 2.6 Painel de Agentes na Conversa
**Arquivo NOVO:** `src/components/omnichannel/AgentPanel.tsx`

- [ ] Mostra quem esta atendendo esta conversa (avatar + nome + status)
- [ ] Historico de transferencias (lista cronologica)
- [ ] Botao "Transferir para..." (abre TransferModal)
- [ ] Botao "Devolver ao Bot"
- [ ] Botao "Encerrar conversa"
- [ ] Botao "Snooze" (adiar) com date picker para quando reabrir
- [ ] Testar: ver agente atribuido, historico de transferencias

### 2.7 Painel Info do Paciente (Reformulado)
**Arquivo NOVO:** `src/components/omnichannel/PatientInfoPanel.tsx`
(Reformular sidebar existente do HumanInboxPage)

- [ ] Dados basicos: nome, telefone, CPF mascarado, email
- [ ] Tags do paciente (editaveis via TagsManager)
- [ ] Estagio no funil com badge colorido: [Novo Lead] [Qualificado] [Agendado]
- [ ] Temperatura do lead: 🔥 Quente / 🟡 Morno / 🔵 Frio (editavel)
- [ ] Proximas consultas agendadas (se existirem)
- [ ] Historico resumido: "Ultima interacao: 2h atras | Total: 5 conversas"
- [ ] Acoes rapidas:
  - [ ] 📅 Agendar consulta (abre modal de agendamento existente)
  - [ ] 📋 Ver prontuario (link para /dashboard/patient-details/{id})
  - [ ] 💰 Gerar cobranca PIX (se Asaas configurado)
  - [ ] 🏷️ Adicionar tag
- [ ] Testar: ver dados do paciente, clicar em acoes

---

## SPRINT 3: Follow-up Kanban (Trello-like)
**Prazo: 1-2 semanas**

### 3.1 KanbanBoard Principal
**Arquivo NOVO:** `src/components/followup/KanbanBoard.tsx`

- [ ] Layout horizontal com scroll para colunas
- [ ] DndContext do @dnd-kit com PointerSensor (8px distance)
- [ ] closestCorners collision detection
- [ ] DragOverlay com ghost do card
- [ ] 7 colunas padrao para saude:
  1. Novo Lead (cor: azul)
  2. Contactado (cor: indigo)
  3. Qualificado (cor: amarelo)
  4. Agendamento Pendente (cor: laranja)
  5. Agendado (cor: verde)
  6. Pos-Consulta (cor: teal)
  7. Perdido (cor: vermelho)
- [ ] Header de cada coluna: nome + contagem + valor total (se aplicavel)
- [ ] Botao de filtro global: por vendedor, por tag, por prioridade, por periodo
- [ ] Toggle "Meus leads" / "Todos"
- [ ] Testar: ver colunas, arrastar cards entre colunas

### 3.2 KanbanColumn
**Arquivo NOVO:** `src/components/followup/KanbanColumn.tsx`

- [ ] Coluna com header (nome, cor, contagem)
- [ ] SortableContext do @dnd-kit para items dentro da coluna
- [ ] useDroppable para receber cards de outras colunas
- [ ] Ordenacao dentro da coluna: por prioridade, data de entrada, follow-up date
- [ ] Scroll vertical quando muitos cards
- [ ] Indicador de cards "stale" (sem interacao >7 dias): borda amarela
- [ ] Testar: arrastar dentro da coluna e entre colunas

### 3.3 LeadCard
**Arquivo NOVO:** `src/components/followup/LeadCard.tsx`

- [ ] useSortable do @dnd-kit para tornar arrastavel
- [ ] Conteudo do card:
  - Indicador de prioridade (🔥/⬆/—) + Nome do paciente
  - Telefone
  - Interesse detectado (ex: "Avaliacao Implante")
  - Vendedor atribuido (avatar + nome)
  - Tempo desde ultima interacao
  - Tags como pills
  - Data de follow-up agendado (se existir) com icone 📌
  - Nota/contexto resumido (se existir)
  - Borda vermelha se follow-up vencido
  - Borda amarela se stale (>7 dias sem interacao)
- [ ] Acoes rapidas no footer:
  - 💬 Abrir Chat (navega para conversa no Inbox)
  - 📅 Agendar (abre modal de agendamento)
- [ ] Menu de contexto (click direito ou botao ...):
  - Mudar prioridade
  - Reatribuir vendedor
  - Adicionar nota
  - Agendar follow-up
  - Editar tags
- [ ] Testar: ver card, arrastar, clicar em acoes

### 3.4 LostReasonModal
**Arquivo NOVO:** `src/components/followup/LostReasonModal.tsx`

- [ ] Ativado quando card e arrastado para coluna "Perdido"
- [ ] Dropdown obrigatorio com motivos:
  - Sem resposta
  - Preco alto
  - Escolheu concorrente
  - Desistiu do procedimento
  - Nao era o perfil
  - Vai retornar depois
  - Outro (campo texto)
- [ ] Botoes: [Cancelar (volta card)] [Confirmar perda]
- [ ] Ao confirmar: atualiza patient_funnel_stage com lost_reason + move para Perdido
- [ ] Testar: arrastar para Perdido → modal abre → confirmar → card fica em Perdido

### 3.5 LeadDetailModal
**Arquivo NOVO:** `src/components/followup/LeadDetailModal.tsx`

- [ ] Abre ao clicar no card (nao arrastar)
- [ ] Informacoes completas do lead:
  - Dados do paciente
  - Historico de interacoes (timeline resumida)
  - Historico de movimentacoes no funil (de qual coluna veio, quando)
  - Todas as notas
  - Tags
- [ ] Acoes:
  - Editar prioridade
  - Editar temperatura
  - Adicionar nota
  - Agendar follow-up (date picker)
  - Atribuir vendedor
  - Abrir conversa WhatsApp
  - Agendar consulta
- [ ] Testar: clicar no card → modal abre com dados completos

### 3.6 Automacao de Movimentacao
**Arquivo:** (logica no backend ou triggers SQL)

- [ ] Quando `patient_funnel_stage.current_stage` muda para 'agendado' (por qualquer fonte): card move automaticamente no Kanban via realtime subscription
- [ ] Quando appointment e criado: atualizar `patient_funnel_stage` para 'agendado'
- [ ] Highlight automatico: se `last_interaction_at` > 7 dias e stage != 'agendado' e != 'perdido': marcar como "stale"
- [ ] Subscription Supabase realtime em `patient_funnel_stage` para atualizar board em tempo real
- [ ] Testar: agendar consulta → card move para "Agendado" automaticamente

### 3.7 Hook useFollowUpKanban
**Arquivo NOVO:** `src/hooks/useFollowUpKanban.ts`

- [ ] Fetch leads por tenant agrupados por stage
- [ ] Funcao `moveLeadToStage(leadId, newStage, extras?)` — extras: lost_reason, etc.
- [ ] Funcao `updateLead(leadId, updates)` — prioridade, nota, follow_up_date, assigned_to
- [ ] Filtros: por assigned_to, por tag, por prioridade, por periodo
- [ ] Subscription realtime para atualizacoes em tempo real
- [ ] Retornar: `{ columns, moveLeadToStage, updateLead, filters, setFilters, isLoading }`
- [ ] Testar: mover lead via hook, ver atualizacao em tempo real

---

## SPRINT 4: Metricas + AI Triagem + Polish
**Prazo: 1 semana**

### 4.1 Pagina de Metricas
**Arquivo NOVO:** `src/pages/OmnichannelMetrics.tsx`
**Arquivo NOVO:** `src/hooks/useOmnichannelMetrics.ts`

Cards KPI:
- [ ] Tempo medio de primeira resposta (first_response_at - claimed_at)
- [ ] Tempo medio de resolucao (resolved_at - claimed_at)
- [ ] Conversas atendidas hoje/semana/mes
- [ ] Taxa de conversao (leads → agendados)
- [ ] NPS medio (se disponivel)

Graficos (Recharts):
- [ ] Conversas por agente (bar chart horizontal, ranking)
- [ ] Funil de conversao (funnel chart ou bar)
- [ ] Tendencia semanal (line chart)

Tabela de performance por agente:
- [ ] Nome, conversas ativas, atendidas hoje, tempo medio resposta, taxa conversao
- [ ] Ordenavel por coluna
- [ ] Testar: ver metricas, filtrar por periodo

### 4.2 Auto-atribuicao
- [ ] No `process-inbox/index.ts`: apos bot qualificar e fazer handoff, chamar RPC `auto_assign_conversation()`
- [ ] Se nenhum agente online: conversa fica na fila (queued) como ja funciona
- [ ] Se agente encontrado: conversa vai direto para "Meus" do agente
- [ ] Notificacao para o agente via subscription realtime + audio alert
- [ ] Testar: bot qualifica → conversa auto-atribuida ao agente online menos carregado

### 4.3 AI Agent Modo Triagem (lead_filter)
**Arquivo:** `supabase/functions/_shared/clinicalAgent.ts`
**Arquivo:** `supabase/functions/process-inbox/index.ts`

- [ ] Adicionar objetivo `lead_filter` no bot_config
- [ ] Quando objective === 'lead_filter':
  - Agent faz: apresentacao, coleta nome, identifica interesse, classifica temperatura
  - Agent NAO faz: agendamento, coleta CPF/email, confirmacao
  - Apos qualificar (max 3-4 turnos): handoff para fila humana
  - Mensagem de handoff: "Vou te conectar com um de nossos especialistas! 😊 Em instantes alguem vai te ajudar."
- [ ] Setar sessionContext: `{ lead_temperature, lead_interest, known_first_name }`
- [ ] Fazer handoff: omnichannel_status = 'queued'
- [ ] Testar: enviar "Ola" → bot coleta nome → bot pergunta interesse → bot faz handoff

### 4.4 Notificacoes de Transferencia/Nova Conversa
- [ ] Quando conversa e transferida para mim: toast + audio alert
- [ ] Quando nova conversa chega na fila: badge atualiza + audio (ja existe parcialmente)
- [ ] Quando conversa fica >5min na fila sem ninguem assumir: alerta para supervisor
- [ ] Testar: transferir → destino recebe notificacao

### 4.5 Snooze (Adiar Conversa)
- [ ] Botao "Snooze" no AgentPanel com date picker
- [ ] Ao snooze: setar `snoozed_until` e `omnichannel_status = 'snoozed'` (novo status)
- [ ] Conversa some das tabs ativas
- [ ] Cron ou trigger: quando `snoozed_until < now()`, mover de volta para fila
- [ ] Testar: snooze para daqui 1h → conversa some → apos 1h reaparece na fila

---

## Pos-implementacao

- [ ] Testar fluxo completo E2E: paciente envia mensagem → bot triagem → fila → agente assume → agente agenda → confirma → encerra
- [ ] Testar transferencia: agente A assume → transfere para B → B atende
- [ ] Testar visibilidade: agente A ve conversa de B na tab "Todos" mas NAO pode enviar
- [ ] Testar Kanban: arrastar lead entre colunas, motivo de perda, follow-up agendado
- [ ] Testar metricas: verificar que dados aparecem corretamente
- [ ] Testar auto-atribuicao: bot faz handoff → agente online recebe automaticamente
- [ ] Testar heartbeat: fechar aba → status muda para offline em <3min
- [ ] Performance: verificar que realtime nao causa re-renders excessivos
- [ ] Mobile: verificar layout responsivo (tabs empilham verticalmente)

---

## Notas para o Implementador

1. **NAO deletar HumanInboxPage.tsx** — extrair componentes dele para os novos arquivos em `components/omnichannel/`. Eventualmente HumanInboxPage pode ser substituido por OmnichannelPage, mas manter como backup.

2. **@dnd-kit ja esta instalado** — usar `@dnd-kit/core` e `@dnd-kit/sortable`. O Kanban existente em `FunilCaptacao.tsx` e um bom exemplo de como usar.

3. **Tailwind CSS 4** — nao usar classes MUI. O projeto usa Tailwind com tokens customizados (brand-primary, ice-50, graphite-900). Verificar `tailwind.config.ts` para paleta de cores.

4. **Lucide React** — todos os icones vem de `lucide-react`. Nao importar de outros pacotes de icones.

5. **Framer Motion** — usar para animacoes de entrada/saida de cards, transicoes de tab, e DragOverlay.

6. **Supabase Realtime** — usar `supabase.channel().on('postgres_changes', ...)` para subscriptions. Exemplo existente em `usePatientFunnel.ts`.

7. **Regra de ouro da visibilidade**: Na tab "Todos", o input de mensagem deve estar DESABILITADO com banner explicativo. O agente pode VER tudo, mas so pode ENVIAR em conversas atribuidas a ele ou na fila (ao assumir).

8. **Heartbeat**: O hook useAgentStatus deve usar `window.addEventListener('beforeunload')` para marcar offline. Tambem deve ter cleanup no useEffect return. O intervalo de 60s e suficiente.

9. **Canned responses**: O autocomplete ativado por "/" deve usar um portal (createPortal) para renderizar ACIMA do input sem ser cortado pelo overflow do container.

10. **Follow-up Kanban vs FunilCaptacao existente**: O novo Kanban em FollowUpKanban e DIFERENTE do FunilCaptacao. O FunilCaptacao e focado em automacao (movido pelo bot/sistema). O novo Kanban e focado em vendedores humanos (movido manualmente com drag-and-drop). Ambos usam a mesma tabela `patient_funnel_stage`, mas com views diferentes.

11. **Performance**: Para a lista de conversas, usar virtualizacao (react-window ou similar) se houver mais de 50 conversas simultaneas. Para o Kanban, usar paginacao por coluna (carregar 20 cards por vez, load more ao scroll).

12. **O AI Agent continua existindo** — ele NAO e removido. Apenas seu papel muda de "agendador completo" para "triagista/filtro de leads" quando o objetivo e `lead_filter`. Tenants que preferem agendamento automatico pelo bot podem manter o objetivo `hybrid` ou `agenda_management`.
