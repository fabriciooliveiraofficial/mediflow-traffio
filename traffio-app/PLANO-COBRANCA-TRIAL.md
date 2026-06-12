# PLANO — Cobrança com Trial de 14 Dias + Cartão Obrigatório

> **Objetivo:** Forçar coleta de cartão de crédito antes do acesso à plataforma, com trial de 14 dias sem cobrança, captura de lead por e-mail em todo registro (remarketing), e cobrança automática infalível pós-trial via Stripe. Isolamento total de pagamentos por tenant.
>
> **Status geral:** 🟡 EM ANDAMENTO — Migrations 1, 2 e 3 executadas no banco (2026-06-12)
> **Criado em:** 2026-06-12

---

## Arquitetura da Solução

### Fluxo completo (novo)

```
Landing Page (CTA "Começar trial de 14 dias")
   │  passa ?plan=essencial&cycle=monthly na URL
   ▼
/register?plan=clinica&cycle=annual
   │  cliente preenche formulário e clica "Criar Conta"
   ▼
[1] Edge Function `register-lead` (fire-and-forget, SEMPRE executa)
   │  • grava lead na tabela `registration_leads` (service-role only)
   │  • envia e-mail via SMTP próprio (Hostinger, mailbox cadastro@traffio.com.br) → cadastro@traffio.com.br
   │  • NUNCA bloqueia o fluxo se falhar (lead fica no banco p/ retry)
   ▼
[2] Provisionamento atual (auth user → profile → tenant → member)
   │  tenant criado com plan = plano selecionado, status = 'trial'
   ▼
[3] Modal de Pagamento (PaymentRequiredModal) — OBRIGATÓRIO, sem fechar
   │  • mostra plano selecionado + preço + ciclo
   │  • "14 dias grátis — nada será cobrado hoje"
   │  • "Cancele a qualquer momento em Configurações → Assinatura"
   │  • "Após 14 dias, sua assinatura será cobrada automaticamente"
   │  • botão único: "Adicionar forma de pagamento"
   ▼
[4] Stripe Checkout (mode: subscription)
   │  • subscription_data.trial_period_days = 14
   │  • payment_method_collection: "always"  ← cartão OBRIGATÓRIO
   │  • Stripe valida o cartão (hold de R$0) sem cobrar
   ▼
[5] Webhook: checkout.session.completed (subscription.status = 'trialing')
   │  • tenants.subscription_status = 'trial'
   │  • tenants.card_on_file = TRUE
   │  • tenants.trial_ends_at = subscription.trial_end (fonte: Stripe)
   ▼
[6] SubscriptionGuard (frontend) libera acesso ao /dashboard
   │  REGRA: sem card_on_file = TRUE → acesso bloqueado (volta ao modal)
   ▼
[7] Dia 14: Stripe cobra AUTOMATICAMENTE (zero código nosso)
   │  • invoice.payment_succeeded → status = 'active'
   │  • invoice.payment_failed   → Smart Retries (4 tentativas) → 'suspended'
   │  • customer.subscription.trial_will_end (3 dias antes) → e-mail aviso
```

### Por que a cobrança "jamais falha"

1. **Cartão validado no checkout** — Stripe faz verificação de R$0 ao salvar o cartão
2. **Cobrança automática pelo Stripe** no fim do trial — não depende de cron nosso
3. **Smart Retries** do Stripe (ativar no dashboard) — 4 retentativas inteligentes em até 2 semanas
4. **Webhook idempotente** — eventos reprocessados não duplicam faturas
5. **Aviso 3 dias antes** (`trial_will_end`) — cliente atualiza cartão se necessário
6. **Suspensão automática** se todas as tentativas falharem → gate bloqueia acesso e exige novo cartão

### Isolamento multi-tenant (pagamentos)

- 1 Stripe Customer **por tenant** com `metadata.tenant_id` (já existe)
- `tenants.stripe_customer_id` é `UNIQUE` (já existe)
- `registration_leads`: RLS **deny-all** — somente service-role acessa (dados de remarketing nunca expostos)
- `tenant_invoices`: RLS por membership (já existe)
- Webhook resolve tenant **somente** via `stripe_customer_id` — nunca aceita tenant_id do payload sem validar
- Frontend nunca vê chave secreta Stripe; tudo via Edge Functions com JWT

---

## TASKLIST EXECUTÁVEL

### FASE 0 — Pré-requisitos (manual, fora do código)

> **Decisão (2026-06-12):** sem serviços externos de e-mail (Resend/SendGrid). O envio será via **SMTP da Hostinger**, usando a caixa `cadastro@traffio.com.br` que já existe. A Edge Function atua como *cliente* SMTP (biblioteca `denomailer`), conectando nesse servidor — toda a lógica/template fica no nosso código.

