# Plano: Multi-Canal para Automações (No-Show + NPS)

**Data:** 2026-06-04  
**Status:** Aguardando execução  
**Objetivo:** Permitir que a plataforma envie notificações de Prevenção de No-Show e Pesquisa NPS pelo canal de preferência do paciente (WhatsApp, Instagram DM, Facebook Messenger ou SMS).

---

## Diagnóstico

### Problema Central
A `outbound_message_queue` e o `process-outbound` não têm conhecimento de canal — tudo é despachado via Z-API (WhatsApp), independente de como o paciente se comunicou com a clínica.

### Dados Disponíveis (mas não usados)
| Tabela | Campo | Dado disponível |
|---|---|---|
| `conversation_sessions` | `channel` | `whatsapp \| instagram \| facebook \| livechat` |
| `patient_funnel_stage` | `lead_source` | `whatsapp \| instagram \| indicacao` |
| `outbound_message_queue` | *(ausente)* | Nenhum campo de canal |

### Solução Arquitetural
1. Criar tabela `patient_channel_preferences` para persistir preferência por paciente
2. Adicionar colunas `notification_channel` + `channel_recipient_id` na `outbound_message_queue`
3. Atualizar `schedule-reminders` para popular canal ao enfileirar
4. Atualizar `process-outbound` para rotear por canal correto
5. Adicionar UI de preferência de canal no perfil do paciente e em Intelligence.tsx

---

## Arquitetura da Solução

```
Paciente interage via Instagram DM
        ↓
conversation_sessions.channel = 'instagram'
        ↓
[Auto-detect OR Manual] → patient_channel_preferences
        ↓
schedule-reminders lê preferência → outbound_message_queue (channel='instagram', recipient_id='ig_user_123')
        ↓
process-outbound roteia → Meta Graph API → Instagram DM
```

---

## TASKLIST EXECUTÁVEL

### FASE 1 — Database (Supabase SQL Editor)

- [ ] **TASK 1.1** — Executar script SQL: criar `patient_channel_preferences`
- [ ] **TASK 1.2** — Executar script SQL: adicionar colunas de canal em `outbound_message_queue`
- [ ] **TASK 1.3** — Executar script SQL: adicionar `instagram_user_id` e `facebook_user_id` em `conversation_sessions`
- [ ] **TASK 1.4** — Verificar se as tabelas e colunas foram criadas corretamente

### FASE 2 — Backend: Edge Function `schedule-reminders`

- [ ] **TASK 2.1** — Atualizar função para buscar `patient_channel_preferences` ao enfileirar
- [ ] **TASK 2.2** — Implementar auto-detect: usa última sessão ativa se não houver preferência manual
- [ ] **TASK 2.3** — Popular `notification_channel` e `channel_recipient_id` nas inserções da fila
- [ ] **TASK 2.4** — Testar enfileiramento com paciente de canal Instagram (validar campos populados)

### FASE 3 — Backend: Edge Function `process-outbound`

- [ ] **TASK 3.1** — Adicionar roteador de canal (`switch notification_channel`)
- [ ] **TASK 3.2** — Implementar dispatcher para Instagram DM via Meta Graph API
- [ ] **TASK 3.3** — Implementar dispatcher para Facebook Messenger via Meta Graph API
- [ ] **TASK 3.4** — Implementar dispatcher para SMS via **Telnyx** (`TelnyxClient.sendSms()`) ← decisão final: Telnyx para todos os países
- [ ] **TASK 3.5** — Manter dispatcher WhatsApp (Z-API) como default/fallback
- [ ] **TASK 3.6** — Testar envio em cada canal com mensagem de teste

### FASE 4 — Backend: Webhook Handlers (capturar platform user IDs)

- [ ] **TASK 4.1** — Atualizar handler do Instagram para salvar `instagram_user_id` em `patient_channel_preferences`
- [ ] **TASK 4.2** — Atualizar handler do Facebook para salvar `facebook_user_id` em `patient_channel_preferences`
- [ ] **TASK 4.3** — Criar função helper `upsertChannelPreference()` reutilizável

### FASE 5 — Frontend: UI de Preferência de Canal

- [ ] **TASK 5.1** — Criar componente `ChannelPreferenceSelector` (dropdown com ícones dos canais)
- [ ] **TASK 5.2** — Integrar seletor no perfil do paciente (HumanInboxPage sidebar)
- [ ] **TASK 5.3** — Adicionar badge de canal preferido na `FilaAutomacoes`
- [ ] **TASK 5.4** — Adicionar coluna "Canal" na tabela de fila de automações

### FASE 6 — Frontend: Intelligence.tsx

