# PLANO MASTER — Sistema de Comunicações Traffio
## Consolidação: Multi-Canal + Softphone + Instagram DM + Facebook Messenger

**Data:** 2026-06-04  
**Status:** Planejamento consolidado  
**Documentos filhos:**
- `PLANO_MULTI_CANAL_AUTOMACOES.md` — No-Show + NPS multi-canal
- `PLANO_SOFTPHONE_TELNYX.md` — Softphone (voz + SMS via Telnyx)
- `ANALISE_SMS_TWILIO_VS_TELNYX.md` — Análise de provedores (decisão: Telnyx)

---

## Diagnóstico: O que foi encontrado de inconsistente

| Problema | Impacto | Corrigido aqui? |
|---|---|---|
| `PLANO_MULTI_CANAL_AUTOMACOES.md` refere "Zenvia/Twilio" para SMS | SMS vai usar Telnyx | ✅ |
| TASK 3.2/3.3 (Instagram DM + Facebook Messenger) sem detalhes de implementação | Tasks vazias, não executáveis | ✅ |
| `auth-meta` existente é para **Ads** (scopes: ads_management) — NÃO para mensagens | Sem Page Access Token para envio de DMs | ✅ |
| Nenhum plano consolidado com ordem de execução dos dois sistemas | Risco de conflito entre as fases | ✅ |

---

## Arquitetura Geral — Visão Completa

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TRAFFIO PLATAFORMA                           │
│                                                                     │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐   │
│  │  AUTOMAÇÕES          │    │  COMUNICAÇÕES (Softphone)        │   │
│  │  No-Show + NPS       │    │  Voz + SMS + Números             │   │
│  │                      │    │                                  │   │
│  │  WhatsApp → Z-API    │    │  Voz → Telnyx WebRTC             │   │
│  │  Instagram → Meta    │    │  SMS → Telnyx Messaging          │   │
│  │  Facebook → Meta     │    │  Números → Telnyx Numbers API    │   │
│  │  SMS → Telnyx        │    │  Gravação → Telnyx Recording     │   │
│  └──────────┬───────────┘    └──────────────┬───────────────────┘   │
│             │                               │                       │
│             └───────────┬───────────────────┘                       │
│                         ▼                                           │
│              outbound_message_queue                                 │
│              patient_channel_preferences                            │
│              conversation_sessions                                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Diferença Crítica: Meta Ads vs Meta Messaging

> **ATENÇÃO:** Este é o erro mais importante identificado na análise.

A função `auth-meta` existente faz OAuth para **Meta Ads** com escopo `ads_management`. Isso **não permite** enviar mensagens pelo Instagram DM ou Facebook Messenger.

Para mensagens, precisamos de um **segundo fluxo OAuth completamente separado**:

| | auth-meta atual (Ads) | auth-meta-messaging (NOVO) |
|---|---|---|
| **Finalidade** | Ads Manager, relatórios de campanha | Enviar DMs, receber DMs |
| **Scopes** | `ads_management, ads_read` | `pages_messaging, instagram_manage_messages, pages_read_engagement, pages_manage_metadata` |
| **Token obtido** | Long-lived User Token | Page Access Token (por página) |
| **Onde salva** | `ad_integrations.access_token` | `tenant_meta_pages.page_access_token` (NOVA tabela) |
| **Endpoint de envio** | N/A | `POST /{page_id}/messages` (Facebook) |
| **Endpoint Instagram** | N/A | `POST /{instagram_account_id}/messages` |
| **Receptor identificado por** | N/A | PSID (FB) ou IGSID (IG) — capturado do webhook |

---

## Como funciona o envio de DM via Meta Graph API

### Facebook Messenger
```
Paciente manda mensagem via Facebook Messenger
        ↓
Webhook recebe: { sender: { id: "PSID_123" }, message: { text: "..." } }
PSID = Page-Scoped User ID (identificador único deste usuário para esta página)
        ↓
Salvar PSID em patient_channel_preferences.facebook_user_id
        ↓
Para enviar de volta:
POST https://graph.facebook.com/v21.0/me/messages
  ?access_token={page_access_token}
Body: {
  "recipient": { "id": "PSID_123" },
  "message": { "text": "Olá! Sua consulta está confirmada para amanhã..." }
}
```

### Instagram DM
```
Paciente manda DM pelo Instagram
        ↓
Webhook recebe: { sender: { id: "IGSID_456" }, message: { text: "..." } }
IGSID = Instagram-Scoped User ID
        ↓
Salvar IGSID em patient_channel_preferences.instagram_user_id
        ↓
Para enviar de volta:
POST https://graph.facebook.com/v21.0/{instagram_account_id}/messages
  ?access_token={page_access_token}
Body: {
  "recipient": { "id": "IGSID_456" },
  "message": { "text": "Olá! Sua consulta está confirmada para amanhã..." }
}
```

