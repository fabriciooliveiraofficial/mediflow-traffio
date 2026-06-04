# Auditoria: Arquitetura Multi-Tenant Telnyx
**Data:** 2026-06-04 | **Severidade máxima encontrada:** CRÍTICA

---

## 1. Modelo Arquitetural — Como Funciona o Multi-Tenant

### Modelo adotado: Traffio como Revendedor Telnyx

```
Telnyx (1 conta master — Traffio)
          ↓
    Traffio compra números, ativa SIP
          ↓
  Tabela tenant_phone_numbers (scope por tenant_id)
          ↓
  Webhook identifica tenant pelo número destino
          ↓
  call_records / message_inbox por tenant_id
```

Este modelo é **válido e escalável** — é o mesmo usado por grandes CPaaS como Twilio e Vonage em seus planos reseller. A Telnyx **não tem sub-contas por API** (diferente do Twilio), então o controle fica 100% no banco de dados da Traffio.

**Consequência direta:** Traffio paga à Telnyx, cobra dos tenants com markup. Precisa rastrear tudo internamente.

---

## 2. Vulnerabilidades Encontradas

### 🔴 CRÍTICAS (risco de vazamento de dados entre tenants)

| # | Arquivo | Linha | Problema | Impacto |
|---|---|---|---|---|
| C1 | `telnyx-call-webhook` | update status | Atualiza `call_records` usando só `call_control_id` sem `tenant_id` | Tenant A pode sobrescrever dados do Tenant B |
| C2 | `telnyx-numbers` | release endpoint | `.eq("id", number_id)` sem `.eq("tenant_id", tenantId)` | Admin de qualquer tenant pode deletar números de outros |
| C3 | `CommunicationsHub.tsx` | voicemail mark-read | Sem `tenant_id` no UPDATE | Qualquer usuário autenticado marca voicemails de outros tenants como lidos |
| C4 | `CommunicationsHub.tsx` | call notes update | Sem `tenant_id` no UPDATE | Qualquer usuário pode editar notas de chamadas de outros tenants |
| C5 | `telnyx-call-webhook` | sem verificação de assinatura | Webhook aceita POST de qualquer origem | Atacante pode injetar eventos falsos |
| C6 | `telnyx-sms-webhook` | sem verificação de assinatura | Idem | Injeção de SMS falsos no sistema |

### 🟠 ALTAS (problemas sérios mas sem leak imediato)

| # | Arquivo | Problema |
|---|---|---|
| A1 | `agent_telnyx_credentials` | Senha SIP armazenada em texto puro no banco |
| A2 | `process-outbound` | SMS enviado sem registrar custo/uso em nenhuma tabela |
| A3 | Toda a stack | **Zero rastreamento de uso** — não existe forma de saber quantos minutos/SMS cada tenant usou |
| A4 | `useTelnyxWebRTC.ts` | Caller ID não validado contra números do tenant — pode ser forjado |

### 🟡 MÉDIAS

| # | Arquivo | Problema |
|---|---|---|
| M1 | `process-outbound` | Quiet hours hardcoded Brazil (ignora tenant.timezone em alguns casos) |
| M2 | Telnyx numbers | Nenhum cap de gastos por tenant |
| M3 | Toda a stack | Nenhum audit log de operações sensíveis |

---

## 3. O Que Está FALTANDO para Produção

### 3.1 Rastreamento de Uso (billing)
```
SEM ISSO, A TRAFFIO NÃO CONSEGUE:
  ✗ Saber quantos minutos cada clínica usou no mês
  ✗ Saber quantos SMS foram enviados por tenant
  ✗ Gerar fatura de uso variável
  ✗ Alertar quando tenant está prestes a exceder o plano
  ✗ Calcular margem/custo por tenant
```

### 3.2 Modelo de Precificação por Tenant
Não existe tabela que define o plano de cada tenant (minutos inclusos, SMS inclusos, preço de excedente).

### 3.3 Verificação de Assinatura Telnyx
Ambos webhooks aceitam qualquer POST — devem verificar `X-Telnyx-Signature-ed25519`.

---

## 4. Arquitetura Completa Recomendada

```
TENANT compra número na plataforma
         ↓
telnyx-numbers → Telnyx API (compra com master key)
         ↓
tenant_phone_numbers (tenant_id, phone_number, telnyx_number_id)
         ↓
Telnyx roteia chamadas/SMS para webhook único da Traffio
         ↓
telnyx-call-webhook / telnyx-sms-webhook
  → identifica tenant por número destino
  → processa evento
  → registra em call_records / message_inbox  ← já existe
  → registra em tenant_usage_log             ← CRIAR
         ↓
Cron mensal: agregar tenant_usage_log → tenant_monthly_usage
         ↓
Stripe Metered Billing (ou desconto na fatura) → cobrar tenant
```

---

## 5. Scripts SQL de Correção (executar em ordem)

