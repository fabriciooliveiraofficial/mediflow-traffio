# Softphone Traffio — Análise de Viabilidade e Plano de Implementação
## Powered by Telnyx | Modelo: Google Voice Profissional

**Data:** 2026-06-04  
**Status:** Planejamento  
**Escopo:** Sistema completo de comunicação — voz, SMS, voicemail, gravação, múltiplos números, múltiplos atendentes

---

## 1. Análise de Viabilidade

### O que a Telnyx oferece que permite construir isso

A Telnyx é uma das poucas CPaaS com **backbone IP próprio** e oferece os 4 blocos necessários para um softphone profissional:

| Bloco | Produto Telnyx | Status |
|---|---|---|
| Ligações via navegador | **WebRTC SDK** (`@telnyx/webrtc`) | ✅ Disponível |
| Controle programático de chamadas | **Call Control API** | ✅ Disponível |
| Compra e gestão de números | **Number Management API** | ✅ Disponível (BR, US, CA, UK, MX, NZ) |
| SMS bidirecional | **Messaging API** | ✅ Disponível |
| Gravação de chamadas | **Recording API** (via Call Control) | ✅ Disponível |
| Voicemail | **TeXML** + storage | ✅ Disponível |
| IVR (menu de atendimento) | **Call Control webhooks** | ✅ Disponível |
| Fila de chamadas | **Call Queuing API** | ✅ Disponível |

### Verificação de viabilidade por país

| País | Compra de número | Voz | SMS | Sender ID |
|---|:---:|:---:|:---:|---|
| 🇧🇷 Brasil | ✅ | ✅ | ✅ | ⚠️ Sem branding (número) |
| 🇺🇸 EUA | ✅ | ✅ | ✅ | ❌ EUA não suporta |
| 🇨🇦 Canadá | ✅ | ✅ | ✅ | ❌ Não suportado |
| 🇬🇧 UK | ✅ | ✅ | ✅ | ✅ Sem cadastro |
| 🇲🇽 México | ✅ | ✅ | ✅ | ❌ Carrier sobrescreve |
| 🇳🇿 Nova Zelândia | ✅ | ✅ | ✅ | ❌ Carrier sobrescreve |

### Infraestrutura atual que EXISTE e ajuda

| O que já existe | Onde | Relevância |
|---|---|---|
| `conversation_sessions` com `channel` | banco de dados | Chamadas viram sessões com `channel='call'` |
| `omnichannel_status` enum | banco de dados | Adicionar `'in_call'` ao enum |
| `CloudApiClient` pattern | `_shared/cloudApiClient.ts` | Modelo para criar `TelnyxClient` |
| MediaRecorder API (gravação de voz no chat) | `HumanInboxPage.tsx` | Mesmo padrão para microfone no softphone |
| DashboardLayout com sidebar | `layouts/DashboardLayout.tsx` | Adicionar "Comunicações" na navegação |
| `assigned_to_user_id` em sessões | banco de dados | Atribuição de chamada ao atendente |

### Infraestrutura que NÃO EXISTE (construir do zero)

- Nenhuma integração WebRTC para voz
- Nenhuma tabela de histórico de chamadas (CDR)
- Nenhuma tabela de números de telefone por tenant
- Nenhum sistema de credenciais SIP por atendente
- Nenhuma página de comunicações

---

## 2. Arquitetura do Sistema

### Fluxo de Chamada Recebida

```
Paciente disca para número da clínica (+5511 4003-XXXX)
          ↓
Telnyx → POST /supabase/functions/telnyx-call-webhook
          ↓
Edge Function identifica tenant pelo número
          ↓
Verifica horário comercial (bot_config.business_hours)
          ↓
       ┌──────────────────────────────────┐
       │  Dentro do horário?              │
       └──────┬───────────────────────────┘
              │SIM                       │NÃO
              ↓                          ↓
   Busca agentes online           IVR: "Fora do horário"
   (Supabase Realtime presence)   → Voicemail
              ↓
   ┌──────────────────────────────┐
   │  Agente disponível?          │
   └─────┬────────────────────────┘
         │SIM                  │NÃO
         ↓                     ↓
  Toca no browser do     Fila de espera
  atendente (WebRTC)     → Música de espera
         ↓               → Após timeout: voicemail
  Atendente aceita
         ↓
  Chamada conectada
  Gravação inicia (se configurado)
         ↓
  Desliga → CDR salvo → Recording URL salva
```

### Fluxo de Chamada Saída

```
Atendente digita número no dialpad do browser
          ↓
Telnyx WebRTC SDK → POST Telnyx API "new call"
          ↓
PSTN → Toca no celular/fixo do destino
          ↓
Conectado → Gravação (se configurado)
```

### Fluxo de SMS Recebido (via número Telnyx)