> **Nota:** Instagram DM usa o mesmo endpoint do Messenger mas passando o `instagram_account_id` em vez do `page_id`. O token de acesso é o mesmo — o Page Access Token da página do Facebook conectada à conta Instagram Business.

---

## TASKLIST MASTER — Ordem de Execução

### ═══ BLOCO A: FUNDAÇÃO DE BANCO (fazer primeiro — os dois sistemas dependem disso) ═══

- [ ] **A.1** — SQL: criar `patient_channel_preferences`  
  *(Script 1.1 do PLANO_MULTI_CANAL_AUTOMACOES)*
- [ ] **A.2** — SQL: adicionar `notification_channel` + `channel_recipient_id` em `outbound_message_queue`  
  *(Script 1.2 do PLANO_MULTI_CANAL_AUTOMACOES)*
- [ ] **A.3** — SQL: adicionar `platform_user_id` em `conversation_sessions`  
  *(Script 1.3 do PLANO_MULTI_CANAL_AUTOMACOES)*
- [ ] **A.4** — SQL: criar tabela `tenant_meta_pages` (NOVA — Page tokens para mensagens)  
  *(Script A.4 abaixo — NÃO existe em nenhum plano anterior)*
- [ ] **A.5** — SQL: criar tabelas do Softphone (`tenant_phone_numbers`, `call_records`, `voicemails`, `agent_telnyx_credentials`, `call_routing_rules`)  
  *(Script 1 do PLANO_SOFTPHONE_TELNYX)*
- [ ] **A.6** — SQL: adicionar campos Telnyx em `tenants` (`telnyx_api_key`, `telnyx_enabled`, `sms_provider`, `sms_enabled`)  
  *(Script 2 do PLANO_SOFTPHONE_TELNYX)*
- [ ] **A.7** — SQL: adicionar `channel='call'` e `channel='sms'` ao check de `conversation_sessions`  
  *(Script 3 do PLANO_SOFTPHONE_TELNYX — atualizado para incluir 'sms')*
- [ ] **A.8** — SQL: Verificação completa de todas as tabelas criadas  
  *(Script 1.4 do PLANO_MULTI_CANAL + Script 4 do PLANO_SOFTPHONE)*

---

### ═══ BLOCO B: META MESSAGING OAuth (pré-requisito para Instagram DM e Facebook) ═══

- [ ] **B.1** — Criar nova Edge Function `auth-meta-messaging/index.ts`
  - OAuth separado do `auth-meta` (Ads)
  - Scopes: `pages_messaging, instagram_manage_messages, pages_read_engagement, pages_manage_metadata`
  - Após autorização: buscar lista de páginas (`GET /me/accounts`)
  - Salvar cada página na tabela `tenant_meta_pages`
- [ ] **B.2** — Criar botão "Conectar Páginas para Mensagens" em `Settings.tsx`
  - Separado e distinto do botão "Conectar Meta Ads"
  - Listar páginas conectadas (com ícone do Instagram se vinculado)
- [ ] **B.3** — Criar Edge Function `refresh-meta-page-tokens/index.ts`
  - Page Access Tokens expiram — renovar automaticamente via cron
  - Usar long-lived User Token para gerar novos Page tokens
- [ ] **B.4** — Testar envio de mensagem de teste via Graph API (Facebook + Instagram)

---

### ═══ BLOCO C: META SOCIAL MESSAGING CLIENT (dispatcher Instagram/Facebook) ═══

- [ ] **C.1** — Criar `supabase/functions/_shared/metaSocialClient.ts`
  - `sendFacebookMessage(pageId, pageToken, psid, text)` → `POST /{page_id}/messages`
  - `sendInstagramMessage(igAccountId, pageToken, igsid, text)` → `POST /{ig_account_id}/messages`
  - `markAsRead(pageToken, recipient_id)` → POST mark_seen
  - Tratamento de erros específicos: token expirado, usuário bloqueou, janela de 24h fechada
- [ ] **C.2** — Atualizar `process-outbound` com roteador multi-canal:
  ```typescript
  switch (msg.notification_channel) {
    case 'whatsapp':   → OutboxDispatcher.sendNow() (Z-API/Cloud API) ← já existe
    case 'instagram':  → MetaSocialClient.sendInstagramMessage() ← NOVO
    case 'facebook':   → MetaSocialClient.sendFacebookMessage()  ← NOVO
    case 'sms':        → TelnyxClient.sendSms()                  ← NOVO
    default:           → fallback WhatsApp
  }
  ```
