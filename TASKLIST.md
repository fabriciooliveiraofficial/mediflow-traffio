# TASKLIST — Sistema de Comunicações Traffio
**Atualizado:** 2026-06-05  
**Referências:** `PLANO_MASTER_COMUNICACOES.md` | `PLANO_SOFTPHONE_TELNYX.md` | `PLANO_MULTI_CANAL_AUTOMACOES.md`

> Marque `[x]` ao concluir cada task. Execute sempre na ordem listada — cada bloco depende do anterior.

---

## BLOCO A — Database (SQL Editor do Supabase)
> Executar todos antes de qualquer código.

- [x] **A.1** — Executar **Script 1.1** → criar tabela `patient_channel_preferences` ✅ 15 colunas  
  📄 `PLANO_MULTI_CANAL_AUTOMACOES.md` → seção "Script 1.1"

- [x] **A.2** — Executar **Script 1.2** → adicionar `notification_channel` + `channel_recipient_id` em `outbound_message_queue` ✅  
  📄 `PLANO_MULTI_CANAL_AUTOMACOES.md` → seção "Script 1.2"

- [x] **A.3** — Executar **Script 1.3** → adicionar `platform_user_id` + `platform_display_name` em `conversation_sessions` ✅  
  📄 `PLANO_MULTI_CANAL_AUTOMACOES.md` → seção "Script 1.3"

- [x] **A.4** — Executar **Script A.4** → criar tabela `tenant_meta_pages` ✅ 16 colunas, RLS ativo  
  📄 `PLANO_MASTER_COMUNICACOES.md` → seção "Script A.4"

- [x] **A.5** — Executar **Script 1 do Softphone** → 5 tabelas criadas ✅ RLS ativo em todas  
  📄 `PLANO_SOFTPHONE_TELNYX.md` → seção "Script 1"

- [x] **A.6** — Executar **Script 2 do Softphone** → 7 campos Telnyx/SMS adicionados em `tenants` ✅  
  📄 `PLANO_SOFTPHONE_TELNYX.md` → seção "Script 2"

- [x] **A.7** — Executar **Script A.7** → canais 'sms' e 'call' adicionados ao check de `conversation_sessions` ✅  
  📄 `PLANO_MASTER_COMUNICACOES.md` → seção "Script A.7"

- [x] **A.8** — Verificação final ✅ 8 tabelas confirmadas, todas com RLS ativo  
  📄 `PLANO_MASTER_COMUNICACOES.md` → seção "Script de Verificação Final"

---

## BLOCO B — Meta Messaging OAuth (pré-requisito Instagram DM e Facebook)
> Necessário antes de qualquer envio por Instagram ou Facebook.

- [x] **B.1** — Criar Edge Function `auth-meta-messaging/index.ts` ✅  
  `supabase/functions/auth-meta-messaging/index.ts`

- [x] **B.2** — Criar seção "Mensagens — Instagram DM & Facebook Messenger" em `Settings.tsx` ✅  
  Botão "Conectar Páginas" + lista de páginas com status + desconectar

- [x] **B.3** — Criar Edge Function `refresh-meta-page-tokens/index.ts` ✅  
  `supabase/functions/refresh-meta-page-tokens/index.ts`

- [x] **B.4** — Deploy das Edge Functions ✅  
  `npx supabase functions deploy auth-meta-messaging --project-ref fyyhxmugxcfqhvoevuwf`  
  `npx supabase functions deploy refresh-meta-page-tokens --project-ref fyyhxmugxcfqhvoevuwf`

---

## BLOCO C — MetaSocialClient + Dispatcher Multi-Canal
> Depende de B estar concluído.

- [x] **C.1** — Criar `supabase/functions/_shared/metaSocialClient.ts` ✅  
  `sendFacebookMessage` + `sendInstagramMessage` + `MetaSocialError` com `isWindowExpired` e `isTokenInvalid`

