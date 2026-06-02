# Task List: Migração WhatsApp Cloud API + Flows

> Plano detalhado em: `PLANO-WHATSAPP-CLOUD-API.md`

---

## Pre-requisitos

- [ ] Ler o plano completo em `PLANO-WHATSAPP-CLOUD-API.md`
- [ ] Ler `supabase/functions/_shared/outboxDispatcher.ts` (ponto de integração principal)
- [ ] Ler `supabase/functions/whatsapp-bot/index.ts` (webhook atual Z-API)
- [ ] Ler `supabase/functions/process-inbox/index.ts` (processamento de mensagens)
- [ ] Ler `supabase/functions/_shared/clinicalAgent.ts` (agent LLM)
- [ ] Ler `src/services/zapiService.ts` (service frontend atual)
- [ ] Ler `src/pages/AdminWhatsApp.tsx` (UI de admin atual)

---

## FASE 1: Setup Meta Business + Adapter Layer
**Prazo: 2-4 semanas**

### 1.0 Registro na Meta (manual — não é código)
- [ ] Criar conta Meta Business em business.facebook.com
- [ ] Criar App no Meta for Developers (tipo: Business)
- [ ] Ativar produto "WhatsApp" no app
- [ ] Obter número de teste (sandbox) para desenvolvimento
- [ ] Iniciar processo de verificação de negócio
- [ ] Obter credenciais: `PHONE_NUMBER_ID`, `WABA_ID`, `ACCESS_TOKEN`, `APP_SECRET`
- [ ] Gerar System User Token (permanente, não expira como user tokens)

### 1.1 Migration — Novos campos na tabela tenants
**Arquivo NOVO:** `supabase/migrations/20260406_cloud_api_fields.sql`
- [ ] Adicionar coluna `whatsapp_provider` (text, default 'zapi')
- [ ] Adicionar coluna `cloud_api_phone_number_id` (text, nullable)
- [ ] Adicionar coluna `cloud_api_access_token` (text, nullable)
- [ ] Adicionar coluna `cloud_api_business_account_id` (text, nullable)
- [ ] Adicionar coluna `cloud_api_app_secret` (text, nullable)
- [ ] Adicionar coluna `flow_booking_id` (text, nullable)
- [ ] Adicionar coluna `flow_reschedule_id` (text, nullable)
- [ ] Criar index em `cloud_api_phone_number_id` para lookup rápido no webhook
- [ ] Testar: rodar migration no Supabase Dashboard ou CLI

### 1.2 Cloud API Client
**Arquivo NOVO:** `supabase/functions/_shared/cloudApiClient.ts`
- [ ] Implementar classe `CloudApiClient` com construtor (phoneNumberId, accessToken)
- [ ] Método `sendText(to, text)` — POST para Graph API `/messages`
- [ ] Método `sendButtons(to, bodyText, buttons[])` — Interactive button message
- [ ] Método `sendList(to, bodyText, buttonText, sections[])` — Interactive list message  
- [ ] Método `sendFlow(to, bodyText, flowId, flowToken, flowAction, screenId)` — WhatsApp Flow
- [ ] Método `markAsRead(messageId)` — Marcar mensagem como lida
- [ ] Método estático `verifyWebhookSignature(payload, signature, appSecret)` — HMAC SHA-256
- [ ] Método `sendTemplate(to, templateName, language, components[])` — Templates pré-aprovados (futuro)
- [ ] Adicionar retry com backoff para rate limits (HTTP 429)
- [ ] Adicionar logging estruturado para auditoria
- [ ] Testar: enviar texto e botões para número de teste sandbox

### 1.3 Modificar OutboxDispatcher — Dual Mode
**Arquivo:** `supabase/functions/_shared/outboxDispatcher.ts`
- [ ] Importar `CloudApiClient`
- [ ] Modificar `sendNow()` para verificar `tenant.whatsapp_provider`
  - Se `cloud_api`: usar `CloudApiClient`
  - Se `zapi` (ou ausente): manter `sendZapiMessage()` (sem mudança)
- [ ] Criar função `sendCloudApiMessage(tenant, phone, payload)` análoga a `sendZapiMessage`
  - Mapear payload `{ text, interactive }` para formato Cloud API
  - Se `interactive.type === 'button'`: usar `sendButtons()`
  - Se `interactive.type === 'list'`: usar `sendList()`
  - Senão: usar `sendText()`
