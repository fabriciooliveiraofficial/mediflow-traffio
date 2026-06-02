# Plano de Implementacao: Atendimento Omnichannel + Follow-up Kanban

## Resumo Executivo

Transformar a pagina "Atendimento" (HumanInboxPage) em um painel Omnichannel completo no estilo Octadesk/7Bee, onde multiplos usuarios/vendedores atendem conversas de WhatsApp em fila. O AI Agent faz apenas triagem/filtro do lead, e os humanos conduzem o agendamento. Inclui pagina de Follow-up com Kanban drag-and-drop estilo Trello para classificar e avançar leads.

---

## 1. Estado Atual do Codigo

### Pagina Existente: HumanInboxPage.tsx
**Arquivo:** `src/pages/HumanInboxPage.tsx` (~11.429 linhas)

**O que ja existe:**
- Layout 3 paineis: lista conversas (280px) | chat central | sidebar paciente (288px)
- 2 tabs: "Aguardando" (queued) e "Meus" (human_active atribuidos ao usuario)
- Claim atomico via RPC `claim_conversation` (PostgreSQL FOR UPDATE NOWAIT)
- SLA timer com cores (cinza <5min, ambar 5-10min, vermelho >10min)
- Realtime Supabase subscriptions em `conversation_sessions` e `conversation_messages`
- 6 quick replies estaticas
- Notas internas (role = `internal`)
- Bubbles por role: user (esquerda), assistant/bot (direita cinza), human (direita azul), internal (ambar)
- Sidebar paciente: nome, CPF mascarado, proximas consultas
- Acoes: "Devolver ao Bot" e "Encerrar"
- Busca por nome/telefone

**O que FALTA (gap analysis baseado em Octadesk/7Bee/Zendesk):**
- Nao tem status online/offline/busy do agente
- Nao tem transferencia entre agentes
- Nao tem auto-atribuicao (round-robin)
- Nao tem tags/etiquetas nas conversas
- Nao tem prioridade por conversa
- Nao tem limite de conversas simultaneas por agente
- Nao tem visibilidade de conversas de OUTROS agentes (so ve as proprias)
- Nao tem metricas de performance por agente
- Nao tem snooze/agendar retorno
- Nao tem canned responses com variaveis
- Nao tem suporte a midia (audio, imagem, documento)

### Pagina Existente: Automacoes.tsx
**Arquivo:** `src/pages/Automacoes.tsx`

Ja tem Kanban com @dnd-kit em `FunilCaptacao`:
- 5 colunas fixas: Novo Lead, Em Follow-up, Qualificado, Agendado, Perdido
- Cards de pacientes arrastáveis
- Metricas por coluna

### Navegacao Atual (DashboardLayout.tsx)
**Arquivo:** `src/layouts/DashboardLayout.tsx` (~692 linhas)

Menu lateral com "Atendimento" (badge com contagem de fila) e "Inteligencia" (expandivel com sub-itens).

### Tabelas Existentes
- `conversation_sessions`: id, tenant_id, patient_phone, omnichannel_status, human_handoff, assigned_to_user_id, claimed_at, recent_messages, context
- `conversation_messages`: id, session_id, role, content, ai_raw_response, parsed_intent
- `patient_funnel_stage`: id, tenant_id, patient_phone, patient_name, current_stage, lead_source, lead_temperature, next_action_type, next_action_at
- `patients`: id, tenant_id, phone, full_name, cpf, email, birth_date
- `members`: user_id, tenant_id, role
- `outbound_message_queue`: id, tenant_id, patient_phone, message_type, template_key, scheduled_at, status

### Tech Stack
- React 19, Tailwind CSS 4, Framer Motion, Lucide React
- @dnd-kit/core + @dnd-kit/sortable (ja instalado)
- Supabase (Postgres + Realtime)
- React Router DOM 7

---

## 2. Arquitetura Proposta

### Nova Estrutura de Navegacao

```
Sidebar:
├── Dashboard
├── Agenda
├── Recepcao
├── Atendimento (RENOMEAR → "Omnichannel")    ← Badge com fila
│   ├── Inbox (fila + conversas)               ← Sub-pagina principal  
│   ├── Follow-up (Kanban)                     ← NOVA sub-pagina
│   └── Metricas                               ← NOVA sub-pagina
├── Pacientes
├── Financeiro
├── Inteligencia
│   ├── Configuracao do Bot
│   ├── Base de Conhecimento
│   └── AI Debugger
├── Automacoes
├── ...
```