### Script SEC-1 — Tabelas de Uso e Custo (CRÍTICO — faltando)

```sql
-- EXECUTAR NO SQL EDITOR DO SUPABASE

-- ================================================================
-- Rastreamento de uso em tempo real
-- ================================================================
CREATE TABLE IF NOT EXISTS tenant_usage_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  resource_type     TEXT NOT NULL CHECK (resource_type IN ('call_inbound', 'call_outbound', 'sms_outbound', 'sms_inbound', 'number_monthly')),
  resource_id       UUID,           -- call_records.id ou outbound_message_queue.id
  quantity          DECIMAL(10,4) NOT NULL,  -- minutos (calls) ou unidades (SMS)
  unit_cost_usd     DECIMAL(10,6) NOT NULL DEFAULT 0,  -- custo Telnyx por unidade
  total_cost_usd    DECIMAL(10,4) NOT NULL DEFAULT 0,  -- quantidade × unit_cost
  billing_period    DATE NOT NULL,  -- primeiro dia do mês: '2026-06-01'
  tenant_phone_number TEXT,         -- número envolvido
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tul_tenant_period   ON tenant_usage_log(tenant_id, billing_period);
CREATE INDEX idx_tul_resource_type   ON tenant_usage_log(tenant_id, resource_type, billing_period);
CREATE INDEX idx_tul_resource_id     ON tenant_usage_log(resource_id) WHERE resource_id IS NOT NULL;

ALTER TABLE tenant_usage_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tul_tenant_isolation" ON tenant_usage_log
  FOR SELECT USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

-- ================================================================
-- Agregado mensal por tenant (snapshot para faturamento)
-- ================================================================
CREATE TABLE IF NOT EXISTS tenant_monthly_usage (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  billing_period        DATE NOT NULL,           -- '2026-06-01'

  -- Chamadas
  call_inbound_minutes  DECIMAL(10,2) DEFAULT 0,
  call_outbound_minutes DECIMAL(10,2) DEFAULT 0,
  call_inbound_count    INTEGER DEFAULT 0,
  call_outbound_count   INTEGER DEFAULT 0,
  call_missed_count     INTEGER DEFAULT 0,

  -- SMS
  sms_outbound_count    INTEGER DEFAULT 0,
  sms_inbound_count     INTEGER DEFAULT 0,

  -- Números ativos
  active_numbers_count  INTEGER DEFAULT 0,

  -- Custos (USD — custo Telnyx, sem markup)
  total_cost_usd        DECIMAL(10,4) DEFAULT 0,

  -- Status de faturamento
  billed                BOOLEAN DEFAULT false,
  billed_at             TIMESTAMPTZ,
  stripe_usage_record_id TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, billing_period)
);

CREATE INDEX idx_tmu_tenant_period ON tenant_monthly_usage(tenant_id, billing_period);

ALTER TABLE tenant_monthly_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tmu_tenant_isolation" ON tenant_monthly_usage
  FOR SELECT USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

-- ================================================================
-- Planos de comunicação por tenant (define limites e preços)
-- ================================================================
CREATE TABLE IF NOT EXISTS tenant_communication_plans (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_name               TEXT NOT NULL DEFAULT 'starter',

  -- Inclusões mensais
  included_inbound_minutes  INTEGER NOT NULL DEFAULT 100,
  included_outbound_minutes INTEGER NOT NULL DEFAULT 60,
  included_sms_outbound     INTEGER NOT NULL DEFAULT 100,
  included_numbers          INTEGER NOT NULL DEFAULT 1,

  -- Preços de excedente (USD)
  overage_inbound_per_min   DECIMAL(10,6) DEFAULT 0.006,
  overage_outbound_per_min  DECIMAL(10,6) DEFAULT 0.015,
  overage_sms_per_unit      DECIMAL(10,6) DEFAULT 0.008,
  overage_number_per_month  DECIMAL(10,4) DEFAULT 3.50,

  -- Markup sobre custo Telnyx (em vez de preço fixo — opcional)
  markup_percentage         DECIMAL(5,2) DEFAULT 0,

  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id)
);

ALTER TABLE tenant_communication_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tcp_tenant_isolation" ON tenant_communication_plans
  FOR SELECT USING (tenant_id = (auth.jwt()->>'tenant_id')::uuid);

-- ================================================================
-- Inserir plano padrão para tenants existentes
-- ================================================================
INSERT INTO tenant_communication_plans (tenant_id, plan_name)
SELECT id, 'starter'
FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

-- ================================================================
-- View: uso atual do mês para dashboards
-- ================================================================
CREATE OR REPLACE VIEW tenant_current_month_usage AS
SELECT
  tenant_id,
  billing_period,
  SUM(CASE WHEN resource_type = 'call_inbound'  THEN quantity ELSE 0 END) AS inbound_minutes,
  SUM(CASE WHEN resource_type = 'call_outbound' THEN quantity ELSE 0 END) AS outbound_minutes,
  SUM(CASE WHEN resource_type = 'sms_outbound'  THEN quantity ELSE 0 END) AS sms_outbound_count,
  SUM(CASE WHEN resource_type = 'sms_inbound'   THEN quantity ELSE 0 END) AS sms_inbound_count,
  SUM(total_cost_usd) AS total_cost_usd,
  COUNT(*) AS total_events
FROM tenant_usage_log
WHERE billing_period = date_trunc('month', now())::date
GROUP BY tenant_id, billing_period;

-- Verificar
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('tenant_usage_log', 'tenant_monthly_usage', 'tenant_communication_plans');
```

