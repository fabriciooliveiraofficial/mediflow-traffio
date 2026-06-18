# Tasklist: Stripe Wallet Checkout Integration

- `[x]` **Diagnóstico de Erros do Stripe**
  - Analisar os logs de console enviados pelo usuário (CSP violations, ERR_NAME_NOT_RESOLVED, message channel closed).
  - Identificar a origem dos bloqueios (`inner-preview.html` vs ambiente nativo).
  - Verificar existência e lógica da Edge Function `stripe-create-wallet-checkout`.
  - Verificar configuração do webhook do Stripe (`stripe-webhook`) para lidar com `wallet_recharge`.
- `[ ]` **Testar em Ambiente Limpo (Ação do Usuário)**
  - Abrir a aplicação em uma nova guia dedicada, fora do painel de visualização (preview iframe) do IDE.
  - Desativar temporariamente bloqueadores de anúncios (AdBlock, uBlock, Brave Shields) que bloqueiam telemetria do Stripe (`m.stripe.com`).
- `[/]` **Verificar Fluxo Ponta-a-Ponta**
  - Iniciar uma recarga na página de `Settings`.
  - Concluir o pagamento no Stripe Checkout de teste.
  - `[x]` Simular o acionamento do banco via SQL para verificar saldo e triggers (recharge + usage debit).
  - Confirmar se o webhook do Supabase recebe o evento `checkout.session.completed` e credita a carteira no banco.
- `[ ]` **Ajustes Finais (Se necessários após o teste)**
  - Corrigir falhas residuais no webhook (se a carteira não atualizar).
  - Otimizar a UX de recarga em andamento no frontend.