### Layout da Pagina Omnichannel (4 paineis)

```
┌────────────────────────────────────────────────────────────────────┐
│  HEADER: Tabs [Inbox] [Follow-up] [Metricas]    Status: 🟢 Online │
├──────────┬─────────────────────────────┬──────────┬────────────────┤
│ PAINEL 1 │       PAINEL 2              │ PAINEL 3 │   PAINEL 4     │
│          │                             │          │                │
│ FILA DE  │    THREAD DE                │ ATENDEN- │  INFO DO       │
│ CONVERSAS│    MENSAGENS                │ TES NA   │  PACIENTE      │
│          │                             │ CONVERSA │                │
│ ┌──────┐ │  ┌─────────────────────┐    │          │ Nome: Maria    │
│ │🔴 3  │ │  │ Bot: Ola! Sou a     │    │ 🟢 Ana  │ Tel: 41 9xxx   │
│ │Maria │ │  │ Amanda...           │    │ 👁️ Carlos│ CPF: 965.***  │
│ │5min  │ │  │                     │    │          │                │
│ ├──────┤ │  │ Pac: Quero agendar  │    │ Transfer │ Proxima:       │
│ │🟡 2  │ │  │ implante            │    │ [Ana ▼]  │ 10/04 09:00   │
│ │Carlos│ │  │                     │    │          │ Dr. Fabricio   │
│ │2min  │ │  │ Bot: Otimo! Vou     │    │ Historico│                │
│ ├──────┤ │  │ verificar...        │    │ de       │ Tags:          │
│ │🟢 1  │ │  │                     │    │ transf.  │ [🔥 Quente]   │
│ │Jose  │ │  │ 👤 (Voce): Ola     │    │          │ [🦷 Implante] │
│ │30s   │ │  │ Maria! Aqui é o     │    │ Notas    │                │
│ └──────┘ │  │ Fabricio...         │    │ internas │ Funnel:        │
│          │  │                     │    │          │ [Qualificado]  │
│ ──────── │  │ ┌─────────────────┐ │    │          │                │
│ TABS:    │  │ │ Digite...   📎 ↩│ │    │          │ Acoes:         │
│ Fila(3)  │  │ └─────────────────┘ │    │          │ [📅 Agendar]  │
│ Meus(2)  │  └─────────────────────┘    │          │ [💰 Cobrar]   │
│ Todos(8) │                             │          │ [📋 Prontuario]│
│          │  Quick: /saudacao /horarios  │          │                │
└──────────┴─────────────────────────────┴──────────┴────────────────┘
```

---

## 3. Novas Tabelas (Migrations)

### 3.1 agent_availability — Status dos agentes
```sql
CREATE TABLE public.agent_availability (
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'busy', 'away', 'offline')),
  max_concurrent int NOT NULL DEFAULT 5,
  current_count int NOT NULL DEFAULT 0,
  skills text[] DEFAULT '{}',
  last_heartbeat timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id)
);

ALTER TABLE public.agent_availability ENABLE ROW LEVEL SECURITY;

-- Todos os membros do tenant podem ver
CREATE POLICY "Members can view agent availability" ON public.agent_availability
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.members WHERE members.tenant_id = agent_availability.tenant_id AND members.user_id = auth.uid())
  );

-- Cada agente atualiza apenas o proprio status
CREATE POLICY "Agents can update own availability" ON public.agent_availability
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Agents can insert own availability" ON public.agent_availability
  FOR INSERT WITH CHECK (user_id = auth.uid());
```

### 3.2 conversation_tags — Tags nas conversas
```sql
CREATE TABLE public.tags (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6B7280', -- hex color
  category text DEFAULT 'general', -- 'priority', 'interest', 'status', 'general'
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_tags_tenant_name ON public.tags(tenant_id, name);
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.conversation_tags (
  session_id uuid REFERENCES public.conversation_sessions(id) ON DELETE CASCADE,
  tag_id uuid REFERENCES public.tags(id) ON DELETE CASCADE,
  added_by uuid REFERENCES auth.users(id),
  added_at timestamptz DEFAULT now(),
  PRIMARY KEY (session_id, tag_id)
);

ALTER TABLE public.conversation_tags ENABLE ROW LEVEL SECURITY;
```

