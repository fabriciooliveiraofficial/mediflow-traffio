# Plano de Migração: Z-API → WhatsApp Cloud API + Flows

## Resumo Executivo

Migrar o sistema de messaging do Traffio de Z-API (scraper não-oficial) para WhatsApp Cloud API (API oficial da Meta) com WhatsApp Flows para agendamento estruturado. O resultado: agendamento em 30-90 segundos com 0% de ambiguidade, compliance total LGPD, selo verde, e custos menores.

---

## 1. Diagnóstico Atual

### Z-API — O que é
Z-API é um **scraper não-oficial do WhatsApp Web**. Faz engenharia reversa do protocolo Web e expõe REST API. Viola os Termos de Serviço do WhatsApp (Seção 4).

### Código Atual que Usa Z-API

| Arquivo | Uso | Linhas |
|---------|-----|--------|
| `supabase/functions/_shared/outboxDispatcher.ts` | Envio de mensagens (text, button-list, option-list) | 116-176 |
| `supabase/functions/whatsapp-bot/index.ts` | Recebe webhooks do Z-API | 1-139 |
| `supabase/functions/process-outbox/index.ts` | Processa fila de mensagens assíncronas | Todo |
| `supabase/functions/process-inbox/index.ts` | Usa outboxDispatcher.sendNow() para enviar | ~533-546 |
| `src/services/zapiService.ts` | Status, restart, QR code, disconnect | Todo |
| `src/pages/AdminWhatsApp.tsx` | UI de conexão WhatsApp | Todo |
| `src/services/notificationService.ts` | Notificações via Z-API | Todo |

### Endpoints Z-API em Uso
```
POST /send-text           → Texto simples (funciona)
POST /send-button-list    → Botões interativos (INSTÁVEL — fallback para texto existe)
POST /send-option-list    → Listas de opções (INSTÁVEL — fallback para texto existe)
GET  /status              → Verificar conexão
POST /restart             → Reiniciar instância
POST /disconnect          → Desconectar
GET  /qr-code/image       → QR code para conectar
```

### Problemas Atuais
1. **Botões/Listas instáveis** — `outboxDispatcher.ts:143-155` tem fallback porque `/send-button-list` falha frequentemente
2. **Risco de ban** — WhatsApp pode banir o número a qualquer momento
3. **Sem WhatsApp Flows** — Impossível via scraping
4. **Sem selo verde** — Sem verificação de negócio
5. **LGPD questionável** — Dados de saúde passando por proxy não-certificado
6. **Sessão instável** — Código já tem `/restart` e `/status` para lidar com quedas

---

## 2. Arquitetura Proposta

### Visão Geral

```
┌──────────────────────────────────────────────────────────┐
│                    PACIENTE (WhatsApp)                     │
└──────────────────────┬───────────────────────────────────┘
                       │
    ┌──────────────────▼──────────────────┐
    │     Meta Cloud API (webhook)         │
    │     POST /whatsapp-webhook           │
    └──────────────────┬──────────────────┘
                       │
    ┌──────────────────▼──────────────────┐
    │     whatsapp-bot/index.ts            │
    │     (adaptado para Cloud API)        │
    │     - Verifica assinatura webhook    │
    │     - Extrai mensagem/button/flow    │
    │     - Insere em message_inbox        │
    └──────────────────┬──────────────────┘
                       │
    ┌──────────────────▼──────────────────┐
    │     process-inbox (inalterado)       │
    │     - Debounce + Fusion              │
    │     - ClinicalAgent (LLM)            │
    └──────────────────┬──────────────────┘
                       │
    ┌──────────────────▼──────────────────┐
    │     Intent Router (NOVO)             │
    │     - "agendar" → WhatsApp Flow      │
    │     - "dúvida" → LLM Agent           │
    │     - "reagendar" → WhatsApp Flow    │
    │     - "complexo" → Human handoff     │
    └──────────┬───────────┬──────────────┘
               │           │
    ┌──────────▼──┐  ┌─────▼────────────┐
    │  WhatsApp    │  │  ClinicalAgent   │
    │  Flows       │  │  (LLM + Tools)   │
    │  (booking)   │  │  (FAQ, suporte)  │
    └──────────────┘  └──────────────────┘
               │           │
    ┌──────────▼───────────▼──────────────┐
    │     outboxDispatcher.ts              │
    │     (adaptado: Cloud API + Z-API)    │
    │     - sendViaCloudAPI()              │
    │     - sendViaZAPI() (fallback/legado)│
    └─────────────────────────────────────┘
```