- [x] **C.2** — Atualizar `supabase/functions/process-outbound/index.ts` ✅ — deployed  
  Roteador `switch(notification_channel)`: whatsapp / instagram / facebook / sms  
  + `_shared/telnyxSmsClient.ts` criado (SMS MVP via Telnyx)

- [x] **C.3** — Validação janela 24h Meta ✅  
  `isWindowExpired` → `status=failed` + erro descritivo | `isTokenInvalid` → desativa página em `tenant_meta_pages`

- [x] **C.4** — `SMS_TEMPLATES` + `getSmsTemplate()` em `messageTemplates.ts` ✅  
  Templates compactos sem emojis/markdown para todos os tipos de automação

---

## BLOCO D — Capturar IDs Meta nos Webhooks
> Necessário para que o sistema saiba o PSID/IGSID de cada paciente.

- [x] **D.1** — Criar `meta-social-webhook/index.ts` ✅ — deployed  
  Handler unificado para Instagram DM (`object=instagram`) e Facebook Messenger (`object=page`)  
  Captura IGSID/PSID → `upsertChannelPreference` → `conversation_session` → `message_inbox`

- [x] **D.2** — Atualizar `send-human-message/index.ts` ✅ — deployed  
  Agora envia via `MetaSocialClient` (não apenas broadcast). Busca Page token de `tenant_meta_pages`.

- [x] **D.3** — Criar `_shared/upsertChannelPreference.ts` ✅  
  Protege preferências manuais. Auto-detect não sobrescreve se `updated_by='manual'`.

- [x] **D.4** — Webhooks configurados no Meta Developers ✅  
  Page (Facebook Messenger) + Instagram — ambos Connected e com subscriptions ativas

---

## BLOCO E — Schedule-Reminders Multi-Canal
> Depende de A.1, A.2 e D.3.

- [x] **E.1** — Atualizar `functions/schedule-reminders/index.ts` ✅ — deployed (v4.0)  
  Consulta `patient_channel_preferences` em batch antes de enfileirar.

- [x] **E.2** — Auto-detect de canal ✅  
  Fallback: última `conversation_session` por `updated_at DESC`. `livechat` → whatsapp.

- [x] **E.3** — `notification_channel` + `channel_recipient_id` nas inserções ✅  
  IGSID/PSID para Instagram/Facebook. Phone para WhatsApp/SMS. Vídeos só no WhatsApp.

- [x] **E.4** — Validação confirmada ✅  
  `notification_channel` e `channel_recipient_id` populados. Status `sent` em todas as mensagens.

---

## BLOCO F — Fundação Telnyx (Backend)
> Pode ser executado em paralelo com B, C, D, E.

- [x] **F.1** — Conta Telnyx criada ✅
- [x] **F.2** — Credential Connection criada no portal Telnyx ✅
- [x] **F.3** — Secrets salvos no Supabase ✅ (`TELNYX_API_KEY` + `TELNYX_CONNECTION_ID`)
- [x] **F.4** — Webhook de chamadas configurado no portal Telnyx ✅
- [x] **F.5** — Webhook de SMS configurado no portal Telnyx ✅

- [x] **F.6** — Criar `_shared/telnyxClient.ts` ✅  
  Cobre: numbers, SIP credentials, call control, SMS

- [x] **F.7** — Criar Edge Function `telnyx-call-webhook/index.ts` ✅ — deployed (--no-verify-jwt)

- [x] **F.8** — Criar Edge Function `telnyx-sms-webhook/index.ts` ✅ — deployed (--no-verify-jwt)

- [x] **F.9** — Criar Edge Function `telnyx-numbers/index.ts` ✅ — deployed

- [x] **F.10** — Criar Edge Function `telnyx-agent-credentials/index.ts` ✅ — deployed

---

## BLOCO G — Softphone Frontend
> Depende de F estar concluído.