### 3.3 conversation_transfers — Historico de transferencias
```sql
CREATE TABLE public.conversation_transfers (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  session_id uuid REFERENCES public.conversation_sessions(id) ON DELETE CASCADE NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  from_user_id uuid REFERENCES auth.users(id),
  to_user_id uuid REFERENCES auth.users(id),
  reason text,
  transferred_at timestamptz DEFAULT now()
);

ALTER TABLE public.conversation_transfers ENABLE ROW LEVEL SECURITY;
```

### 3.4 canned_responses — Respostas rapidas com variaveis
```sql
CREATE TABLE public.canned_responses (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  shortcode text NOT NULL, -- e.g., '/saudacao', '/horarios', '/preco'
  title text NOT NULL,
  content text NOT NULL, -- Supports {{patient_name}}, {{clinic_name}}, etc.
  category text DEFAULT 'general',
  created_by uuid REFERENCES auth.users(id),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_canned_tenant_shortcode ON public.canned_responses(tenant_id, shortcode);
ALTER TABLE public.canned_responses ENABLE ROW LEVEL SECURITY;
```

### 3.5 Adicionar campos em conversation_sessions
```sql
ALTER TABLE public.conversation_sessions 
  ADD COLUMN IF NOT EXISTS priority text DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz,
  ADD COLUMN IF NOT EXISTS first_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS channel text DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS last_message_preview text,
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS unread_count int DEFAULT 0;
```

### 3.6 Adicionar campos em patient_funnel_stage (Follow-up Kanban)
```sql
ALTER TABLE public.patient_funnel_stage
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS lost_reason text,
  ADD COLUMN IF NOT EXISTS deal_value_cents int,
  ADD COLUMN IF NOT EXISTS stage_entered_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS follow_up_date timestamptz,
  ADD COLUMN IF NOT EXISTS priority text DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
```

### 3.7 RPCs — Transferencia e Auto-atribuicao

