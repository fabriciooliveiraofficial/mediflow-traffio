# Diagnóstico — Conexão Meta Ads / Google Ads não exibe dados (Analytics Pro)

**Data:** 2026-06-15
**Severidade:** CRÍTICO — Integração "conecta" (status fica Ativo), mas nenhuma campanha, gasto, lead ou conversão é exibido.

---

## Sintoma reportado

1. Usuário clica em **"Conectar Conta Meta"** na página **Analytics Pro**.
2. Popup OAuth do Facebook abre, fluxo completa, popup fecha.
3. Botão muda para **"Gerenciar Conexão"** (✓ Ativo) — ou seja, `ad_integrations.status = 'active'` foi gravado com sucesso.
4. **Porém**: nenhuma campanha, gasto, lead, conversão, clique ou gráfico aparece. O painel continua mostrando o estado "Aguardando integração".
5. Console mostra erros `"A listener indicated an asynchronous response... message channel closed"`.

---

## Diagnóstico (causas raiz)

### Causa Raiz 0 (CRÍTICA, BLOQUEADORA — descoberta ao rodar a Fase 0) — Coluna `settings` não existe em `ad_integrations` no banco real

Ao tentar rodar o script de diagnóstico da **Fase 0**, o Supabase retornou:

```
ERROR: 42703: column ai.settings does not exist
LINE 8:   ai.settings,
```

A migration `supabase/migrations/20260603_ads_integrations_and_performance.sql` define `ad_integrations` com `settings JSONB DEFAULT '{}'::jsonb`, mas usa `CREATE TABLE IF NOT EXISTS`. O erro confirma que a tabela `ad_integrations` **já existia no banco antes dessa migration** (criada por outro processo/migration não rastreada, provavelmente para o fluxo de "Meta Messaging"), então `CREATE TABLE IF NOT EXISTS` foi um **no-op** — a coluna `settings` (e possivelmente outras) nunca foi criada.

**Impacto — BLOQUEIA O DEPLOY das correções desta sessão:**
- `auth-meta/index.ts` e `auth-google/index.ts` (Fase 1) agora fazem `upsert(..., settings: adAccountSettings, ...)`. Se a coluna não existir, o Postgres rejeita o upsert (`column "settings" of relation "ad_integrations" does not exist`) → **o callback OAuth passaria a falhar com erro 500**, pior do que o estado atual.
- `sync-ads-performance` (Fase 2) lê/grava `integration.settings` e usa `updateIntegrationSettings(...)` — falharia pelo mesmo motivo.

#### Diagnóstico de schema confirmado (0.0a/0.0b)

- `ad_integrations` (real) tem: `id, tenant_id, platform, account_id, account_name, access_token, refresh_token, token_expires_at, status, created_at, updated_at` — **sem `settings`**. As colunas `account_id`/`account_name`/`token_expires_at` não são usadas por nenhum código atual (`auth-google`, `auth-meta-messaging` não as referenciam) — são leftovers inofensivos, não serão tocados.
- UNIQUE `(tenant_id, platform)` existe em `ad_integrations` → compatível com `onConflict: "tenant_id,platform"` usado pelos upserts.
- `ad_performance_daily` (real) tem **todas** as colunas que `sync-ads-performance` grava (`spend_cents, revenue_cents, leads_count, conversion_count, impressions, clicks, date, platform, tenant_id`), e a UNIQUE `(tenant_id, platform, date)` bate exatamente com `onConflict: "tenant_id,platform,date"`. **Nenhuma alteração necessária nesta tabela.**

#### Correção (rodar no SQL Editor do Supabase — aditiva, idempotente, sem risco)

```sql
-- Adiciona a coluna settings (JSONB) usada por auth-meta, auth-google e sync-ads-performance
-- para guardar ad_account_id, available_ad_accounts, customer_id, developer_token,
-- last_sync_error e last_sync_at. Não afeta nenhuma coluna/linha existente.
ALTER TABLE public.ad_integrations
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;
```