- [x] **0.1** ✅ Credenciais SMTP definidas (Hostinger):
  - Host: `smtp.hostinger.com`
  - Porta: `465` (SSL/TLS)
  - Usuário: `cadastro@traffio.com.br`
  - Senha: ✅ definida (ver 0.2)
- [x] **0.2** ✅ Secrets configurados no Supabase (`npx supabase secrets list` confirma os 6 presentes):
  - `SMTP_HOST=smtp.hostinger.com`
  - `SMTP_PORT=465`
  - `SMTP_USER=cadastro@traffio.com.br`
  - `SMTP_PASS` ✅ definido pelo usuário (Dashboard/CLI, sem passar pelo chat)
  - `SMTP_FROM=cadastro@traffio.com.br`
  - `REGISTRATION_NOTIFY_EMAIL=cadastro@traffio.com.br`
- [x] **0.3** ✅ Os 4 Price IDs Stripe já estão configurados nos secrets do Supabase
- [x] **0.4** ✅ Smart Retries ativo no Stripe Dashboard
- [x] **0.5** ✅ Evento `customer.subscription.trial_will_end` adicionado ao webhook endpoint no Stripe Dashboard

> ✅ **FASE 0 completa.** Todos os pré-requisitos manuais foram concluídos em 2026-06-12.

> ⚠️ **Risco conhecido:** alguns provedores bloqueiam/limitam conexões SMTP de IPs "novos" (proteção anti-spam). Se o envio falhar com erro de autenticação/conexão na primeira tentativa, pode ser necessário liberar o acesso SMTP externo no painel da Hostinger para essa conta. Isso só aparece no teste real (Fase 2.4).

### FASE 1 — Banco de dados (script SQL no final deste arquivo)

- [x] **1.1** ✅ Executar `MIGRATION 1` no SQL Editor do Supabase (executado em 2026-06-12):
  - tabela `registration_leads` (captura de leads p/ remarketing, RLS deny-all)
  - coluna `tenants.card_on_file BOOLEAN DEFAULT FALSE`
  - coluna `registration_leads.email_sent_at` (auditoria do envio)
- [x] **1.2** ✅ Script salvo em `supabase/migrations/20260612_trial_billing_enforcement.sql`

### FASE 2 — Edge Function `register-lead` (e-mail SEMPRE enviado)

- [x] **2.1** ✅ Criado `supabase/functions/_shared/email.ts`:
  - helper `sendEmail({ to, subject, html })` usando **denomailer** (cliente SMTP para Deno)
  - lê `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` dos secrets
  - reutilizável por outras functions (ex: `trial_will_end` na Fase 6.3)
- [x] **2.2** ✅ Criado `supabase/functions/register-lead/index.ts`:
  - recebe `{ clinic_name, admin_name, email, phone, plan_id, billing_cycle }`
  - grava em `registration_leads` (service-role)
  - envia e-mail HTML via `sendEmail()` (SMTP) para `REGISTRATION_NOTIFY_EMAIL` com todos os dados do formulário
  - marca `email_sent_at` em caso de sucesso; se falhar, lead permanece no banco com `email_sent_at IS NULL` (retry manual possível)
  - responde 200 sempre que o lead foi gravado (e-mail é best-effort, lead é obrigatório)
- [x] **2.3** ✅ Deploy executado: `npx supabase functions deploy register-lead --project-ref fyyhxmugxcfqhvoevuwf`
- [x] **2.4** ✅ Teste manual via curl executado e CONFIRMADO — lead gravado e `email_sent_at = 2026-06-12 16:15:47` preenchido. SMTP Hostinger funcionando via Edge Function (sem bloqueio de IP).

> ✅ **FASE 2 completa.**

### FASE 3 — Seleção de plano na Landing → Register

- [x] **3.1** ✅ `LandingPage.tsx`: cards de preço (essencial/clínica/rede) agora navegam para `/register?plan=<id>&cycle=<billingCycle>`. CTAs genéricos ("Começar Agora", hero, SolutionCard) continuam em `/register` (default essencial/monthly, resolvido na 3.3). O caso "rede sem checkout" é tratado downstream (stripe-create-checkout já retorna `redirect_to_sales` — será exposto na Fase 5).
- [x] **3.2** ✅ `LandingPage.tsx`: textos ajustados —
  - Stats bar ("14 dias / Trial gratuito"): sub trocado de "sem cartão de crédito" → "cancele quando quiser"
  - Pricing card (planos essencial/clínica): "Sem cartão de crédito" → "14 dias grátis · cancele quando quiser"
- [x] **3.3** ✅ `RegisterPage.tsx`: lê `?plan=` e `?cycle=` via `useSearchParams`, valida contra `PLAN_ORDER` (default `essencial`/`monthly`), exibe badge do plano selecionado (ícone, nome, ciclo e preço/mês) no topo do formulário.