```
Paciente envia SMS para número da clínica
          ↓
Telnyx → POST /supabase/functions/telnyx-sms-webhook
          ↓
Identifica tenant pelo número
          ↓
Cria/atualiza conversation_session (channel='sms')
          ↓
Aparece no CommunicationsHub (aba SMS)
Atendente responde → outbound_message_queue channel='sms'
```

### Modelo Multi-Tenant

```
Traffio (conta master Telnyx)
    │
    ├── Tenant A (Clínica X) 
    │     ├── Número: +55 11 4003-1111 (fixo)
    │     ├── Número: +55 11 9999-2222 (celular/WhatsApp)
    │     ├── Agente 1: login_token_agent1 (SIP credential)
    │     └── Agente 2: login_token_agent2
    │
    └── Tenant B (Clínica Y)
          ├── Número: +1-555-333-4444 (EUA)
          └── Agente 1: login_token_agent3
```

---

## 3. Funcionalidades — MVP vs Completo

### MVP (Fase 1–6) — ~8 semanas

- [x] Comprar e gerenciar números Telnyx por tenant
- [x] Fazer chamadas saintes pelo navegador (WebRTC)
- [x] Receber chamadas entrantes no navegador (WebRTC)
- [x] Controles básicos: mudo, desligar, colocar em espera
- [x] Gravação de chamadas (automática ou manual)
- [x] Histórico de chamadas (CDR) com player de gravação
- [x] SMS bidirecional (enviar e receber)
- [x] Voicemail (sem transcrição)
- [x] Página CommunicationsHub dedicada
- [x] Configurações: números e atendentes

### Versão Completa (Fase 7–9) — +6 semanas

- [ ] Transcrição de voicemail (Telnyx AI ou Whisper)
- [ ] IVR visual (menu "Tecle 1 para agendamento, 2 para financeiro")
- [ ] Ring groups (múltiplos atendentes por número)
- [ ] Transferência de chamada (fria e quente)
- [ ] Fila de chamadas com posição e música de espera
- [ ] Horário comercial automático por tenant
- [ ] Relatórios de chamadas (tempo médio, taxa de atendimento, etc.)
- [ ] Integração automática com pacientes (quando o número liga, abre o perfil)
- [ ] Click-to-call de dentro do perfil do paciente

---

## 4. Modelo de Dados — Novas Tabelas

### `tenant_phone_numbers` — Números por tenant
```sql
id UUID PK
tenant_id UUID FK tenants
phone_number TEXT UNIQUE          -- "+5511400311111" formato E.164
telnyx_number_id TEXT             -- ID interno Telnyx
friendly_name TEXT                -- "Recepção", "Financeiro"
country_code TEXT                 -- "BR", "US", etc.
capabilities JSONB                -- { voice: true, sms: true }
monthly_cost DECIMAL(10,4)        -- custo mensal em USD
is_active BOOLEAN DEFAULT true
routing_config JSONB              -- config de roteamento (IVR, ring group, etc.)
created_at TIMESTAMPTZ
```

### `call_records` — CDR (Call Detail Records)
```sql
id UUID PK
tenant_id UUID FK tenants
telnyx_call_control_id TEXT       -- ID da chamada na Telnyx
direction TEXT                    -- 'inbound' | 'outbound'
from_number TEXT
to_number TEXT
answered_by_user_id UUID FK       -- qual atendente atendeu
tenant_phone_number_id UUID FK    -- qual número do tenant foi usado
status TEXT                       -- 'completed' | 'missed' | 'voicemail' | 'failed'
duration_seconds INTEGER
recording_url TEXT                -- URL do arquivo de gravação (Telnyx storage)
recording_duration_seconds INTEGER
call_notes TEXT                   -- notas do atendente
patient_id UUID FK patients       -- se identificado
started_at TIMESTAMPTZ
answered_at TIMESTAMPTZ
ended_at TIMESTAMPTZ
created_at TIMESTAMPTZ
```

### `voicemails` — Caixa de voicemail
```sql
id UUID PK
tenant_id UUID FK tenants
tenant_phone_number_id UUID FK
telnyx_call_control_id TEXT
from_number TEXT
recording_url TEXT
duration_seconds INTEGER
transcript TEXT                   -- NULL até ser transcrito
is_read BOOLEAN DEFAULT false
is_deleted BOOLEAN DEFAULT false
patient_id UUID FK patients
created_at TIMESTAMPTZ
```

### `agent_telnyx_credentials` — Credenciais WebRTC por atendente
```sql
id UUID PK
tenant_id UUID FK tenants
user_id UUID FK auth.users
telnyx_sip_username TEXT          -- gerado pela API Telnyx
telnyx_sip_password TEXT          -- gerado pela API Telnyx (armazenar criptografado)
telnyx_credential_id TEXT         -- ID do recurso na Telnyx
is_active BOOLEAN DEFAULT true
last_registered_at TIMESTAMPTZ    -- última vez que o browser se conectou
created_at TIMESTAMPTZ
UNIQUE(tenant_id, user_id)
```