### Fluxo de Agendamento com WhatsApp Flows

```
Paciente: "Quero agendar"
    │
    ▼
Bot: "Ótimo! Vou abrir nosso sistema de agendamento rápido 😊"
    + [BOTÃO: "Agendar Agora 📅"]
    │
    ▼ (paciente clica)
    │
    ▼ WhatsApp Flow abre nativamente no celular
    │
    ┌─── Tela 1: Especialidade ──────────┐
    │  Dropdown dinâmico:                 │
    │  - Odontologia                      │
    │  - Nefrologia                       │
    │  - Nutrição                         │
    │  [Continuar →]                      │
    └────────────────────────────────────┘
    │
    ┌─── Tela 2: Profissional ───────────┐
    │  Dropdown (filtrado por espec.):    │
    │  - Dr. Fabricio Oliveira            │
    │  - Dra. Fabiola Santos             │
    │  [Continuar →]                      │
    └────────────────────────────────────┘
    │
    ┌─── Tela 3: Serviço ───────────────┐
    │  Radio buttons:                     │
    │  ○ Avaliação Ortodôntica (30 min)  │
    │  ○ Limpeza Dental (45 min)         │
    │  ○ Consulta Geral (30 min)         │
    │  [Continuar →]                      │
    └────────────────────────────────────┘
    │
    ┌─── Tela 4: Data e Horário ─────────┐
    │  Datas disponíveis (radio):         │
    │  ○ Seg 07/04 — 09:00, 10:00, 14:00│
    │  ○ Ter 08/04 — 08:30, 11:00       │
    │  ○ Qua 09/04 — 09:00, 15:00       │
    │                                     │
    │  Horário selecionado: [dropdown]    │
    │  [Continuar →]                      │
    └────────────────────────────────────┘
    │
    ┌─── Tela 5: Confirmação ────────────┐
    │  🩺 Avaliação Ortodôntica           │
    │  👨‍⚕️ Dr. Fabricio Oliveira          │
    │  📍 Unidade Centro                  │
    │  📅 Segunda, 07/04/2026             │
    │  ⏰ 09:00                           │
    │                                     │
    │  Nome: ________                     │
    │  CPF: _________ (se necessário)     │
    │                                     │
    │  [✅ Confirmar Agendamento]         │
    └────────────────────────────────────┘
    │
    ▼ Flow response → whatsapp-bot webhook
    │
    ▼ book_appointment() é chamado
    │
    ▼ Bot envia: "✅ Agendamento confirmado! ..."
```

**Resultado: Agendamento completo em 30-90 segundos, ZERO ambiguidade, ZERO parsing de texto.**

---

## 3. Implementação — Fase a Fase

---

### FASE 1: Adapter Layer (Dual-Mode: Z-API + Cloud API)
**Prazo: 2-4 semanas**
**Objetivo: Poder enviar mensagens tanto via Z-API quanto Cloud API, por tenant**

#### 1.1 Registrar como Tech Provider na Meta
- Criar conta Meta Business: https://business.facebook.com
- Registrar App no Meta for Developers: https://developers.facebook.com
- Ativar WhatsApp Business API no app
- Obter: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `ACCESS_TOKEN`
- Verificar negócio (pode levar 1-2 semanas)

#### 1.2 Criar `cloudApiClient.ts` — Novo arquivo
**Arquivo:** `traffio-app/supabase/functions/_shared/cloudApiClient.ts`

Responsabilidades:
- Enviar mensagens de texto via Cloud API
- Enviar mensagens interativas (botões, listas)
- Enviar WhatsApp Flows
- Verificar assinatura de webhook (HMAC SHA-256)
- Upload de mídia (futuro)