> ✅ **FASE 3 completa.** `npx tsc --noEmit` sem erros.

### FASE 4 — RegisterPage: lead + tenant com plano + modal

- [x] **4.1** ✅ `handleRegister` dispara `supabase.functions.invoke('register-lead', ...)` logo após validar o form, ANTES do provisionamento, sem await bloqueante (fire-and-forget com `.catch` logado) — captura garantida mesmo em desistência. Funciona pré-login: o supabase-js envia a anon key, validada pelo curl da Fase 2.4.
- [x] **4.2** ✅ Insert em `tenants` agora inclui `plan: selectedPlanId` e `billing_cycle: billingCycle` (a coluna `trial_ends_at` já tem default `NOW() + 14 dias` na migration `20260602_subscription_plans.sql`)
- [x] **4.3** ✅ Após provisionamento, não navega mais para `/dashboard`: guarda `tenantData.trial_ends_at` e faz `setStep(3)` → renderiza `PaymentRequiredModal`
- [x] **4.4** ✅ (extra necessário p/ cancel_url) Criada página `src/pages/RegisterPaymentPage.tsx` + rota `/register/payment` no `App.tsx`: reexibe o `PaymentRequiredModal` com `plan`/`billing_cycle`/`trial_ends_at` do tenant logado (via `useTenant`); redireciona a `/login` se não autenticado

> ✅ **FASE 4 completa.**

### FASE 5 — Componente `PaymentRequiredModal`

- [x] **5.1** ✅ Criado `src/components/billing/PaymentRequiredModal.tsx`:
  - modal **não-fechável** (overlay fixo z-100, sem X, sem clique-fora, sem ESC)
  - resumo do plano: ícone, nome, ciclo, preço/mês e "cobrado a partir de <data trial_ends_at>" (fallback: hoje + 14 dias)
  - bullets obrigatórios incluídos:
    - ✅ "14 dias grátis para testar — nada será cobrado hoje"
    - ✅ "Cancele a qualquer momento na página **Configurações**, sem custo"
    - ✅ "Sua assinatura só é cobrada após o fim dos 14 dias de trial"
  - botão "Adicionar forma de pagamento" → invoca `stripe-create-checkout` com `success_url: /dashboard?welcome=1` · `cancel_url: /register/payment`
  - trata `redirect_to_sales` (plano rede → mailto vendas) e exibe erro inline com retry
  - selo "Pagamento processado com segurança pela Stripe"
- [x] **5.2** ✅ Modal reutilizado no `SubscriptionGuard` (Fase 7.1) para qualquer conta em trial sem cartão

> ✅ **FASE 5 completa.** `npx tsc --noEmit` sem erros.

### FASE 6 — Stripe: checkout com trial + webhook

- [x] **6.1** ✅ `stripe-create-checkout/index.ts`:
  - `subscription_data.trial_period_days` calculado de `tenants.trial_ends_at` (mín. 1, máx. 14 dias), aplicado APENAS quando `subscription_status === 'trial'` com data futura — upgrade de conta ativa continua cobrando imediato
  - `payment_method_collection: "always"` (cartão sempre coletado, mesmo com total R$0)
  - `metadata.flow = "registration_trial"` quando o trial é aplicado (em session e subscription metadata)
  - texto do botão do checkout: "nada será cobrado durante os N dias de trial"
- [x] **6.2** ✅ `stripe-webhook/index.ts` — `checkout.session.completed`:
  - `subscription.status === 'trialing'`: seta `subscription_status='trial'`, `card_on_file=TRUE`, `trial_ends_at=subscription.trial_end`, `subscription_external_id`, `billing_cycle`, `plan`, `subscription_renews_at` — NÃO ativa nem zera o trial
  - `status === 'active'` (upgrade sem trial): comportamento atual mantido (`activateSubscription` + fatura)
- [x] **6.3** ✅ `stripe-webhook/index.ts` — novo case `customer.subscription.trial_will_end`:
  - busca owner do tenant (members → profiles), envia e-mail via `_shared/email.ts` (SMTP Hostinger): valor da cobrança (extraído da subscription) e data (trial_end), com lembrete de cancelamento em Configurações — best-effort, nunca falha o webhook
- [x] **6.4** ✅ `customer.subscription.updated`: detecta transição `trialing → active` via `previous_attributes.status`; quando ativo seta `card_on_file=TRUE`, `trial_ends_at=null` e garante `subscription_started_at`; registra a 1ª fatura (idempotente)
- [x] **6.5** ✅ Idempotência: helper `insertInvoiceOnce()` verifica `external_invoice_id` existente antes de qualquer INSERT em `tenant_invoices` (aplicado nos 3 pontos: payment_failed, payment_succeeded, createInvoiceRecord)
- [x] **6.6** ✅ Deploy executado: `stripe-create-checkout` e `stripe-webhook` no projeto `fyyhxmugxcfqhvoevuwf`