➡️ **Depois de rodar este script, o deploy das Edge Functions (Fase 1/2) pode prosseguir com segurança.**

---

### Causa Raiz 1 (CRÍTICA) — `sync-ads-performance` nunca é executada

**Arquivo:** `supabase/functions/sync-ads-performance/index.ts`

Essa Edge Function é a **única** responsável por popular a tabela `ad_performance_daily` (que alimenta todo o card "Conexões Ads", o gráfico "Evolução de Tráfego" e os KPIs do topo).

Busquei em todas as migrations por `cron.schedule` referenciando `sync-ads-performance` — **não existe nenhum job de cron** chamando essa função (existem apenas crons para `process-outbound`, `process-outbox`, `process-inbox`, `schedule-reminders`). Também não há nenhuma chamada a essa função no frontend (`src/`).

**Resultado:** mesmo com a integração "Ativa", `ad_performance_daily` permanece **vazia para sempre** — nada jamais é sincronizado. Isso por si só já explica 100% do sintoma "nada aparece".

---

### Causa Raiz 2 (CRÍTICA) — OAuth do Meta nunca captura o `ad_account_id`

**Arquivo:** `supabase/functions/auth-meta/index.ts`, linhas 96-108 (upsert em `ad_integrations`)

O upsert grava apenas `tenant_id`, `platform`, `access_token`, `status`. O campo `settings` (JSONB) fica `{}` — nunca é perguntado/buscado **qual conta de anúncios (Ad Account)** do Facebook deve ser sincronizada.

**Arquivo:** `supabase/functions/sync-ads-performance/index.ts`, linha 45:
```ts
const adAccountId = settings?.ad_account_id ?? "act_default";
```

Como `settings.ad_account_id` nunca existe, o fallback `"act_default"` é usado — **isso não é um ID de conta de anúncios válido**. A chamada à Graph API (`/act_default/insights`) retorna erro, o código faz `continue` (linha 53) e **nenhuma linha é gravada** em `ad_performance_daily`.

➡️ **Mesmo que o cron da Causa Raiz 1 fosse criado agora, o sync do Meta continuaria falhando silenciosamente** por falta do Ad Account ID real.

---

### Causa Raiz 3 (CRÍTICA, mesmo padrão) — Google Ads usa `customer_id` e `developer_token` placeholders

**Arquivo:** `supabase/functions/sync-ads-performance/index.ts`, linhas 135 e 149:
```ts
const customerId = settings?.customer_id ?? "1234567890"; // default customer id
...
"developer-token": settings?.developer_token ?? "",
```

Mesmo problema: o fluxo `auth-google/index.ts` nunca grava `customer_id` nem `developer_token` em `ad_integrations.settings`. A chamada à Google Ads API falharia por customer ID inválido / developer-token vazio.

---

### Causa Raiz 4 (CRÍTICA) — Dashboard nunca re-busca os dados após conectar

**Arquivo:** `src/pages/Dashboard.tsx`

- `handleConnect()` (linhas 82-116) faz polling em `ad_integrations` e, ao detectar `status = 'active'`, só executa:
  ```ts
  setIntegrations(prev => ({ ...prev, [platform]: true }));
  ```
- `fetchDashboardData()` (dentro do `useEffect`, linhas 118-207) — que busca `ad_performance_daily`, `appointments` e `patients` — só roda **uma vez ao montar** (depende de `tenant?.id` e `period`, nunca de `integrations`).

➡️ **Mesmo que `ad_performance_daily` tivesse dados**, a tela não atualizaria sozinha — precisaria de reload manual da página. Esse é um bug independente, que potencializa a sensação de "nada aconteceu".

---

### Causa Raiz 5 (MÉDIA / UX) — "Gerenciar Conexão" não tem função própria