```sql
-- Transferir conversa entre agentes
CREATE OR REPLACE FUNCTION transfer_conversation(
  p_session_id uuid,
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_reason text DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- Verificar que a conversa pertence ao from_user
  SELECT tenant_id INTO v_tenant_id
  FROM conversation_sessions
  WHERE id = p_session_id AND assigned_to_user_id = p_from_user_id
  FOR UPDATE NOWAIT;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'conversation_not_found_or_not_assigned');
  END IF;

  -- Transferir
  UPDATE conversation_sessions SET
    assigned_to_user_id = p_to_user_id,
    claimed_at = now()
  WHERE id = p_session_id;

  -- Registrar transferencia
  INSERT INTO conversation_transfers (session_id, tenant_id, from_user_id, to_user_id, reason)
  VALUES (p_session_id, v_tenant_id, p_from_user_id, p_to_user_id, p_reason);

  -- Atualizar contadores de disponibilidade
  UPDATE agent_availability SET current_count = GREATEST(current_count - 1, 0)
  WHERE user_id = p_from_user_id AND tenant_id = v_tenant_id;

  UPDATE agent_availability SET current_count = current_count + 1
  WHERE user_id = p_to_user_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Auto-atribuir conversa ao agente menos carregado
CREATE OR REPLACE FUNCTION auto_assign_conversation(
  p_session_id uuid,
  p_tenant_id uuid
) RETURNS jsonb AS $$
DECLARE
  v_agent uuid;
BEGIN
  SELECT user_id INTO v_agent
  FROM agent_availability
  WHERE tenant_id = p_tenant_id
    AND status = 'online'
    AND current_count < max_concurrent
    AND last_heartbeat > now() - interval '2 minutes'
  ORDER BY current_count ASC, last_heartbeat DESC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_agent IS NULL THEN
    RETURN jsonb_build_object('assigned', false, 'reason', 'no_agents_available');
  END IF;

  UPDATE conversation_sessions SET
    omnichannel_status = 'human_active',
    assigned_to_user_id = v_agent,
    claimed_at = now()
  WHERE id = p_session_id;

  UPDATE agent_availability SET current_count = current_count + 1
  WHERE user_id = v_agent AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object('assigned', true, 'agent_id', v_agent);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## 4. Componentes da UI

### 4.1 Pagina Inbox (Reformulacao do HumanInboxPage)

**Arquivo a modificar:** `src/pages/HumanInboxPage.tsx`

**Mudancas estruturais:**

#### Header da pagina
- Tabs: **Inbox** | **Follow-up** | **Metricas**
- Status do agente: dropdown [🟢 Online] [🟡 Ocupado] [⚪ Ausente] [🔴 Offline]
- Indicador: "3 na fila | 2 seus | 8 total"

#### Painel 1 — Lista de Conversas (REFORMULADO)
- **3 tabs** (em vez de 2):
  - **Fila** (queued) — conversas aguardando atendimento, visiveis para TODOS
  - **Meus** (human_active, assigned_to_user_id = eu) — minhas conversas ativas
  - **Todos** (human_active, qualquer assigned_to_user_id) — supervisao, somente leitura
- Cada card de conversa mostra:
  - Avatar/iniciais do paciente
  - Nome do paciente (ou telefone se desconhecido)
  - Preview da ultima mensagem (truncado 60 chars)
  - Tempo de espera com cor SLA
  - Tags como pills coloridos
  - Icone de prioridade (🔥 urgente, ⬆ alta)
  - Badge do agente atribuido (na tab "Todos")
  - Indicador de mensagens nao lidas
- Filtros: por tag, por prioridade, por data
- Ordenacao: mais antigo primeiro (FIFO) ou por prioridade

#### Painel 2 — Thread de Mensagens (MELHORADO)
- Mensagens com tipos visuais:
  - `user` (paciente): bolha esquerda, fundo branco
  - `assistant` (bot): bolha direita, fundo cinza claro, badge "🤖 Bot"
  - `human` (agente): bolha direita, fundo azul, badge com nome do agente
  - `internal` (nota): bolha central, fundo ambar, italico, icone cadeado
  - `system` (eventos): linha central cinza ("🔄 Transferido para Ana", "🤖 Bot encerrou", "📅 Agendamento criado")
- Input de mensagem com:
  - Textarea expansivel
  - Botao de enviar
  - Botao de anexo (futuro: midia)
  - Toggle "Nota interna" (alterna entre mensagem e nota)
  - Autocomplete de canned responses: ao digitar "/" mostra lista de atalhos

#### Painel 3 — Agentes na Conversa (NOVO)
- Quem esta atendendo esta conversa
- Historico de transferencias
- Botao "Transferir para..." com dropdown de agentes online
- Notas internas rapidas
- Acoes: Devolver ao Bot, Encerrar, Snooze (adiar)

#### Painel 4 — Info do Paciente (MELHORADO)
- Dados basicos: nome, telefone, CPF mascarado, email
- Tags do paciente (editaveis)
- Estagio no funil: [Novo Lead | Qualificado | Agendado | ...]
- Temperatura do lead: 🔥 Quente / 🟡 Morno / 🔵 Frio
- Proximas consultas agendadas
- Historico resumido: ultima interacao, total de conversas
- Acoes rapidas:
  - 📅 Agendar consulta (abre modal)
  - 📋 Ver prontuario (link para PatientDetails)
  - 💰 Gerar cobranca (PIX)
  - 🏷️ Adicionar tag

### 4.2 Regras de Visibilidade entre Agentes

**Regra fundamental (estilo Octadesk/7Bee):**

1. **Fila (queued)**: TODOS os agentes veem. Qualquer um pode clicar para assumir (claim).
2. **Meus (human_active, meu)**: So eu vejo nesta tab. Posso enviar mensagens.
3. **Todos (human_active, qualquer agente)**: TODOS veem as conversas de TODOS os agentes. Mas:
   - **NAO pode enviar mensagem** na conversa de outro agente
   - **PODE ver** o historico completo (somente leitura)
   - **PODE transferir** se tiver permissao de supervisor
   - Interface mostra badge: "👤 Atendido por Ana" com input desabilitado
4. **Transferencia**: Agente A pode transferir conversa para Agente B. B recebe notificacao. Conversa aparece na tab "Meus" de B.

**Implementacao:**
```typescript
// No componente de input de mensagem:
const canSendMessage = conversation.assigned_to_user_id === currentUserId 
  || conversation.omnichannel_status === 'queued'; // pode enviar ao assumir
  