> ✅ **FASE 6 completa.**

### FASE 7 — Gate de acesso (`SubscriptionGuard`)

- [x] **7.1** ✅ Criado `src/components/billing/SubscriptionGuard.tsx`, integrado no `TenantApp` (`App.tsx`) dentro do `DashboardLayout`, recebendo `activeScreen`/`onNavigate` (a navegação do dashboard é por estado interno, não por URL):
  - `subscription_status === 'trial' && !card_on_file` (e trial não expirado) → `PaymentRequiredModal` em tela cheia (bloqueia TUDO, inclusive billing/settings — fecha o item 5.2)
  - `isTrialExpired || status === 'suspended'` → tela "Seu trial terminou" / "Pagamento pendente" com CTA → telas `billing` e `settings` continuam acessíveis
  - `status === 'canceled'` → tela "Assinatura cancelada" com CTA "Reativar assinatura"
  - `status === 'active'` ou trial válido com cartão → acesso liberado
  - tenant não carregado (loading/super_admin) → não bloqueia (guards de rota cuidam)
- [x] **7.2** ✅ `TenantContext`: interface `Tenant` ganhou `card_on_file: boolean` (o fetch usa `select('*')`, então o valor já vem do banco)
- [x] **7.3** ✅ Rotas master (`/master/*`) e portal do paciente (`/portal/*`) ficam fora do guard — ele só envolve o conteúdo do `TenantApp` (`/dashboard/*`)

> ✅ **FASE 7 completa.** `npx tsc --noEmit` sem erros.

### FASE 8 — Cancelamento + Billing Portal + troca flexível de planos (AJUSTADA)

> **Ajuste (2026-06-12, decisão do usuário):** o cancelamento fica na página **Assinatura** (BillingPage), no botão **"Gerenciar Faturamento"** — não em Settings. A página também passou a permitir troca flexível de planos respeitando o período/ciclo já pago.

- [x] **8.1** ✅ Criada `supabase/functions/stripe-create-portal/index.ts`:
  - valida JWT → tenant do member (owner/admin only)
  - `stripe.billingPortal.sessions.create({ customer, return_url, locale: pt-BR })` — no portal: atualizar cartão, ver faturas e **cancelar assinatura**
- [x] **8.2** ✅ Criada `supabase/functions/stripe-change-plan/index.ts` — troca de plano respeitando o ciclo contratado:
  - **Em trial (trialing)**: troca imediata do price com `proration_behavior: 'none'`, trial preservado — nada é cobrado; a 1ª cobrança já sai no valor novo
  - **Upgrade** (plano superior OU mesmo plano mensal→anual): imediato com `proration_behavior: 'always_invoice'` — tempo não usado vira crédito, só a diferença proporcional é cobrada
  - **Downgrade** (plano inferior OU anual→mensal): agendado para o fim do período pago via **Subscription Schedule** (fase 1 = plano atual até `current_period_end`; fase 2 = novo price com metadata p/ o webhook) — `tenant.plan` só muda na virada, aplicado pelo `subscription.updated`
  - Downgrade agendado anterior é liberado (release) antes de qualquer nova mudança
  - Sem assinatura Stripe → `{ needs_checkout: true }` (front cai no checkout normal) · plano rede → `{ redirect_to_sales }`
- [x] **8.3** ✅ `BillingPage.tsx` ("Assinatura"):
  - botão "Gerenciar Faturamento" ligado ao portal (`stripe-create-portal`) com loading e tooltip "Atualizar cartão, ver faturas e cancelar assinatura"
  - botões dos planos agora chamam `stripe-change-plan` (com confirmação prévia explicando proração/agendamento) e caem no checkout só quando não há assinatura
  - "Plano atual" considera plano **e** ciclo — permite migrar mensal↔anual no mesmo plano ("Mudar para anual/mensal")
  - labels corrigidos: "Fazer upgrade" / "Mudar de plano" / "Falar com vendas" (antes o card essencial mostrava "Começar trial de 14 dias" num downgrade)
  - banner "Mudança agendada: plano X em DD/MM" após downgrade + toasts de sucesso/erro + `refresh()` do tenant após upgrade
- [x] **8.4** ✅ Coerência de textos com o novo local do cancelamento:
  - `PaymentRequiredModal`: bullet → "Cancele a qualquer momento na página **Assinatura → Gerenciar Faturamento**, sem custo"
  - e-mail `trial_will_end` (stripe-webhook): idem