### `call_routing_rules` — Regras de roteamento por número
```sql
id UUID PK
tenant_id UUID FK tenants
tenant_phone_number_id UUID FK
rule_name TEXT
rule_type TEXT                    -- 'ring_group' | 'ivr' | 'voicemail' | 'forward'
ring_timeout_seconds INTEGER DEFAULT 30
ring_strategy TEXT                -- 'simultaneous' | 'round_robin' | 'sequential'
agent_user_ids UUID[]             -- array de atendentes no ring group
ivr_config JSONB                  -- menu IVR (árvore de opções)
forward_to TEXT                   -- número externo para encaminhar
business_hours JSONB              -- { mon: "08:00-18:00", ... }
after_hours_action TEXT           -- 'voicemail' | 'forward' | 'ivr'
is_active BOOLEAN DEFAULT true
created_at TIMESTAMPTZ
```

---

## 5. APIs Telnyx Necessárias

### Number Management
```
GET  /v2/available_phone_numbers?filter[country_code]=BR
     &filter[features][]=voice&filter[features][]=sms
     → Lista números disponíveis para compra

POST /v2/phone_numbers
     { "phone_number": "+5511400311111" }
     → Compra o número

PATCH /v2/phone_numbers/{id}
     { "connection_id": "webhook_connection_id" }
     → Associa número ao webhook de call control

DELETE /v2/phone_numbers/{id}
     → Libera o número
```

### SIP Credentials (por atendente)
```
POST /v2/telephony_credentials
     { "name": "Agent João - Clínica X" }
     → Cria credencial SIP. Retorna username + password

GET  /v2/telephony_credentials/{id}/token
     → Gera login_token para o WebRTC SDK do browser
     (token de curta duração, renovar a cada 1h)

DELETE /v2/telephony_credentials/{id}
     → Remove acesso do atendente
```

### Call Control (webhook-driven)
```
Webhook recebe: call.initiated (chamada chegando)
POST /v2/calls/{call_control_id}/actions/answer → atende
POST /v2/calls/{call_control_id}/actions/bridge → conecta dois legs
POST /v2/calls/{call_control_id}/actions/hold   → coloca em espera
POST /v2/calls/{call_control_id}/actions/unhold → retira da espera
POST /v2/calls/{call_control_id}/actions/record_start → inicia gravação
POST /v2/calls/{call_control_id}/actions/record_stop  → para gravação
POST /v2/calls/{call_control_id}/actions/transfer → transfere
POST /v2/calls/{call_control_id}/actions/hangup → desliga
POST /v2/calls/{call_control_id}/actions/speak  → text-to-speech (IVR)
POST /v2/calls/{call_control_id}/actions/gather → coleta DTMF (IVR)

Webhook recebe: call.recording.saved → { recording_url, duration }
Webhook recebe: call.hangup → { duration, answered_by }
```

### Mensagens SMS
```
POST /v2/messages
     { "from": "+5511400311111", "to": "+5511999999999", 
       "text": "Olá! Sua consulta..." }

Webhook recebe: message.received → inbound SMS
```

---

## 6. Componentes Frontend

### Softphone Widget (sempre visível)
```
┌────────────────────────────────────┐
│  📞 COMUNICAÇÕES    [Disponível ▼] │
├────────────────────────────────────┤
│  Número ativo: (11) 4003-1111  [▼] │
├────────────────────────────────────┤
│                                    │
│          [ 1 ][ 2 ][ 3 ]           │
│          [ 4 ][ 5 ][ 6 ]           │
│          [ 7 ][ 8 ][ 9 ]           │
│          [ * ][ 0 ][ # ]           │
│                                    │
│  [___(11)99999-9999__________]     │
│                                    │
│        [  🟢 LIGAR  ]              │
└────────────────────────────────────┘
```

### Active Call View
```
┌────────────────────────────────────┐
│  📞 EM CHAMADA                     │
│  Ana Silva  (+55 11 9 9999-1234)   │
│  ⏱ 00:02:34                        │
├────────────────────────────────────┤
│                                    │
│  [ 🎙 MUDO ] [ ⏸ ESPERA ] [ ↗ ]   │
│              [TRANSFERIR]          │
│                                    │
│  [    ☎ DESLIGAR (vermelho)   ]    │
└────────────────────────────────────┘
```

### Incoming Call Notification (overlay)
```
┌─────────────────────────────────┐
│  📲 CHAMADA RECEBIDA            │
│                                 │
│  ☎  (11) 9 8765-4321           │
│  Ana Silva (Paciente)           │
│  Última visita: 15/05/2026      │
│                                 │
│  [ ✅ ATENDER ]  [ ❌ RECUSAR ] │
└─────────────────────────────────┘
```