- [ ] Modificar `processBatch()` para buscar campos cloud_api do tenant no JOIN
- [ ] Manter `sendZapiMessage()` intacto (backward compatibility)
- [ ] Testar: enviar mensagem via Cloud API para tenant configurado

### 1.4 Webhook Cloud API
**Arquivo NOVO:** `supabase/functions/whatsapp-cloud-webhook/index.ts`
- [ ] Implementar handler GET para verificação de webhook (hub.mode, hub.verify_token, hub.challenge)
- [ ] Implementar handler POST para mensagens recebidas
- [ ] Verificar assinatura HMAC SHA-256 (header `X-Hub-Signature-256`)
- [ ] Parsear payload Cloud API: `entry[].changes[].value.messages[]`
- [ ] Resolver tenant por `metadata.phone_number_id` (query tabela tenants)
- [ ] Extrair conteúdo baseado no tipo:
  - `type: "text"` → `message.text.body`
  - `type: "interactive", interactive.type: "button_reply"` → `interactive.button_reply.id`
  - `type: "interactive", interactive.type: "list_reply"` → `interactive.list_reply.id`
  - `type: "interactive", interactive.type: "nfm_reply"` → `interactive.nfm_reply.response_json` (Flow)
- [ ] Verificar idempotência via `message.id` (wamid)
- [ ] Inserir em `message_inbox` (MESMO formato do Z-API webhook — process-inbox inalterado)
- [ ] Marcar mensagem como lida (`markAsRead`)
- [ ] Retornar 200 OK
- [ ] Para `nfm_reply` (Flow completion): processar booking direto (ver Task 3.3)
- [ ] Testar: enviar mensagem do sandbox → verificar que chega em message_inbox

### 1.5 Configurar Webhook URL na Meta
- [ ] Deploy da Edge Function: `supabase functions deploy whatsapp-cloud-webhook`
- [ ] Configurar URL do webhook no Meta App Dashboard
- [ ] Subscrever aos campos: `messages`, `messaging_postbacks`
- [ ] Testar: enviar mensagem e verificar nos logs do Supabase

### 1.6 Frontend — Admin Cloud API
**Arquivo:** `src/pages/AdminWhatsApp.tsx` (modificar)
- [ ] Adicionar tab/seção para "WhatsApp Cloud API" (ao lado da seção Z-API existente)
- [ ] Form para configurar: phone_number_id, access_token, app_secret
- [ ] Toggle para alternar provider: Z-API ↔ Cloud API
- [ ] Status indicator: verificar conexão Cloud API
- [ ] Manter seção Z-API funcional para tenants legados

**Arquivo NOVO:** `src/services/cloudApiService.ts`
- [ ] Método `getStatus(tenantId)` — verificar se Cloud API está configurada
- [ ] Método `updateConfig(tenantId, config)` — salvar credenciais
- [ ] Método `testConnection(tenantId)` — enviar mensagem de teste

---

## FASE 2: Interactive Messages Confiáveis
**Prazo: 2-4 semanas**

### 2.1 Botões Interativos no Fluxo de Agendamento
**Arquivo:** `supabase/functions/process-inbox/index.ts`
- [ ] Após ClinicalAgent retornar resposta, detectar padrões que devem virar botões:
  - Se resposta oferece 2-3 opções de horário → converter para botões
  - Se resposta oferece particular/convênio → converter para botões
  - Se resposta pede confirmação sim/não → converter para botões
- [ ] Implementar `convertToInteractive(responseText)` que analisa a resposta e gera payload interativo
- [ ] Passar payload interativo para `outbox.sendNow(creds, phone, { text, interactive })`
- [ ] Testar: verificar que opções de horário aparecem como botões clicáveis

### 2.2 Listas Interativas para Múltiplas Opções
**Arquivo:** `supabase/functions/process-inbox/index.ts`
- [ ] Se ClinicalAgent oferece 4+ opções (especialidades, horários, profissionais): converter para lista
- [ ] Implementar geração de sections + rows a partir do texto do agent
- [ ] Testar: verificar que lista de especialidades aparece como menu dropdown

