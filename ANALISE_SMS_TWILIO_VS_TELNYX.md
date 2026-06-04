# Análise Comparativa: Twilio vs Telnyx
## Canal SMS — Plataforma Multi-País

**Data:** 2026-06-04  
**Países analisados:** Brasil, Estados Unidos, Canadá, Inglaterra (UK), México, Nova Zelândia  
**Contexto:** Escolha de provedor SMS para a central de automações (No-Show + NPS)

---

## Resumo Executivo

| | Twilio | Telnyx |
|---|:---:|:---:|
| **Preço** | Mais caro (base pública) | ~50% mais barato |
| **Sender ID no Brasil** | ✅ Sim (com cadastro, 10 semanas) | ❌ Não suportado |
| **Suporte 24/7 grátis** | ❌ Pago ($1.500/mês) | ✅ Incluído |
| **Uptime SLA** | 99,95% | 99,999% |
| **WhatsApp API** | ✅ Sim | ❌ Não |
| **Transparência de preços** | ✅ Pública para todos os países | ⚠️ Internacional requer login |

**Veredito:** Para a Traffio, **Telnyx é a melhor escolha** — exceto se o branding do Sender ID no Brasil for essencial. Nesse caso, Twilio é a única opção.

---

## 1. Preços de SMS por País

### Twilio (preços públicos e transparentes)

| País | Custo por SMS | Observação |
|---|---|---|
| 🇧🇷 **Brasil** | **$0,0599** (~R$0,33) | + possíveis tarifas de operadora |
| 🇺🇸 **Estados Unidos** | **$0,0083** + surcharges | AT&T +$0,0035, T-Mobile +$0,0045 → total ~$0,012 |
| 🇨🇦 **Canadá** | **$0,0083** + surcharges | Bell +$0,0087, Rogers +$0,0084 → total ~$0,017 |
| 🇬🇧 **Inglaterra** | **$0,0560** (~R$0,31) | — |
| 🇲🇽 **México** | **$0,1819** (~R$1,01) | O mais caro dos 6 países |
| 🇳🇿 **Nova Zelândia** | **$0,1050** (~R$0,58) | — |

### Telnyx (preços USA/CA públicos; demais requerem login)

| País | Custo por SMS | Observação |
|---|---|---|
| 🇧🇷 **Brasil** | Não publicado | Estimativa: 30–50% mais barato que Twilio |
| 🇺🇸 **Estados Unidos** | **$0,004** + surcharges | **52% mais barato que Twilio** na base |
| 🇨🇦 **Canadá** | **~$0,004** + surcharges | Bell/Virgin: sem surcharge adicional |
| 🇬🇧 **Inglaterra** | Não publicado | Estimativa: mais barato |
| 🇲🇽 **México** | Não publicado | Estimativa: mais barato |
| 🇳🇿 **Nova Zelândia** | Não publicado | Estimativa: mais barato |

> **Nota sobre segmentos:** SMS padrão = 160 chars. Com emoji = apenas 70 chars por segmento (encoding UCS-2). Cada segmento acima do limite é cobrado como SMS adicional.

---

## 2. Alphanumeric Sender ID por País

**Sender ID** é o que o destinatário vê no campo "De:" do SMS.  
Com Sender ID: `De: TRAFFIO` | Sem: `De: +1-555-1234`

| País | Twilio | Telnyx | Observação |
|---|:---:|:---:|---|
| 🇧🇷 **Brasil** | ✅ Sim* | ❌ Não | *Twilio requer cadastro de 10 semanas na TIM, CLARO e VIVO. VIVO aceita somente maiúsculas. |
| 🇺🇸 **EUA** | ❌ Não | ❌ Não | EUA **não permite** Sender ID alfanumérico — proibição regulatória dos carriers |
| 🇨🇦 **Canadá** | ❌ Não | ❌ Não | Canadá não suporta |
| 🇬🇧 **UK** | ✅ Sim | ✅ Sim | Ambos suportam, sem necessidade de cadastro prévio |
| 🇲🇽 **México** | ❌ Não | ❌ Não | Carrier sobrescreve com número aleatório |
| 🇳🇿 **Nova Zelândia** | ❌ Não | ❌ Não | Carrier sobrescreve |

> **Conclusão crítica:** Se a plataforma precisa que o SMS chegue com o nome da empresa (ex: "TRAFFIO" ou o nome da clínica), **somente Twilio resolve no Brasil** — e com 10 semanas de espera para aprovação. Para os demais países fora do UK, **nenhum dos dois** preserva o Sender ID.

---

## 3. Compliance por País

### 🇧🇷 Brasil — LGPD + ANATEL

