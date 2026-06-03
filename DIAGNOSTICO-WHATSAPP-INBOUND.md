# Diagnóstico & Correção — Mensagens Recebidas WhatsApp não Aparecem

**Data:** 2026-06-03  
**Sintoma:** Mensagens enviadas funcionam. Mensagens recebidas não aparecem na página de Atendimento.  
**Pipeline suspeita:** `Z-API → whatsapp-bot → message_inbox → process-inbox (cron) → conversation_messages → Realtime → Frontend`

---

## FASE 1 — Diagnóstico (sem alterar nada, só ler)

Execute os scripts abaixo no **SQL Editor do Supabase** na ordem indicada.
Cada resultado vai apontar exatamente onde a pipeline está quebrada.

---

### ETAPA 1.1 — Verificar se mensagens estão chegando no banco

Cole no SQL Editor e execute:

```sql
-- Mostra as últimas 20 mensagens recebidas pelo webhook
-- Se esta tabela estiver VAZIA = webhook não está chegando (problema no Z-API ou URL errada)
-- Se tiver linhas com status='pending' = mensagens chegam mas o cron não processa
-- Se tiver linhas com status='processing' travadas = cron travou no meio

SELECT
  id,
  phone,
  LEFT(content, 60) AS content_preview,
  message_type,
  status,
  received_at,
  created_at
FROM message_inbox
ORDER BY created_at DESC
LIMIT 20;
```

**Interprete o resultado:**
- `Tabela vazia` → problema na **Etapa 1.3** (webhook/URL)
- `status = 'pending'` há mais de 1 min → problema na **Etapa 1.2** (cron)
- `status = 'processing'` há mais de 5 min → cron travado, ir para **Etapa 2.2**
- `status = 'done'` → mensagens processadas, problema no Realtime → **Etapa 1.4**

---

### ETAPA 1.2 — Verificar se os cron jobs estão cadastrados

```sql
-- Lista todos os cron jobs agendados
-- Deve aparecer: process-inbox-a, process-inbox-b, process-inbox-c
SELECT
  jobname,
  schedule,
  active,
  jobid
FROM cron.job
WHERE jobname LIKE '%inbox%' OR jobname LIKE '%process%'
ORDER BY jobname;
```

**Interprete:**
- `0 linhas retornadas` → cron jobs nunca foram criados → ir para **Etapa 2.1**
- `active = false` → cron desativado → ir para **Etapa 2.1**
- `3 linhas, active = true` → cron OK, problema em outro lugar

---

### ETAPA 1.3 — Verificar última execução dos cron jobs

```sql
-- Histórico de execuções recentes dos crons de inbox
SELECT
  jobname,
  start_time,
  end_time,
  status,
  return_message
FROM cron.job_run_details
WHERE jobname LIKE '%inbox%'
ORDER BY start_time DESC
LIMIT 20;
```

**Interprete:**
- `0 linhas` → nunca executou → ir para **Etapa 2.1**
- `status = 'failed'` → veja `return_message` para identificar o erro
- `status = 'succeeded'` mas mensagens ainda pendentes → URL da função pode estar errada

---

### ETAPA 1.4 — Verificar se Realtime está habilitado nas tabelas

```sql
-- Lista tabelas com publicação Realtime ativa
SELECT
  schemaname,
  tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;
```

**O que deve aparecer (obrigatório):**
- `conversation_sessions`
- `conversation_messages`

**Interprete:**
- Se `conversation_messages` NÃO aparece → Realtime desligado → ir para **Etapa 2.3**
- Se `conversation_sessions` NÃO aparece → sessões novas não disparam alerta → ir para **Etapa 2.3**

---

### ETAPA 1.5 — Verificar RLS nas tabelas principais

```sql
-- Verifica quais políticas RLS existem nas tabelas de mensagens
SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE tablename IN (
  'conversation_messages',
  'conversation_sessions',
  'message_inbox'
)
ORDER BY tablename, cmd;
```

**O que verificar:**
- `conversation_messages` deve ter policy para `SELECT` com `cmd = 'SELECT'`
- `conversation_sessions` deve ter policy para `SELECT`
- Se faltar policy de SELECT em alguma → ir para **Etapa 2.4**

