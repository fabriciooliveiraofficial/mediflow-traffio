# Auditoria — Assinaturas Traffio (Stripe) — 14/09/2026

Objetivo: confirmar que a página de assinatura (`/billing`), os botões de plano, o upgrade/downgrade e a conexão com a conta Stripe estão corretos e prontos para monetizar de verdade.

## Resumo executivo

| Item | Status |
|---|---|
| Botões de assinatura (checkout inicial) | ✅ Correto |
| Botão de upgrade/downgrade de plano | 🔴 Estava quebrado — **corrigido nesta auditoria** |
| Botão "Gerenciar Faturamento" (Stripe Portal) | ✅ Correto e configurado |
| Conta Stripe em modo Live | ✅ Confirmado (`pk_live_...`) |
| Catálogo de preços no Stripe vs. app | ✅ Idêntico (verificado direto no Stripe) |
| Segredos/variáveis de ambiente (Price IDs, chaves) | ✅ Todos configurados |
| Webhook — endpoint, URL, eventos assinados | ✅ Correto (6/6 eventos) |
| Webhook — compatibilidade de versão da API | ✅ **Corrigido e implantado** — ver seção 2 |

---

## 1. Bug crítico corrigido: upgrade/downgrade quebrava com erro falso

**Arquivo:** [BillingPage.tsx](traffio-app/src/pages/BillingPage.tsx) — função `handleChangePlan`.

A variável `targetPlanName` era declarada com `const` **dentro** do bloco `if (!isTrialing) { ... }` (linha 90 original), mas era usada **fora** desse bloco, dentro do `try` que trata a resposta do backend (linhas 121, 122, 128, 129 originais) — um erro de escopo de JavaScript/TypeScript puro e simples.

Confirmei com `tsc --noEmit` (o `vite build` usado no deploy real **não** roda checagem de tipos, por isso isso nunca foi pego antes):

```
src/pages/BillingPage.tsx(121,81): error TS2304: Cannot find name 'targetPlanName'.
src/pages/BillingPage.tsx(122,76): error TS2304: Cannot find name 'targetPlanName'.
src/pages/BillingPage.tsx(128,48): error TS2304: Cannot find name 'targetPlanName'.
src/pages/BillingPage.tsx(129,90): error TS2304: Cannot find name 'targetPlanName'.
```

**Efeito real em produção:** toda vez que um tenant clicava para trocar de plano (upgrade OU downgrade), o backend (`stripe-change-plan`) processava a troca com sucesso real no Stripe — mas, ao voltar a resposta, o frontend **crashava** com `ReferenceError: targetPlanName is not defined` antes de mostrar o toast de sucesso e antes de chamar `refresh()` para atualizar a tela. O `catch` do próprio código então capturava esse erro e mostrava **"Erro ao alterar plano"** para o cliente — uma mensagem de erro falsa, sobre uma operação que na verdade tinha dado certo no Stripe. O cliente ficaria sem saber se a troca funcionou, e a tela continuaria mostrando o plano antigo.

**Correção aplicada:** movi a declaração de `targetPlanName` para o topo da função (fora do bloco condicional), eliminando o problema de escopo. Confirmado com `tsc --noEmit` que o erro desapareceu.

---

## 2. Risco crítico — corrigido em 14/09/2026

Este foi o achado mais importante desta auditoria. **Já está corrigido e implantado em produção.**

**O que encontrei:** no painel do Stripe (Workbench → Webhooks → o endpoint que aponta para `stripe-webhook`), a **"Versão da API" configurada no endpoint é `2025-11-17.clover`**. Mas todo o código (`stripe-webhook`, `stripe-change-plan`, `stripe-create-checkout`, `stripe-create-portal`) cria o cliente Stripe fixado em `apiVersion: "2024-06-20"` — uma versão anterior à atualização "Basil" do Stripe.

Em 31/03/2025, o Stripe [removeu os campos `current_period_start`/`current_period_end` do objeto Subscription](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end), movendo-os para dentro de `subscription.items.data[].current_period_end`. Isso significa que qualquer eventos de webhook entregue neste endpoint (que usa a versão `2025-11-17.clover`, posterior a essa mudança) **não tem mais** `subscription.current_period_end` no nível raiz do objeto.

O handler `customer.subscription.updated` em [stripe-webhook/index.ts:193](traffio-app/supabase/functions/stripe-webhook/index.ts:193) lê exatamente esse campo diretamente do payload bruto do webhook:

```ts
const renewsAt = new Date(subscription.current_period_end * 1000).toISOString();
```

Como `subscription.current_period_end` vem `undefined` nesse payload, `new Date(undefined * 1000)` produz uma Data inválida, e `.toISOString()` **lança uma exceção** (`RangeError: Invalid time value`) — isso acontece **antes** da linha que atualiza o tenant no banco (`await supabase.from("tenants").update(updates)`, linha 222). O `catch` do webhook responde 500 ao Stripe, e a atualização no banco **nunca acontece**.

**Isso quebra silenciosamente:**
- A transição de trial → ativo quando a 1ª cobrança acontece de verdade (o campo `subscription_status` do tenant nunca vira `'active'` via este caminho);
- Qualquer renovação mensal/anual subsequente;
- A troca de plano feita pelo próprio cliente no Stripe Billing Portal;
- **A ativação do downgrade agendado** (`stripe-change-plan`, seção 5c) — o novo plano só é aplicado no banco quando este mesmo evento dispara na virada do ciclo.