```typescript
// Estrutura do arquivo (o implementador deve desenvolver):

export class CloudApiClient {
  private phoneNumberId: string;
  private accessToken: string;
  private apiVersion = 'v21.0';
  
  constructor(phoneNumberId: string, accessToken: string) { ... }
  
  // Enviar texto simples
  async sendText(to: string, text: string): Promise<void> { 
    // POST https://graph.facebook.com/{apiVersion}/{phoneNumberId}/messages
    // Body: { messaging_product: "whatsapp", to, type: "text", text: { body } }
  }
  
  // Enviar botões interativos (max 3)
  async sendButtons(to: string, bodyText: string, buttons: Array<{id: string, title: string}>): Promise<void> {
    // type: "interactive", interactive: { type: "button", body: { text }, action: { buttons } }
  }
  
  // Enviar lista de opções (max 10 rows, 10 sections)
  async sendList(to: string, bodyText: string, buttonText: string, sections: Array<{title: string, rows: Array<{id: string, title: string, description?: string}>}>): Promise<void> {
    // type: "interactive", interactive: { type: "list", body: { text }, action: { button, sections } }
  }
  
  // Enviar WhatsApp Flow
  async sendFlow(to: string, bodyText: string, flowId: string, flowToken: string, flowAction: 'navigate' | 'data_exchange', screenId?: string): Promise<void> {
    // type: "interactive", interactive: { type: "flow", body: { text }, action: { name: "flow", parameters: { flow_message_version: "3", flow_id, flow_token, flow_action, flow_action_payload: { screen: screenId } } } }
  }
  
  // Marcar mensagem como lida
  async markAsRead(messageId: string): Promise<void> {
    // POST messages, body: { messaging_product: "whatsapp", status: "read", message_id }
  }
  
  // Verificar assinatura do webhook (HMAC SHA-256)
  static verifyWebhookSignature(payload: string, signature: string, appSecret: string): boolean {
    // crypto.subtle.sign("HMAC", key, data) === signature
  }
}
```

**Endpoints Cloud API usados:**
```
POST https://graph.facebook.com/v21.0/{phone_number_id}/messages  → Enviar mensagem
POST https://graph.facebook.com/v21.0/{phone_number_id}/messages  → Marcar como lida
GET  https://graph.facebook.com/v21.0/{phone_number_id}           → Info do número
```

#### 1.3 Modificar `outboxDispatcher.ts` — Dual-Mode

O `outboxDispatcher.ts` precisa suportar AMBOS os providers (transição gradual por tenant).

**Mudanças necessárias:**

1. Adicionar import do `CloudApiClient`
2. Modificar `sendNow()` para verificar qual provider o tenant usa
3. Modificar `sendZapiMessage()` — manter como está (fallback)
4. Adicionar `sendCloudApiMessage()` — novo método

**Lógica de roteamento:**
```typescript
async sendNow(tenant: any, phone: string, payload: any, typingDelayMs = 0): Promise<void> {
  // Determinar provider baseado na config do tenant
  if (tenant.whatsapp_provider === 'cloud_api' && tenant.cloud_api_phone_number_id && tenant.cloud_api_access_token) {
    await sendCloudApiMessage(tenant, phone, payload);
  } else {
    // Fallback para Z-API (legado)
    await sendZapiMessage(tenant, phone, payload, typingDelayMs);
  }
}
```

#### 1.4 Modificar tabela `tenants` — Novos campos

**Migration SQL necessária:**
```sql
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS whatsapp_provider text DEFAULT 'zapi'; -- 'zapi' | 'cloud_api'
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS cloud_api_phone_number_id text;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS cloud_api_access_token text;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS cloud_api_business_account_id text;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS cloud_api_app_secret text; -- Para verificação de webhook
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS cloud_api_waba_id text; -- WhatsApp Business Account ID

-- Index para busca rápida por phone_number_id (webhook routing)
CREATE INDEX IF NOT EXISTS idx_tenants_cloud_api_phone ON public.tenants(cloud_api_phone_number_id) WHERE cloud_api_phone_number_id IS NOT NULL;
```