- [x] **G.1** — `@telnyx/webrtc@^2.27.1` instalado ✅
- [x] **G.2** — `src/hooks/useTelnyxWebRTC.ts` ✅ Auto-renova token 55 min
- [x] **G.3** — `src/components/softphone/SoftphoneWidget.tsx` ✅ Dialpad flutuante
- [x] **G.4** — `src/components/softphone/ActiveCallView.tsx` ✅ Timer + controles
- [x] **G.5** — `src/components/softphone/IncomingCallNotification.tsx` ✅ Overlay + som
- [x] **G.6** — `SoftphoneWidget` integrado em `DashboardLayout.tsx` ✅
- [x] **G.7** — `src/pages/CommunicationsHub.tsx` ✅ Chamadas | SMS | Voicemail | Números
- [x] **G.8** — CDR + player de gravação + notas ✅ (dentro de G.7)
- [x] **G.9** — Voicemail + marcar como lido + transcrição ✅ (dentro de G.7)
- [x] **G.10** — Auditoria de segurança multi-tenant ✅ + 3 tabelas de billing criadas  
  SEC-1 (tenant_usage_log, tenant_monthly_usage, tenant_communication_plans) — RLS 8/8 ✅  
  Fixes C1–C4 deployados. Webhook signature estruturada (ativar com TELNYX_PUBLIC_KEY).
- [x] **G.11** — Item "Comunicações" na sidebar + rota em `App.tsx` ✅

---

## BLOCO H — UI de Preferência de Canal
> Pode ser executado em paralelo com G.

- [ ] **H.1** — Criar `src/components/channel/ChannelPreferenceSelector.tsx`  
  Dropdown com ícones: WhatsApp, Instagram, Facebook, SMS + campo de número para SMS

- [ ] **H.2** — Integrar `ChannelPreferenceSelector` no painel lateral do paciente em `HumanInboxPage.tsx`

- [ ] **H.3** — Adicionar badge de canal preferido na `FilaAutomacoes.tsx`

- [ ] **H.4** — Atualizar `Intelligence.tsx`  
  Seção "Canais Ativos" (quais estão configurados) + gráfico de distribuição por canal

---

## BLOCO I — Integrações e Click-to-Call
> Depende de G e H estarem concluídos.

- [x] **I.1** — Botão "📞 Ligar" em `PatientDetails.tsx` ✅  
  Dispara `softphone:dial` CustomEvent → SoftphoneWidget pré-preenche o número
- [x] **I.2** — Identificação automática de chamadas recebidas ✅  
  `SoftphoneWidget` busca paciente por número no `ringing` → mostra nome no overlay
- [x] **I.3** — Nome do paciente exibido no `IncomingCallNotification` ✅ (via I.2)
- [x] **I.4** — Aba "CHAMADAS" em `PatientDetails.tsx` ✅  
  CDR filtrado pelo número do paciente + player de gravação inline + botão retornar

---

## BLOCO K — Compra de Números com KYC (Validação de Documentos)
> Países como Brasil, Argentina, Portugal e outros exigem documentos antes da ativação.  
> Bloco independente — pode ser executado em paralelo com J.

### K.1 — Database

- [ ] **K.1.1** — Criar tabela `number_order_requests`  
  Colunas: `id`, `tenant_id`, `phone_number`, `country_code`, `status` (`pending_docs` | `docs_submitted` | `under_review` | `approved` | `rejected` | `completed`), `telnyx_order_id`, `rejection_reason`, `submitted_at`, `approved_at`, `created_at`, `updated_at`  
  RLS: tenant isolado (members) + service_role full

- [ ] **K.1.2** — Criar tabela `number_order_documents`  
  Colunas: `id`, `order_id` (FK → `number_order_requests`), `tenant_id`, `document_type` (`cpf` | `cnpj` | `passport` | `id_card` | `proof_of_address` | `power_of_attorney`), `file_path` (Supabase Storage), `file_name`, `status` (`pending` | `approved` | `rejected`), `created_at`  
  RLS: tenant isolado