- [ ] **C.3** — Adicionar validação da "janela de mensagem de 24h" da Meta
  - Instagram/Facebook: só permite responder dentro de 24h após última mensagem do paciente
  - Se fora da janela: registrar falha, notificar operador, sugerir canal alternativo

---

### ═══ BLOCO D: CAPTURA DE IDs Meta nos Webhooks ═══

- [ ] **D.1** — Atualizar webhook handler do Instagram (identificar onde está no código)
  - Ao receber mensagem: capturar `sender.id` (IGSID)
  - Chamar `upsertChannelPreference(tenantId, phone, { instagram_user_id: igsid })`
- [ ] **D.2** — Atualizar webhook handler do Facebook Messenger
  - Ao receber mensagem: capturar `sender.id` (PSID)
  - Chamar `upsertChannelPreference(tenantId, phone, { facebook_user_id: psid })`
- [ ] **D.3** — Criar função helper `upsertChannelPreference()` em `_shared/`
  - Upsert em `patient_channel_preferences`
  - Se `updated_by = 'manual'`: não sobrescrever com auto-detect
  - Atualizar `last_auto_detected_at`

---

### ═══ BLOCO E: SCHEDULE-REMINDERS (multi-canal) ═══

- [ ] **E.1** — Atualizar `schedule-reminders` para consultar `patient_channel_preferences`
- [ ] **E.2** — Implementar lógica de auto-detect: se sem preferência manual, usar última sessão ativa
- [ ] **E.3** — Popular `notification_channel` e `channel_recipient_id` ao inserir na fila
- [ ] **E.4** — Testar enfileiramento para cada canal

---

### ═══ BLOCO F: FUNDAÇÃO TELNYX ═══

- [ ] **F.1** — Criar conta Telnyx + obter API Key
- [ ] **F.2** — Criar Webhook Connection e Application no portal Telnyx
- [ ] **F.3** — Salvar `TELNYX_API_KEY` e `TELNYX_APP_ID` como Supabase Secrets
- [ ] **F.4** — Criar `supabase/functions/_shared/telnyxClient.ts` (ver detalhes no PLANO_SOFTPHONE_TELNYX)
- [ ] **F.5** — Criar Edge Function `telnyx-call-webhook` (chamadas recebidas)
- [ ] **F.6** — Criar Edge Function `telnyx-sms-webhook` (SMS recebido)
- [ ] **F.7** — Criar Edge Function `telnyx-numbers` (comprar/liberar números)
- [ ] **F.8** — Criar Edge Function `telnyx-agent-credentials` (credenciais WebRTC)

---

### ═══ BLOCO G: SOFTPHONE FRONTEND ═══

- [ ] **G.1** — Instalar `@telnyx/webrtc` no projeto
- [ ] **G.2** — Criar hook `useTelnyxWebRTC(loginToken)`
- [ ] **G.3** — Criar componente `SoftphoneWidget.tsx` (dialpad flutuante)
- [ ] **G.4** — Criar componente `ActiveCallView.tsx` (durante chamada)
- [ ] **G.5** — Criar componente `IncomingCallNotification.tsx` (overlay de chamada recebida)
- [ ] **G.6** — Integrar SoftphoneWidget no `DashboardLayout.tsx`
- [ ] **G.7** — Criar página `CommunicationsHub.tsx` (histórico + SMS + voicemail)
- [ ] **G.8** — Criar seção "Comunicações" em `Settings.tsx` (números + atendentes + roteamento)
- [ ] **G.9** — Adicionar "Comunicações" na sidebar do `DashboardLayout.tsx`

---

### ═══ BLOCO H: UI DE PREFERÊNCIA DE CANAL ═══

- [ ] **H.1** — Criar componente `ChannelPreferenceSelector`
- [ ] **H.2** — Integrar no painel lateral do paciente (HumanInboxPage)
- [ ] **H.3** — Badge de canal preferido na `FilaAutomacoes`
- [ ] **H.4** — Atualizar `Intelligence.tsx` (seção "Canais Ativos" + distribuição de canais)

---

### ═══ BLOCO I: TESTES E VALIDAÇÃO ═══