#### 1.5 Criar webhook para Cloud API — Novo Edge Function
**Arquivo:** `traffio-app/supabase/functions/whatsapp-cloud-webhook/index.ts`

O webhook da Cloud API tem formato DIFERENTE do Z-API.

**Payload de entrada (Cloud API):**
```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "WABA_ID",
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "phone_number_id": "PHONE_ID", "display_phone_number": "55..." },
        "messages": [{
          "id": "wamid.xxx",
          "from": "5541999999999",
          "timestamp": "1234567890",
          "type": "text",
          "text": { "body": "Olá" }
        }]
      },
      "field": "messages"
    }]
  }]
}
```

**Tipos de mensagem que o webhook recebe:**
- `type: "text"` → Texto normal
- `type: "interactive"` → Resposta de botão ou lista
  - `interactive.type: "button_reply"` → `interactive.button_reply.id`
  - `interactive.type: "list_reply"` → `interactive.list_reply.id`
- `type: "nfm_reply"` → Resposta de WhatsApp Flow
  - `interactive.nfm_reply.response_json` → JSON com dados do flow

**Responsabilidades do novo webhook:**
1. Verificar assinatura HMAC SHA-256 (header `X-Hub-Signature-256`)
2. Responder challenge de verificação (`GET` com `hub.verify_token`)
3. Resolver tenant pelo `phone_number_id`
4. Extrair conteúdo da mensagem (text, button_reply, list_reply, flow_reply)
5. Verificar idempotência (`wamid`)
6. Inserir em `message_inbox` (MESMO formato que Z-API — process-inbox inalterado)
7. Processar respostas de WhatsApp Flows (booking direto)

**Estrutura do arquivo:**
```typescript
serve(async (req: Request) => {
  // GET = webhook verification challenge
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }
  
  // POST = incoming message
  // 1. Verify HMAC signature
  // 2. Parse webhook payload
  // 3. Extract messages from entry[].changes[].value.messages[]
  // 4. For each message:
  //    a. Resolve tenant by phone_number_id
  //    b. Extract content based on type (text, interactive, nfm_reply)
  //    c. Check idempotency
  //    d. Insert into message_inbox
  //    e. If nfm_reply (Flow response): process booking directly
  // 5. Return 200 OK
});
```

#### 1.6 Criar `src/services/cloudApiService.ts` — Frontend
**Arquivo:** `traffio-app/src/services/cloudApiService.ts`

Para a UI de admin (substituir/complementar `zapiService.ts`):
- Status da conexão
- Informações do número
- Configurar webhook URL

---

### FASE 2: Interactive Messages Confiáveis
**Prazo: 2-4 semanas (em paralelo com Fase 1)**
**Objetivo: Botões e listas 100% confiáveis**

#### 2.1 Remover fallbacks de botões/listas no outboxDispatcher

Com a Cloud API, botões e listas SEMPRE funcionam. O código de fallback em `outboxDispatcher.ts:143-155` pode ser simplificado para Cloud API tenants.

#### 2.2 Adicionar botões interativos no fluxo de agendamento

Pontos onde usar botões (max 3):
- Após listar especialidades (se ≤ 3): botões
- Após listar profissionais (se ≤ 3): botões
- Confirmação final: [✅ Confirmar] [❌ Cancelar] [📝 Alterar]
- Particular vs Convênio: [💳 Particular] [🏥 Convênio]

Pontos onde usar listas (> 3 opções):
- Especialidades (se > 3): lista com seções
- Horários disponíveis: lista agrupada por data
- Profissionais (se > 3): lista com descrição

#### 2.3 Modificar ClinicalAgent para gerar interactive payloads

O `processMessage()` retorna apenas `string` hoje. Precisa retornar:
```typescript
interface AgentResponse {
  text: string;
  interactive?: {
    type: 'button' | 'list';
    buttons?: Array<{ id: string; title: string }>;
    sections?: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>;
  };
}
```