### CommunicationsHub Page (layout completo)
```
┌──────────────────────────────────────────────────────────────────┐
│  COMUNICAÇÕES                          [Número: (11) 4003-1111 ▼]│
├──────────┬───────────────────────────────────────────────────────┤
│  TABS:   │                                                        │
│  📞Calls  │  HISTÓRICO DE CHAMADAS                               │
│  💬 SMS   │  ┌─────────────────────────────────────────────────┐ │
│  📣 VM    │  │ ↙ Ana Silva · (11)99999-1234 · 3min · 10:30    │ │
│  📊 Stats │  │ ↗ Saída       · (11)98888-5678 · 1min · 09:15  │ │
│           │  │ ↙ João Souza  · (11)97777-9012 · VM  · 08:45   │ │
│           │  │ ↗ Saída       · (11)96666-3456 · 5min · Ontem  │ │
│           │  └─────────────────────────────────────────────────┘ │
│           │                                                        │
│  SOFTPHONE│  DETALHES DA CHAMADA                                 │
│  ────────  │  ┌─────────────────────────────────────────────────┐ │
│ [1][2][3] │  │ Ana Silva                                        │ │
│ [4][5][6] │  │ 3 minutos · Atendida por: João                  │ │
│ [7][8][9] │  │                                                   │ │
│ [*][0][#] │  │ 🎙 GRAVAÇÃO                                      │ │
│           │  │ ▶ ──────────────────── 3:12                     │ │
│ [LIGAR]   │  │ [⬇ Download]                                     │ │
│           │  │                                                   │ │
│           │  │ 📝 NOTAS DA CHAMADA                              │ │
│           │  │ [_____________________________]                   │ │
│           │  └─────────────────────────────────────────────────┘ │
└──────────┴───────────────────────────────────────────────────────┘
```

---

## TASKLIST EXECUTÁVEL — IMPLEMENTAÇÃO COMPLETA

### FASE 0 — Fundação Telnyx (Configuração de Conta)

- [ ] **TASK 0.1** — Criar conta Telnyx e obter API Key
- [ ] **TASK 0.2** — Criar Webhook Connection no portal Telnyx (URL: `[supabase_url]/functions/v1/telnyx-call-webhook`)
- [ ] **TASK 0.3** — Criar Application no portal Telnyx e associar ao webhook
- [ ] **TASK 0.4** — Salvar `TELNYX_API_KEY` e `TELNYX_APP_ID` como Supabase Secrets
- [ ] **TASK 0.5** — Testar conectividade da API Telnyx (buscar números disponíveis no Brasil)

### FASE 1 — Database (SQL Editor do Supabase)

- [ ] **TASK 1.1** — Executar Script SQL 1: criar tabelas (`tenant_phone_numbers`, `call_records`, `voicemails`, `agent_telnyx_credentials`, `call_routing_rules`)
- [ ] **TASK 1.2** — Executar Script SQL 2: adicionar campos Telnyx à tabela `tenants`
- [ ] **TASK 1.3** — Executar Script SQL 3: adicionar `channel='call'` ao enum e campos de chamada em `conversation_sessions`
- [ ] **TASK 1.4** — Executar Script SQL 4: criar RLS policies para novas tabelas
- [ ] **TASK 1.5** — Verificar estrutura das tabelas criadas

### FASE 2 — Backend: TelnyxClient Shared

- [ ] **TASK 2.1** — Criar `supabase/functions/_shared/telnyxClient.ts`
  - Método: `searchNumbers(countryCode, features)` → lista números disponíveis
  - Método: `purchaseNumber(phoneNumber)` → compra número
  - Método: `releaseNumber(numberid)` → libera número
  - Método: `createSipCredential(name)` → cria credencial SIP para atendente
  - Método: `getLoginToken(credentialId)` → token temporário WebRTC
  - Método: `revokeSipCredential(credentialId)` → revoga acesso
  - Método: `sendSms(from, to, text)` → envia SMS
  - Método: `answerCall(callControlId, clientState?)` → atende chamada
  - Método: `bridgeCalls(callControlId, targetCallControlId)` → conecta dois legs
  - Método: `holdCall(callControlId)` / `unholdCall()` → espera
  - Método: `transferCall(callControlId, to)` → transfere
  - Método: `hangupCall(callControlId)` → desliga
  - Método: `startRecording(callControlId)` → inicia gravação
  - Método: `stopRecording(callControlId)` → para gravação
  - Método: `speak(callControlId, text)` → TTS para IVR
  - Método: `gather(callControlId, options)` → coleta DTMF

### FASE 3 — Backend: Edge Functions de Chamadas

- [ ] **TASK 3.1** — Criar Edge Function `telnyx-call-webhook/index.ts`
  - Handler para `call.initiated` (chamada recebida)
  - Identifica tenant pelo número destino
  - Verifica horário comercial
  - Busca agentes disponíveis (Supabase Realtime presence)
  - Toca para o atendente via WebRTC
  - Fallback: voicemail se ninguém atender em N segundos
  - Handler para `call.answered`
  - Handler para `call.hangup` → salva CDR em `call_records`
  - Handler para `call.recording.saved` → salva URL em `call_records`