- [x] **8.5** ✅ Billing Portal configurado no Stripe Dashboard (2026-06-12): cancelamento **ao final do período de faturamento** + atualização de forma de pagamento ativos. Alterar planos/quantidades via portal: **desativados** (troca de plano é feita só pela plataforma, via `stripe-change-plan`).
- [x] **8.6** ✅ Deploy executado: `stripe-create-portal`, `stripe-change-plan` e `stripe-webhook` (texto atualizado)

> ✅ **FASE 8 completa.** `npx tsc --noEmit` sem erros.

### FASE 9 — Testes E2E (Stripe test mode)

> **DECISÃO (2026-06-12):** testes serão feitos em **LIVE MODE com cartão real** (secrets são `sk_live`). Adaptações:
> - Usar **Essencial mensal (R$ 197)** nos testes que geram cobrança (9.3, 9.6-upgrade) para minimizar valor; **reembolsar** depois no Dashboard (Payments → Refund — a taxa Stripe não é devolvida)
> - **9.4 (falha de pagamento) ADIADO** — cartões de falha só existem em test mode; caminho de suspensão fica coberto por revisão de código + Smart Retries
> - 🧹 **Limpeza obrigatória pós-teste:** cancelar TODAS as assinaturas de teste no Stripe (Cancel immediately) — senão cobram de verdade em 14 dias — e remover tenants/leads de teste do banco
> - Frontend local: `npm run dev` (aponta para o Supabase de produção via `.env`)

- [ ] **9.1** Registro completo (caminho feliz):
  - Landing → card **Clínica** com toggle **Anual** → `/register?plan=clinica&cycle=annual` (badge confere plano/preço)
  - Preencher form → "Criar Conta" → modal de pagamento aparece (NÃO vai ao dashboard)
  - E-mail "Novo cadastro: ..." chegou em `cadastro@traffio.com.br`
  - "Adicionar forma de pagamento" → checkout mostra **R$ 0 hoje / trial 14 dias** → cartão `4242...` → volta em `/dashboard?welcome=1` e acessa normalmente
  - Verificação SQL:
    ```sql
    SELECT name, plan, billing_cycle, subscription_status, card_on_file,
           trial_ends_at, subscription_external_id
    FROM tenants ORDER BY created_at DESC LIMIT 1;
    -- esperado: plan=clinica, billing_cycle=annual, status=trial,
    -- card_on_file=true, trial_ends_at ~ +14d, external_id=sub_...
    ```
  - *Obs.: se ao voltar do checkout o modal ainda aparecer, é corrida com o webhook — aguardar ~5s e recarregar.*
- [ ] **9.2** Desistência (remarketing + gate):
  - Registrar outra conta e **abandonar no modal** (fechar aba)
  - Lead gravado + e-mail enviado (`SELECT email, email_sent_at FROM registration_leads ORDER BY created_at DESC LIMIT 1;`)
  - Login com essa conta → `SubscriptionGuard` reexibe o modal, dashboard bloqueado
- [ ] **9.3** Trial → 1ª cobrança (sem esperar 14 dias): no Stripe Dashboard (test mode), abrir a subscription do teste 9.1 → **Actions → Update subscription → End trial now** (ou via API `trial_end: 'now'`) → fatura emitida e paga →
  ```sql
  SELECT subscription_status, trial_ends_at, subscription_started_at
  FROM tenants WHERE subscription_external_id = 'sub_...';
  -- esperado: status=active, trial_ends_at=NULL, started_at preenchido
  SELECT status, amount, external_invoice_id FROM tenant_invoices
  WHERE tenant_id = '...' ORDER BY created_at DESC;
  -- esperado: 1 fatura paga, SEM duplicata
  ```
- [ ] **9.4** Falha de pagamento: registrar conta nova com cartão `4000 0000 0000 0341` → "End trial now" → cobrança falha → tenant `suspended` → login mostra tela "Pagamento pendente" (só Assinatura/Configurações acessíveis) → fatura `failed` registrada
- [ ] **9.5** Cancelamento: página Assinatura → "Gerenciar Faturamento" → portal abre em pt-BR → cancelar → volta com aviso de cancelamento no fim do período; ao fim (ou "Cancel immediately" no Dashboard p/ acelerar) → tenant `canceled` → tela "Assinatura cancelada"
- [ ] **9.6** Troca flexível de planos (Fase 8):
  - Conta em trial: trocar Essencial→Clínica → imediato, sem cobrança, toast OK
  - Conta ativa: upgrade → fatura proporcional gerada na hora; downgrade → banner "Mudança agendada para DD/MM" e `tenant.plan` inalterado até lá