---

### ETAPA 1.6 — Verificar URL configurada nos cron jobs

```sql
-- Mostra o comando exato que o cron executa
-- Verifique se a URL da Edge Function está correta
SELECT
  jobname,
  command
FROM cron.job
WHERE jobname LIKE '%inbox%'
ORDER BY jobname;
```

**O que verificar:**
- A URL deve ser: `https://SEU_PROJECT_REF.supabase.co/functions/v1/process-inbox`
- Compare com sua URL real do Supabase

---

## FASE 2 — Correções

Execute **somente as etapas que o diagnóstico acima indicar**.

---

### ETAPA 2.1 — Recriar os cron jobs do process-inbox

> Execute se ETAPA 1.2 retornou 0 linhas ou jobs inativos.
> ⚠️ **Substitua `YOUR_PROJECT_REF` e `YOUR_SERVICE_ROLE_KEY` pelos valores reais do seu projeto Supabase.**

```sql
-- Remover jobs antigos (se existirem)
SELECT cron.unschedule('process-inbox-a');
SELECT cron.unschedule('process-inbox-b');
SELECT cron.unschedule('process-inbox-c');

-- Recriar os 3 jobs escalonados (execução a cada ~20s)
SELECT cron.schedule(
  'process-inbox-a',
  '* * * * *',
  $$
    SELECT net.http_post(
      url    := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/process-inbox',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
      ),
      body   := '{}'::jsonb
    );
  $$
);

SELECT cron.schedule(
  'process-inbox-b',
  '* * * * *',
  $$
    SELECT pg_sleep(20);
    SELECT net.http_post(
      url    := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/process-inbox',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
      ),
      body   := '{}'::jsonb
    );
  $$
);

SELECT cron.schedule(
  'process-inbox-c',
  '* * * * *',
  $$
    SELECT pg_sleep(40);
    SELECT net.http_post(
      url    := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/process-inbox',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
      ),
      body   := '{}'::jsonb
    );
  $$
);

-- Confirmar criação
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE '%inbox%';
```

---

### ETAPA 2.2 — Desbloquear mensagens travadas em 'processing'

> Execute se ETAPA 1.1 retornou linhas com `status='processing'` há mais de 5 minutos.

```sql
-- Conta mensagens travadas
SELECT COUNT(*), MIN(created_at), MAX(created_at)
FROM message_inbox
WHERE status = 'processing'
  AND created_at < NOW() - INTERVAL '5 minutes';

-- Liberar mensagens travadas (volta para pending para reprocessar)
UPDATE message_inbox
SET status = 'pending', batch_id = NULL
WHERE status = 'processing'
  AND created_at < NOW() - INTERVAL '5 minutes';

-- Confirmar
SELECT COUNT(*) AS liberadas FROM message_inbox WHERE status = 'pending';
```

---

### ETAPA 2.3 — Habilitar Realtime nas tabelas

> Execute se ETAPA 1.4 não mostrou `conversation_messages` ou `conversation_sessions`.

```sql
-- Habilitar Realtime para as tabelas de mensagens e sessões
ALTER PUBLICATION supabase_realtime ADD TABLE conversation_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE conversation_sessions;

-- Confirmar
SELECT tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('conversation_messages', 'conversation_sessions');
```

---

### ETAPA 2.4 — Adicionar RLS SELECT nas tabelas

> Execute se ETAPA 1.5 não mostrou policies de SELECT para `conversation_messages` ou `conversation_sessions`.