Ou alternativamente, o process-inbox pode pós-processar a resposta do agent e detectar padrões que devem virar botões (ex: quando oferece 2-3 horários → converte para botões automaticamente).

---

### FASE 3: WhatsApp Flows para Agendamento
**Prazo: 4-8 semanas**
**Objetivo: Agendamento completo em uma única interação nativa**

#### 3.1 Criar Flow de Agendamento no WhatsApp Manager

WhatsApp Flows são definidos via JSON e registrados na API. Podem ser:
- **Estáticos**: telas fixas, dados pré-definidos
- **Dinâmicos**: telas com dados do backend (via endpoint de data exchange)

Para agendamento, usaremos **Flow Dinâmico** (data exchange):

**Definição do Flow JSON (registrar via API):**
```json
{
  "name": "appointment_booking",
  "categories": ["APPOINTMENT_BOOKING"],
  "screens": [
    {
      "id": "SPECIALTY",
      "title": "Especialidade",
      "data": { "specialties": { "type": "array", "items": { "type": "object" }, "__example__": [{"id": "uuid1", "title": "Odontologia"}] } },
      "layout": {
        "type": "SingleColumnLayout",
        "children": [
          { "type": "Dropdown", "label": "Escolha a especialidade", "name": "specialty_id", "data-source": "${data.specialties}", "required": true },
          { "type": "Footer", "label": "Continuar", "on-click-action": { "name": "data_exchange", "payload": { "specialty_id": "${form.specialty_id}", "screen": "DOCTOR" } } }
        ]
      }
    },
    {
      "id": "DOCTOR",
      "title": "Profissional",
      "data": { "doctors": { "type": "array", "items": { "type": "object" }, "__example__": [{"id": "uuid2", "title": "Dr. Fabricio"}] } },
      "layout": {
        "type": "SingleColumnLayout",
        "children": [
          { "type": "Dropdown", "label": "Escolha o profissional", "name": "doctor_id", "data-source": "${data.doctors}", "required": true },
          { "type": "Footer", "label": "Continuar", "on-click-action": { "name": "data_exchange", "payload": { "doctor_id": "${form.doctor_id}", "screen": "SERVICE" } } }
        ]
      }
    },
    {
      "id": "SERVICE",
      "title": "Serviço",
      "data": { "services": { "type": "array", "items": { "type": "object" }, "__example__": [{"id": "uuid3", "title": "Avaliação"}] } },
      "layout": {
        "type": "SingleColumnLayout",
        "children": [
          { "type": "RadioButtonsGroup", "label": "Tipo de consulta", "name": "service_id", "data-source": "${data.services}", "required": true },
          { "type": "Footer", "label": "Ver Horários", "on-click-action": { "name": "data_exchange", "payload": { "service_id": "${form.service_id}", "screen": "DATETIME" } } }
        ]
      }
    },
    {
      "id": "DATETIME",
      "title": "Data e Horário",
      "data": { 
        "dates": { "type": "array", "items": { "type": "object" }, "__example__": [{"id": "2026-04-07", "title": "Seg 07/04"}] },
        "slots": { "type": "array", "items": { "type": "object" }, "__example__": [{"id": "09:00", "title": "09:00"}] }
      },
      "layout": {
        "type": "SingleColumnLayout",
        "children": [
          { "type": "Dropdown", "label": "Data", "name": "date", "data-source": "${data.dates}", "required": true },
          { "type": "Dropdown", "label": "Horário", "name": "time", "data-source": "${data.slots}", "required": true },
          { "type": "Footer", "label": "Confirmar", "on-click-action": { "name": "data_exchange", "payload": { "date": "${form.date}", "time": "${form.time}", "screen": "CONFIRM" } } }
        ]
      }
    },
    {
      "id": "CONFIRM",
      "title": "Confirmação",
      "data": {
        "summary": { "type": "string", "__example__": "🩺 Avaliação\n👨‍⚕️ Dr. Fabricio\n📅 07/04 às 09:00" }
      },
      "layout": {
        "type": "SingleColumnLayout",
        "children": [
          { "type": "TextBody", "text": "${data.summary}" },
          { "type": "TextInput", "label": "Seu nome completo", "name": "patient_name", "required": true, "input-type": "text" },
          { "type": "TextInput", "label": "CPF (apenas números)", "name": "cpf", "required": false, "input-type": "number" },
          { "type": "Footer", "label": "✅ Confirmar Agendamento", "on-click-action": { "name": "complete", "payload": { "patient_name": "${form.patient_name}", "cpf": "${form.cpf}" } } }
        ]
      }
    }
  ]
}
```