- [ ] **I.1** — Paciente manda DM no Instagram → recebe reminder de consulta pelo Instagram DM
- [ ] **I.2** — Paciente manda mensagem no Facebook Messenger → recebe NPS pelo Messenger
- [ ] **I.3** — Operador define preferência SMS → reminder chega por SMS via Telnyx
- [ ] **I.4** — Operador recebe chamada no navegador → chamada conecta, grava, salva CDR
- [ ] **I.5** — Operador faz chamada sainte → paciente recebe no celular
- [ ] **I.6** — Sem preferência definida → sistema usa WhatsApp como fallback
- [ ] **I.7** — Teste da janela de 24h: Instagram/Facebook fora da janela → mensagem falha graciosamente

---

## SCRIPTS SQL NOVOS (não cobertos nos planos anteriores)

### Script A.4 — Tabela `tenant_meta_pages` (Page Tokens para Mensagens)

```sql
-- EXECUTAR NO SQL EDITOR DO SUPABASE
-- Script A.4: armazenar Page Access Tokens para Instagram DM e Facebook Messenger
-- DIFERENTE de ad_integrations (que guarda tokens de Ads)

CREATE TABLE IF NOT EXISTS tenant_meta_pages (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Identificadores da Página do Facebook
  page_id                 TEXT NOT NULL,       -- ID numérico da página FB ("123456789")
  page_name               TEXT,               -- "Clínica Exemplo"
  page_access_token       TEXT NOT NULL,       -- Token de acesso à página (não expira se permanent)
  page_category           TEXT,               -- "Medical & Health", etc.

  -- Conta Instagram vinculada à página (se houver)
  instagram_account_id    TEXT,               -- ID da conta Instagram Business
  instagram_username      TEXT,               -- "@clinicaexemplo"

  -- Controle do token
  token_type              TEXT DEFAULT 'page' CHECK (token_type IN ('page', 'long_lived')),
  expires_at              TIMESTAMPTZ,         -- NULL = não expira (token de página permanente)
  last_refreshed_at       TIMESTAMPTZ DEFAULT now(),
  is_active               BOOLEAN NOT NULL DEFAULT true,

  -- Origem do token (para auditoria)
  authorized_by_user_id   UUID REFERENCES auth.users(id),
  scope_granted           TEXT[],             -- ['pages_messaging', 'instagram_manage_messages', ...]

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(tenant_id, page_id)
);

-- Índice para buscar por instagram_account_id (envio de DM)
CREATE INDEX IF NOT EXISTS idx_tmp_instagram_account
  ON tenant_meta_pages(tenant_id, instagram_account_id)
  WHERE instagram_account_id IS NOT NULL;

-- Índice para buscar páginas ativas por tenant
CREATE INDEX IF NOT EXISTS idx_tmp_tenant_active
  ON tenant_meta_pages(tenant_id, is_active)
  WHERE is_active = true;

-- RLS
ALTER TABLE tenant_meta_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tmp_tenant_isolation" ON tenant_meta_pages
  USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_tenant_meta_pages_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tmp_updated_at
  BEFORE UPDATE ON tenant_meta_pages
  FOR EACH ROW EXECUTE FUNCTION update_tenant_meta_pages_updated_at();

-- Verificar
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'tenant_meta_pages'
ORDER BY ordinal_position;
```

---

### Script A.7 — Atualizar `conversation_sessions` para incluir 'sms' e 'call'

```sql
-- EXECUTAR NO SQL EDITOR DO SUPABASE
-- Script A.7: adicionar 'sms' e 'call' como canais válidos

-- Remover constraint atual (inclui: whatsapp, livechat, instagram, facebook)
ALTER TABLE conversation_sessions
  DROP CONSTRAINT IF EXISTS conversation_sessions_channel_check;

-- Adicionar constraint atualizada
ALTER TABLE conversation_sessions
  ADD CONSTRAINT conversation_sessions_channel_check
    CHECK (channel IN ('whatsapp', 'instagram', 'facebook', 'livechat', 'sms', 'call'));

-- Adicionar campos específicos de chamada
ALTER TABLE conversation_sessions
  ADD COLUMN IF NOT EXISTS call_record_id UUID REFERENCES call_records(id),
  ADD COLUMN IF NOT EXISTS active_call_control_id TEXT;

-- Índice para chamadas ativas
CREATE INDEX IF NOT EXISTS idx_cs_active_call
  ON conversation_sessions(tenant_id, active_call_control_id)
  WHERE active_call_control_id IS NOT NULL;

-- Verificar
SELECT conname, consrc
FROM pg_constraint
WHERE conrelid = 'conversation_sessions'::regclass
  AND contype = 'c'
  AND conname LIKE '%channel%';
```

---

### Script de Verificação Final (todos os sistemas)