---

### Script SEC-2 — Verificação e Auditoria (executar depois do SEC-1)

```sql
-- Verificar todas as tabelas de comunicação com RLS
SELECT
  t.tablename,
  t.rowsecurity AS rls_active,
  COUNT(p.policyname) AS policies
FROM pg_tables t
LEFT JOIN pg_policies p ON p.tablename = t.tablename
WHERE t.tablename IN (
  'tenant_phone_numbers', 'call_records', 'voicemails',
  'agent_telnyx_credentials', 'call_routing_rules',
  'tenant_usage_log', 'tenant_monthly_usage', 'tenant_communication_plans'
)
GROUP BY t.tablename, t.rowsecurity
ORDER BY t.tablename;
```

---

## 6. Fixes de Código (implementar após SQL)

### Fix C1+C2 — telnyx-call-webhook e telnyx-numbers
Ver arquivo `telnyx-call-webhook/index.ts` — adicionar `tenant_id` em todos os UPDATEs

### Fix C3+C4 — CommunicationsHub.tsx
Ver arquivo `CommunicationsHub.tsx` — adicionar `tenant_id` em voicemail e call notes

### Fix C5+C6 — Verificação de assinatura
Telnyx usa Ed25519 (não HMAC). Requer o `TELNYX_PUBLIC_KEY` do portal.

### Fix A2 — Rastreamento de uso em process-outbound e call-webhook
Após cada chamada/SMS: INSERT em `tenant_usage_log`

---

## 7. Perguntas do Usuário — Respostas Diretas

### "Como o tenant contrata o número?"
```
Tenant admin → Settings → Comunicações → "Comprar Número"
→ telnyx-numbers?action=search busca disponíveis na Telnyx
→ Tenant escolhe → POST action=purchase
→ Traffio compra na Telnyx (master key)
→ Salva em tenant_phone_numbers (tenant_id isolado)
→ Número aparece no painel do tenant
```
**Status atual:** ✅ Implementado | **Gap:** sem cap de gastos por tenant

### "Como é o controle de minutos (inbound/outbound)?"
```
Chamada termina → call.hangup webhook → duration_seconds em call_records
→ INSERT tenant_usage_log (resource_type='call_inbound', quantity=minutos)
→ VIEW tenant_current_month_usage agrega em tempo real
→ Comparar com tenant_communication_plans.included_*_minutes
→ Se excedeu: cobrar excedente via Stripe
```
**Status atual:** ❌ NÃO implementado | **Gap:** nenhum rastreamento existe

### "Como é o controle de SMS?"
```
SMS enviado → process-outbound → sendSms()
→ INSERT tenant_usage_log (resource_type='sms_outbound', quantity=1)

SMS recebido → telnyx-sms-webhook
→ INSERT tenant_usage_log (resource_type='sms_inbound', quantity=1)
```
**Status atual:** ❌ NÃO implementado | **Gap:** zero contagem de SMS

### "Como evitar leak entre tenants?"
```
Correções necessárias (implementar agora):
1. Todos os UPDATEs incluírem .eq('tenant_id', tenantId)
2. Webhook signature verification (Ed25519)
3. RLS ativo em todas as tabelas (já está — verificar com SEC-2)
```

---

## Resumo Executivo

| Área | Status Atual | Para Produção |
|---|---|---|
| Isolamento de dados (RLS) | ✅ Implementado nos SQLs do Bloco A | ✅ OK |
| Roteamento multi-tenant por número | ✅ Implementado | ✅ OK |
| Isolamento de chamadas (write ops) | ❌ Vulnerável (C1, C2) | Fixar código |
| Verificação de webhook | ❌ Ausente | Implementar |
| Rastreamento de minutos | ❌ Ausente | Criar tabelas + lógica |
| Rastreamento de SMS | ❌ Ausente | Criar tabelas + lógica |
| Plano por tenant (caps/limites) | ❌ Ausente | Criar tabela |
| Billing de uso | ❌ Ausente | Stripe Metered ou manual |

**Próximos passos obrigatórios antes de colocar em produção:**
1. Executar Script SEC-1 (tabelas de uso)
2. Corrigir C1–C6 no código
3. Implementar INSERT de uso no call-webhook e process-outbound
4. Adicionar tela de uso/consumo no CommunicationsHub
