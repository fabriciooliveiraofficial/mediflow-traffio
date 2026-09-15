# Monetização da IA — plano aprovado (15/09/2026)

Decisão do usuário: **piso de 35% de margem bruta em qualquer cenário**, inclusive
o de estresse (cache 0%, dólar 6,00, conversa no teto). Este documento registra
os números, as regras e o que foi implementado. Análise completa e memória em
`memory/ai_monetization_unit_economics.md`.

## 1. Custos medidos (produção, 21/07–17/08, 1 tenant de teste)

| Item | Valor |
|---|---|
| Sonnet 5 | US$ 2 / 10 por MTok (cache write 1,25×, read 0,1×) |
| Haiku 4.5 (triagem) | US$ 1 / 5 |
| Cache hit | ~73% estável |
| Custo por resposta do agente | US$ 0,028 |
| Conversa média (3,85 respostas) | R$ 0,61 |
| Conversa p90 (7 respostas) | R$ 1,12 |
| **Estresse** (8 respostas, cache 0%, dólar 6,00) | **R$ 2,91** |

Custos por tenant fora da IA: Z-API **R$ 99,99/número** (pago pela Traffio),
Stripe BR 3,99% + R$ 0,39 + 0,7% Billing, imposto assumido 15,5% (Anexo V —
confirmar), infra rateada R$ 20–54.

## 2. Modelo

**Franquia em orçamento de custo, exibida como conversas.**
- 1 conversa = `AI_CONVERSATION_UNIT_BRL` (R$ 1,55) de custo real de IA.
- Toda chamada de LLM (agente, triagem, copiloto, imagem, documentos,
  comentários) grava `cost_brl_cents` em `ai_usage_logs` e conta na franquia do
  mês-calendário. Passou da franquia, o trigger debita da carteira de créditos.
- Sem franquia e sem créditos → IA pausa; a conversa vai para a fila humana
  (soft handoff, reason `ai_budget`) e o tenant recebe aviso por e-mail.
- Regra do piso: `preço × 44,81% − 0,39 ≥ custos fixos + franquia × 1,55`.

## 3. Tabela aprovada

| Plano | Mensal | Anual (por mês) | Conversas IA | Números WA |
|---|---|---|---|---|
| Essencial | R$ 297 | R$ 272 | 0 (compra pacote) | 1 |
| Clínica | R$ 547 | R$ 497 | 60 | 1 |
| Rede | R$ 997 | R$ 917 | 150 | 1 |
| Número WA adicional | R$ 229/mês | — | — | — |
| Trial (14 dias) | — | — | 20/mês | 1 |

Pacotes (créditos não expiram): 50 → R$ 199 · 150 → R$ 549 · 500 → R$ 1.790.
Anual = 1 mês grátis (11/12). O desconto de 20% foi abolido.

## 4. Salvaguardas

1. Gate de orçamento antes de qualquer chamada de IA (`_shared/aiBudget.ts`).
2. Teto diário por tenant (`AI_DAILY_CAP_BRL`, R$ 30).
3. Rate limit por telefone (`AI_PHONE_TURNS_PER_HOUR`, 40).
4. Tenant suspenso/cancelado/trial vencido → franquia 0.
5. Câmbio e parâmetros em `master_config`, não no código.
6. Spend limit na conta Anthropic (manual, painel da Anthropic).

## 5. Onde está cada coisa

| Camada | Arquivo |
|---|---|
| Schema, funções, trigger | `supabase/migrations/20260915_ai_budget_and_pricing.sql` |
| Gate + aviso | `supabase/functions/_shared/aiBudget.ts` |
| Custo em BRL por chamada | `supabase/functions/_shared/llmProvider.ts` |
| Roteamento com gate | `supabase/functions/process-inbox/index.ts` |
| Comentários (IG/FB) com gate | `supabase/functions/ai-reply-*-comments/index.ts` |
| Checkout de pacote | `supabase/functions/stripe-create-ai-package-checkout/` |
| Crédito no webhook | `supabase/functions/stripe-webhook/index.ts` (`type=ai_package`) |
| Catálogo Stripe (planos, nº extra) | `supabase/functions/stripe-sync-catalog/` |
| Preços no frontend | `src/config/planConfig.ts`, `src/locales/*/billing.json`, `landing.json` |
| Uso de IA + compra de pacote | `src/pages/BillingPage.tsx` |

## 6. Status da implementação (15/09/2026)

Feito e em produção:
- Migração aplicada (planos, `ai_packages`, `master_config`, `cost_brl_cents`,
  carteira, ledger, `ai_budget_status`, `ai_credit_apply`, trigger de débito).
  Trigger validado com transação de teste (R$33 de uso → franquia esgotada,
  1,60 conversa debitada, `allowed=false`).
- Histórico de custo Sonnet corrigido (×2/3) e backfill de `cost_brl_cents`.
- Edge Functions deployadas: process-inbox (gate + reason `ai_budget`),
  whatsapp-bot, ai-reply-*-comments (gate), extract-clinic-facts, stripe-webhook
  (crédito de pacote), stripe-create-checkout / stripe-change-plan (price via
  master_config), stripe-create-ai-package-checkout, stripe-sync-catalog,
  stripe-set-extra-numbers.
- Frontend: preços, textos dos planos (pt/en/es), card de uso de IA + compra de
  pacote em /billing, botão "Sincronizar catálogo Stripe" no master.

Pendente (ação humana):
1. Master → Faturamento → **Sincronizar catálogo Stripe** (cria os Prices novos
   e grava em master_config; até lá o checkout usa os Price IDs antigos dos
   secrets).
2. Spend limit na conta Anthropic.
3. Confirmar regime tributário.
4. Multi-instância Z-API por tenant ainda não existe no modelo de dados
   (`tenants.zapi_instance_id` é um só) — o add-on de número extra está
   precificado e cobrável, mas a 2ª instância é provisionamento manual.

## 7. Operação

- Revisar `AI_USD_BRL_RATE` todo mês; acima de 6,20 reprecificar pacotes.
- Re-medir custo/conversa com 30 dias de clínicas reais e ajustar franquias.
- Confirmar regime tributário: no Anexo III (6%) todas as margens sobem ~9,5 pp.