- [ ] **9.7** Isolamento multi-tenant: logado no tenant A, conferir que Assinatura/faturas mostram só dados de A; via SQL conferir que `tenant_invoices` de B não vazam (RLS)
- [ ] **9.8** Webhook duplicado: Stripe Dashboard → Webhooks → evento `invoice.payment_succeeded` do teste 9.3 → **Resend** → `tenant_invoices` continua com 1 registro (log: "fatura ... já registrada — skip")

---

## SCRIPT SQL — MIGRATION 1 (colar no SQL Editor do Supabase)

```sql
-- ================================================================
-- TRIAL BILLING ENFORCEMENT
-- Leads de registro (remarketing) + flag de cartão no tenant
-- ================================================================

-- 1. Tabela de leads de registro (TODO registro gera um lead,
--    mesmo em caso de desistência — base de remarketing)
CREATE TABLE IF NOT EXISTS public.registration_leads (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_name    TEXT NOT NULL,
    admin_name     TEXT NOT NULL,
    email          TEXT NOT NULL,
    phone          TEXT,
    plan_id        TEXT,
    billing_cycle  TEXT CHECK (billing_cycle IN ('monthly', 'annual')),
    tenant_id      UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
    email_sent_at  TIMESTAMPTZ,          -- quando o e-mail p/ cadastro@ foi enviado
    converted_at   TIMESTAMPTZ,          -- quando inseriu cartão (conversão)
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS deny-all: somente service-role (Edge Functions) acessa.
-- Dados sensíveis de remarketing JAMAIS expostos a tenants.
ALTER TABLE public.registration_leads ENABLE ROW LEVEL SECURITY;
-- (sem policies = nenhum acesso via anon/authenticated)

CREATE INDEX IF NOT EXISTS idx_registration_leads_email
    ON public.registration_leads (email);
CREATE INDEX IF NOT EXISTS idx_registration_leads_created_at
    ON public.registration_leads (created_at DESC);

-- 2. Flag de cartão cadastrado no tenant (gate de acesso)
ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS card_on_file BOOLEAN NOT NULL DEFAULT FALSE;

-- Tenants que já têm assinatura ativa no Stripe possuem cartão
UPDATE public.tenants
SET card_on_file = TRUE
WHERE subscription_status = 'active'
   OR subscription_external_id IS NOT NULL;

-- Índice para o gate (consulta frequente no login)
CREATE INDEX IF NOT EXISTS idx_tenants_card_on_file
    ON public.tenants (card_on_file)
    WHERE card_on_file = FALSE;
```

---

# PARTE 2 — Enforcement de Recursos por Plano + Anti-Fraude de Sessões

> **Diagnóstico (2026-06-12):** os limites por plano existem (`planConfig.ts` + tabela `plans`) e os helpers `can()`/`canAddProfessional()`/`canAddLocation()` existem em `usePlan.ts`, mas **nenhum enforcement é aplicado em lugar nenhum** (nem UI, nem Edge Functions, nem banco). Controle de sessões simultâneas: **inexistente** (padrão Supabase = sessões ilimitadas).

### FASE 10 — Enforcement de limite de usuários/profissionais (server-side)

- [x] **10.1** ✅ DECISÃO: **Opção B adotada** — TODOS os membros ativos do tenant contam no limite, independente do papel (owner incluso)
- [x] **10.2** ✅ `MIGRATION 2` executada no SQL Editor (2026-06-12) — trigger `enforce_member_limit` ativo em `members`
- [x] **10.2b** ✅ `MIGRATION 2b` executada no SQL Editor (2026-06-12) — trigger agora conta TODOS os membros ativos (Opção B)
- [ ] **10.3** `invite-member/index.ts`: antes de criar o convite, contar TODOS os membros ativos (Opção B) vs `plans.max_professionals` do plano do tenant → se atingido, retornar 403 `{ error, code: 'PLAN_LIMIT_REACHED', limit, current }`
- [ ] **10.4** `accept-invite/index.ts`: re-validar o limite no momento do aceite (convite pode ter sido criado antes do limite estourar)
- [ ] **10.5** UI `TeamManagement.tsx` / `Professionals.tsx`: usar `canAddProfessional(count)` para desabilitar botão de convite + banner "Limite do plano atingido — fazer upgrade" linkando para `/billing`
- [ ] **10.6** Aplicar o mesmo padrão para `max_locations` (criação de unidades) e `max_whatsapp_numbers` (compra de números Telnyx)
- [ ] **10.7** Downgrade de plano: webhook (`customer.subscription.updated`) NÃO desativa membros automaticamente — apenas bloqueia novas adições; exibir aviso "Você tem 5 profissionais, seu novo plano permite 2" no Billing

### FASE 11 — Sessão única / anti-compartilhamento de senha

