# TASKLIST DE CORREÇÃO CIRÚRGICA: INSTAGRAM/META E EDGE FUNCTIONS

- [x] **Fase 1: Estabilizar Deploy do Frontend**
  - [x] Removida a dependência do `supabase` CLI de `devDependencies` no `package.json` para evitar erros de `socket hang up` no postinstall do Cloudflare Pages.

- [x] **Fase 2: Diagnosticar Erro 500 no `send-human-message`**
  - [x] Verificado que o código da Edge Function compila perfeitamente sem erros de sintaxe.
  - [x] Implantado/re-deployado com sucesso a função `send-human-message` atualizada.

- [x] **Fase 3: Reforçar a Edge Function de Webhook (Prevenção de Timeout)**
  - [x] Convertido o fluxo de processamento de assíncrono para síncrono aguardado (`await processEntries(...)`) no `meta-social-webhook` para evitar que a Deno Deploy congele a requisição antes da inserção no banco de dados.
  - [x] Implementado o fluxo rápido (**Human Fast Path**) direto para `conversation_messages` quando a conversa já estiver com `omnichannel_status = 'human_active'`, eliminando os 30 segundos de atraso do process-inbox cron para Instagram/Facebook.
  - [x] Implantada a nova versão do webhook com sucesso.

- [x] **Fase 4: Consertar "Seleção de Mensagem" no Frontend**
  - [x] Adicionado evento `onClick` nos balões de chat da página `HumanInboxPage.tsx` para alternar a exibição da barra de ações (responder, copiar, etc.), resolvendo a limitação de seleção em dispositivos touch/mobile.