**Arquivo:** `src/pages/Dashboard.tsx`, linha 390 e 433:
```tsx
onClick={() => handleConnect('meta')}
...
{integrations.meta ? "Gerenciar Conexão" : "Conectar Conta Meta"}
```

O `onClick` é o mesmo independentemente do estado. Clicar em "Gerenciar Conexão" **reabre o popup OAuth do zero**, em vez de abrir uma área de gerenciamento (conta de anúncios vinculada, status do último sync, erro, desconectar).

---

### Causa Raiz 6 (CRÍTICA) — Popup do OAuth não fecha sozinho e fica como "página da plataforma" aberta

**Arquivos:** `public/oauth-callback.html` (linhas 221-269) e `src/pages/Dashboard.tsx` (`handleConnect`, linhas 82-116)

Após o Facebook autorizar, `auth-meta`/`auth-google` redirecionam o popup para:
```
${redirectBack}/oauth-callback.html?status=success&platform=meta
```
`oauth-callback.html` faz parte do **build do Traffio** (`dist/oauth-callback.html`, mesma origem/marca da plataforma) — por isso visualmente parece "uma nova seção/página da plataforma" abrindo.

Essa página tenta duas coisas:
1. `window.opener.postMessage({ type: 'OAUTH_CONNECTED', platform }, '*')` (linha ~227)
2. `setTimeout(() => window.close(), 3000)` (linha ~268)

**Problema 1 — `window.close()` é bloqueado pelo navegador.**
Durante o fluxo, o popup sofre **duas navegações de topo**:
- Navegação 1: `window.open(authUrl)` → `auth-meta` → redirect 302 → tela de login/autorização do Facebook.
- Navegação 2: clique em "Continuar/Autorizar" no Facebook → `auth-meta` (callback com `code`) → redirect 302 → `oauth-callback.html`.

Isso deixa `window.history.length === 2`. Chrome/Edge/Firefox **só permitem que um script feche a própria janela (`window.close()`) se `history.length === 1`** (ou seja, se a janela nunca navegou para outra página depois do `window.open` inicial). Com `history.length === 2`, `window.close()` é **silenciosamente ignorado** — a aba/janela permanece aberta mostrando "Meta Ads Conectado!".

**Problema 2 — o `postMessage` nunca é recebido.**
Busquei em todo `src/` por `postMessage`, `OAUTH_CONNECTED`, `window.addEventListener('message'` e **não há nenhuma ocorrência**. O `Dashboard.tsx` **não escuta** a mensagem enviada por `oauth-callback.html` e **não guarda a referência** da janela aberta (`window.open(...)` é chamado sem capturar o retorno). Mesmo corrigindo o Problema 1, hoje não há como o `opener` reagir a essa mensagem.

A única detecção de sucesso hoje é o **polling em `ad_integrations`** (a cada 2s, por até 5 min) — que só atualiza o estado `integrations`, e não fecha a janela do OAuth.

➡️ **Resultado prático:** a aba/janela do OAuth (com a marca Traffio) fica aberta indefinidamente após conectar. Combinado com a **Causa Raiz 5** (cada clique em "Gerenciar Conexão" reabre o fluxo do zero), **cada tentativa deixa mais uma aba dessas aberta** — exatamente o "fico com páginas da plataforma abertas" relatado.

---

### Observação — Erros de console não são causa raiz

```
dashboard:1 Uncaught (in promise) Error: A listener indicated an asynchronous response
by returning true, but the message channel closed before a response was received
```

Esse erro é uma **assinatura clássica de extensões do Chrome** (gerenciadores de senha, Grammarly, tradutores, etc.) que injetam content-scripts na página — não está relacionado ao código do Traffio. Pode ser confirmado testando em **janela anônima sem extensões**. Não faz parte do plano de correção, apenas registrado para não gerar confusão.

---

## Plano de Correção

> ⚠️ Nenhum código será alterado até o usuário aprovar este plano, conforme solicitado.