- [ ] **TASK 3.2** — Criar Edge Function `telnyx-sms-webhook/index.ts`
  - Handler para `message.received`
  - Cria/atualiza `conversation_session` com `channel='sms'`
  - Salva mensagem em `conversation_messages`
  - Notifica atendentes via Supabase Realtime

- [ ] **TASK 3.3** — Criar Edge Function `telnyx-numbers/index.ts`
  - `GET /search?country=BR` → busca números disponíveis
  - `POST /purchase` → compra número para tenant
  - `PATCH /:id` → atualiza configuração do número
  - `DELETE /:id` → libera número

- [ ] **TASK 3.4** — Criar Edge Function `telnyx-agent-credentials/index.ts`
  - `POST /create` → cria credencial SIP para membro do tenant
  - `GET /token` → gera login_token (renovável a cada 1h)
  - `DELETE /:id` → revoga credencial

### FASE 4 — Backend: Edge Function de SMS (integração com fila existente)

- [ ] **TASK 4.1** — Atualizar `process-outbound` para rotear SMS via Telnyx quando `notification_channel='sms'` e `tenant.sms_provider='telnyx'`
- [ ] **TASK 4.2** — Atualizar `schedule-reminders` para popular `notification_channel` nos lembretes

### FASE 5 — Frontend: Softphone Widget

- [ ] **TASK 5.1** — Instalar `@telnyx/webrtc` no projeto
- [ ] **TASK 5.2** — Criar hook `useTelnyxWebRTC(loginToken)`:
  - Conecta ao servidor Telnyx
  - Gerencia estado: `idle | calling | ringing | in_call | on_hold`
  - Expõe: `call(number)`, `answer()`, `hangup()`, `mute()`, `hold()`, `transfer(number)`
  - Eventos: `onIncomingCall`, `onCallAnswered`, `onCallEnded`
  - Auto-renova loginToken antes de expirar (1h)
- [ ] **TASK 5.3** — Criar componente `SoftphoneWidget.tsx` (widget flutuante, sempre visível)
  - Dialpad numérico
  - Input de número com autocompletar de pacientes
  - Seletor de número ativo (qual número do tenant usar)
  - Status do agente (disponível / ocupado / ausente)
- [ ] **TASK 5.4** — Criar componente `ActiveCallView.tsx` (durante chamada)
  - Timer de duração
  - Botões: Mudo, Espera, Transferir, Desligar
  - Display de quem está na chamada (nome do paciente se identificado)
- [ ] **TASK 5.5** — Criar componente `IncomingCallNotification.tsx` (overlay)
  - Mostra número + nome do paciente (se identificado)
  - Botões: Atender / Recusar
  - Toca som de chamada (audio loop)
  - Abre automaticamente o perfil do paciente ao atender
- [ ] **TASK 5.6** — Integrar `SoftphoneWidget` no `DashboardLayout.tsx` (sempre presente quando tenant tem Telnyx ativo)

### FASE 6 — Frontend: CommunicationsHub Page

- [ ] **TASK 6.1** — Criar página `src/pages/CommunicationsHub.tsx`
- [ ] **TASK 6.2** — Criar aba **Chamadas** com componente `CallHistoryList`:
  - Lista CDR com ícones de entrada/saída/perdida/voicemail
  - Duração, horário, nome do paciente (se identificado)
  - Badge de gravação disponível
  - Filtros: data, atendente, número, tipo
- [ ] **TASK 6.3** — Criar componente `CallDetailPanel`:
  - Player de gravação de áudio (reutilizar AudioPlayer do HumanInboxPage)
  - Download da gravação
  - Campo de notas da chamada (editável)
  - Link para perfil do paciente
  - Botão "Retornar chamada"
- [ ] **TASK 6.4** — Criar aba **SMS** com lista de threads por número
  - Reutilizar padrão do HumanInboxPage
  - Diferencial: filtra por número do tenant
- [ ] **TASK 6.5** — Criar aba **Voicemail** com lista de gravações
  - Player de áudio
  - Marcador de lido/não lido
  - Botão "Retornar chamada"
  - Transcrição (quando disponível)
- [ ] **TASK 6.6** — Criar aba **Analytics** de comunicação:
  - Chamadas hoje / semana / mês
  - Taxa de atendimento (%)
  - Tempo médio de chamada
  - Chamadas por atendente
  - SMS enviados vs recebidos
- [ ] **TASK 6.7** — Adicionar "Comunicações" na sidebar `DashboardLayout.tsx`

### FASE 7 — Frontend: Configurações de Comunicação

- [ ] **TASK 7.1** — Criar seção "Comunicações" em `Settings.tsx`
- [ ] **TASK 7.2** — Criar aba **Números**:
  - Lista números ativos do tenant (nome amigável, país, capacidades, custo)
  - Botão "Comprar Número" → modal de busca por país/cidade
  - Configurar número (nome, routing, IVR)
  - Liberar número