| Requisito | Twilio | Telnyx |
|---|---|---|
| RC Bundle (obrigatório desde abr/2025) | ✅ Exigido | ✅ Exigido |
| Horário permitido | 09h–22h local, proibido domingo | 09h–22h local, proibido domingo |
| Opt-out em português | PARE, SAIR, AJUDA | PARE, SAIR, AJUDA |
| Delivery Report handset | ❌ Apenas SMSC-level | ❌ Apenas SMSC-level |
| Carriers sem Unicode | OI, NEXTEL, CTBC (evitar acentos) | OI, NEXTEL, CTBC (evitar acentos) |

> **Fuso horário no Brasil:** O país tem 3 fusos (Acre UTC-5, Amazônia UTC-4, Brasília UTC-3). O `process-outbound` já tem lógica de quiet hours — precisará ser expandida por timezone do paciente para SMS.

### 🇺🇸 EUA — TCPA + 10DLC

| Requisito | Twilio | Telnyx |
|---|---|---|
| Registro de Brand (10DLC) | $4,50 one-time | $4,50 sem markup |
| Campaign vetting fee | $15 one-time | $15 sem markup |
| Campaign mensal | $1,50–$10/mês | $1,50–$10/mês sem markup |
| Auth+ (desde ago/2025) | $15/tentativa | $15/tentativa |
| Prazo de aprovação | 10–15 dias úteis | 5–15 dias úteis |

> Taxas 10DLC são **impostas pelos carriers** (mesmo valor nos dois). Telnyx as repassa sem markup — Twilio não declara política de markup.

### 🇨🇦 Canadá — CASL + CRTC
- Consentimento expresso obrigatório. Opt-out deve ser processado em 10 dias úteis.
- A2P registration agora mandatória para long codes canadenses em ambos.

### 🇬🇧 UK — UK GDPR + ICO + PECR
- Consentimento prévio para marketing. ICO oversight.
- Twilio: Binding Corporate Rules cobertura global GDPR.
- Telnyx: Mesmas obrigações GDPR. Sender ID disponível sem registro.

### 🇲🇽 México — IFT + LFTAIPG
- Consentimento necessário. Sem lista DNC nacional robusta.
- Ambos: long codes locais disponíveis. Sender ID não preservado.

### 🇳🇿 Nova Zelândia — Unsolicited Electronic Messages Act 2007
- Consentimento expresso ou implícito. Opt-out obrigatório. Ambos funcionam.

---

## 4. Confiabilidade e Infraestrutura

| Métrica | Twilio | Telnyx |
|---|---|---|
| **Uptime SLA** | 99,95% | **99,999%** (cinco noves) |
| **Taxa de erro API** | 0,00% | 0,03% |
| **Latência API p50** | **~65ms** (mais rápido) | ~230ms |
| **Latência API p90** | **~115ms** | ~380ms |
| **Rede** | Parcerias com agregadores | **Backbone IP próprio**, licenças de carrier em 30+ países |
| **Redundância** | Múltiplos clouds | Multi-cloud, resistente a falhas AWS (out. 2025) |

> Para SMS de automação (não real-time), a diferença de latência de API é irrelevante — o SMS não é instantâneo por natureza. O uptime SLA mais alto da Telnyx é mais relevante.

---

## 5. Suporte

| | Twilio | Telnyx |
|---|---|---|
| **Suporte 24/7 grátis** | ❌ **Não** | ✅ **Sim** |
| **Plano básico (Developer)** | Sem SLA, apenas e-mail | 24/7 chat + phone + email grátis |
| **Para obter 24/7 com SLA** | $1.500/mês (plano Business) | Incluído em todas as contas |
| **Avaliação G2 (suporte)** | 8,2/10 | **9,3/10** |
| **Idioma** | Inglês (primário) | Inglês (primário) |

> **Impacto prático:** Se um tenant em produção tiver problema com SMS num domingo às 23h, com Telnyx existe suporte disponível. Com Twilio free tier, não há garantia de resposta.

---

## 6. Recursos de API

| Recurso | Twilio | Telnyx |
|---|---|---|
| REST API | ✅ | ✅ |
| Node.js / TypeScript SDK | ✅ | ✅ |
| Python SDK | ✅ | ✅ |
| Webhooks delivery status | ✅ | ✅ |
| RCS Business Messaging | ✅ GA em 22+ países | ✅ GA desde jul/2025 |
| WhatsApp Business API | ✅ | ❌ |
| E-mail integrado (SendGrid) | ✅ | ❌ |
| MMS (USA/CA) | ✅ | ✅ |
| MMS (BR/UK/MX/NZ) | ❌ (fallback SMS) | ❌ (fallback SMS) |
| "Twexit" (migração de Twilio) | N/A | ✅ API compatível com Twilio |
| Documentação / Comunidade | **Benchmark da indústria** | Boa, mas menor |

---

## 7. Trial e Custos Iniciais

| | Twilio | Telnyx |
|---|---|---|
| Crédito inicial | **$15,50** | $5,00 |
| Cartão de crédito para trial | Não necessário | Não necessário |
| Restrição do trial | Só envia para números verificados | Só envia para números verificados |
| Limite de envio trial | 100 SMS | 100 SMS/dia |
| Validade | 30 dias | 30 dias |