### Fase 0 — Diagnóstico no banco (somente leitura, sem alterações)

- [x] **0.0a** Rodar primeiro o script de **diagnóstico de schema** abaixo (não falha mesmo se colunas/tabelas estiverem faltando) e colar o resultado aqui no chat — necessário para gerar o `ALTER TABLE` correto da Causa Raiz 0:

```sql
-- 0.0a — Colunas existentes em ad_integrations e ad_performance_daily
select table_name, column_name, data_type, column_default, is_nullable, ordinal_position
from information_schema.columns
where table_schema = 'public'
  and table_name in ('ad_integrations', 'ad_performance_daily')
order by table_name, ordinal_position;

-- 0.0b — Constraints (PK/UNIQUE) das duas tabelas
select tc.table_name, tc.constraint_name, tc.constraint_type, kcu.column_name, kcu.ordinal_position
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
where tc.table_schema = 'public'
  and tc.table_name in ('ad_integrations', 'ad_performance_daily')
order by tc.table_name, tc.constraint_type, kcu.ordinal_position;
```

- [ ] **0.1** Depois que a Causa Raiz 0 estiver corrigida (coluna `settings` existir), rodar o script abaixo e colar o resultado aqui no chat:

```sql
-- 0.1 — Estado atual da integração Meta/Google para todos os tenants
select
  ai.tenant_id,
  ai.platform,
  ai.status,
  (ai.access_token is not null) as has_access_token,
  (ai.refresh_token is not null) as has_refresh_token,
  ai.settings,
  ai.updated_at
from public.ad_integrations ai
order by ai.updated_at desc;

-- 0.2 — Quantas linhas existem em ad_performance_daily (deve estar vazio/quase vazio)
select tenant_id, platform, count(*) as dias, min(date) as primeiro_dia, max(date) as ultimo_dia
from public.ad_performance_daily
group by tenant_id, platform;

-- 0.3 — Confirmar se META_CLIENT_ID / META_CLIENT_SECRET estão configurados (sem mostrar o valor)
select key, (value is not null and value <> '') as configurado, updated_at
from public.master_config
where key like 'META_%' or key like 'GOOGLE_%' or key like 'FACEBOOK_%';

-- 0.4 — Jobs de cron existentes (confirmar que sync-ads-performance NÃO está agendado)
select jobid, jobname, schedule, active
from cron.job
order by jobname;
```

---

### Fase 1 — Capturar o Ad Account ID real no OAuth do Meta ✅ IMPLEMENTADO

- [x] **1.1** Após o exchange do `long_lived_token` em `auth-meta/index.ts`, chamar `GET /me/adaccounts?fields=account_id,name` na Graph API.
- [x] **1.2** Se houver **1 conta**: salvar automaticamente em `ad_integrations.settings.ad_account_id` (formato `act_<id>`).
- [x] **1.3** Se houver **múltiplas contas**: salvar a lista em `settings.available_ad_accounts` e marcar `settings.needs_account_selection = true` (seleção disponível na UI — Fase 6).

### Fase 2 — Corrigir `sync-ads-performance` (Meta + Google) ✅ IMPLEMENTADO

- [x] **2.1** Removido o fallback `"act_default"`. Se `settings.ad_account_id` ausente → não chama a API, grava `settings.last_sync_error = "Conta de anúncios do Meta não configurada."` e pula (`continue`).
- [x] **2.2** Mesma lógica para Google: exige `settings.customer_id` e `settings.developer_token` reais; sem eles, marca `last_sync_error` em vez de chamar a API com placeholder.
- [x] **2.3** Em caso de erro de API (token expirado, conta inválida, etc.), persiste o erro em `ad_integrations.settings.last_sync_error` + `last_sync_at` via novo helper `updateIntegrationSettings`.
- [x] **2.4** Em caso de sucesso, grava `settings.last_sync_at` (timestamp) e limpa `last_sync_error`. Também adicionado `&time_increment=1` na chamada ao Meta para granularidade diária.