- [ ] **TASK 7.3** — Criar aba **Atendentes**:
  - Lista membros com status Telnyx ativo/inativo
  - Botão "Ativar Comunicações" por membro → cria credencial SIP
  - Revogar acesso
  - Atribuir a números específicos
- [ ] **TASK 7.4** — Criar aba **Roteamento**:
  - Para cada número: configurar ring group (quais atendentes)
  - Estratégia: simultâneo / round-robin / sequencial
  - Timeout até ir para voicemail (segundos)
  - Horário comercial (por dia da semana)
  - Ação fora do horário (voicemail / mensagem IVR / encaminhar)
- [ ] **TASK 7.5** — Criar aba **Gravação**:
  - Toggle: gravar todas as chamadas automaticamente
  - Aviso legal (opcional, reproduzir para quem liga)
  - Retenção: 30 / 60 / 90 / 180 dias

### FASE 8 — Integrações com módulos existentes

- [ ] **TASK 8.1** — Click-to-call no perfil do paciente (`PatientDetails.tsx`)
  - Botão "📞 Ligar" ao lado do telefone do paciente
  - Usa SoftphoneWidget para iniciar chamada
- [ ] **TASK 8.2** — Identificação automática de chamadas recebidas
  - Ao receber chamada, buscar paciente pelo número
  - Se encontrado: mostrar nome no `IncomingCallNotification`
  - Se atendida: abrir perfil do paciente no painel lateral
- [ ] **TASK 8.3** — Integrar gravações com histórico do paciente
  - Em `PatientDetails.tsx`, aba de histórico de chamadas
- [ ] **TASK 8.4** — Integrar canal SMS do Telnyx com automações (No-Show + NPS)
  - `outbound_message_queue` com `notification_channel='sms'` usa TelnyxClient

---

## SCRIPTS SQL DE IMPLEMENTAÇÃO

### Script 1 — Tabelas principais do Softphone