// Na tab "Todos":
// Mostrar conversas com assigned_to_user_id != currentUserId
// Input desabilitado com mensagem: "Esta conversa esta sendo atendida por {agentName}"
```

### 4.3 Pagina Follow-up (Kanban) — NOVA

**Arquivo novo:** `src/pages/FollowUpKanban.tsx`

**Design: Kanban board estilo Trello com colunas customizaveis**

#### Colunas padrao (para saude):
```
| Novo Lead    | Contactado  | Qualificado | Agendamento  | Agendado    | Pos-Consulta | Perdido  |
|              |             |             | Pendente     |             |              |          |
| Leads que    | Primeiro    | Interesse   | Ja escolheu  | Consulta    | Acompanhar   | Nao      |
| chegaram     | contato     | confirmado  | horario,     | marcada     | resultado,   | converteu|
| via WhatsApp | feito pelo  | quer        | aguardando   |             | retorno,     |          |
|              | vendedor    | agendar     | confirmacao  |             | reagendar    |          |
```

#### Card de cada lead:
```
┌─────────────────────────────────┐
│ 🔥 Maria Silva                  │ ← Prioridade + Nome
│ 📱 41 99775-9569                │ ← Telefone
│ 🦷 Avaliacao Implante           │ ← Interesse
│ 👤 Ana (vendedora)              │ ← Responsavel
│ ⏰ 2h atras                     │ ← Ultima interacao
│ [🔥Quente] [🦷Implante]        │ ← Tags
│                                 │
│ 📌 Retornar em 07/04 14:00     │ ← Follow-up agendado
│ 💬 "Vou falar com meu marido"  │ ← Nota/ultimo contexto
├─────────────────────────────────┤
│ [💬 Abrir Chat] [📅 Agendar]   │ ← Acoes rapidas
└─────────────────────────────────┘
```

#### Features do Kanban:
- **Drag-and-drop** entre colunas (@dnd-kit, ja instalado)
- **Motivo de perda obrigatorio**: ao arrastar para "Perdido", abre modal com dropdown:
  - "Sem resposta"
  - "Preço alto"
  - "Escolheu concorrente"
  - "Desistiu"
  - "Outro" (campo texto)
- **Filtros**: por vendedor, por tag, por prioridade, por periodo
- **Ordenacao dentro da coluna**: por prioridade, por data, por valor
- **Metricas por coluna**: contagem de cards, valor total, tempo medio no estagio
- **Follow-up date**: cada card pode ter data de retorno. Cards com retorno vencido ficam com borda vermelha
- **Atribuicao**: cada lead pode ser atribuido a um vendedor. Filtro "Meus leads" / "Todos"
- **Acoes no card**: abrir conversa WhatsApp, agendar consulta, adicionar nota, mudar prioridade, reatribuir

#### Automacao de movimentacao:
- Quando bot qualifica lead → move automaticamente para "Qualificado"
- Quando agendamento e criado → move para "Agendado"
- Quando paciente para de responder por 7 dias → highlight "stale" (borda amarela)
- Quando paciente para de responder por 30 dias → sugere mover para "Perdido"

### 4.4 Pagina Metricas — NOVA

**Arquivo novo:** `src/pages/OmnichannelMetrics.tsx`

**Cards KPI:**
- Tempo medio de primeira resposta
- Tempo medio de resolucao
- Conversas atendidas hoje/semana/mes
- Taxa de conversao (lead → agendado)
- NPS medio
- Conversas por agente (ranking)

**Graficos:**
- Conversas por hora do dia (heatmap)
- Funil de conversao (sankey ou bar chart)
- Performance por agente (bar chart comparativo)
- Tendencia semanal

---

## 5. Fluxo Completo da Conversa

```
1. Paciente envia mensagem via WhatsApp
   ↓
2. Webhook → message_inbox (status: pending)
   ↓
3. process-inbox (cron 2s):
   - AI Agent faz TRIAGEM/FILTRO:
     - Coleta nome do paciente
     - Identifica interesse (especialidade, procedimento)
     - Classifica temperatura do lead (hot/warm/cold)
     - Salva em patient_funnel_stage
   - AI Agent NAO faz agendamento (diferente do fluxo anterior)
   - Apos qualificar: transfere para fila humana
   ↓
4. conversation_sessions.omnichannel_status = 'queued'
   ↓
5. Tentativa de auto-atribuicao:
   - RPC auto_assign_conversation()
   - Se agente disponivel: atribui automaticamente
   - Se nenhum online: fica na fila
   ↓