#### 3.2 Criar Flow Data Exchange Endpoint
**Arquivo:** `traffio-app/supabase/functions/whatsapp-flow-endpoint/index.ts`

Este endpoint é chamado pelo WhatsApp a cada transição de tela do Flow. Ele recebe os dados da tela anterior e retorna os dados para a próxima tela.

**Responsabilidades:**
```typescript
// Recebe request criptografado do WhatsApp
// Descriptografa com a private key do app
// Processa baseado na screen solicitada:

switch (screenId) {
  case 'SPECIALTY':
    // Query: SELECT id, name FROM specialties WHERE tenant_id = ?
    // Return: { specialties: [...] }
    
  case 'DOCTOR':
    // Query: SELECT id, full_name FROM doctors WHERE specialty = ? AND tenant_id = ?
    // Return: { doctors: [...] }
    
  case 'SERVICE':
    // Query: SELECT id, name, duration FROM appointment_types WHERE doctor_id = ?
    // Return: { services: [...] }
    
  case 'DATETIME':
    // Query: RPC get_available_slots(doctor_id, location_id, date_range)
    // Return: { dates: [...], slots: [...] }
    
  case 'CONFIRM':
    // Build summary string
    // Return: { summary: "🩺 Avaliação\n👨‍⚕️ Dr. Fabricio\n📅 07/04 às 09:00" }
}
```

#### 3.3 Processar Flow Completion no Webhook

Quando o paciente completa o flow, o webhook recebe:
```json
{
  "type": "interactive",
  "interactive": {
    "type": "nfm_reply",
    "nfm_reply": {
      "response_json": "{\"patient_name\":\"Maria\",\"cpf\":\"12345678900\",\"doctor_id\":\"uuid\",\"date\":\"2026-04-07\",\"time\":\"09:00\",\"service_id\":\"uuid\"}"
    }
  }
}
```

No `whatsapp-cloud-webhook/index.ts`, ao receber `nfm_reply`:
1. Parse o `response_json`
2. Chamar `book_appointment()` diretamente (sem LLM!)
3. Enviar confirmação ao paciente
4. Atualizar funnel stage para 'agendado'

**Isso elimina a necessidade do LLM para 80% dos agendamentos.**

#### 3.4 Modificar Intent Router no process-inbox

Quando o ClinicalAgent detecta intenção de agendar, em vez de iniciar o fluxo via LLM, disparar o WhatsApp Flow:

```typescript
// No process-inbox, após detectar intent de agendamento:
if (bookingIntent && tenant.whatsapp_provider === 'cloud_api' && tenant.flow_booking_id) {
  // Enviar mensagem com botão que abre o Flow
  const cloudApi = new CloudApiClient(tenant.cloud_api_phone_number_id, tenant.cloud_api_access_token);
  await cloudApi.sendFlow(
    phone,
    `${patientFirstName ? `${patientFirstName}, v` : 'V'}amos agendar sua consulta! 😊 Clique no botão abaixo para escolher especialidade, profissional, data e horário — é rapidinho!`,
    tenant.flow_booking_id,
    crypto.randomUUID(), // flow_token para tracking
    'navigate',
    'SPECIALTY' // tela inicial
  );
  // Não chama ClinicalAgent — flow resolve tudo
  return;
}
```

---

### FASE 4: Manter ClinicalAgent para Casos Especiais
**Prazo: Contínuo**
**Objetivo: LLM apenas para o que Flows não resolvem**