### Fase 3 — Agendar execução automática via pg_cron ✅ IMPLEMENTADO

- [x] **3.1** Job pg_cron criado chamando `sync-ads-performance` a cada 3 horas (`jobid = 31`, `sync-ads-performance-every-3h`).
- [x] **3.2** Script executado com sucesso (2026-06-15):

```sql
-- Placeholder — preencher <<<SEU_SERVICE_ROLE_KEY>>> e executar SOMENTE
-- após o deploy da nova versão de sync-ads-performance (Fase 2)

select cron.unschedule(jobname)
from cron.job
where jobname = 'sync-ads-performance-every-3h';

select cron.schedule(
  'sync-ads-performance-every-3h',
  '0 */3 * * *',
  $$
    select net.http_post(
      url     := 'https://fyyhxmugxcfqhvoevuwf.supabase.co/functions/v1/sync-ads-performance',
      body    := '{}',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer <<<SEU_SERVICE_ROLE_KEY>>>"}'::jsonb
    );
  $$
);
```

### Fase 4 — Popup do OAuth: fechar automaticamente e parar de deixar páginas abertas (Causa Raiz 6) ✅ IMPLEMENTADO

- [x] **4.1** Em `Dashboard.tsx` → `handleConnect`: capturada a referência da janela: `const popup = window.open(authUrl, '_blank', ...)`.
- [x] **4.2** Registrado `window.addEventListener('message', handleMessage)` junto da abertura do popup, escutando `{ type: 'OAUTH_CONNECTED', platform }` e `{ type: 'OAUTH_ERROR', platform, message }` enviados por `oauth-callback.html` (com checagem `event.origin === window.location.origin`).
- [x] **4.3** Ao receber `OAUTH_CONNECTED`/`OAUTH_ERROR`:
  - `popup.close()` chamado **a partir do opener** (funciona mesmo com `history.length > 1`).
  - `message` listener removido (`cleanup()`).
  - `pollInterval`/`pollTimeout` limpos (não precisa mais esperar até 5 min).
  - `integrations` atualizado imediatamente + toast de sucesso/erro exibido.
- [x] **4.4** Polling em `ad_integrations` mantido apenas como **fallback** (popup bloqueado pelo navegador ou `postMessage` falhar).

### Fase 5 — Sincronização imediata + refresh automático do Dashboard ✅ IMPLEMENTADO

- [x] **5.1** `fetchDashboardData` extraído como função reutilizável (`useCallback`), chamada tanto no `useEffect` inicial quanto após reconectar/sincronizar.
- [x] **5.2** Nova função `triggerSyncAndRefresh()`:
  - Dispara (fire-and-forget) `POST /functions/v1/sync-ads-performance` para popular dados imediatamente (não espera o cron de 3h).
  - Chama `fetchDashboardData()` após 4s para refletir os novos dados sem reload da página.
  - Acionada automaticamente em `OAUTH_CONNECTED` e no botão "Sincronizar Agora" do modal (Fase 6).

### Fase 6 — UI "Gerenciar Conexão" ✅ IMPLEMENTADO

- [x] **6.1** Quando `integrations.meta` (ou `.google`) for `true`, o botão **"Gerenciar Conexão"** abre um modal com:
  - Conta de anúncios vinculada (`settings.ad_account_id`) e seletor (`settings.available_ad_accounts`, se `needs_account_selection = true`)
  - Última sincronização (`settings.last_sync_at`) / erro (`settings.last_sync_error`)
  - Botões "Sincronizar Agora" e "Desconectar" (seta `status = 'inactive'`)
- [x] **6.2** Apenas o botão **"Conectar"** (estado não-ativo) chama `handleConnect()` / abre o popup OAuth; quando já ativo, abre o modal `openManageModal()`.

---

## Status