- [ ] **11.1** Avaliar upgrade do projeto Supabase para plano Pro e ativar **Enforce single session per user** (Dashboard → Authentication → Sessions) — derruba sessão anterior no refresh do token (janela de até ~1h)
- [x] **11.2** ✅ `MIGRATION 3` executada no SQL Editor (2026-06-12) — tabela `active_sessions` + RLS + trigger de sessão única; script salvo em `supabase/migrations/20260612_active_sessions.sql`
- [ ] **11.3** Criar `src/services/sessionGuardService.ts`:
  - no login: registra sessão (`session_id` do JWT, fingerprint do dispositivo, user-agent, IP via edge function) e marca como "sessão corrente" do usuário
  - heartbeat a cada 2 min: atualiza `last_seen_at`; se a sessão corrente do usuário no banco for OUTRA (login mais novo em outro lugar), executa `supabase.auth.signOut()` + tela "Sua conta foi acessada em outro dispositivo"
- [ ] **11.4** Integrar o guard no `AuthContext.tsx` (iniciar/parar heartbeat junto com a sessão)
- [ ] **11.5** Realtime (opcional, melhora p/ derrubada instantânea): subscription no canal `active_sessions` do próprio usuário → desloga na hora em vez de esperar o heartbeat
- [ ] **11.6** Tela em `Settings.tsx` → "Dispositivos conectados": listar sessões do usuário com botão "Desconectar" (transparência + autosserviço)

### FASE 12 — Auditoria anti-fraude (sinal, não bloqueio)

- [ ] **12.1** Edge function/cron diário: detectar padrões suspeitos em `active_sessions` (mesma conta, IPs de geolocalizações distantes em < 24h; > N dispositivos distintos/semana)
- [ ] **12.2** Gravar flags em tabela `fraud_signals` (service-role only) e exibir no Master Dashboard (`/master`) para ação comercial
- [ ] **12.3** E-mail automático ao owner do tenant no 2º flag: "Detectamos uso compartilhado de credenciais — cada profissional precisa do próprio usuário (LGPD/auditoria de prontuário)"

---

## SCRIPT SQL — MIGRATION 2 (limite de membros por plano)

```sql
-- ================================================================
-- ENFORCEMENT: limite de profissionais por plano (camada banco)
-- Trigger dispara em INSERT/UPDATE de members com is_active = TRUE
-- ================================================================

CREATE OR REPLACE FUNCTION public.enforce_member_limit()
RETURNS TRIGGER AS $$
DECLARE
    v_max_professionals INT;
    v_current_count     INT;
BEGIN
    -- Só valida ativações
    IF (NEW.is_active IS DISTINCT FROM TRUE) THEN
        RETURN NEW;
    END IF;

    -- Limite do plano do tenant (NULL = ilimitado)
    SELECT p.max_professionals
      INTO v_max_professionals
      FROM public.tenants t
      JOIN public.plans p ON p.id = t.plan
     WHERE t.id = NEW.tenant_id;

    IF v_max_professionals IS NULL THEN
        RETURN NEW;  -- plano Rede: ilimitado
    END IF;

    -- Conta membros ativos com papel clínico (ajustar conforme decisão 10.1)
    SELECT COUNT(*)
      INTO v_current_count
      FROM public.members
     WHERE tenant_id = NEW.tenant_id
       AND is_active = TRUE
       AND role IN ('doctor')          -- Opção A; p/ Opção B remover este filtro
       AND id IS DISTINCT FROM NEW.id; -- não contar o próprio registro em UPDATE

    IF (NEW.role IN ('doctor')) AND v_current_count >= v_max_professionals THEN
        RAISE EXCEPTION 'PLAN_LIMIT_REACHED: o plano atual permite % profissional(is). Faça upgrade para adicionar mais.', v_max_professionals
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_enforce_member_limit ON public.members;
CREATE TRIGGER trg_enforce_member_limit
    BEFORE INSERT OR UPDATE OF is_active, role ON public.members
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_member_limit();
```

## SCRIPT SQL — MIGRATION 2b (ajuste para Opção B — SUBSTITUI a função acima)

> Decisão 10.1 final: TODOS os membros ativos contam no limite (owner incluso).

