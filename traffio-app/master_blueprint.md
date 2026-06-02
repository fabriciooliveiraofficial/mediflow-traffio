# 🌐 MASTER BLUEPRINT: Traffio Medical - Plataforma de Elite

**Objetivo:** Construir o ecossistema médico mais sofisticado do mercado global.  
**Stack Tecnológica:** Next.js 14+ (App Router), TypeScript (Strict), Tailwind CSS, Framer Motion, Prisma ORM, PostgreSQL, Redis, OpenAI SDK, Stripe/Asaas SDK.

---

## 🏗️ 1. Infraestrutura & Segurança de Elite (The Foundation)
A arquitetura foi projetada para máxima performance, segurança de dados sensíveis e previsibilidade financeira absoluta.

### 1.1 Compute & Deployment Model (The App Layer)
*   **Fase 0: Bootstrap (Custo R$ 0,00):**
    *   **Frontend/API:** Cloudflare Pages (Free Tier).
    *   **IA Engine (Lógica):** AWS Lambda (Free Tier - 1M invocations/mês).
    *   **IA Engine (LLM):** **Groq API (Tier Gratuito)** para processamento de texto ultrarrápido sem custo.
*   **Fase 1: Scale-up (Com Faturamento):**
    *   **Hospedagem Primária:** Cloudflare Workers / Pages (Paid Tier).
    *   **Engine de IA (Backend Pesado):** AWS App Runner / Lambda (Provisioned).
*   **Staging & Preview:** Ambientes efêmeros nativos da Cloudflare vinculados a PRs.

### 1.2 Data Persistence & Compliance (The Data Layer)
*   **Fase Bootstrap:** Supabase Free Tier (500MB) + **Cloudflare R2 (10GB Free)** para arquivos e exames.
*   **Fase Pro:** Supabase Pro (Managed PostgreSQL) para backups e escalabilidade.
*   **Criptografia:** AES-256-GCM no nível de aplicação (colunas sensíveis) + TDE (Transparent Data Encryption) em repouso.
*   **RBAC & RLS:** Implementação rigorosa de *Row Level Security* (RLS) para garantir isolamento total entre Tenants (Clínicas).
*   **Performance:** CDN Edge em todas as requisições; cache de dados sensíveis em Redis.

---

## 🎨 2. Design System: O Protocolo Blue Master
O Agente deve agir como um designer de produto sênior.

*   **Fundamentos:**
    *   **Ice Glaze (Light):** #F8FAFC com gradientes de vidro translúcido.
    *   **Night Surgery (Dark):** #0A0A0B com brilho azul infravermelho.
    *   **Primary Blue:** #1152d4 (Aplicar em todos os botões de ação e ícones de status).
*   **Interações:** Animações de 300ms (Spring) usando Framer Motion. Nada de transições bruscas.
*   **Tipografia:** Plus Jakarta Sans (Escalonamento geométrico 1.25x).

---

## 🤖 3. Core Engine de IA (The Super Agent)
A alma da plataforma. Implementação de **Fluxo Híbrido** (Determinístico + Generativo) para máxima eficiência e lucro.

*   **Arquitetura "Lean AI" (Custo Enxuto):**
    *   **Orquestrador (State Machine):** O comportamento não é 100% livre. O Tenant desenha um **Fluxo** (Saudação -> Menu -> Agenda). A IA atua apenas como "Roteador" para garantir que o usuário siga o caminho.
    *   **Z-API Interativo:** Uso massivo de **List Messages (Menus)** e **Botões** para inputs do paciente. Isso elimina a necessidade de interpretar texto livre para escolhas simples (ex: escolher especialidade), economizando milhares de tokens.
    *   **Modelos:**
        *   **Gemini 3 Flash:** Para intenção rápida e "conversa fiada" (90% do volume).
        *   **Claude Sonnet 3.5:** Apenas para validação clínica final e contextos complexos.