---

## 8. Descontos por Volume

| | Twilio | Telnyx |
|---|---|---|
| Desconto automático | A partir de 150K msgs/mês | Growth Plan: 8% off acima de $1K/mês |
| Enterprise | Contrato anual com desconto | Contrato negociado |
| Desconto base em EUA (1M+ msgs) | de $0,0083 para $0,0073/msg | de $0,004 para $0,0005/msg (1B+) |

---

## 9. Pontos Cegos e Riscos

### Twilio — Riscos
- **Mais caro:** ~2x o preço base nos EUA vs Telnyx
- **Suporte caro:** Para SLA garantido precisa pagar $1.500/mês
- **Sender ID Brasil:** Funciona, mas 10 semanas de espera e processo manual por carrier

### Telnyx — Riscos
- **Sem Sender ID no Brasil:** O SMS chega de número aleatório — pode parecer spam
- **Preços internacionais ocultos:** Brasil, UK, México, NZ requerem login para ver preço real
- **Sem WhatsApp API:** Se no futuro quiser consolidar WhatsApp + SMS num único SDK, não tem
- **Menor ecossistema:** Menos integrações de terceiros, documentação menos extensa

---

## 10. Recomendação para a Traffio

### Cenário A — Sender ID não é prioridade (recomendado para iniciar)

**Use Telnyx**

- Menor custo operacional em todos os países
- Suporte 24/7 sem custo adicional
- Uptime SLA superior (99,999%)
- A plataforma já tem WhatsApp via Z-API/Meta — não precisa do WhatsApp API do Twilio
- Integração simples via SDK Node.js/TypeScript (igual ao ambiente Deno das Edge Functions)

```
SMS chega "De: +5511999999999" (número fixo do tenant)
→ Paciente não vê o nome da clínica, mas recebe o SMS normalmente
```

### Cenário B — Branding por nome da clínica no Brasil é essencial

**Use Twilio para o Brasil + Telnyx para os demais países**

```
Brasil  → Twilio  (Sender ID "CLINICA" após 10 semanas de cadastro)
EUA     → Telnyx  (52% mais barato, sem Sender ID disponível nos EUA de qualquer forma)
UK      → Telnyx  (Sender ID disponível em ambos; Telnyx mais barato)
CA/MX/NZ → Telnyx (sem Sender ID em nenhum dos dois; Telnyx mais barato)
```

> Esta abordagem dual é tecnicamente viável — o roteador no `process-outbound` pode selecionar o provedor baseado no país do telefone do paciente.

### Cenário C — Simplicidade acima de tudo

**Use Twilio em todos os países**

- Preços públicos e previsíveis para planejamento
- Uma única integração
- Melhor documentação para a equipe
- Custo maior, mas mais simples de operar

---

## Decisão Sugerida

```
FASE 1 (agora): Telnyx
  → Integrar primeiro, começar a cobrar SMS
  → Sender ID será número do tenant (sem branding customizado)
  → Custo menor para validar o canal

FASE 2 (se mercado brasileiro demandar branding):
  → Adicionar Twilio como provedor secundário só para Brasil
  → Iniciar registro de Sender ID (10 semanas de lead time)
  → Roteador já está preparado para isso (campo sms_provider no tenant)
```

---

## Script SQL: Atualizar `tenants` para suportar múltiplos provedores

```sql
-- EXECUTAR NO SQL EDITOR DO SUPABASE
-- Suporte a dois provedores SMS (para estratégia dual Telnyx+Twilio)

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS sms_provider TEXT
    CHECK (sms_provider IN ('zenvia', 'twilio', 'telnyx'));

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS sms_api_key TEXT;
  -- Telnyx: API Key do portal Mission Control
  -- Twilio: "AccountSID:AuthToken" (concatenado)
  -- Zenvia: X-API-TOKEN

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS sms_sender_id TEXT;
  -- Telnyx/Twilio: número E.164 (+5511XXXXXXXX) ou string alfanumérica (apenas UK/BR-Twilio)
  -- Exemplo: "+5511999990000" ou "TRAFFIO"

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN NOT NULL DEFAULT false;

-- Opcional: provedor de fallback se o primário falhar
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS sms_fallback_provider TEXT
    CHECK (sms_fallback_provider IN ('zenvia', 'twilio', 'telnyx'));

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS sms_fallback_api_key TEXT;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS sms_fallback_sender_id TEXT;

-- Verificar
SELECT id, name, sms_provider, sms_sender_id, sms_enabled
FROM tenants
ORDER BY name;
```

---

*Fontes: Documentação oficial Twilio (2025), Documentação oficial Telnyx (2025), benchmarks Knock.app, análise SuprSend, APIScout comparativo 2026.*