```sql
-- ================================================================
-- AJUSTE: limite de membros por plano — OPÇÃO B (decisão 10.1)
-- Agora TODOS os membros ativos do tenant contam no limite
-- max_professionals do plano, independente do papel.
-- ================================================================

CREATE OR REPLACE FUNCTION public.enforce_member_limit()
RETURNS TRIGGER AS $$
DECLARE
    v_max_members   INT;
    v_current_count INT;
BEGIN
    -- Só valida ativações
    IF (NEW.is_active IS DISTINCT FROM TRUE) THEN
        RETURN NEW;
    END IF;

    -- Limite do plano do tenant (NULL = ilimitado)
    SELECT p.max_professionals
      INTO v_max_members
      FROM public.tenants t
      JOIN public.plans p ON p.id = t.plan
     WHERE t.id = NEW.tenant_id;

    IF v_max_members IS NULL THEN
        RETURN NEW;  -- plano Rede: ilimitado
    END IF;

    -- OPÇÃO B: conta TODOS os membros ativos do tenant (qualquer role)
    SELECT COUNT(*)
      INTO v_current_count
      FROM public.members
     WHERE tenant_id = NEW.tenant_id
       AND is_active = TRUE
       AND id IS DISTINCT FROM NEW.id; -- não contar o próprio registro em UPDATE

    IF v_current_count >= v_max_members THEN
        RAISE EXCEPTION 'PLAN_LIMIT_REACHED: o plano atual permite % usuário(s) ativo(s). Faça upgrade para adicionar mais.', v_max_members
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recriar o trigger (qualquer ativação de membro passa pela validação)
DROP TRIGGER IF EXISTS trg_enforce_member_limit ON public.members;
CREATE TRIGGER trg_enforce_member_limit
    BEFORE INSERT OR UPDATE OF is_active, role, tenant_id ON public.members
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_member_limit();
```

## SCRIPT SQL — MIGRATION 3 (controle de sessões ativas)

```sql
-- ================================================================
-- SESSÕES ATIVAS: rastreio de dispositivos + sessão única
-- ================================================================

CREATE TABLE IF NOT EXISTS public.active_sessions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id    TEXT NOT NULL UNIQUE,   -- claim session_id do JWT
    tenant_id     UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    device_label  TEXT,                   -- ex: "Chrome · Windows"
    user_agent    TEXT,
    ip_address    TEXT,
    is_current    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_active_sessions_user
    ON public.active_sessions (user_id, is_current);
CREATE INDEX IF NOT EXISTS idx_active_sessions_tenant
    ON public.active_sessions (tenant_id);

ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;

-- Usuário vê e gerencia apenas as próprias sessões
CREATE POLICY "sessions_own_select" ON public.active_sessions
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "sessions_own_insert" ON public.active_sessions
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "sessions_own_update" ON public.active_sessions
    FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "sessions_own_delete" ON public.active_sessions
    FOR DELETE USING (user_id = auth.uid());

-- Ao registrar nova sessão corrente, desativa as anteriores do usuário
CREATE OR REPLACE FUNCTION public.deactivate_previous_sessions()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_current = TRUE THEN
        UPDATE public.active_sessions
           SET is_current = FALSE
         WHERE user_id = NEW.user_id
           AND id <> NEW.id
           AND is_current = TRUE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_deactivate_previous_sessions ON public.active_sessions;
CREATE TRIGGER trg_deactivate_previous_sessions
    AFTER INSERT ON public.active_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.deactivate_previous_sessions();

-- Limpeza de sessões mortas (> 7 dias sem heartbeat)
-- Agendar via pg_cron ou edge function diária:
-- DELETE FROM public.active_sessions WHERE last_seen_at < NOW() - INTERVAL '7 days';
```

---

## Decisões e observações

| Decisão | Justificativa |
|---|---|
| Stripe Checkout com `trial_period_days` (não Setup Intent manual) | Stripe valida o cartão, gerencia o trial e cobra sozinho no dia 14 — menor superfície de erro |
| Lead via Edge Function (não client-side) | E-mail e gravação acontecem server-side com service-role; cliente não consegue pular nem ver a senha SMTP |
| SMTP próprio (Hostinger) em vez de Resend/SendGrid | Decisão do cliente: nenhuma conta nova em serviço externo de envio; usa a caixa `cadastro@traffio.com.br` já existente — tudo gerenciado pela plataforma |
| Lead gravado ANTES do provisionamento | Captura mesmo se o provisionamento falhar ou o cliente fechar a aba |
| `card_on_file` como coluna própria | Gate simples e barato no frontend sem chamar o Stripe a cada load |
| Tenants antigos sem cartão | O `SubscriptionGuard` exibirá o modal no próximo login deles — comportamento desejado ("sempre forçar") |
| Plano `rede` | Continua fluxo de vendas (sem checkout self-service) |

## Variáveis de ambiente novas (Supabase Secrets)

| Secret | Valor | Status |
|---|---|---|
| `SMTP_HOST` | `smtp.hostinger.com` | ✅ configurado |
| `SMTP_PORT` | `465` | ✅ configurado |
| `SMTP_USER` | `cadastro@traffio.com.br` | ✅ configurado |
| `SMTP_PASS` | senha da caixa (Hostinger) | ✅ configurado (definido diretamente pelo usuário) |
| `SMTP_FROM` | `cadastro@traffio.com.br` | ✅ configurado |
| `REGISTRATION_NOTIFY_EMAIL` | `cadastro@traffio.com.br` | ✅ configurado |