- [ ] **TASK 6.1** — Adicionar seção "Canais Ativos" mostrando quais canais estão configurados
- [ ] **TASK 6.2** — Adicionar configuração de mensagem por canal (templates específicos por canal)
- [ ] **TASK 6.3** — Mostrar distribuição de canais no painel de desempenho (gráfico de pizza)

### FASE 7 — Validação e Testes

- [ ] **TASK 7.1** — Testar fluxo completo: paciente entra via Instagram → recebe reminder por Instagram
- [ ] **TASK 7.2** — Testar fallback: sem preferência definida → cai para WhatsApp
- [ ] **TASK 7.3** — Testar override manual: paciente prefere SMS mesmo vindo do WhatsApp
- [ ] **TASK 7.4** — Verificar que NPS também respeita canal preferido

---

## SCRIPTS SQL

### Script 1.1 — Criar tabela `patient_channel_preferences`

```sql
-- EXECUTAR NO SQL EDITOR DO SUPABASE
-- Script 1.1: patient_channel_preferences

CREATE TABLE IF NOT EXISTS patient_channel_preferences (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_phone             TEXT NOT NULL,

  -- Canal preferido para receber notificações de automação
  preferred_channel         TEXT NOT NULL DEFAULT 'whatsapp'
                            CHECK (preferred_channel IN ('whatsapp', 'instagram', 'facebook', 'sms')),

  -- Identificadores por canal
  whatsapp_phone            TEXT,           -- Ex: "5511999999999"
  instagram_user_id         TEXT,           -- Ex: "17841400000000000" (ID numérico da Meta)
  instagram_username        TEXT,           -- Ex: "@usuario" (para exibição)
  facebook_user_id          TEXT,           -- Ex: "10158000000000" (ID numérico da Meta)
  facebook_name             TEXT,           -- Nome exibido no FB (para exibição)
  sms_phone                 TEXT,           -- Número para SMS (pode diferir do WhatsApp)

  -- Controle de origem da preferência
  updated_by                TEXT NOT NULL DEFAULT 'auto'
                            CHECK (updated_by IN ('auto', 'manual')),
  -- 'auto' = detectado da última conversa ativa
  -- 'manual' = operador definiu manualmente

  last_auto_detected_at     TIMESTAMPTZ,
  last_manual_updated_at    TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(tenant_id, patient_phone)
);

-- Índice para buscas rápidas por tenant + phone
CREATE INDEX IF NOT EXISTS idx_pcp_tenant_phone
  ON patient_channel_preferences(tenant_id, patient_phone);

-- Índice para buscar por instagram_user_id (webhook handler)
CREATE INDEX IF NOT EXISTS idx_pcp_instagram_user_id
  ON patient_channel_preferences(tenant_id, instagram_user_id)
  WHERE instagram_user_id IS NOT NULL;

-- Índice para buscar por facebook_user_id (webhook handler)
CREATE INDEX IF NOT EXISTS idx_pcp_facebook_user_id
  ON patient_channel_preferences(tenant_id, facebook_user_id)
  WHERE facebook_user_id IS NOT NULL;

-- RLS
ALTER TABLE patient_channel_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_select" ON patient_channel_preferences
  FOR SELECT USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE POLICY "tenant_isolation_insert" ON patient_channel_preferences
  FOR INSERT WITH CHECK (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

CREATE POLICY "tenant_isolation_update" ON patient_channel_preferences
  FOR UPDATE USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

-- Trigger: atualiza updated_at automaticamente
CREATE OR REPLACE FUNCTION update_patient_channel_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pcp_updated_at
  BEFORE UPDATE ON patient_channel_preferences
  FOR EACH ROW EXECUTE FUNCTION update_patient_channel_preferences_updated_at();
```

---

### Script 1.2 — Adicionar colunas de canal em `outbound_message_queue`