O ClinicalAgent (LLM) continua ativo para:
- **FAQ**: "Quanto custa?", "Aceita convênio X?", "Qual o endereço?"
- **Reagendamento complexo**: "Quero mudar para semana que vem mas só posso de manhã"
- **Suporte emocional**: "Estou com muito medo da consulta"
- **Triagem**: Decidir se encaminha para Flow, FAQ, ou humano
- **Fallback**: Se o Flow falhar ou paciente não clicar no botão

Com a Knowledge Base (RAG) que já tem migration criada (`20260406_knowledge_base.sql`), o ClinicalAgent pode responder FAQs consultando a base vetorial.

---

## 4. Campos Novos no Banco de Dados

### Tabela `tenants` — Novos campos
```sql
whatsapp_provider          text DEFAULT 'zapi'   -- 'zapi' | 'cloud_api'
cloud_api_phone_number_id  text                   -- ID do número na Meta
cloud_api_access_token     text                   -- Token permanente (System User Token)
cloud_api_business_account_id text                -- WABA ID
cloud_api_app_secret       text                   -- Para verificação HMAC
flow_booking_id            text                   -- ID do Flow de agendamento registrado
flow_reschedule_id         text                   -- ID do Flow de reagendamento
```

### Novos Arquivos
```
supabase/functions/_shared/cloudApiClient.ts          — Client da Cloud API
supabase/functions/whatsapp-cloud-webhook/index.ts    — Webhook para Cloud API
supabase/functions/whatsapp-flow-endpoint/index.ts    — Data exchange endpoint para Flows
supabase/migrations/20260406_cloud_api_fields.sql     — Migration com novos campos
src/services/cloudApiService.ts                       — Frontend service
```

### Arquivos Modificados
```
supabase/functions/_shared/outboxDispatcher.ts        — Dual-mode (Z-API + Cloud API)
supabase/functions/process-inbox/index.ts             — Intent router para Flows
src/pages/AdminWhatsApp.tsx                           — UI para configurar Cloud API
src/services/zapiService.ts                           — Manter para tenants legados
```

---

## 5. Custos Comparativos

| Item | Z-API (atual) | Cloud API (proposto) |
|------|---------------|----------------------|
| Plataforma | R$100-200/mês por instância | Grátis (self-hosted) |
| Conversas (marketing) | Incluído | ~R$0.50/conversa |
| Conversas (utility) | Incluído | ~R$0.10/conversa |
| Conversas (service) | Incluído | Grátis (primeiras 1000/mês) |
| LLM (GPT-4o-mini) | ~R$0.15-0.45/agendamento | ~R$0.02-0.05/agendamento (só FAQ) |
| **Total 300 conv/mês** | **~R$200-400** | **~R$50-150** |

**Economia estimada: 50-70% nos custos mensais por clínica.**

---

## 6. Riscos e Mitigação

| Risco | Mitigação |
|-------|-----------|
| Verificação de negócio demora | Iniciar Fase 1 enquanto aguarda aprovação |
| Pacientes não clicam no Flow | Fallback: ClinicalAgent assume via texto |
| Flow endpoint indisponível | Flow pode ter dados estáticos como fallback |
| Migração de número | Manter Z-API ativo durante transição, migrar por tenant |
| WhatsApp Flows em beta para alguns países | Brasil já tem suporte completo (GA) |

---

## 7. Cronograma Resumido

| Semana | Atividade |
|--------|-----------|
| 1-2 | Registro Meta Business, setup app, obter credenciais |
| 2-3 | Implementar `cloudApiClient.ts` + migration banco |
| 3-4 | Implementar `whatsapp-cloud-webhook` + dual-mode no outboxDispatcher |
| 4-5 | Testar envio/recebimento via Cloud API com 1 tenant piloto |
| 5-6 | Implementar botões e listas interativos (100% confiáveis) |
| 6-8 | Desenvolver WhatsApp Flow de agendamento + data exchange endpoint |
| 8-10 | Testar Flow completo E2E, iterar |
| 10-12 | Migrar tenants gradualmente, monitorar métricas |
| 12+ | Desativar Z-API para tenants migrados |