```sql
-- EXECUTAR NO SQL EDITOR DO SUPABASE
-- Script 1: Tabelas do sistema Softphone Telnyx

-- ================================================================
-- 1. NÚMEROS DE TELEFONE POR TENANT
-- ================================================================
CREATE TABLE IF NOT EXISTS tenant_phone_numbers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number          TEXT NOT NULL,       -- "+5511400311111" formato E.164
  telnyx_number_id      TEXT NOT NULL,       -- ID interno Telnyx
  friendly_name         TEXT,               -- "Recepção", "Financeiro"
  country_code          TEXT NOT NULL,       -- "BR", "US", "GB", etc.
  capabilities          JSONB NOT NULL DEFAULT '{"voice": true, "sms": true}',
  monthly_cost_usd      DECIMAL(10,4),       -- custo mensal em USD
  is_active             BOOLEAN NOT NULL DEFAULT true,
  routing_config        JSONB DEFAULT '{}',  -- config de roteamento
  purchased_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(phone_number),
  UNIQUE(telnyx_number_id)
);

CREATE INDEX IF NOT EXISTS idx_tpn_tenant_active
  ON tenant_phone_numbers(tenant_id, is_active);

-- ================================================================
-- 2. HISTÓRICO DE CHAMADAS (CDR)
-- ================================================================
CREATE TABLE IF NOT EXISTS call_records (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  telnyx_call_control_id        TEXT,
  telnyx_call_leg_id            TEXT,
  direction                     TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_number                   TEXT NOT NULL,
  to_number                     TEXT NOT NULL,
  answered_by_user_id           UUID REFERENCES auth.users(id),
  tenant_phone_number_id        UUID REFERENCES tenant_phone_numbers(id),
  status                        TEXT NOT NULL DEFAULT 'initiated'
                                CHECK (status IN ('initiated', 'ringing', 'answered', 'completed', 'missed', 'voicemail', 'failed', 'busy', 'no_answer')),
  duration_seconds              INTEGER,
  recording_url                 TEXT,
  recording_duration_seconds    INTEGER,
  recording_expires_at          TIMESTAMPTZ,
  call_notes                    TEXT,
  patient_id                    UUID REFERENCES patients(id),
  started_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at                   TIMESTAMPTZ,
  ended_at                      TIMESTAMPTZ,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cr_tenant_started
  ON call_records(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cr_from_number
  ON call_records(tenant_id, from_number);
CREATE INDEX IF NOT EXISTS idx_cr_patient
  ON call_records(tenant_id, patient_id)
  WHERE patient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cr_status
  ON call_records(tenant_id, status)
  WHERE status IN ('missed', 'voicemail');

-- ================================================================
-- 3. VOICEMAILS
-- ================================================================
CREATE TABLE IF NOT EXISTS voicemails (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_phone_number_id  UUID REFERENCES tenant_phone_numbers(id),
  call_record_id          UUID REFERENCES call_records(id),
  from_number             TEXT NOT NULL,
  recording_url           TEXT NOT NULL,
  duration_seconds        INTEGER,
  transcript              TEXT,             -- NULL até ser transcrito
  is_read                 BOOLEAN NOT NULL DEFAULT false,
  is_deleted              BOOLEAN NOT NULL DEFAULT false,
  patient_id              UUID REFERENCES patients(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vm_tenant_unread
  ON voicemails(tenant_id, is_read, is_deleted)
  WHERE is_deleted = false;

-- ================================================================
-- 4. CREDENCIAIS SIP POR ATENDENTE (WebRTC)
-- ================================================================
CREATE TABLE IF NOT EXISTS agent_telnyx_credentials (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  telnyx_credential_id    TEXT NOT NULL UNIQUE,
  telnyx_sip_username     TEXT NOT NULL,
  telnyx_sip_password     TEXT NOT NULL,   -- armazenar criptografado (vault)
  is_active               BOOLEAN NOT NULL DEFAULT true,
  last_registered_at      TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_atc_tenant_active
  ON agent_telnyx_credentials(tenant_id, is_active)
  WHERE is_active = true;

-- ================================================================
-- 5. REGRAS DE ROTEAMENTO POR NÚMERO
-- ================================================================
CREATE TABLE IF NOT EXISTS call_routing_rules (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_phone_number_id    UUID NOT NULL REFERENCES tenant_phone_numbers(id) ON DELETE CASCADE,
  rule_name                 TEXT NOT NULL DEFAULT 'Default',
  rule_type                 TEXT NOT NULL DEFAULT 'ring_group'
                            CHECK (rule_type IN ('ring_group', 'ivr', 'voicemail', 'forward', 'bot')),
  ring_timeout_seconds      INTEGER NOT NULL DEFAULT 30,
  ring_strategy             TEXT NOT NULL DEFAULT 'simultaneous'
                            CHECK (ring_strategy IN ('simultaneous', 'round_robin', 'sequential')),
  agent_user_ids            UUID[] NOT NULL DEFAULT '{}',
  ivr_config                JSONB DEFAULT '{}',
  forward_to                TEXT,           -- número externo para encaminhar
  business_hours            JSONB DEFAULT '{
    "mon": "08:00-18:00", "tue": "08:00-18:00", "wed": "08:00-18:00",
    "thu": "08:00-18:00", "fri": "08:00-18:00", "sat": null, "sun": null
  }',
  timezone                  TEXT DEFAULT 'America/Sao_Paulo',
  after_hours_action        TEXT NOT NULL DEFAULT 'voicemail'
                            CHECK (after_hours_action IN ('voicemail', 'forward', 'ivr', 'message')),
  after_hours_message       TEXT DEFAULT 'Obrigado por ligar. Estamos fora do horário de atendimento. Por favor, deixe sua mensagem.',
  auto_record               BOOLEAN NOT NULL DEFAULT true,
  is_active                 BOOLEAN NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_phone_number_id)
);

-- ================================================================
-- 6. RLS POLICIES
-- ================================================================
ALTER TABLE tenant_phone_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE voicemails ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_telnyx_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_routing_rules ENABLE ROW LEVEL SECURITY;

-- tenant_phone_numbers
CREATE POLICY "tpn_tenant_isolation" ON tenant_phone_numbers
  USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

-- call_records
CREATE POLICY "cr_tenant_isolation" ON call_records
  USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

-- voicemails
CREATE POLICY "vm_tenant_isolation" ON voicemails
  USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

-- agent_telnyx_credentials (só o próprio usuário ou admin vê)
CREATE POLICY "atc_owner_or_admin" ON agent_telnyx_credentials
  USING (
    tenant_id = (auth.jwt()->>'tenant_id')::uuid
    AND (
      user_id = auth.uid()
      OR (auth.jwt()->'app_metadata'->>'role') IN ('admin', 'owner')
    )
  );

-- call_routing_rules
CREATE POLICY "crr_tenant_isolation" ON call_routing_rules
  USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);
```

---

### Script 2 — Campos Telnyx na tabela `tenants`

```sql
-- EXECUTAR NO SQL EDITOR DO SUPABASE
-- Script 2: Adicionar campos Telnyx à tabela tenants

-- API Key da Telnyx para este tenant (ou da conta master Traffio)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS telnyx_api_key TEXT,
  ADD COLUMN IF NOT EXISTS telnyx_app_id TEXT,           -- Application ID da Telnyx
  ADD COLUMN IF NOT EXISTS telnyx_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS telnyx_auto_record BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS telnyx_recording_retention_days INTEGER DEFAULT 90,
  ADD COLUMN IF NOT EXISTS sms_provider TEXT DEFAULT 'telnyx'
    CHECK (sms_provider IN ('telnyx', 'twilio', 'zenvia')),
  ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN tenants.telnyx_api_key IS 
  'Chave API Telnyx do tenant (ou NULL para usar a chave master da Traffio)';
COMMENT ON COLUMN tenants.telnyx_app_id IS 
  'ID do Application Telnyx com webhook de Call Control configurado';

-- Verificar
SELECT id, name, telnyx_enabled, sms_provider, sms_enabled
FROM tenants
ORDER BY name;
```