```sql
-- EXECUTAR NO SQL EDITOR DO SUPABASE
-- Script 1.2: adicionar canal na fila de automações

-- Coluna: qual canal deve ser usado para enviar esta mensagem
ALTER TABLE outbound_message_queue
  ADD COLUMN IF NOT EXISTS notification_channel TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (notification_channel IN ('whatsapp', 'instagram', 'facebook', 'sms'));

-- Coluna: identificador do destinatário no canal específico
-- Para WhatsApp/SMS: número de telefone
-- Para Instagram: instagram_user_id (ID numérico da Meta)
-- Para Facebook: facebook_user_id (ID numérico da Meta)
ALTER TABLE outbound_message_queue
  ADD COLUMN IF NOT EXISTS channel_recipient_id TEXT;

-- Índice para o dispatcher filtrar por canal (process-outbound processa por canal)
CREATE INDEX IF NOT EXISTS idx_omq_channel_status_scheduled
  ON outbound_message_queue(notification_channel, status, scheduled_at)
  WHERE status = 'pending';

-- Backfill: mensagens existentes ficam como whatsapp com phone como recipient
UPDATE outbound_message_queue
SET 
  notification_channel = 'whatsapp',
  channel_recipient_id = patient_phone
WHERE notification_channel IS NULL OR channel_recipient_id IS NULL;

-- Comentário descritivo nas colunas
COMMENT ON COLUMN outbound_message_queue.notification_channel IS 
  'Canal de entrega: whatsapp | instagram | facebook | sms';
COMMENT ON COLUMN outbound_message_queue.channel_recipient_id IS 
  'ID do destinatário no canal: phone para whatsapp/sms, user_id numérico para instagram/facebook';
```

---

### Script 1.3 — Adicionar campos de platform ID em `conversation_sessions`

```sql
-- EXECUTAR NO SQL EDITOR DO SUPABASE
-- Script 1.3: enriquecer conversation_sessions com IDs de plataforma

-- Armazena o ID numérico do usuário na plataforma (Instagram, Facebook)
-- Necessário para enviar mensagens proativas via Meta Graph API
ALTER TABLE conversation_sessions
  ADD COLUMN IF NOT EXISTS platform_user_id TEXT;

-- Nome de exibição no canal (ex: @username no Instagram, nome no Facebook)
ALTER TABLE conversation_sessions
  ADD COLUMN IF NOT EXISTS platform_display_name TEXT;

-- Índice para busca rápida por platform_user_id + canal
CREATE INDEX IF NOT EXISTS idx_cs_platform_user_channel
  ON conversation_sessions(tenant_id, platform_user_id, channel)
  WHERE platform_user_id IS NOT NULL;

COMMENT ON COLUMN conversation_sessions.platform_user_id IS
  'ID numérico do usuário na plataforma (Meta Instagram/Facebook user ID)';
COMMENT ON COLUMN conversation_sessions.platform_display_name IS
  'Nome de exibição: @username (Instagram) ou nome completo (Facebook)';
```

---

### Script 1.4 — Verificação das mudanças

```sql
-- EXECUTAR NO SQL EDITOR DO SUPABASE
-- Script 1.4: verificar se tudo foi criado corretamente

-- Verificar tabela patient_channel_preferences
SELECT 
  column_name, 
  data_type, 
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'patient_channel_preferences'
ORDER BY ordinal_position;

-- Verificar colunas adicionadas em outbound_message_queue
SELECT 
  column_name, 
  data_type, 
  column_default
FROM information_schema.columns
WHERE table_name = 'outbound_message_queue'
  AND column_name IN ('notification_channel', 'channel_recipient_id')
ORDER BY ordinal_position;

-- Verificar colunas adicionadas em conversation_sessions
SELECT 
  column_name, 
  data_type
FROM information_schema.columns
WHERE table_name = 'conversation_sessions'
  AND column_name IN ('platform_user_id', 'platform_display_name');

-- Verificar índices criados
SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE tablename IN ('patient_channel_preferences', 'outbound_message_queue', 'conversation_sessions')
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- Verificar políticas RLS
SELECT schemaname, tablename, policyname, cmd
FROM pg_policies
WHERE tablename = 'patient_channel_preferences';
```

---

## Visão Geral do Fluxo Final

```
1. Paciente interage via qualquer canal
        ↓
2. Webhook handler salva platform_user_id em conversation_sessions
        ↓
3. upsertChannelPreference() auto-detecta e salva em patient_channel_preferences
        ↓
4. Operador pode sobrescrever manualmente via UI (updated_by = 'manual')
        ↓
5. schedule-reminders consulta patient_channel_preferences ao criar fila
        ↓
6. outbound_message_queue: { notification_channel: 'instagram', channel_recipient_id: '17841400...' }
        ↓
7. process-outbound roteia:
   ├── 'whatsapp'   → Z-API sendMessage(phone)
   ├── 'instagram'  → Meta Graph API /me/messages (instagram_user_id)
   ├── 'facebook'   → Meta Graph API /me/messages (facebook_user_id)
   └── 'sms'        → SMS Provider API (phone)
```

---

## Canais Suportados — Referência