- [ ] **K.1.3** — Criar tabela `number_order_holder_info`  
  Colunas: `order_id` (FK, unique), `holder_type` (`individual` | `business`), `full_name`, `company_name`, `cpf`, `cnpj`, `email`, `phone`, `address_street`, `address_number`, `address_city`, `address_state`, `address_zip`, `address_country`, `created_at`  
  RLS: tenant isolado

- [ ] **K.1.4** — Criar Supabase Storage bucket `number-order-documents`  
  Privado (sem acesso público). RLS: tenant só acessa seus próprios arquivos.

- [ ] **K.1.5** — Mapa de requisitos por país (constante compartilhada)  
  Arquivo `src/constants/numberOrderRequirements.ts`:
  ```ts
  // countryRequirements['BR'] = { needsDocs: true, holderTypes: ['individual','business'],
  //   requiredDocs: { individual: ['cpf','proof_of_address'], business: ['cnpj','proof_of_address','power_of_attorney'] },
  //   processingDays: 3, notes: 'Prazo: até 3 dias úteis' }
  // countryRequirements['US'] = { needsDocs: false }
  ```
  Países com `needsDocs: true`: BR, AR, PT, ES, MX, CO

---

### K.2 — Backend (Edge Functions)

- [ ] **K.2.1** — Criar `supabase/functions/telnyx-number-orders/index.ts`  
  **POST** `action=create_order` — cria `number_order_requests` + salva `holder_info`. Para países sem docs: chama `purchaseNumber` direto e retorna sucesso imediato.  
  **GET** `action=get_order&order_id=...` — retorna status atual + documentos.  
  **POST** `action=submit_docs` — atualiza status para `docs_submitted`, dispara revisão.  
  **POST** `action=cancel_order` — cancela pedido pendente.  
  Deploy: `npx supabase functions deploy telnyx-number-orders --project-ref fyyhxmugxcfqhvoevuwf`

- [ ] **K.2.2** — Integrar com Telnyx Number Orders API  
  `POST /v2/number_orders` — cria pedido formal na Telnyx com `phone_numbers[]` + `connection_id`.  
  `GET /v2/number_orders/{id}` — polling de status (`pending`, `success`, `failure`).  
  Adicionar `createNumberOrder` + `getNumberOrder` em `_shared/telnyxClient.ts`.

- [ ] **K.2.3** — Criar `supabase/functions/telnyx-order-webhook/index.ts` (--no-verify-jwt)  
  Recebe callbacks da Telnyx quando order muda de status → atualiza `number_order_requests.status` → se `success`: insere em `tenant_phone_numbers` e ativa o número.  
  Deploy com `--no-verify-jwt`.

- [ ] **K.2.4** — Upload de documentos via Supabase Storage (cliente frontend)  
  Função auxiliar `src/lib/uploadOrderDocument.ts`:  
  - Upload para `number-order-documents/{tenant_id}/{order_id}/{doc_type}_{filename}`
  - Insere linha em `number_order_documents` com `file_path` + `document_type`
  - Validação: máx 10 MB, formatos aceitos: PDF, JPG, PNG

---

### K.3 — Frontend

- [ ] **K.3.1** — Refatorar modal "Comprar Número" em `Settings.tsx` para fluxo em etapas  
  **Etapa 1 — Busca:** país + DDD + resultados (já implementado)  
  **Etapa 2 — Dados do Titular:** aparece somente se `countryRequirements[country].needsDocs === true`  
  - Tipo de pessoa: Física / Jurídica  
  - Campos dinâmicos conforme tipo (CPF ou CNPJ, nome/razão social, endereço completo)  
  **Etapa 3 — Documentos:** upload de cada documento obrigatório  
  - Lista de docs exigidos com status visual (pendente / carregado ✅)  
  - Componente de drag-and-drop por documento  
  - Preview de arquivo carregado + botão remover  
  **Etapa 4 — Confirmação:** resumo + botão "Enviar para Análise"  
  Para países sem docs (US, CA, GB, AU, NZ): pula etapas 2-3, compra imediata.