**Evidência de que ainda não causou dano visível:** confirmei diretamente no painel do Stripe (aba "Entregas de eventos" do endpoint) que esse webhook **nunca recebeu nenhuma entrega, em nenhum momento** — ou seja, nenhuma assinatura real completou um ciclo ainda. O bug existe mas ainda não "explodiu" porque a plataforma ainda não processou uma renovação real. Isso é uma bomba-relógio: vai falhar na primeira renovação/1ª cobrança real que acontecer.

**Tentativa da correção rápida (repinar o endpoint) — não é possível:** ao tentar criar um novo endpoint de webhook no Stripe fixado em `2024-06-20`, descobri que o painel só permite escolher entre a versão atual da conta (`2025-11-17.clover`) ou versões mais novas (`2026-08-26.dahlia`/`.preview`) — o Stripe não deixa fixar um endpoint novo numa versão antiga/já aposentada. E a versão de um endpoint já existente não pode ser editada de forma alguma (confirmado no painel: campo bloqueado com "Este campo não pode ser alterado"). Ou seja, a única correção real possível é ajustar o código.

**Correção aplicada:** adicionei funções auxiliares (`getPeriodEnd`/`getPeriodStart`) em `stripe-webhook/index.ts` e `stripe-change-plan/index.ts` que leem o campo tanto do lugar antigo (`subscription.current_period_end`) quanto do novo (`subscription.items.data[0].current_period_end`), o que quer que esteja disponível no payload recebido. Troquei todos os usos diretos do campo (linhas 159, 193, 217, 461-462 do webhook; linha 190 do change-plan) para usar os helpers. Já **implantado em produção** via `supabase functions deploy stripe-webhook` e `stripe-change-plan`. Isso resolve o problema independentemente de qual versão de API o Stripe usar no payload, então a correção também é à prova de futuras mudanças de versão.

---

## 3. O que está correto e verificado

**Checkout inicial (`stripe-create-checkout`):** resolve o Price ID certo por plano+ciclo via variáveis de ambiente, cria/reaproveita o Stripe Customer, respeita o trial já em andamento do tenant (inclusive extensões dadas pelo super-admin), sempre coleta cartão mesmo em trial R$0, texto de confirmação em pt-BR. Sem problemas.

**Troca de plano (`stripe-change-plan`):** lógica sofisticada e correta —
- Em trial: troca imediata e gratuita, sem cobrar nada.
- Upgrade (ou mensal→anual do mesmo plano): imediato, com proração (`always_invoice`) — cobra só a diferença proporcional.
- Downgrade: agendado via Subscription Schedule para o fim do ciclo já pago — o cliente não perde o que já pagou.
- Libera automaticamente um schedule anterior se o cliente mudar de ideia antes da troca agendada se efetivar.
- Autorização restrita a `owner`/`admin` do tenant.

**Portal de faturamento (`stripe-create-portal` + configuração no Stripe):** a configuração "Padrão" do Customer Portal já existe no Stripe, com Faturas, Dados do cliente, Formas de pagamento e **Cancelamento habilitado** (cancela no fim do período, com coleta de motivo) — confirmei isso diretamente no painel. O botão "Gerenciar Faturamento" vai funcionar.

**Conta Stripe:**
- Confirmada em **modo Live** (chave pública `pk_live_...LWU1` visível no painel).
- Catálogo de produtos no Stripe tem exatamente os 3 planos com os preços certos, batendo 100% com o `planConfig.ts` do app: Essencial R$197/mês (R$1.896/ano = R$158/mês), Clínica R$397/mês (R$3.816/ano = R$318/mês), Rede R$897/mês (R$8.616/ano = R$718/mês).
- Todos os 8 segredos necessários estão configurados no Supabase: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, e os 6 `STRIPE_PRICE_*` (um por plano×ciclo).
- Endpoint de webhook aponta para a URL certa (`.../functions/v1/stripe-webhook`) e está assinado exatamente para os 6 tipos de evento que o código sabe tratar — nem faltando, nem sobrando nenhum.

**Webhook (`stripe-webhook`), lógica de negócio (fora do bug da seção 2):** trata corretamente checkout, renovação, cancelamento, aviso de fim de trial por e-mail (3 dias antes), suspensão por falha de pagamento e reativação por pagamento bem-sucedido — com proteção para não derrubar um tenant que tenha uma extensão de trial dada manualmente pelo super-admin, e inserção idempotente de faturas.

---

## 4. Observações (não bloqueantes)

- **Nenhuma assinatura real processada ainda**: o endpoint de webhook nunca recebeu uma única entrega de evento, e o "Volume bruto" do Stripe está zerado — a plataforma ainda não vendeu nenhuma assinatura de verdade. Isso é esperado num momento pré-lançamento comercial, não é um bug.
- ~~Existe um segundo endpoint de webhook...~~ **Removido em 14/09/2026** (a pedido do usuário): o endpoint `desbravahub` apontando para `cruzeirodosuljuveve.org/webhook-stripe.php`, sem relação com o Traffio, foi excluído diretamente no painel do Stripe (Workbench → Webhooks → Excluir destino). Só resta o endpoint correto (`stripe-webhook`) na conta.
- O painel inicial do Stripe mostra os valores agregados em **US$** (moeda de exibição/relatório da conta), enquanto os preços reais dos planos estão corretamente em BRL — não afeta o valor cobrado do cliente, é só a moeda de exibição do dashboard.

## 5. O que eu não pude verificar sozinho

Não tentei fazer um checkout de teste de ponta a ponta porque a conta está em **modo Live** — um teste real geraria uma cobrança/assinatura de verdade. Se quiser uma validação 100% completa antes de anunciar o lançamento, a forma mais segura é você mesmo fazer uma assinatura real de teste (pode cancelar depois pelo próprio Portal, que confirmei estar funcional) ou usar o recurso de "Test clocks" do Stripe em modo de teste com uma chave separada.