6. Agente ve conversa na tab "Fila" ou recebe notificacao
   ↓
7. Agente clica "Assumir" (claim_conversation RPC)
   - Status → human_active
   - assigned_to_user_id = agente
   - Conversa move para tab "Meus"
   ↓
8. Agente conduz atendimento:
   - Le historico do bot (triagem)
   - Conversa com paciente via WhatsApp
   - Pode usar canned responses (/horarios, /saudacao)
   - Pode adicionar tags ([🔥 Quente], [🦷 Implante])
   - Pode adicionar notas internas
   ↓
9. Agente realiza agendamento:
   - Botao "📅 Agendar" no painel de acoes
   - Abre modal de agendamento (selecionar doutor, serviço, data, hora)
   - Cria appointment no banco
   - Envia confirmacao ao paciente via WhatsApp
   - patient_funnel_stage move para "Agendado"
   ↓
10. Agente encerra conversa ou transfere:
    - "Encerrar": omnichannel_status = 'closed'
    - "Transferir para X": RPC transfer_conversation()
    - "Devolver ao Bot": omnichannel_status = 'bot_active'
   ↓
11. Follow-up (Kanban):
    - Lead aparece na coluna correspondente
    - Vendedor arrasta entre colunas conforme avanco
    - Se nao respondeu: vendedor agenda retorno
    - Se perdido: registra motivo