### 2.3 Confirmação com Botões
**Arquivo:** `supabase/functions/_shared/clinicalAgent.ts`
- [ ] Modificar `processMessage()` para retornar metadata de interatividade junto com texto
- [ ] Quando agent gera mensagem de confirmação (Etapa 4): incluir flag `{ interactive: true, type: 'confirm' }`
- [ ] process-inbox converte em: [✅ Confirmar] [❌ Cancelar] [📝 Alterar dados]
- [ ] Testar: confirmação de agendamento aparece com botões

### 2.4 Processar Respostas de Botões/Listas
**Arquivo:** `supabase/functions/whatsapp-cloud-webhook/index.ts`
- [ ] Quando recebe `button_reply.id`: inserir em message_inbox com conteúdo = button_id mapeado
  - Exemplo: button_id `"confirm_booking"` → content `"sim"` (compatível com preRoute existente)
  - Exemplo: button_id `"slot_09:00_2026-04-07"` → content `"quero o das 09:00 no dia 07/04"`
- [ ] Quando recebe `list_reply.id`: mesmo mapeamento
- [ ] Manter compatibilidade com o ClinicalAgent (ele recebe texto, não button IDs)
- [ ] Testar: clicar botão → verificar que ClinicalAgent processa corretamente

---

## FASE 3: WhatsApp Flows para Agendamento
**Prazo: 4-8 semanas**

### 3.1 Criar e Registrar Flow na Meta
- [ ] Criar JSON do Flow de agendamento (5 telas: Especialidade → Profissional → Serviço → Data/Hora → Confirmação)
- [ ] Registrar Flow via Graph API: `POST /{WABA_ID}/flows`
- [ ] Obter `flow_id` e salvar no campo `tenants.flow_booking_id`
- [ ] Publicar Flow (status: PUBLISHED)
- [ ] Testar: verificar que Flow aparece no WhatsApp Manager

### 3.2 Flow Data Exchange Endpoint
**Arquivo NOVO:** `supabase/functions/whatsapp-flow-endpoint/index.ts`
- [ ] Implementar descriptografia do request (AES-GCM com private key do app)
- [ ] Handler para cada tela:
  - `SPECIALTY`: query specialties do tenant → return `{ specialties: [{id, title}] }`
  - `DOCTOR`: query doctors por specialty → return `{ doctors: [{id, title}] }`
  - `SERVICE`: query appointment_types por doctor → return `{ services: [{id, title}] }`
  - `DATETIME`: query available slots (RPC) → return `{ dates: [{id, title}], slots: [{id, title}] }`
  - `CONFIRM`: build summary string → return `{ summary: "..." }`
- [ ] Implementar criptografia da response (AES-GCM)
- [ ] Adicionar health check endpoint
- [ ] Configurar URL do endpoint no Flow (via Graph API)
- [ ] Deploy: `supabase functions deploy whatsapp-flow-endpoint`
- [ ] Testar: abrir Flow no sandbox → verificar que dados dinâmicos carregam

### 3.3 Processar Flow Completion (Booking Direto)
**Arquivo:** `supabase/functions/whatsapp-cloud-webhook/index.ts`
- [ ] Quando recebe `nfm_reply` (Flow completo):
  - Parse `response_json` → extrair doctor_id, service_id, date, time, patient_name, cpf
  - Lookup/create patient (reuse lógica de `clinicalAgent.executeTool("register_patient")`)
  - Chamar RPC `book_appointment` diretamente (sem LLM!)
  - Se sucesso: enviar confirmação via Cloud API
  - Se conflito (slot ocupado): enviar mensagem + reabrir Flow
  - Atualizar `patient_funnel_stage` → 'agendado'
  - Cancelar follow-ups pendentes
  - Enqueue reminders (48h, 24h, 2h)
- [ ] Testar: completar Flow → verificar appointment criado no banco

### 3.4 Intent Router — Direcionar para Flow
**Arquivo:** `supabase/functions/process-inbox/index.ts`
- [ ] Antes de chamar ClinicalAgent, verificar se tenant tem Cloud API + Flow configurado
- [ ] Detectar intenção de agendamento (regex ou mini-classificador):
  ```
  /\b(agendar|marcar|consulta|avaliação|horário|vaga|disponib|quero uma|preciso de)\b/i
  ```