```sql
-- EXECUTAR NO SQL EDITOR DO SUPABASE
-- Verificação completa de todos os sistemas

SELECT 'MULTI-CANAL' as sistema, table_name,
  (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_name = t.table_name) as colunas
FROM (VALUES
  ('patient_channel_preferences'),
  ('outbound_message_queue')
) AS t(table_name)

UNION ALL

SELECT 'META MESSAGING' as sistema, table_name,
  (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_name = t.table_name) as colunas
FROM (VALUES
  ('tenant_meta_pages')
) AS t(table_name)

UNION ALL

SELECT 'SOFTPHONE' as sistema, table_name,
  (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_name = t.table_name) as colunas
FROM (VALUES
  ('tenant_phone_numbers'),
  ('call_records'),
  ('voicemails'),
  ('agent_telnyx_credentials'),
  ('call_routing_rules')
) AS t(table_name)

ORDER BY sistema, table_name;
```

---

## Dependências entre os Blocos

```
A (Database)
├── → B (Meta OAuth Messaging)  ← depende da tabela tenant_meta_pages (A.4)
├── → C (Meta Social Client)    ← depende de B estar concluído
├── → D (Capturar IDs Webhooks) ← depende da tabela patient_channel_preferences (A.1)
├── → E (Schedule-Reminders)    ← depende de A.1 e A.2
└── → F (Fundação Telnyx)       ← depende de A.5 e A.6

B → C (dispatcher precisa dos tokens de B)
D → E (precisa ter IDs capturados para enfileirar com canal correto)
F → G (frontend precisa da fundação backend)
C + E → I (testes só depois dos dispatchers e fila atualizados)
G + H → I (testes de UI)
```

---

## Resumo de Todos os Arquivos a Criar/Modificar

### Novos Edge Functions
| Arquivo | Bloco |
|---|---|
| `functions/auth-meta-messaging/index.ts` | B.1 |
| `functions/refresh-meta-page-tokens/index.ts` | B.3 |
| `functions/telnyx-call-webhook/index.ts` | F.5 |
| `functions/telnyx-sms-webhook/index.ts` | F.6 |
| `functions/telnyx-numbers/index.ts` | F.7 |
| `functions/telnyx-agent-credentials/index.ts` | F.8 |

### Edge Functions a modificar
| Arquivo | Bloco | O que muda |
|---|---|---|
| `functions/process-outbound/index.ts` | C.2 | Roteador multi-canal |
| `functions/schedule-reminders/index.ts` | E.1–E.3 | Consultar preferência de canal |

### Novos Shared Clients
| Arquivo | Bloco |
|---|---|
| `functions/_shared/metaSocialClient.ts` | C.1 |
| `functions/_shared/telnyxClient.ts` | F.4 |

### Novos Componentes React
| Arquivo | Bloco |
|---|---|
| `src/pages/CommunicationsHub.tsx` | G.7 |
| `src/components/softphone/SoftphoneWidget.tsx` | G.3 |
| `src/components/softphone/ActiveCallView.tsx` | G.4 |
| `src/components/softphone/IncomingCallNotification.tsx` | G.5 |
| `src/hooks/useTelnyxWebRTC.ts` | G.2 |
| `src/components/channel/ChannelPreferenceSelector.tsx` | H.1 |

### Arquivos a modificar (Frontend)
| Arquivo | Bloco | O que muda |
|---|---|---|
| `src/layouts/DashboardLayout.tsx` | G.6, G.9 | Adicionar SoftphoneWidget + item de navegação |
| `src/pages/Settings.tsx` | G.8 | Seção "Comunicações" |
| `src/pages/Intelligence.tsx` | H.4 | Seção "Canais Ativos" |
| `src/pages/HumanInboxPage.tsx` | H.2 | Painel de preferência de canal |

---

## Estimativa Consolidada

| Bloco | Conteúdo | Estimativa |
|---|---|---|
| A | Database | 1 dia |
| B | Meta OAuth Messaging | 3 dias |
| C | Meta Social Client + dispatcher | 4 dias |
| D | Captura de IDs nos webhooks | 2 dias |
| E | Schedule-reminders multi-canal | 3 dias |
| F | Fundação Telnyx | 1 semana |
| G | Softphone Frontend | 2,5 semanas |
| H | UI preferência de canal | 3 dias |
| I | Testes e validação | 3 dias |
| **TOTAL** | | **~7–8 semanas** |

---

**Próximo passo recomendado:** Executar todos os scripts SQL do Bloco A em sequência no SQL Editor do Supabase (Scripts 1.1, 1.2, 1.3, A.4, A.7 + scripts do PLANO_SOFTPHONE_TELNYX 1, 2).
