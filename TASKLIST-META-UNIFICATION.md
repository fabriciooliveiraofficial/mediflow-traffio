# TASKLIST: Unificação das Conexões Meta (Ads e Messaging)

Este documento descreve as etapas necessárias para unificar os fluxos de autenticação do Meta (Facebook/Instagram), consolidando as permissões de Anúncios e de Mensagens em uma única ação, conforme solicitado.

## 1. Banco de Dados (Supabase)
- [x] Analisar o impacto da unificação das tabelas `ad_integrations` e `tenant_meta_pages` ou mantê-las separadas, mas alimentadas pela mesma função (recomendado manter separadas para não quebrar a lógica existente).
- [x] Adicionar colunas de controle (se necessário) na tabela `ad_integrations` para armazenar quais recursos (Ads, Messaging) o usuário explicitamente ativou.

## 2. Edge Functions (Backend)
- [x] Criar ou modificar a Edge Function para uma rota unificada (ex: `auth-meta-unified`).
- [x] Atualizar o redirecionamento do OAuth (`fbAuthUrl`) para solicitar **todos** os scopes necessários em uma única chamada:
  - Scopes de Ads: `ads_management, ads_read`
  - Scopes de Messaging: `pages_show_list, pages_messaging, instagram_manage_messages, pages_read_engagement, pages_manage_metadata, instagram_basic, business_management`
- [x] Na lógica de *callback* (após a troca pelo token de longa duração):
  - [x] Executar a rotina A: Buscar e salvar as contas de anúncios na tabela `ad_integrations`.
  - [x] Executar a rotina B: Buscar e salvar as páginas do Facebook/Instagram na tabela `tenant_meta_pages`.
  - [x] Tratar erros de forma isolada (ex: se o usuário não tem conta de anúncios, não impedir a gravação das páginas de mensagens, e vice-versa).
- [x] Retornar os dados consolidados no fechamento do popup ou redirecionamento de sucesso para o frontend.

## 3. Frontend (UI e Lógica)
- [x] **Criar Componente Centralizado de Conexão:** Desenvolver um componente único de botão "Conectar Conta Meta" que acione a nova Edge Function unificada.
- [x] **Página "Analytics Pro" (`src/pages/Dashboard.tsx`):**
  - [x] Remover a chamada isolada para `auth-meta`.
  - [x] Inserir o novo componente de conexão unificada.
  - [x] Atualizar a interface para refletir que a conexão abrange múltiplos recursos, se aplicável.
- [x] **Página "Configurações > Clínicas" (`src/pages/Settings.tsx`):**
  - [x] Remover a chamada isolada para `auth-meta-messaging`.
  - [x] Substituir pelo novo componente de conexão unificada ou redirecionar o usuário para uma central de integrações.
- [x] **Gestão de Recursos (Opcional, mas recomendado):**
  - [x] Criar uma interface para que o usuário possa ativar/desativar os recursos selecionados no momento da conexão (Anúncios / Mensagens), solicitando apenas as permissões necessárias e gravando os dados de acordo.
- [x] Atualizar a tela de `oauth-callback.html` para processar a resposta combinada (Ads + Pages) e disparar os eventos de janela corretos para o aplicativo React.

## 4. Testes e Homologação
- [ ] Testar fluxo do zero com um Tenant sem integrações.
- [ ] Testar a aceitação parcial (ex: o usuário concede acesso às páginas, mas não às contas de anúncios no momento da autorização do Facebook).
- [ ] Validar a leitura contínua dos relatórios no *Analytics Pro*.
- [/] Validar a recepção/envio de mensagens em tempo real no *Atendimento* (Troubleshooting Webhooks da Meta).
  - [x] Verificar Logs da Edge Function `meta-social-webhook` no Supabase (Encontrado erro de formatação de data/timestamp).
  - [x] Corrigir o erro de conversão de `timestamp` na função `meta-social-webhook` (Remover multiplicação por 1000).
  - [x] Fazer o deploy da função corrigida.
  - [x] Corrigir interface para permitir "Assumir" conversa quando status for `bot_active`.
  - [x] Realizar um novo teste de envio de mensagem.
  - [/] Solucionar erro de deploy da pipeline (hiccup de rede no download da CLI da Supabase).
  - [ ] Validar envio de mensagens após reconexão e verificar toast de erro da Meta Graph API se houver.
- [ ] Testar revogação de tokens e reconexão.

