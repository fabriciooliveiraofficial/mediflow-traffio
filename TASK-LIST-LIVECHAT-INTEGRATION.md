# Task List: Live Chat Integration

Este arquivo serve para acompanhar o progresso das tarefas de integração do Live Chat com a plataforma `mediflow-traffio`.

## 1. Banco de Dados (Database Migration)
- [ ] Criar a migration `supabase/migrations/20260602_add_livechat_channel.sql`
- [ ] Executar a migration no banco de dados para adicionar a coluna `channel` à tabela `conversation_sessions` e o índice correspondente

## 2. Modificações nas Edge Functions Existentes
- [ ] Modificar `supabase/functions/send-human-message/index.ts` para verificar `session.channel === 'livechat'` e enviar via Realtime Broadcast
- [ ] Modificar `supabase/functions/send-human-media/index.ts` para verificar `session.channel === 'livechat'` e enviar via Realtime Broadcast

## 3. Criação da Nova Edge Function do Visitante
- [ ] Criar a nova Edge Function `supabase/functions/livechat-visitor-message/index.ts`
- [ ] Implementar parse de `multipart/form-data` para suportar upload de arquivos e imagens enviadas pelo visitante
- [ ] Fazer upload da mídia para o bucket `chat-media` usando a chave `service_role`
- [ ] Tratar criação de sessões sintéticas com `channel = 'livechat'`, definindo o `context` com Nome, E-mail e Telefone obrigatórios do visitante

## 4. Atualização do Frontend (Traffio App)
- [ ] Modificar `src/pages/HumanInboxPage.tsx` para exibir o ícone `MessageCircle` para sessões de Live Chat
- [ ] Alterar exibição de nome do visitante para ler de `session.context?.visitor_name` se o canal for `livechat` e não houver paciente vinculado
- [ ] Adicionar filtro de canais (`Todos`, `WhatsApp`, `Live Chat`) na barra lateral do painel de conversas

## 5. Criação do Script do Widget Injetável
- [ ] Criar o script `public/livechat-widget.js` contendo o HTML/CSS injetável e a lógica JS para a Landing Page
- [ ] Implementar o formulário obrigatório de cadastro inicial (Nome, E-mail e Telefone)
- [ ] Adicionar funcionalidade de envio de mensagens de texto e seleção de arquivos para upload via Edge Function
- [ ] Implementar a conexão de Realtime Broadcast para escutar respostas do atendente e renderizar o histórico
- [ ] Criar um arquivo HTML de teste em `public/test-livechat.html` para testar o widget localmente
