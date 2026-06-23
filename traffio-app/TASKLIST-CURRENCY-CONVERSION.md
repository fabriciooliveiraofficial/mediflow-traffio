# Conversão BRL → Moeda Local (display-only) — Tasklist

> BRL é a fonte de verdade em toda a infraestrutura (cobrança, Stripe, ad spend). Esta feature **só afeta a exibição** em telas de analytics/dashboard da clínica — nenhum valor convertido é armazenado, somado ou usado em cálculo.

## Status

- [x] `src/lib/i18n/countryFormats.ts` — campo `currency` por país + `getCurrencyForCountry()`
- [x] `src/lib/i18n/formatCurrency.ts` — formatador puro (`Intl.NumberFormat`), fallback pt-BR/BRL
- [x] `src/hooks/useTenantCurrency.ts` — resolve moeda do tenant, lê `exchange_rates` (cache 1h em memória, staleness 36h), expõe `formatDual(valorBRL)`
- [x] `supabase/functions/refresh-exchange-rates/index.ts` — busca Frankfurter API (api.frankfurter.dev, gratuita, sem API key, base BRL → USD/MXN/NZD), upsert em `exchange_rates`, nunca falha o cron por erro transitório do provedor
- [x] `supabase/migrations/20260623_exchange_rates.sql` — tabela + RLS (`select` p/ `authenticated`, escrita só via service role) + cron diário 06:00 UTC — **executado pelo usuário no SQL Editor**

## Histórico de troca de provedor

Começamos com **exchangerate.host**, mas esse provedor (hoje operado pela apilayer) descontinuou o endpoint `/latest` e tornou o parâmetro `source` (moeda-base customizada) recurso pago — o plano gratuito exige API key e só permite base fixa em USD, obrigando cross-rate manual. Trocamos para **Frankfurter** (`api.frankfurter.dev`): 100% gratuito, sem cadastro, sem API key, aceita `base=BRL` direto. `getExchangeRateApiKey()` em `masterConfig.ts` foi removida (não é mais necessária).
- [x] `src/pages/Dashboard.tsx` — KPI "Ad Spend" + colunas monetárias da tabela de campanhas (spend/CPC/CPM/CPA) + exports PDF/Excel
- [x] `src/pages/FinancialDashboard.tsx` — KPI cards `summary.total`/`paid`/`pending`
- [x] `src/components/followup/PerformanceStats.tsx` — KPI "Vendas" (`metrics.totalRevenue`)
- [x] `src/pages/BillingPage.tsx` — preço grande dos 3 cards de plano (Essential/Clinic/Network); checkout/Stripe continua sempre cobrando em BRL, só a exibição do card mudou
- [x] `npx tsc --noEmit`, `npm run build`, `npm run lint` — limpos para todos os arquivos novos/modificados (erros de `any`/imports não usados restantes são pré-existentes, fora do escopo desta feature)
- [x] Migração SQL executada pelo usuário (tabela + RLS + cron diário 06:00 UTC, jobid 34)
- [x] Edge Function deployada (versão Frankfurter) e testada manualmente — `exchange_rates` populada com USD/MXN/NZD reais

## Status final: CONCLUÍDO

Feature em produção e validada ponta a ponta (banco + Edge Function + cron + frontend).

## Nota de escopo (correção feita durante a implementação)

O plano original previa também converter o "tooltip do gráfico de tendência de receita" em `PerformanceStats.tsx`. Ao reabrir o arquivo durante a implementação, constatei que esse gráfico não existe — os dois gráficos do componente (Funil de Vendas e Aquisição de Leads) mostram contagens, não dinheiro, e o `CustomTooltip` compartilhado nunca formata moeda. Apenas o card de KPI "Vendas" foi convertido.