- [x] **Fases 1, 2, 4, 5 e 6 implementadas no código** (`auth-meta/index.ts`, `sync-ads-performance/index.ts`, `Dashboard.tsx`).
- [x] **Causa Raiz 0 diagnosticada** — confirmado que falta apenas a coluna `settings JSONB` em `ad_integrations`. `ad_performance_daily` está 100% compatível, nenhuma alteração necessária.
- 🔴 **PENDENTE — rodar a correção de schema (Causa Raiz 0) antes de qualquer deploy:**
  ```sql
  ALTER TABLE public.ad_integrations
    ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;
  ```
  **⚠️ NÃO fazer o deploy das Edge Functions (`auth-meta`, `sync-ads-performance`) antes desse `ALTER TABLE`** — caso contrário o callback OAuth do Meta/Google passa a retornar erro 500 (regressão pior que o estado atual).
- [x] **Deploy concluído** (2026-06-15):
  - ✅ Edge Function `auth-meta` deployada com sucesso.
  - ✅ Edge Function `sync-ads-performance` deployada com sucesso.
  - ✅ Frontend buildado (`vite build`, 3752 módulos) e publicado via `wrangler deploy` → `mediflow-traffio.fabriciooliveiraofficial.workers.dev`.
- [x] **Fase 0.1-0.4 — resultados (2026-06-15):**
  - **0.1** — `ad_integrations` tem 3 linhas: 2x Meta (`status=active`, `has_access_token=true`, mas `settings={}` — criadas pelo `auth-meta` **antigo**, sem `ad_account_id`) e 1x Google (tenant `362fa1ba...`, `has_access_token=false`, `updated_at` de abril — conexão quebrada/incompleta).
  - **0.2** — `ad_performance_daily` **vazia** (0 linhas) — confirma Causa Raiz 1.
  - **0.3** — `master_config`: `META_CLIENT_ID`/`META_CLIENT_SECRET` configurados ✅; `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` **não** configurados no `master_config` ❌.
  - **0.4** — nenhum cron job para `sync-ads-performance` (confirma Causa Raiz 1).
  - **Checagem extra:** `npx supabase secrets list` mostra que `META_CLIENT_ID`, `META_CLIENT_SECRET`, `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` **estão todos configurados como Secrets do Edge Function** (fonte usada por `sync-ads-performance` e por `auth-google`). Ou seja, `sync-ads-performance` **não cairá no modo demo** para nenhuma das duas plataformas.
  - **Conclusão Meta:** as 2 integrações existentes precisam de **reconexão** (Desconectar → Conectar Conta Meta novamente) para que o `auth-meta` novo (já deployado) popule `settings.ad_account_id`. Sem isso, o sync grava `last_sync_error: "Conta de anúncios do Meta não configurada."` (sem travar).
  - **Conclusão Google:** `auth-google` não captura `customer_id`/`developer_token` (exigidos pela Google Ads API, obtidos manualmente no Google Ads API Center) — comportamento esperado da Fase 2.2 (`last_sync_error` sem travar). Configuração completa do Google Ads é um item separado, fora do escopo deste fix.
- [x] **Fase 3 — cron criado e ativo** (`jobid = 31`, `sync-ads-performance-every-3h`, a cada 3h).
- [ ] **Pendente: Reconectar Meta** — na página Analytics Pro: "Gerenciar Conexão" → "Desconectar" → "Conectar Conta Meta" (para as 2 integrações Meta existentes, ou ao menos a do tenant de teste).
- [ ] **Pendente: Reteste end-to-end** — após reconectar o Meta:
  - Popup deve **fechar automaticamente** após o OAuth (sem deixar aba/página da Traffio aberta).
  - Toast de sucesso deve aparecer.
  - Após ~4s, o dashboard deve atualizar (campanhas/spend/leads do Meta), ou exibir `last_sync_error` no modal "Gerenciar Conexão" se ainda houver algum problema (ex: usuário Facebook sem Ad Account, token sem permissão `ads_read`).