| Canal | API | Identificador | Observação |
|---|---|---|---|
| WhatsApp | Z-API | Número de telefone | Já implementado |
| Instagram DM | Meta Graph API | `instagram_user_id` (numérico) | Requer Page token |
| Facebook Messenger | Meta Graph API | `facebook_user_id` (numérico) | Requer Page token |
| SMS | **Telnyx** (decisão final — ver ANALISE_SMS_TWILIO_VS_TELNYX.md) | Número de telefone celular | Ver PLANO_SOFTPHONE_TELNYX.md |

---

## SMS — Detalhamento Completo

### Por que o SMS é diferente dos outros canais?

O SMS impõe restrições técnicas que os outros canais não têm. **Ignorá-las causa mensagens cortadas, caracteres estranhos e custo desnecessário.**

| Restrição | Detalhe | Impacto nos templates atuais |
|---|---|---|
| **Limite de 160 chars** | Padrão GSM-7 (sem emojis/acentos especiais) | Todos os templates atuais excedem 160 chars |
| **UCS-2 com emojis = 70 chars** | Qualquer emoji (😊, ✅, ⭐) muda o encoding | Templates com emoji: cobram múltiplos segmentos |
| **Sem markdown** | `*negrito*` aparece literalmente: `*negrito*` | Templates usam `*bold*` do WhatsApp |
| **Sem botões interativos** | Não existe "lista de opções" em SMS | Precisa de instrução textual: "Responda SIM" |
| **Sem mídia** | Vídeos de lembrete não funcionam em SMS padrão | `reminder_videos_enabled` não se aplica |
| **Links são texto simples** | Funcionam, mas ocupam chars e podem ser bloqueados | URLs longas de check-in/sala de espera devem ser omitidas |

### Quando o paciente recebe alertas por SMS?

**Caso de uso principal:** paciente que entrou em contato por **ligação telefônica tradicional** (não tem sessão digital).

```
Paciente liga → Operador cria/encontra paciente no sistema
                        ↓
            Operador define: Canal preferido = SMS
            Número SMS = (preenchido manualmente ou igual ao cadastro)
                        ↓
          schedule-reminders → notification_channel = 'sms'
                        ↓
          process-outbound → TelnyxClient.sendSms() → SMS no celular
```

**Diferença chave vs outros canais:** Para WhatsApp, Instagram e Facebook existe webhook que auto-detecta o canal. **Para ligações telefônicas, não existe webhook** — o operador precisa definir manualmente. Por isso `updated_by = 'manual'` será o padrão para SMS.

### Provedor Recomendado: Zenvia

| Critério | Zenvia | Twilio |
|---|---|---|
| Sede | Brasil | EUA |
| Suporte | Português | Inglês |
| Cobertura BR | Nativa (acordos diretos com operadoras) | Via parceiros |
| Preço SMS BR | ~R$0,09/SMS | ~US$0,0075/SMS |
| API | REST simples | REST bem documentado |
| Sender ID | Alfanumérico (ex: "TRAFFIO") gratuito | Requer número dedicado |
| Recomendação | ✅ **Melhor para produto BR** | Alternativa global |

### Credenciais SMS na tabela `tenants`

O padrão do sistema usa a tabela `tenants` para credenciais de canais (igual ao `zapi_instance_id`, `zapi_token`). O SMS seguirá o mesmo padrão.

**Ver Script 1.5 abaixo** para adicionar os campos SMS na tabela `tenants`.

### Templates SMS — Versão Compacta

Os templates SMS são uma versão reescrita dos templates WhatsApp existentes: **sem emojis, sem markdown, sem links, máximo 155 chars** (5 chars de margem para variáveis longas).

**Ver Script 1.6 abaixo** para os templates SMS prontos para adicionar em `messageTemplates.ts`.

---

## SCRIPTS SQL ADICIONAIS (SMS)

### Script 1.5 — Adicionar credenciais SMS na tabela `tenants`

```sql
-- EXECUTAR NO SQL EDITOR DO SUPABASE
-- Script 1.5: adicionar suporte a SMS na tabela tenants

-- Provedor SMS: 'zenvia' ou 'twilio'
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS sms_provider TEXT
    CHECK (sms_provider IN ('zenvia', 'twilio'));

-- Chave de API do provedor SMS
-- Zenvia: token de autenticação (X-API-TOKEN)
-- Twilio: concatenado como "AccountSID:AuthToken"
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS sms_api_key TEXT;

-- Remetente (aparece como "DE:" no SMS)
-- Zenvia: string alfanumérica de até 11 chars (ex: "TRAFFIO", "CLINICA")
-- Twilio: número de telefone adquirido (+5511XXXXXXXX)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS sms_sender_id TEXT;

-- Habilitar/desabilitar SMS para este tenant
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN tenants.sms_provider IS 'Provedor SMS: zenvia ou twilio';
COMMENT ON COLUMN tenants.sms_api_key  IS 'Credencial do provedor: Zenvia token | Twilio AccountSID:AuthToken';
COMMENT ON COLUMN tenants.sms_sender_id IS 'Remetente: alfanumérico 11 chars (Zenvia) ou número (Twilio)';

-- Verificar
SELECT id, name, sms_provider, sms_enabled
FROM tenants
LIMIT 5;
```