```sql
-- ── conversation_messages ──────────────────────────────────────
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;

-- Remover policy antiga se existir
DROP POLICY IF EXISTS "members_read_messages" ON conversation_messages;

-- Criar policy de leitura para membros do tenant
CREATE POLICY "members_read_messages"
  ON conversation_messages
  FOR SELECT
  USING (
    session_id IN (
      SELECT id FROM conversation_sessions
      WHERE tenant_id IN (
        SELECT tenant_id FROM members
        WHERE user_id = auth.uid()
          AND is_active = TRUE
      )
    )
  );

-- ── conversation_sessions ──────────────────────────────────────
ALTER TABLE conversation_sessions ENABLE ROW LEVEL SECURITY;

-- Remover policy antiga se existir
DROP POLICY IF EXISTS "members_read_sessions" ON conversation_sessions;

-- Criar policy de leitura para membros do tenant
CREATE POLICY "members_read_sessions"
  ON conversation_sessions
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM members
      WHERE user_id = auth.uid()
        AND is_active = TRUE
    )
  );

-- Confirmar
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('conversation_messages', 'conversation_sessions')
  AND cmd = 'SELECT';
```

---

### ETAPA 2.5 — Verificar URL do Webhook no Z-API

> Execute se ETAPA 1.1 retornou tabela vazia (nenhuma mensagem chegando).

**Verifique no painel do Z-API:**

1. Acesse o painel do Z-API
2. Vá em **Instâncias → sua instância → Webhooks**
3. A URL configurada deve ser exatamente:
   ```
   https://YOUR_PROJECT_REF.supabase.co/functions/v1/whatsapp-bot
   ```
4. O método deve ser **POST**
5. **Eventos que devem estar habilitados:**
   - `onMessageReceived` ✅
   - `onMessageSent` ✅ (opcional)
6. Salvar e testar com a opção "Enviar mensagem de teste"

**Para Cloud API (Meta):**
- Acesse **Meta for Developers → seu app → WhatsApp → Configuration**
- Callback URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/whatsapp-bot`
- Verify Token: qualquer string (deve coincidir com `WHATSAPP_VERIFY_TOKEN` nos Secrets)
- Webhook Fields: `messages` ✅

---

## FASE 3 — Validação Final

Execute após aplicar as correções para confirmar que está tudo funcionando.

```sql
-- 1. Envie uma mensagem de WhatsApp para o número da clínica
-- 2. Aguarde ~30 segundos
-- 3. Execute esta query para verificar o ciclo completo:

-- Verificar se chegou no webhook
SELECT 'message_inbox' AS tabela, status, COUNT(*) AS total
FROM message_inbox
WHERE created_at > NOW() - INTERVAL '5 minutes'
GROUP BY status

UNION ALL

-- Verificar se foi processada
SELECT 'conversation_messages' AS tabela, role AS status, COUNT(*) AS total
FROM conversation_messages
WHERE created_at > NOW() - INTERVAL '5 minutes'
  AND role = 'user'
GROUP BY role

UNION ALL

-- Verificar se criou/atualizou sessão
SELECT 'conversation_sessions' AS tabela, omnichannel_status AS status, COUNT(*) AS total
FROM conversation_sessions
WHERE updated_at > NOW() - INTERVAL '5 minutes'
GROUP BY omnichannel_status;
```

**Resultado esperado após a correção:**
| tabela | status | total |
|---|---|---|
| message_inbox | done | 1 |
| conversation_messages | user | 1 |
| conversation_sessions | queued | 1 |

---

## Resumo do Fluxo Correto

```
Z-API envia POST → whatsapp-bot (Edge Function)
                        ↓
              INSERT message_inbox (status='pending')
                        ↓ [cron a cada ~20s]
              process-inbox (Edge Function)
                        ↓
              INSERT conversation_messages (role='user')
              UPDATE conversation_sessions (omnichannel_status='queued')
                        ↓ [Realtime Postgres Changes]
              HumanInboxPage recebe evento
                        ↓
              Mensagem aparece na tela + som de alerta
```

---

## Checklist de Execução

- [ ] **1.1** Verificar `message_inbox` — tabela vazia ou status das mensagens
- [ ] **1.2** Verificar cron jobs cadastrados
- [ ] **1.3** Verificar histórico de execução dos crons
- [ ] **1.4** Verificar Realtime habilitado nas tabelas
- [ ] **1.5** Verificar RLS SELECT nas tabelas
- [ ] **1.6** Verificar URL nos cron jobs
- [ ] **2.x** Aplicar correção indicada pelo diagnóstico
- [ ] **Fase 3** Validação final com mensagem de teste