```

---

## 6. Papel do AI Agent (Apenas Triagem)

O ClinicalAgent continua existindo mas com papel REDUZIDO:

### O que o AI Agent FAZ:
1. **Apresentacao**: Se apresenta e pergunta o nome (greeting deterministico)
2. **Coleta de dados basicos**: Nome, telefone WhatsApp
3. **Identificacao de interesse**: "O que voce esta procurando?" → classifica
4. **Qualificacao rapida**: Identifica se e lead quente (quer agendar agora) ou frio (so perguntando)
5. **Transferencia para humano**: Apos qualificar, envia mensagem tipo "Vou te conectar com um de nossos especialistas que vai te ajudar com o agendamento! 😊"

### O que o AI Agent NAO FAZ mais:
- ~~Agendamento completo~~ → Humano faz
- ~~Coleta de CPF/email/nascimento~~ → Humano faz se necessario
- ~~Confirmacao de agendamento~~ → Humano faz
- ~~Gestao de objecoes~~ → Humano faz

### Configuracao no bot_config:
```json
{
  "objective": "lead_filter",
  "closing_mode": "warm_handoff",
  "handoff_policy": "after_qualification",
  "auto_handoff_after_name": true,
  "max_bot_turns_before_handoff": 4
}
```

---

## 7. Heartbeat e Status do Agente

### Frontend (Hook)
```typescript
// useAgentStatus.ts
// - Ao montar: upsert agent_availability com status = 'online'
// - A cada 60s: UPDATE last_heartbeat = now()
// - Ao desmontar (beforeunload): UPDATE status = 'offline'
// - Dropdown permite mudar para 'busy', 'away'
// - Realtime subscription mostra quem esta online
```

### Backend (Cleanup Cron)
```sql
-- Rodar a cada 2 minutos: marcar como offline quem nao deu heartbeat
UPDATE agent_availability SET status = 'offline', current_count = 0
WHERE status != 'offline' AND last_heartbeat < now() - interval '3 minutes';
```

---

## 8. Canned Responses com Variaveis

### Templates padrao para saude:
```
/saudacao → "Ola {{patient_name}}! 😊 Aqui e o {{agent_name}} da {{clinic_name}}. Como posso te ajudar?"
/horarios → "{{patient_name}}, temos os seguintes horarios disponiveis essa semana: [verificar agenda]"
/preco    → "{{patient_name}}, o valor da {{service_name}} e R$ {{price}}. Aceita cartao, PIX e boleto."
/convenio → "{{patient_name}}, aceitamos os seguintes convenios: [verificar lista]"
/preparo  → "{{patient_name}}, para sua consulta, lembre-se: [instrucoes de preparo]"
/confirma → "{{patient_name}}, confirmo seu agendamento: 📅 {{date}} as ⏰ {{time}} com {{doctor_name}} na 📍 {{location}}. Ate la! 😊"
/cancela  → "{{patient_name}}, seu agendamento foi cancelado conforme solicitado. Quando quiser reagendar, e so me chamar! 😊"
```

### Implementacao no input:
- Ao digitar "/" no campo de mensagem: abre dropdown com canned responses filtradas
- Selecionar substitui o "/" pelo conteudo com variaveis preenchidas
- Variaveis resolvidas a partir de: sessionContext, patientData, appointmentData

---

## 9. Arquivos a Criar/Modificar

### Novos Arquivos

| Arquivo | Descricao |
|---------|-----------|
| `supabase/migrations/20260407_omnichannel_v2.sql` | Migration com todas as tabelas novas |
| `src/pages/OmnichannelPage.tsx` | Container com tabs (Inbox, Follow-up, Metricas) |
| `src/pages/FollowUpKanban.tsx` | Pagina Kanban de follow-up |
| `src/pages/OmnichannelMetrics.tsx` | Dashboard de metricas |
| `src/hooks/useAgentStatus.ts` | Hook de heartbeat e status online/offline |
| `src/hooks/useConversationTags.ts` | Hook para gerenciar tags |
| `src/hooks/useCannedResponses.ts` | Hook para respostas rapidas |
| `src/hooks/useOmnichannelMetrics.ts` | Hook para metricas |
| `src/components/omnichannel/ConversationList.tsx` | Lista de conversas reformulada |
| `src/components/omnichannel/MessageThread.tsx` | Thread de mensagens reformulada |
| `src/components/omnichannel/AgentPanel.tsx` | Painel de agentes (novo) |
| `src/components/omnichannel/PatientInfoPanel.tsx` | Sidebar de info do paciente (reformulada) |
| `src/components/omnichannel/TransferModal.tsx` | Modal de transferencia |
| `src/components/omnichannel/TagsManager.tsx` | Componente de tags |
| `src/components/omnichannel/CannedResponsePicker.tsx` | Autocomplete de respostas rapidas |
| `src/components/omnichannel/AgentStatusDropdown.tsx` | Dropdown de status do agente |
| `src/components/followup/KanbanBoard.tsx` | Board Kanban principal |
| `src/components/followup/KanbanColumn.tsx` | Coluna do Kanban |
| `src/components/followup/LeadCard.tsx` | Card de lead arrastavel |
| `src/components/followup/LostReasonModal.tsx` | Modal de motivo de perda |
| `src/components/followup/LeadDetailModal.tsx` | Modal de detalhe do lead |

### Arquivos Modificados

| Arquivo | Mudanca |
|---------|---------|
| `src/layouts/DashboardLayout.tsx` | Renomear "Atendimento" para "Omnichannel", adicionar sub-itens |
| `src/App.tsx` | Adicionar rotas para novas paginas |
| `src/pages/HumanInboxPage.tsx` | Refatorar para usar novos componentes, ou substituir por OmnichannelPage |
| `supabase/functions/process-inbox/index.ts` | Mudar handoff para fila humana apos triagem |
| `supabase/functions/_shared/clinicalAgent.ts` | Adicionar modo "lead_filter" que faz triagem rapida |

---

## 10. Ordem de Implementacao

### Sprint 1: Fundacao (1-2 semanas)
1. Migration SQL (tabelas, RPCs)
2. Hook useAgentStatus (heartbeat + status)
3. Container OmnichannelPage com tabs
4. Refatorar ConversationList com 3 tabs (Fila, Meus, Todos)
5. Implementar regra de visibilidade (ver tudo, enviar so no meu)

### Sprint 2: Core Inbox (1-2 semanas)
6. Transferencia entre agentes (TransferModal + RPC)
7. Tags nas conversas (TagsManager + hook)
8. Canned Responses com variaveis (CannedResponsePicker + hook)
9. Painel de agentes na conversa (AgentPanel)
10. Melhorar PatientInfoPanel com acoes rapidas

### Sprint 3: Follow-up Kanban (1-2 semanas)
11. FollowUpKanban page com colunas e DnD
12. LeadCard com informacoes resumidas
13. LostReasonModal ao arrastar para Perdido
14. Filtros e ordenacao no Kanban
15. Integracao: ao agendar, mover card automaticamente

### Sprint 4: Metricas + Polish (1 semana)
16. OmnichannelMetrics page
17. Auto-atribuicao (RPC + trigger)
18. Notificacoes de transferencia
19. Testes E2E
20. Ajustar AI Agent para modo triagem (lead_filter)