---

### Script 1.6 — Templates SMS (para referência no código)

> **Este script é apenas documentação — não executar no SQL.**
> Os templates devem ser adicionados em `supabase/functions/_shared/messageTemplates.ts` na TASK 3.4.

```typescript
// ============================================================
// TEMPLATES SMS — sem emojis, sem markdown, máx 155 chars
// ============================================================

'sms_appointment_reminder_48h': (v) =>
  `Ola ${v.patient_name}! Lembrete: consulta com ${v.doctor_name} em ${v.date} as ${v.time}` +
  `${v.location_name ? ` - ${v.location_name}` : ''}. Confirme respondendo SIM ou REAGENDAR.`,
  // Exemplo: "Ola Joao! Lembrete: consulta com Dra. Ana em 06/06 as 14:00 - Clinica Centro. Confirme SIM ou REAGENDAR."
  // Chars: ~120 ✅

'sms_appointment_reminder_24h': (v) =>
  `Ola ${v.patient_name}! Amanha: consulta com ${v.doctor_name} as ${v.time}` +
  `${v.location_name ? ` em ${v.location_name}` : ''}. Responda SIM para confirmar ou REAGENDAR.`,
  // Chars: ~115 ✅

'sms_appointment_reminder_2h': (v) =>
  `${v.patient_name}, sua consulta e em 2h (${v.time})` +
  `${v.location_name ? ` na ${v.location_name}` : ''}. Ate logo!`,
  // Chars: ~75 ✅

'sms_booking_confirmed': (v) =>
  `Agendado! ${v.patient_name}, consulta com ${v.doctor_name} em ${v.date} as ${v.time}` +
  `${v.location_name ? ` - ${v.location_name}` : ''}. ${v.clinic_name}`,
  // Chars: ~120 ✅

'sms_nps_survey': (v) =>
  `Ola ${v.patient_name}! Como foi sua consulta na ${v.clinic_name} hoje? ` +
  `Responda com nota de 0 a 10. Sua opiniao e muito importante!`,
  // Chars: ~125 ✅

'sms_follow_up_1': (v) =>
  `Ola ${v.patient_name}! Aqui e a ${v.clinic_name}. Notamos que nao concluiu ` +
  `seu agendamento. Posso ajudar? Responda esta mensagem.`,
  // Chars: ~125 ✅
```

### Script 1.7 — Configurar SMS para um tenant (exemplo de uso)

```sql
-- EXECUTAR NO SQL EDITOR DO SUPABASE
-- Script 1.7: configurar Zenvia para um tenant específico
-- Substitua os valores pelos reais antes de executar

UPDATE tenants
SET
  sms_provider   = 'zenvia',
  sms_api_key    = 'SEU_TOKEN_ZENVIA_AQUI',   -- token da Zenvia
  sms_sender_id  = 'TRAFFIO',                  -- até 11 chars, sem espaço
  sms_enabled    = true
WHERE id = 'SEU_TENANT_ID_AQUI';

-- Verificar
SELECT id, name, sms_provider, sms_sender_id, sms_enabled
FROM tenants
WHERE id = 'SEU_TENANT_ID_AQUI';
```

---

## Fluxo Completo de Atribuição de Canal SMS (Operador)

```
1. Paciente liga para a clínica
         ↓
2. Operador abre o perfil do paciente na plataforma
         ↓
3. Na seção "Canal de Notificação":
   [WhatsApp ▼] → troca para [SMS]
   Número SMS: [___(11)99999-9999____] ← pode ser pré-preenchido do cadastro
         ↓
4. Salva → patient_channel_preferences
   { preferred_channel: 'sms', sms_phone: '5511999999999', updated_by: 'manual' }
         ↓
5. Próxima execução do schedule-reminders:
   → Busca preferência → canal = 'sms'
   → Insere na fila: { notification_channel: 'sms', channel_recipient_id: '5511999999999' }
         ↓
6. process-outbound:
   → case 'sms': sendSmsViaZenvia(tenant, '5511999999999', templateSMS)
```

---

**Próximo passo:** Executar os scripts SQL da Fase 1 no SQL Editor do Supabase e confirmar as Tasks 1.1 a 1.7.