*   **Monitoramento de Lucro (Anti-Prejuízo):**
    *   **Dashboard de Uso:** Gráficos em tempo real de Tokens Consumidos vs Valor Cobrado.
    *   **Custo Transparente:** O tenant vê exatamente quanto a "inteligência" está custando.

*   **Memória & Treinamento:**
    *   **Context Injection:** O "treinamento" é feito via **System Prompts** configuráveis no painel do Tenant (Aba "Robô").
    *   **RAG Leve:** Injeção de regras de negócio (endereço, horários, convênios) no contexto da IA.

---

## 🛠️ 4. Roadmap de Funcionalidades (O Caminho da Criação)

### Fase 1: O War-Room (Painel e Gestão)
*   **P01 a P06:** Dashboards com widgets reativos.
*   **Agenda Mestra (Hard-Coded):** Implementação da lógica de "Magnetic Snap" e motor de validação de horários 100% determinístico.
*   **Core do Super Agente:** Setup do LangGraph integrando Gemini 3 Flash com o motor de agendamento local.

### Fase 2: O Clinical Suite (EMR e Operações)
*   **P07 e P08:** Implementar o Escritório Clínico com suporte a prescrições eletrônicas assinadas via Certificado Digital (ICP-Brasil).
*   **Conexão Asaas:** Criar o fluxo de Webhooks para conciliação bancária automática (Pagou no Asaas -> Libera Agendamento no Traffio).

### Fase 3: O Patient Journey (PWA e Timeline)
*   **Check-in Express & Geofencing:** Validação de proximidade via **API de GPS nativo** (camada única). O check-in é liberado apenas se o paciente estiver no raio de segurança da clínica.
*   **Sala de Espera Virtual:** Link dinâmico via WhatsApp permitindo visualização de posição na fila e tempo estimado em tempo real (Realtime Queue), sem necessidade de login.
*   **Fluxo de Status Flexível:** Geração de QR Code dinâmico para recepção **ou** atualização automática do status para `confirmed`/`checkin_done` na Agenda do médico. O fluxo é adaptável para profissionais que atendem sem secretária ou painel de recepção.
*   **Timeline de Saúde:** Criar a Timeline de Saúde como um "Feed" social de eventos médicos. 

---

## 🔗 5. Integrações & API Master (The Connective Tissue)

*   **Asaas REST API:** Endpoints para criação de clientes, geração de cobranças (Pix/Cartão) e split de pagamento entre clínica e médico.
*   **Twilio/WhatsApp Business API:** Hub de comunicação para lembretes automáticos via IA.
*   **Google Maps SDK:** Para a visualização do Hub de Unidades e cálculo de trânsito para o paciente.

---

## 🛡️ 6. Guia Anti-Falhas (QA & Best Practices)

*   **Zero Layout Shift:** Todas as imagens e skeletons devem ter dimensões fixas antes do carregamento.
*   **Error Boundaries:** Envolver cada widget em uma Error Boundary para que uma falha no CRM não quebre a Agenda.
*   **Unit Testing:** Cobertura de 80%+ em funções de cálculo de ROI e lógica de triagem.
*   **Responsive Master:** O design deve ser testado rigorosamente em resoluções de 390px (Mobile) até 2560px (Ultrawide).
*   **Toast Over Alert:** NUNCA usar `window.alert()`. Converter SEMPRE todas as notificações e erros em componentes de Toast (Sonner/Toast Component) para manter a experiência premium.

---

## 📝 7. Instrução Executiva para o Agente de IA
"Priorizar a experiênca fluida. Se o código for complexo, mantenha a interface simples. Se o dado for pesado, use carregamento progressivo. Cada linha de código deve servir ao propósito de elevar a autoridade do especialista médico e a segurança do paciente. Comece pela estrutura do Design System e avance para as regras de negócio da Agenda."

---

## 🔐 8. Credenciais de Teste (IA Agent)

> **Uso Exclusivo para Testes Automatizados e Manuais**

*   **Login URL:** [Localhost Login](http://localhost:5173/login)
*   **Email:** `clinica1@traffio.com.br`
*   **Senha:** `Fdm060881@#$`