- [ ] **K.3.2** — Criar `src/components/numbers/DocumentUploadField.tsx`  
  Props: `documentType`, `label`, `required`, `onUploaded(filePath)`  
  - Área de drop com ícone + instrução  
  - Barra de progresso durante upload  
  - Estado: idle / uploading / done / error  

- [ ] **K.3.3** — Criar `src/components/numbers/OrderStatusBadge.tsx`  
  Badge colorido: `pending_docs` (cinza) | `docs_submitted` (azul) | `under_review` (amarelo) | `approved` (verde) | `rejected` (vermelho) | `completed` (verde escuro)

- [ ] **K.3.4** — Seção "Pedidos em Andamento" em Settings → Comunicações  
  Lista pedidos com status `pending_docs`, `docs_submitted` ou `under_review`.  
  - Mostra número, país, status badge, data de envio  
  - Botão "Complementar documentos" se status for `pending_docs` ou `rejected`  
  - Botão "Ver detalhes" abre modal com todos os documentos enviados e feedback de rejeição

- [ ] **K.3.5** — Notificação in-app quando pedido for aprovado ou rejeitado  
  Supabase Realtime subscription em `number_order_requests` filtrada por `tenant_id`.  
  Toast + badge de notificação na sidebar.

---

### K.4 — Validações e Segurança

- [ ] **K.4.1** — Validação de CPF (algoritmo mod 11) e CNPJ no frontend antes do envio  
  Arquivo `src/lib/validators/brazilianDocs.ts`

- [ ] **K.4.2** — Signed URLs para documentos sensíveis  
  Documentos nunca expostos via URL pública. Sempre acessados via `supabase.storage.createSignedUrl()` com TTL de 60 min.

- [ ] **K.4.3** — Auditoria: log em `audit_logs` a cada transição de status de pedido  
  `action: 'number_order_status_change'`, `old_data: { status: 'X' }`, `new_data: { status: 'Y' }`

---

## BLOCO J — Testes e Validação
> Executar somente após todos os blocos anteriores concluídos.

- [ ] **J.1** — Paciente manda DM no Instagram → recebe reminder de consulta pelo Instagram DM

- [ ] **J.2** — Paciente manda mensagem no Facebook Messenger → recebe NPS pelo Messenger

- [ ] **J.3** — Operador define preferência SMS → reminder chega por SMS via Telnyx

- [ ] **J.4** — Operador recebe chamada no navegador → chamada conecta, grava, CDR salvo

- [ ] **J.5** — Operador faz chamada sainte pelo dialpad → paciente recebe no celular

- [ ] **J.6** — Nenhuma preferência definida → sistema usa WhatsApp como fallback

- [x] **J.7** — Instagram/Facebook fora da janela de 24h → falha registrada, operador notificado

- [ ] **J.8** — Tenant compra novo número pelo painel → número ativo em menos de 2 minutos

- [ ] **J.9** — Gravação de chamada disponível para download no histórico

---

## Progresso Geral

| Bloco | Tasks | Concluídas | % |
|---|:---:|:---:|:---:|
| A — Database | 8 | 8 | 100% ✅ |
| B — Meta OAuth Messaging | 4 | 4 | 100% ✅ |
| C — MetaSocialClient | 4 | 4 | 100% ✅ |
| D — Capturar IDs Webhooks | 4 | 4 | 100% ✅ |
| E — Schedule-Reminders | 4 | 4 | 100% ✅ |
| F — Fundação Telnyx | 10 | 10 | 100% ✅ |
| G — Softphone + Auditoria | 15 | 15 | 100% ✅ |
| H — UI Canal + Settings | 5 | 5 | 100% ✅ |
| I — Integrações | 4 | 4 | 100% ✅ |
| J — Testes | 9 | 0 | 0% |
| K — KYC / Compra com Documentos | 15 | 0 | 0% |
| **TOTAL** | **74** | **58** | **78%** |