- [ ] Se booking intent E tenant tem flow:
  - Enviar mensagem com botão que abre o Flow
  - NÃO chamar ClinicalAgent
  - Marcar messages como "done"
  - Return
- [ ] Se NÃO booking intent: continuar fluxo normal (ClinicalAgent)
- [ ] Testar: enviar "quero agendar" → receber botão de Flow → completar booking via Flow

### 3.5 Fallback — Flow não usado
- [ ] Se paciente não clica no botão do Flow em 2 minutos: ClinicalAgent assume via texto
- [ ] Se Flow falha (data exchange error): ClinicalAgent assume via texto
- [ ] Se paciente responde com texto em vez de clicar: ClinicalAgent processa normalmente
- [ ] Testar: não clicar no Flow → verificar que follow-up funciona

---

## FASE 4: ClinicalAgent como Suporte (LLM para FAQ/Edge Cases)
**Prazo: Contínuo**

### 4.1 RAG com Knowledge Base
**Arquivo:** `supabase/functions/_shared/clinicalAgent.ts`
- [ ] Adicionar tool `search_knowledge_base` que faz busca vetorial na tabela `knowledge_base`
- [ ] Usar para responder FAQs: convênios, preços, preparo pré-consulta, localização
- [ ] Testar: "aceita Unimed?" → agent consulta knowledge_base → responde corretamente

### 4.2 Definir Papel do ClinicalAgent pós-Flows
- [ ] Atualizar system prompt para refletir novo papel (triagem + FAQ + suporte emocional)
- [ ] Remover instruções de agendamento passo-a-passo (Flows cuidam disso)
- [ ] Manter instruções de cancelamento/reagendamento (Flows podem cobrir isso depois)
- [ ] Reduzir tools: remover tools de scheduling que agora são feitas via Flow
- [ ] Testar: verificar que agent responde FAQs mas redireciona booking para Flow

### 4.3 Métricas e Monitoramento
- [ ] Criar dashboard: % agendamentos via Flow vs via LLM vs via humano
- [ ] Tracking: taxa de conclusão do Flow (abandono por tela)
- [ ] Tracking: custo por agendamento (LLM tokens vs Flow = zero)
- [ ] Alertas: se taxa de conclusão do Flow cair abaixo de 70%

---

## Pós-implementação

- [ ] Migrar 1 tenant piloto para Cloud API (manter Z-API ativo para outros)
- [ ] Monitorar métricas por 2 semanas
- [ ] Comparar: taxa de agendamento Z-API vs Cloud API
- [ ] Se métricas positivas: migrar demais tenants gradualmente
- [ ] Desativar Z-API após todos tenants migrados

---

## Notas para o Implementador

1. **A migração é GRADUAL** — Z-API e Cloud API coexistem. O campo `tenants.whatsapp_provider` determina qual usar por tenant.
2. **process-inbox NÃO muda na Fase 1** — O webhook da Cloud API insere em `message_inbox` no mesmo formato do Z-API. O process-inbox é agnóstico ao provider.
3. **ClinicalAgent NÃO muda na Fase 1** — Ele continua funcionando normalmente. Só na Fase 3 ele é "rebaixado" para FAQ/suporte.
4. **WhatsApp Flows requerem HTTPS** — O data exchange endpoint precisa de URL pública com SSL. Supabase Edge Functions já fornecem isso.
5. **Criptografia dos Flows** — WhatsApp Flows usam criptografia end-to-end. O data exchange endpoint precisa descriptografar o request e criptografar a response usando a chave privada do app.
6. **Rate limits Cloud API** — 80 mensagens/segundo por número (muito superior ao Z-API). Não deve ser problema.
7. **Templates** — Para mensagens proativas (follow-ups, reminders), a Cloud API EXIGE templates pré-aprovados. Os templates atuais de `messageTemplates.ts` precisam ser registrados na Meta.
8. **Janela de 24h** — Cloud API permite respostas livres apenas dentro de 24h da última mensagem do paciente. Após 24h, só templates aprovados. Isso afeta follow-ups.
9. **Número de telefone** — O mesmo número NÃO pode estar no Z-API e na Cloud API simultaneamente. A migração exige desconectar do Z-API primeiro.
10. **Custo** — A Cloud API cobra por conversa (não por mensagem). Uma conversa de 24h = 1 cobrança, independente de quantas mensagens.