---

### Script 3 — Adicionar chamada como canal em `conversation_sessions`

```sql
-- EXECUTAR NO SQL EDITOR DO SUPABASE
-- Script 3: Suporte a chamadas no modelo de conversas

-- Adicionar 'call' como canal válido (se a coluna for TEXT com CHECK)
-- Se for um ENUM, precisamos adicionar o valor ao enum primeiro

-- Verificar o tipo atual da coluna channel
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_name = 'conversation_sessions' AND column_name = 'channel';

-- Se for TEXT com constraint, atualizar a constraint (ajustar se necessário):
ALTER TABLE conversation_sessions
  DROP CONSTRAINT IF EXISTS conversation_sessions_channel_check;

ALTER TABLE conversation_sessions
  ADD CONSTRAINT conversation_sessions_channel_check
    CHECK (channel IN ('whatsapp', 'instagram', 'facebook', 'livechat', 'sms', 'call'));

-- Campos específicos de chamada em conversation_sessions
ALTER TABLE conversation_sessions
  ADD COLUMN IF NOT EXISTS call_record_id UUID REFERENCES call_records(id),
  ADD COLUMN IF NOT EXISTS active_call_control_id TEXT;  -- ID do leg ativo (para controle em tempo real)

-- Índice para buscar sessões com chamadas ativas
CREATE INDEX IF NOT EXISTS idx_cs_active_call
  ON conversation_sessions(tenant_id, active_call_control_id)
  WHERE active_call_control_id IS NOT NULL;

-- Verificar
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'conversation_sessions'
  AND column_name IN ('channel', 'call_record_id', 'active_call_control_id');
```

---

### Script 4 — Verificação completa

```sql
-- EXECUTAR NO SQL EDITOR DO SUPABASE
-- Script 4: Verificar toda a estrutura criada

SELECT 
  t.table_name,
  COUNT(c.column_name) as total_columns
FROM information_schema.tables t
JOIN information_schema.columns c ON c.table_name = t.table_name
WHERE t.table_name IN (
  'tenant_phone_numbers', 
  'call_records', 
  'voicemails', 
  'agent_telnyx_credentials', 
  'call_routing_rules'
)
GROUP BY t.table_name
ORDER BY t.table_name;

-- Verificar RLS habilitado
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename IN (
  'tenant_phone_numbers', 
  'call_records', 
  'voicemails', 
  'agent_telnyx_credentials', 
  'call_routing_rules'
);

-- Verificar políticas
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN (
  'tenant_phone_numbers', 
  'call_records', 
  'voicemails', 
  'agent_telnyx_credentials', 
  'call_routing_rules'
)
ORDER BY tablename;

-- Verificar campos Telnyx em tenants
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'tenants'
  AND column_name LIKE 'telnyx%' OR column_name LIKE 'sms_%'
ORDER BY column_name;
```

---

## Modelo de Negócio / Monetização

### Como cobrar pelo Softphone

```
Traffio paga à Telnyx:
  Número BR: ~$3,50/mês
  Chamada recebida: ~$0,002/min (BR)
  Chamada sainte: ~$0,014/min (BR)
  SMS enviado: ~$0,04/mensagem (BR)

Traffio cobra do tenant (sugestão de markup):
  Número BR: R$25/mês (margem ~60%)
  Chamada recebida: R$0,06/min
  Chamada sainte: R$0,12/min
  SMS enviado: R$0,20/mensagem

Ou: Plano flat com bundle de minutos:
  "Plano Comunicações Starter": R$149/mês
    → 1 número + 500 min/mês + 100 SMS
  "Plano Comunicações Pro": R$349/mês
    → 3 números + 2.000 min/mês + 500 SMS + gravação 90 dias
  "Plano Comunicações Enterprise": R$749/mês
    → 10 números + minutos ilimitados + SMS ilimitado + gravação 1 ano
```

---

## Estimativa de Prazo

| Fase | Conteúdo | Estimativa |
|---|---|---|
| 0 | Conta Telnyx + configuração | 1 dia |
| 1 | Database | 2 dias |
| 2 | TelnyxClient shared | 3 dias |
| 3 | Edge Functions (call + sms webhooks) | 1 semana |
| 4 | Integração SMS com fila existente | 2 dias |
| 5 | Softphone Widget (WebRTC) | 2 semanas |
| 6 | CommunicationsHub Page | 1,5 semana |
| 7 | Settings de Comunicação | 1 semana |
| 8 | Integrações (click-to-call, identificação) | 1 semana |
| **MVP Total** | **Fases 0–6** | **~6–7 semanas** |
| **Completo** | **Fases 0–9** | **~10–12 semanas** |

---

**Próximo passo:** Executar os Scripts SQL 1 a 4 no SQL Editor do Supabase para criar a fundação do banco de dados. Depois, avançar para a criação da conta Telnyx (TASK 0.1–0.5).
