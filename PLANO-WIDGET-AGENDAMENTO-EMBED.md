# Plano — Ferramenta de Agendamento Avançado Embarcável (Embed Widget Multi-Tenant)

> **Status:** Diagnóstico + Plano (NÃO executar código ainda — aguardando aprovação)
> **Autor:** Senior Fullstack — Mediflow / Traffio
> **Data:** 2026-06-17
> **Produto:** `https://mediflow-traffio.com`

---

## 1. Diagnóstico Cirúrgico

### 1.1. O que JÁ existe (reaproveitar — não reconstruir)
A plataforma já possui um **motor de agendamento maduro** no Supabase/Postgres. O fluxo que você descreveu (procedimento → profissional → data → slot → dados pessoais → confirmação) **já está implementado**:

| Capacidade | Onde já existe |
|---|---|
| Wizard de agendamento completo (5 passos) | `traffio-app/src/pages/portal/PortalBook.tsx` |
| Busca de slots disponíveis | `smartSchedulingService.getAvailableSlots()` |
| Lock de slot (anti-corrida) | RPC `lock_slot` |
| Booking atômico (anti-double-booking) | RPC `book_appointment_atomic` + migration `02_atomic_booking.sql`, `05_anti_double_booking_and_omnichannel.sql` |
| Próximas datas disponíveis | RPC `find_next_available_dates` (v1→v4) |
| Multi-tenant com isolamento | `tenant_id` + RLS (`03_enable_rls.sql`) |
| Profissionais, unidades, disponibilidade | tabelas `doctors`, `locations`, `doctor_availability` |
| Cancelamento / política de multa | `appointmentService.ts`, `20260220_add_cancellation_policies.sql` |
| Edge Functions (Deno) já em produção | `traffio-app/supabase/functions/*` |

**Conclusão:** o gap **não é o agendador**. É a **camada de distribuição pública (embed)** + uma **API pública sem login** para que esse mesmo motor rode dentro do site de cada clínica.

### 1.2. O ponto que precisa de correção conceitual (importante)
No prompt há uma premissa que vale revisar cirurgicamente:

> *"cada landing tem seu próprio MySQL... a plataforma sincroniza de forma bi-direcional..."*

**A forma moderna NÃO duplica dados nem faz "sync bi-direcional" entre dois bancos.** Plataformas líderes (Calendly, Cal.com, Acuity, SimplyBook, Booknetic) usam **fonte única da verdade (single source of truth)**: o widget embarcado na landing é um **cliente fino** que lê e escreve **direto na API da plataforma**. Não existe segundo banco a sincronizar.

- O **MySQL da Hostinger** serve para o site institucional/marketing — **não precisa armazenar agendamentos**.
- A sensação de "sync bi-direcional em tempo real" é obtida porque **o widget e o painel da clínica leem/escrevem o MESMO banco** (Supabase). Disponibilidade aparece em tempo real; um booking feito na landing surge no painel instantaneamente (via Supabase Realtime).

> **Regra de ouro:** *Não sincronize dois bancos. Tenha um só banco e muitas janelas para ele.*

### 1.2.1. DECISÃO TRAVADA — Cenário A (definitivo)
**Nunca** haverá integração com sistema de agendamento legado da clínica. A plataforma é o **único** sistema de agendamento. Isso simplifica a arquitetura: **removido qualquer trabalho de webhooks de saída / sync com terceiros (antigo "Cenário B" — descartado).**

### 1.3. Observação de stack
- **Plataforma:** Supabase (Postgres + Edge Functions Deno) — já é o backend real.
- **Landings:** Hostinger (PHP/HTML estático **ou** Node). Para o embed, **a tecnologia da landing é irrelevante** — basta ela renderizar um `<script>` + uma `<tag>`. Funciona igual em HTML puro, PHP, WordPress, Node/Next, Wix etc.

---

## 2. Arquitetura Recomendada

### 2.1. Visão geral
```
┌───────────────────────────────────────────────┐
│         PLATAFORMA (fonte única da verdade)     │
│  Supabase: Postgres (RLS) + Edge Functions      │
│  doctors · locations · availability · appts     │
└───────────────────────┬────────────────────────┘
                        │ (1) API pública (publishable key)
                ┌───────▼───────┐
                │ Public Booking │
                │ API (Edge Fn)  │
                └───────▲───────┘
                        │ (2) HTTPS (CORS + key por tenant)
        ┌───────────────┴─────────────────────────────┐
        │   WIDGET INLINE (Web Component + Shadow DOM)  │
        │   drawer/off-canvas no MESMO DOM da landing   │
        │   → dispara fbq()/gtag() do pixel do PAI      │
        └───────────────────────────────────────────────┘
```
> Sem iframe, sem janela externa, sem segundo banco. Um só backend; o widget é uma janela inline para ele.

### 2.2. Mecanismo de embed — DECISÃO RECOMENDADA
**Web Component (Custom Element) com Shadow DOM, distribuído por 1 loader script via CDN.**

Snippet único que cada cliente cola na landing (igual para todos = "template", mas parametrizado por tenant):

```html
<!-- Mediflow Booking Widget -->
<script src="https://cdn.mediflow-traffio.com/widget/v1/loader.js" async></script>

<mediflow-booking data-key="pk_live_xxxxxxxx"></mediflow-booking>
```

> **Snippet imutável:** a `data-key` é o **único** identificador necessário. Idioma, cor, pixel, domínios, fuso e textos são **resolvidos no servidor** a partir da key. Mudou algo no painel? Reflete ao vivo em todas as landings **sem o cliente reeditar o código**. (Atributos como `data-primary-color`/`data-lang` existem apenas como *override* opcional — ver Seção 11.)

A interação acontece via **botão na landing → drawer/off-canvas inline** (sem nova aba, sem popup de browser, sem iframe). Ver Seção 9 (UX +50).

**Por que Web Component + Shadow DOM (e por que o iframe foi DESCARTADO):**
- **Rastreamento de marketing funciona (requisito #2).** Como o widget roda no **mesmo DOM** da landing, a conversão dispara `fbq()`/`gtag()` do **pixel do pai** nativamente. Um iframe cross-origin **quebraria** isso (Same-Origin Policy isola os eventos) — motivo nº1 para não usar iframe. Ver Seção 2.5.
- **Nunca abre janela externa (requisito #3).** Tudo é inline, no formato onboarding (drawer). Iframe-popup teria "cara" de elemento externo.
- **Isolamento de CSS/JS** via Shadow DOM → o estilo da landing não quebra o widget e vice-versa (mesma garantia do iframe, sem o peso/atrito dele).
- **Framework-agnostic** → roda em HTML puro, PHP, WordPress, Node, React, Wix.
- **1 snippet padronizado** para todos os tenants; o `data-tenant` + `data-key` parametriza. Estrutura idêntica = o "template" que você quer.
- **Visual nativo** (sem moldura de iframe), responsivo, com tema por `data-primary-color`.

### 2.3. Como os grandes fazem (validação de mercado)
- **Cal.com / Calendly:** loader `<script>` + embed (inline / popup / floating button) gerado por um *embed snippet generator*; iframe + `postMessage` para altura e eventos. ([Cal.com embed](https://cal.com/embed), [guia de embed](https://www.usecarly.com/blog/how-to-embed-booking-widget/))
- **Booknetic:** widget de iframe embarcável multi-tenant. ([Booknetic](https://www.booknetic.com/feature/embeddable-iframe-booking-widget))
- **Padrão de saúde 2025:** sincronização **bi-direcional em tempo real é obrigatória** para evitar double-booking, e integrações com sistemas externos se fazem por **API + webhooks** nos planos avançados — não por cópia de banco. ([Embeddable](https://embeddable.co/blog/best-scheduling-and-booking-widgets-for-websites), [Nopio build vs buy](https://www.nopio.com/blog/medical-appointment-scheduling/))

### 2.4. Comparativo de mecanismos de embed
| Critério | **Web Component + loader (ESCOLHIDO)** | Iframe puro | Lib React/NPM |
|---|---|---|---|
| **Rastreamento Meta/Google na landing** | ✅ nativo (mesmo DOM) | ❌ **quebra** (cross-origin) | ✅ |
| **Sem janela/aba externa (onboarding inline)** | ✅ drawer no DOM | ⚠️ moldura externa | ✅ |
| Funciona em HTML/PHP/WP | ✅ | ✅ | ❌ (só projetos JS) |
| Isolamento de estilo | ✅ (Shadow DOM) | ✅ (total) | ⚠️ (vaza CSS) |
| Facilidade p/ cliente final | ✅ (1 script + 1 tag) | ✅ | ❌ (precisa dev) |
| Tema/branding por tenant | ✅ (atributos) | ⚠️ (querystring) | ✅ |
| Peso / performance | ✅ leve, lazy-load | ⚠️ médio | ✅ |
| **Veredito** | **ESCOLHIDO** | ❌ Descartado (quebra tracking) | Só p/ clientes técnicos |

### 2.5. Rastreamento de Marketing (Meta Pixel + Google Ads) — requisito #2
Como o widget é **inline (mesmo DOM da landing)**, o pixel que a clínica já tem na página captura tudo. O widget só precisa **emitir eventos**, sem precisar instalar pixel próprio:

- O widget dispara eventos padronizados no `window.dataLayer` **e** chama `fbq`/`gtag` se existirem no pai:
  - `booking_widget_open` (abriu o drawer)
  - `booking_step` (avançou de passo) — útil p/ funil
  - `booking_lead` (preencheu dados → `fbq('track','Lead')`)
  - `booking_purchase` / `Schedule` (agendou → `fbq('track','Schedule')`, `gtag('event','conversion')`)
- Cada evento leva `tenant`, `specialty`, `doctor_id` (sem PII) → permite otimização de campanha por procedimento.
- A clínica configura os IDs de conversão no **painel de instalação** (Fase 4); o snippet injeta os disparos. Nenhuma tag precisa ser editada na mão.

> Isso é **impossível de fazer bem com iframe cross-origin** — confirmando a escolha do Web Component.

#### 2.5.1. Evento-âncora de conversão = TELA DE SUCESSO + Virtual Pageview (requisito #1)
O widget é uma SPA dentro do drawer (a URL da landing **não muda**), então não existe uma "página /obrigado" real para o pixel capturar. Resolvemos com **dois disparos simultâneos** no momento em que a tela de confirmação aparece — cobrindo as duas formas que profissionais de marketing configuram conversão:

1. **Evento de conversão direto** (recomendado): `fbq('track','Schedule')` + `gtag('event','conversion', {...})` + `dataLayer.push({event:'booking_confirmed'})`.
2. **Virtual Pageview** (compatibilidade): no momento do sucesso, o widget faz `history.pushState` para uma rota-fantasma configurável (ex.: `…/agendamento-confirmado`) e empurra um `page_view` virtual no `dataLayer`. Assim, **conversões configuradas por URL de página de obrigado (GTM/Google Ads) disparam normalmente**, sem o cliente precisar criar uma página real.

- A **tela de sucesso** ("✅ Agendamento confirmado!") é o gatilho visual e o ponto exato do disparo — é a "página de obrigado" que você pediu, só que inline.
- A rota-fantasma e os IDs (Pixel/Ads/label) são definidos por tenant no painel de instalação (Fase 4) — o cliente não edita código.
- O disparo é **idempotente** (uma vez por agendamento) para não inflar conversões em refresh/voltar.

---

## 3. Gap Analysis — o que falta construir

| # | Componente | Existe? | Ação |
|---|---|---|---|
| G1 | **Public Booking API** (Edge Functions sem login de paciente) | ❌ | Criar `public-booking` (GET especialidades/profissionais/slots; POST lock + book + criar lead/paciente) |
| G2 | **Publishable key por tenant** (`pk_live_...`) + validação de origem (allowed domains) | ❌ | Tabela `tenant_public_keys` + middleware de validação |
| G3 | **RLS de leitura pública** (anon) para recursos ativos por tenant | ⚠️ parcial | Policies `anon SELECT` em doctors/locations/availability (somente `is_active`) |
| G4 | **Widget embarcável** (Web Component, Shadow DOM, build standalone) | ❌ | Novo pacote `packages/booking-widget` (Vite lib mode → `loader.js`) |
| G5 | **Reaproveitar o wizard** do `PortalBook.tsx` como core do widget | ⚠️ | Extrair lógica de UI para componente reutilizável headless |
| G6 | **Captura de lead anônimo** (finalidade comercial: nome, telefone, email — **sem dados fiscais**) | ⚠️ | Fluxo "guest booking" → cria/match `patients` por telefone |
| G7 | **Anti-abuso** (rate limit + Cloudflare Turnstile/hCaptcha no POST) | ❌ | Adicionar verificação no `public-booking` |
| G8 | **Realtime** no painel da clínica (booking novo aparece sozinho) | ⚠️ existe `useRealtimeQueue` | Estender para appointments |
| G9 | **UX onboarding +50 + drawer/off-canvas** (Seção 9) — alto contraste, fontes grandes, 1 decisão por tela, ícones SVG | ❌ | Design system dedicado do widget |
| G10 | **Camada de rastreamento** (`dataLayer` + `fbq`/`gtag` no pai) | ❌ | Bridge de eventos no widget + config de IDs por tenant |
| G11 | **CDN + versionamento** do widget (`/widget/v1/loader.js`) | ❌ | Deploy em CDN (Cloudflare/bunny) com cache + SRI |
| G12 | **Painel "Instalação"** no app: gera snippet + domínios + IDs de pixel/conversão | ❌ | Tela em `MasterApp`/settings que emite o `<script>` |
| G13 | **i18n por tenant (BR/US/NZ)** — idioma automático, **sem toggle** (Seção 10) | ❌ | `locale`/`country`/`timezone` no tenant + pacotes de tradução + formatos `Intl` |
| G14 | **Tela de sucesso + virtual pageview** (evento-âncora de conversão) | ❌ | Rota-fantasma configurável + disparo idempotente (Seção 2.5.1) |
| G15 | **Confirmação por e-mail** (sempre e-mail, **nunca** WhatsApp) após o booking | ❌ | Envio de e-mail pós-`book` (edge function/trigger) — e-mail vira campo obrigatório no form |
| G16 | **Máscara de telefone por país** (BR/US/NZ); e-mail universal (sem máscara) | ❌ | `Intl`/máscara a partir de `tenants.country` (Fase 2C) |

> Observação: o `corsHeaders` atual usa `Access-Control-Allow-Origin: '*'` — aceitável para leitura pública, mas o **POST de booking** deve validar `Origin` contra os `allowed_domains` do tenant.

---

## 4. Modelo de Dados (novas tabelas)

```sql
-- Chaves públicas por tenant (uma publishable, nunca a service_role)
create table tenant_public_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  public_key text not null unique,          -- pk_live_xxx
  allowed_domains text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz default now()
);

-- IDs de marketing + rota-fantasma de conversão por tenant (requisito #1)
alter table tenant_public_keys
  add column meta_pixel_id text,
  add column google_ads_id text,
  add column google_conversion_label text,
  add column success_virtual_path text default '/agendamento-confirmado';

-- Localização por tenant (requisito #2) — idioma decidido pela clínica, nunca pelo visitante
alter table tenants
  add column locale text not null default 'pt-BR',   -- pt-BR | en-US | en-NZ
  add column country text not null default 'BR',      -- BR | US | NZ (define campos do form)
  add column timezone text not null default 'America/Sao_Paulo';

-- Tema + FAB (conversão secundária) — config do widget por tenant
alter table tenant_public_keys
  add column primary_color text default '#0E7C7B',           -- 1 cor; paleta derivada no widget (Seção 9.6)
  add column fab_label text default 'Agendar',
  add column fab_style text default 'soft',                  -- solid | soft | outline
  add column fab_position text default 'bottom-right',
  add column fab_delay_ms int default 0;                     -- atraso p/ aparição sutil
```
+ coluna `source` em `appointments` já existe (usar `'landing_widget'`).

> O `locale` é resolvido **server-side** a partir do tenant e devolvido junto com a config do widget. O snippet também aceita `data-lang` como override explícito (gerado automaticamente pelo painel) — **mas nunca há seletor de idioma para o visitante**.

---

## 5. Segurança (não-negociável)
- [ ] Widget usa **somente publishable key** (`pk_live_`) — **nunca** `service_role`/anon secret.
- [ ] POST de booking valida `Origin`/`Referer` contra `allowed_domains` do tenant.
- [ ] **Rate limiting** por IP + tenant no endpoint público.
- [ ] **Turnstile/hCaptcha** no passo de confirmação (anti-bot).
- [ ] RLS anon: leitura **apenas** de recursos `is_active = true` do tenant; nunca expõe dados de pacientes.
- [ ] Lock de slot mantém TTL curto (já existe lógica de "10 min para confirmar").
- [ ] Eventos de rastreamento **sem PII** (só `tenant`/`specialty`/`doctor_id`).
- [ ] LGPD: consentimento explícito no formulário de dados pessoais + política de privacidade (já há `PrivacyPolicy.tsx`).

---

## 6. Tasklist Executável

### Fase 0 — Decisões & Spike (1–2 dias)
- [x] **0.1** ✅ TRAVADO: Cenário A (widget = fonte única). Sem sistema legado, jamais.
- [x] **0.2** ✅ TRAVADO: embed via **Web Component inline** (iframe descartado por quebrar rastreamento).
- [ ] **0.3** Definir CDN (Cloudflare Pages/Workers, bunny.net ou Supabase Storage + CDN).
- [ ] **0.4** Definir domínio do widget: `cdn.mediflow-traffio.com` + esquema de versão `/widget/v1/`.
- [ ] **0.5** Aprovar **design system +50** (Seção 9): paleta de alto contraste, escala tipográfica, biblioteca de ícones SVG.

### Fase 1 — API Pública de Agendamento (backend)
- [x] **1.1** ✅ Migration `20260617_widget_public_booking.sql`: tabela `tenant_public_keys` (key auto-gerada + tema/FAB/pixel/domínios) + colunas `locale`/`country`/`timezone` em `tenants` + helper `provision_tenant_public_key`.
- [x] **1.2** ✅ **Refinado:** em vez de RLS `anon` em várias tabelas, a edge function é o **único portão público** (service_role + escopo por tenant). Menor superfície de ataque. RLS anon **dispensada**.
- [x] **1.3** ✅ Edge Function `public-booking/index.ts` (POST JSON `{action,key,...}`): `config`, `specialties`, `locations`, `doctors`, `dates` (próximas datas com vaga, **paginável** p/ o "Ver mais datas"), `slots`, `lock` (reusa `lock_slot`), `book` (cria/associa paciente guest + reusa `book_appointment`). Todas reusam `find_next_available_dates`. `config.toml` com `verify_jwt=false`.
- [x] **1.4** ✅ Validação de `public_key` (key ativa → resolve tenant+config) + `Origin` ∈ `allowed_domains` nas ações de escrita (lock/book); leituras abertas.
- [x] **1.5** ✅ Anti-abuso: migration `20260617_widget_rate_limit.sql` (tabela + `check_widget_rate_limit` + cron de limpeza) e checagem na edge function — rate limit por (tenant, IP, ação): `book` 6/10min, `lock` 20/10min; **Turnstile** no `book` (não bloqueia sem `TURNSTILE_SECRET` — rollout gradual).
- [x] **1.6** ✅ Teste de fumaça em produção: `config`/`specialties`/`doctors`/`dates`/`slots` (HTTP 200 com dados reais), key inválida → 401, origem não autorizada → 403, origem autorizada → lock success. `book` não testado (evitar criar agendamento real).
- [x] **1.7** ✅ **Deploy concluído:** edge function `public-booking` publicada (`--no-verify-jwt` + bloco em `config.toml`) e migrations aplicadas em produção via SQL editor. Turnstile (`TURNSTILE_SECRET`) **a configurar depois**.

> **FASE 1 COMPLETA E EM PRODUÇÃO** ✅ (`fyyhxmugxcfqhvoevuwf`). Endpoint: `https://fyyhxmugxcfqhvoevuwf.supabase.co/functions/v1/public-booking`.

### Fase 2 — Widget Embarcável (frontend, base técnica)
- [x] **2.1/2.2** ✅ `traffio-app/public/widget/v1/widget.js` — Custom Element `<mediflow-booking>` com **Shadow DOM**, vanilla JS (sem build), tema/idioma resolvidos via `config` da API. (Optou-se por arquivo único em vez de Vite lib — zero build, cola em qualquer host.)
- [x] **2.3** ✅ **FAB flutuante** (estilo/posição/label da config) → drawer inline com transição suave + "Voltar" destacado.
- [x] **2.4** ✅ Fluxo completo consumindo a API: especialidade → profissional → data (14 + calendário) → horário → dados → `lock`/`book`. Auto-skip quando há 1 opção.
- [x] **2.5** ✅ Passo "dados" guest: **nome, telefone (máscara por país), email obrigatório**. *(consentimento LGPD a adicionar na UI)*
- [ ] **2.5b** Envio de **confirmação por e-mail** após o booking (G15) — backend pendente.
- [x] **2.7** ✅ Estados: loading, erro, slot tomado (relock), **tela de sucesso** disparando conversão (fbq/gtag/dataLayer + virtual pageview).
- [ ] **2.6/2.8** `loader.js` fino + lazy-load, build versionado + **SRI** + publicar em **CDN pública** (hoje servido por `traffio-app/public/widget/v1/`). *(pendente)*
- [ ] **2C** i18n: estrutura pronta (pt-BR + en); revisar traduções e formatos `Intl` de data/hora por locale.
- [ ] **LGPD:** checkbox de consentimento + link à política no passo de dados.

### Fase 2B — UX & Acessibilidade +50 (Seção 9) — PRIORIDADE ALTA (requisitos #3 e #4)
- [ ] **2B.1** Aplicar design system +50: tipografia ≥18px base, alvos de toque ≥48px, contraste **WCAG AAA**.
- [ ] **2B.1b** Motor de paleta (Seção 9.6): derivar paleta de 1 cor + enforcement AAA por luminância (CSS custom props no Shadow DOM).
- [ ] **2B.2** Formato onboarding: **uma decisão por tela**, progresso visível, linguagem simples.
- [ ] **2B.3** Ícones + ilustrações **SVG** reforçando cada título/opção (especialidade, profissional, data, hora).
- [ ] **2B.4** Cards grandes, selecionáveis com clique em qualquer ponto, com estado "selecionado" óbvio.
- [ ] **2B.5** Campos com rótulos visíveis, alto contraste, máscara de telefone por país e validação amigável (nome, telefone, email).
- [ ] **2B.6** Acessibilidade técnica: navegação por teclado, foco visível, ARIA, leitor de tela, `prefers-reduced-motion`.
- [ ] **2B.7** Teste de usabilidade com usuários reais 50+ (pelo menos 3) antes do go-live.

### Fase 2C — Internacionalização (i18n) por tenant (Seção 10) — requisito #2
- [ ] **2C.1** Adicionar `locale`/`country`/`timezone` ao tenant + retornar na config do widget.
- [ ] **2C.2** Pacotes de tradução `pt-BR`, `en-US`, `en-NZ` (JSON de strings, sem hardcode).
- [ ] **2C.3** Resolução automática do idioma pelo tenant — **sem seletor para o visitante**.
- [ ] **2C.4** Formatação locale-aware via `Intl`: datas, horas, **fuso horário**, moeda, máscara de telefone.
- [ ] **2C.5** Formulário idêntico em todos os países (nome, telefone, email) — só strings e máscara de telefone variam por locale.

### Fase 3 — Rastreamento de Marketing (requisito #1)
- [ ] **3.1** Bridge de eventos: emitir `dataLayer.push` + `fbq`/`gtag` no documento pai (open/step/lead).
- [ ] **3.2** **Tela de sucesso → evento-âncora**: conversão direta (`Schedule`/`conversion`) **+** virtual pageview (`pushState` p/ rota-fantasma) — idempotente. (Seção 2.5.1)
- [ ] **3.3** Eventos sem PII (`tenant`, `specialty`, `doctor_id`).
- [ ] **3.4** Injeção dos IDs de pixel/conversão + rota-fantasma por tenant (vindo da config — Fase 4).
- [ ] **3.5** Validar no Meta Events Manager e Google Tag Assistant (conversão e pageview virtual).

### Fase 4 — Gestão no Painel Super-Admin (Master) — Seção 11
> Nova aba **"Widget"** dentro do detalhe do tenant em `MasterTenants` (`Master → Tenants → [clínica] → Widget`). Toda a config é server-side; o snippet do cliente nunca muda.
- [ ] **4.1** Aba "Widget de Agendamento" no detalhe do tenant (em `MasterTenants.tsx`).
- [ ] **4.2** Gerar/rotacionar `pk_live_` + gerenciar `allowed_domains` (validação de origem).
- [ ] **4.3** Campos para Meta Pixel ID / Google Ads ID / label de conversão + **rota-fantasma de sucesso**.
- [ ] **4.4** Seleção de **idioma/país/fuso** do tenant (define o widget automaticamente).
- [ ] **4.5** Tema (cor primária, texto do botão CTA) + verificação de contraste AAA.
- [ ] **4.6** Gerador de snippet (copiar/colar) + **preview ao vivo** + instruções p/ HTML/WordPress/Hostinger.
- [ ] **4.7** Toggle **ativar/desativar** widget (kill switch) por tenant.

### Fase 5 — Tempo real
- [ ] **5.1** Supabase Realtime: novo booking da landing aparece no painel sem refresh (estender `useRealtimeQueue`).

### Fase 6 — Hardening & Go-live
- [ ] **6.1** Testes E2E do snippet em landing HTML pura + WordPress de teste (Hostinger).
- [ ] **6.2** Load test no endpoint público (k6) — concorrência de slots.
- [ ] **6.3** Auditoria de segurança (RLS, vazamento de PII, CORS, rate limit).
- [ ] **6.4** Auditoria de acessibilidade (axe / Lighthouse a11y ≥95).
- [ ] **6.5** Monitoramento/observabilidade (logs por tenant, métricas de conversão do funil).
- [ ] **6.6** Documentação de onboarding p/ clínicas + rollout piloto (Clínica A).

---

## 7. Resposta direta às perguntas do prompt

> **"É possível instalar de forma automática só inserindo um snippet/script direto no repositório/arquivo da landing?"**
✅ **Sim.** Um único `<script src=".../loader.js">` + a tag `<mediflow-booking data-tenant data-key>`. Idêntico para todos os clientes (template), parametrizado por tenant. Não exige backend na landing nem o MySQL da Hostinger.

> **"Qual a maneira mais eficiente e moderna?"**
**Web Component + loader script via CDN**, consumindo uma **API pública da plataforma** com publishable key por tenant. A plataforma é a **fonte única da verdade** — isso entrega o efeito "bi-direcional em tempo real" sem sincronizar dois bancos.

> **"Cada tenant com sua ferramenta, mas padronizada (template)?"**
✅ Mesmo bundle/arquitetura para todos; `data-tenant` + `data-key` isolam dados e branding. Um código, N clínicas.

> **"Iframe permite tags de rastreamento Meta/Google? (req #2)"**
⚠️ No iframe, **não de forma confiável** (cross-origin isola os eventos). Por isso escolhemos o **Web Component inline**, onde o pixel da landing captura as conversões nativamente. Ver Seção 2.5.

> **"Nunca abrir janela externa; tudo na landing, formato onboarding (req #3)"**
✅ Abertura via **drawer/off-canvas inline** no DOM da landing. Sem nova aba, sem iframe, sem popup de browser. Ver Seção 9.

> **"Fazer o público +50 mudar de ideia sobre agendar online (req #4)"**
✅ Princípio de design "uma decisão por tela", alto contraste WCAG AAA, fontes grandes, alvos ≥48px, ícones/ilustrações SVG guiando cada passo. Detalhado na Seção 9.

> **"Preciso de uma ação capturável pelo pixel, tipo página de sucesso/obrigado"**
✅ A **tela de sucesso** dispara, no mesmo instante, a conversão direta (`fbq Schedule` / `gtag conversion`) **e** um **virtual pageview** numa rota-fantasma (ex.: `/agendamento-confirmado`) — cobrindo conversões configuradas por evento **ou** por URL de obrigado. Idempotente. Ver Seção 2.5.1.

> **"Idioma BR/US/NZ sem botão de tradução no frontend"**
✅ O idioma é **propriedade do tenant** (a clínica está em um país só), resolvido automaticamente — **zero seletor para o visitante**. E é localização completa: textos + datas/horas + **fuso horário** + máscara de telefone + campo de documento condicional (CPF só no Brasil). Ver Seção 10.

> **"Como o widget é injetado em cada landing?"**
✅ Dois itens colados no HTML (1 `<script>` + 1 `<tag>`). Sem build/npm. Funciona igual em HTML, PHP, WordPress, Node. Ver Seção 11.1.

> **"Como o widget sabe a qual tenant se conectar?"**
✅ Pela **publishable key** (`pk_live_...`) — a key É o identificador (como no Stripe). A API resolve tenant + config a partir dela e valida o domínio de origem. Ver Seção 11.2.

> **"Dá para gerar e gerir cada widget pelo painel super-admin?"**
✅ Sim. `Master → Tenants → [clínica] → Widget`: gera/rotaciona a key, define domínios, idioma, pixel, tema, e copia o snippet. Como a config é server-side, alterações refletem **ao vivo sem o cliente editar a landing**. Ver Seção 11.3.

> **"O agendamento é conversão secundária; quero um botão flutuante moderno (a primária é telefone)"**
✅ O widget é um **FAB flutuante** inferior-direito, sofisticado/responsivo, com ícone+rótulo e estilo **subordinado** ao CTA de telefone — descobrível sem competir. Ver Seção 9.3.

> **"Como será definida a paleta de cores? No super-admin?"**
✅ Sim. O super-admin define **1 cor primária** (a da marca); o widget **deriva a paleta inteira e força contraste WCAG AAA** automaticamente (texto preto/branco por luminância). Zero risco de combinação ilegível para o +50. Ver Seções 9.6 e 11.3.

---

## 8. Fontes (benchmark de mercado)
- Cal.com — Embed: https://cal.com/embed
- Cal.com — Embedding a scheduling system: https://cal.com/blog/embedding-a-scheduling-system-on-your-website-a-simple-how-to
- Como embarcar booking widget (Calendly/Cal.com): https://www.usecarly.com/blog/how-to-embed-booking-widget/
- Booknetic — Embeddable iFrame Booking Widget: https://www.booknetic.com/feature/embeddable-iframe-booking-widget
- Best Scheduling & Booking Widgets 2026 (Embeddable): https://embeddable.co/blog/best-scheduling-and-booking-widgets-for-websites
- Medical Scheduling Build vs Buy (Nopio): https://www.nopio.com/blog/medical-appointment-scheduling/

---

## 9. UX & Acessibilidade — Design para o público +50 (requisitos #3 e #4)

> **Missão:** fazer quem tem 50+ — e acha agendamento online "complicado" — concluir o agendamento **sozinho, sem medo e sem ajuda**. O sucesso é medido por taxa de conclusão, não por beleza.

### 9.1. As 5 dores do +50 (do prompt) → resposta de design
| Dor relatada | Resposta no widget |
|---|---|
| "Não enxergam todo o conteúdo" | Tipografia grande (base ≥18px, títulos ≥24px), zoom até 200% sem quebrar, sem texto cinza-claro |
| "Muita informação espalhada" | **Uma decisão por tela** (formato onboarding/wizard), nada de scroll longo |
| "Informações não são claras" | Linguagem simples e direta; cada passo com 1 pergunta clara + ícone SVG que reforça o significado |
| "Nunca sabem onde clicar" | Cards/botões grandes (alvo ≥48–56px), área clicável inteira, 1 ação primária por tela óbvia |
| "Campos sem contraste, não sabem preencher" | Rótulos sempre visíveis, bordas fortes, foco de alto contraste, máscaras automáticas, validação amigável |

### 9.2. Princípios de design (não-negociáveis)
1. **Um passo, uma decisão.** Onboarding em telas sequenciais com barra de progresso ("Passo 2 de 5") e botão "Voltar" sempre visível.
2. **Alto contraste WCAG AAA** (≥7:1 em texto). Nada de placeholder como rótulo. Estado "selecionado" com cor sólida + ✓, não só borda fina.
3. **Tipografia generosa:** base 18–20px, títulos 24–28px, espaçamento de linha 1.5+.
4. **Alvos grandes:** botões e cards com altura mínima 48px (ideal 56px), espaçados (evita toque errado).
5. **Ícones e ilustrações SVG** em cada título/opção — especialidade 🩺, profissional 👤, calendário 📅, relógio 🕐 — reforçando reconhecimento visual (memória icônica > leitura).
6. **Feedback imediato e tranquilizador:** loading claro, mensagens de erro em linguagem humana ("Esse horário acabou de ser reservado, escolha outro 👇"), tela de sucesso celebrando a conclusão.
7. **Zero jargão.** "Especialidade" pode virar "O que você precisa?"; "Profissional" → "Com quem?"; "Confirmar" → "Confirmar meu agendamento".
8. **Movimento sutil** e respeitando `prefers-reduced-motion` (evita desorientação).

### 9.3. Formato de interação — FAB flutuante (requisitos #3 e conversão secundária)
> **Hierarquia de conversão:** a conversão **primária** da landing é o **botão de telefone centralizado**. O agendamento é **secundário** → vive num **botão flutuante (FAB)** que não compete com o telefone, mas continua descobrível.

- **Gatilho = FAB flutuante** no canto **inferior-direito** (`position: fixed`), sofisticado e responsivo:
  - **Ícone SVG + rótulo de texto** ("📅 Agendar") — para o +50, ícone puro gera dúvida; o texto remove o "não sei o que é isso".
  - Tamanho generoso (altura ≥56px, ideal 64px), sombra suave, cantos arredondados, área de toque grande.
  - **Estilo subordinado** ao CTA de telefone por padrão (tom secundário/soft), configurável no painel — nunca ofusca a conversão primária.
  - **Atenção sutil** opcional (leve pulso/entrada após X segundos), sempre respeitando `prefers-reduced-motion`.
  - **Respeita safe-area** no mobile (notch/barra inferior) e **não colide** com outros botões fixos (offset configurável).
- **Ao clicar:** abre o **drawer/off-canvas** deslizando da direita (desktop) / bottom-sheet em tela cheia (mobile), com overlay escuro suave. Tudo inline, sem sair da página, sem nova aba.
- **Dentro do drawer:** wizard onboarding (uma decisão por tela), botão de avançar fixo na base (polegar alcança no celular).
- **Saída segura:** "X" grande + confirmação se houver dados preenchidos ("Deseja sair? Você perderá o agendamento").
- **Posição da tag:** como o FAB é `fixed`, `<mediflow-booking>` pode ficar em qualquer ponto do HTML (ex.: antes de `</body>`) — sem ponto de montagem específico.

#### 9.3.1. Seleção de data para o +50 (dois níveis)
- **Nível 1 — sugestões rápidas:** **pelo menos 14** cartões grandes das próximas datas com vaga ("Hoje", "Amanhã", "Qua · 18 de junho") — uma decisão por toque, sem digitação. Vem da ação `dates` (RPC `find_next_available_dates`, default 14).
- **Nível 2 — calendário de disponibilidade:** botão **"📅 Ver mais datas no calendário"** abre um **calendário grande e acessível** para escolher mês/dia com precisão:
  - células grandes (≥50px), navegação de mês com setas grandes rotuladas;
  - **apenas dias com vaga são clicáveis**; dias sem vaga ficam desabilitados (nunca clica num dia vazio);
  - legenda clara ("Disponível" / "Sem vaga"); não permite navegar para meses passados;
  - link "‹ Voltar às datas sugeridas" para retornar ao Nível 1.
- **Empty-state (sem vaga nenhuma):** mensagem acolhedora + reforço da **conversão primária** ("Não encontramos vagas online — fale conosco: 📞 (telefone)") ou trocar profissional/unidade.

#### 9.3.2. Comportamento de avanço entre etapas (decidido)
- **Escolha única (especialidade/data/horário/profissional):** **auto-avança** ~420ms após o toque, com o ✓ visível primeiro — menos toques sem o efeito "o que aconteceu?". Sem botão "Continuar" redundante nessas telas.
- **Dados pessoais e confirmação final:** **nunca** auto-avançam — botão explícito ("Confirmar meu agendamento").
- **Salvaguardas:** "Voltar" sempre grande e visível; o atraso de ~420ms evita toque acidental; respeitar `prefers-reduced-motion`.
- **Navegação ≠ seleção:** abrir calendário / "Ver mais" / trocar mês não avança; só a seleção de um item avança.
- *(Validado em protótipo com interruptor on/off para o público +50.)*

### 9.4. Design system do widget (a aprovar — task 0.5)
- **Cores:** ver Seção 9.6 (estratégia de paleta).
- **Tipografia:** fonte sem serifa legível (Inter/Source Sans), pesos 500–700 para títulos.
- **Componentes:** `Fab` (botão flutuante), `StepCard`, `OptionCard` (grande, ícone SVG + label + descrição), `BigButton`, `Field` (rótulo + input + ajuda + erro), `ProgressBar`, `Drawer`.
- **Biblioteca de ícones:** SVG inline (sem dependência externa), com `aria-hidden` + texto real ao lado.

### 9.5. Métricas de sucesso (definir baseline no piloto)
- Taxa de conclusão do funil (abrir → agendar) — **alvo principal**.
- Taxa de abandono por passo (onde o +50 trava).
- Tempo médio de conclusão.
- Lighthouse Accessibility ≥ 95; axe sem violações críticas.

### 9.6. Paleta de cores — definida no Super-Admin (1 cor → paleta inteira)
> **Regra:** o super-admin informa **apenas a cor primária** da clínica; o widget **gera o resto** e **garante contraste WCAG AAA** sozinho. Pedir várias cores ao admin = risco de combinação ilegível para o +50.

**Como funciona:**
1. **Entrada (painel):** 1 campo `primary_color` (hex da marca da clínica) — ver Seção 11.3.
2. **Derivação automática** (no widget, a partir da primária):
   - tons de hover/active (clarear/escurecer);
   - cor de **texto sobre a primária** escolhida por **luminância** (preto ou branco) p/ garantir legibilidade;
   - estado "selecionado" sólido + ✓; bordas e foco de alto contraste.
3. **Enforcement AAA:** se a primária não atingir contraste suficiente com o fundo/texto, o sistema **ajusta o tom** automaticamente (escurece/clareia) e usa a cor original só em acentos — **nunca** quebra a legibilidade.
4. **Base fixa de alto contraste:** fundo do drawer claro, texto quase-preto (≥7:1), independentemente da cor da marca. A primária entra em botões, ícones e destaques — não no corpo de texto.
5. **FAB:** por padrão usa um **tom secundário/soft** derivado da primária (para não competir com o CTA de telefone); o painel permite escolher estilo do FAB (`solid` / `soft` / `outline`).
6. **Fallback:** sem cor definida → paleta neutra premium padrão (azul-petróleo/verde clínico) já acessível.

> Implementação via **CSS custom properties** dentro do Shadow DOM (`--mf-primary`, `--mf-on-primary`, `--mf-surface`…), recalculadas em runtime a partir da cor recebida na config.

---

## 10. Internacionalização (i18n) — BR / US / NZ (requisito #2)

> **Princípio:** o idioma é decidido **pela clínica (tenant)**, nunca pelo visitante. **Sem botão/seletor de tradução no frontend** — qualquer elemento extra aumenta o atrito que faz o +50 desistir.

### 10.1. Como o idioma é definido (cascata)
1. **Fonte primária:** campo `locale` do tenant (config no painel). Clínica BR → `pt-BR`; US → `en-US`; NZ → `en-NZ`.
2. **Entrega:** a config do widget já vem com o `locale` resolvido server-side; o `loader.js` também aceita `data-lang` (gerado automaticamente no snippet) como override explícito.
3. **Fallback:** se nada definido, `pt-BR` (default). **Nunca** depende de `navigator.language` como fonte primária (evita um visitante US ver a tela em português, ou vice-versa — a clínica define).

### 10.2. Localização é mais que texto (a armadilha)
| Aspecto | BR (`pt-BR`) | US (`en-US`) | NZ (`en-NZ`) |
|---|---|---|---|
| Strings de UI | Português | Inglês | Inglês |
| Campos do form | nome, telefone, email (idêntico em todos) | idem | idem |
| Máscara de telefone | `+55 (11) 99999-9999` | `+1 (555) 555-5555` | `+64 21 123 4567` |
| Formato de data | `17/06/2026` | `06/17/2026` | `17/06/2026` |
| Hora | 24h | 12h (AM/PM) | 12h/24h |
| Fuso horário | `America/Sao_Paulo` | tz do tenant | `Pacific/Auckland` |
| Moeda (se exibir preço) | BRL `R$` | USD `$` | NZD `$` |

- **Strings:** pacotes JSON (`pt-BR.json`, `en-US.json`, `en-NZ.json`) — nada de texto hardcoded no componente.
- **Formatos:** `Intl.DateTimeFormat` / `Intl.NumberFormat` com o `locale` + `timeZone` do tenant (evita erro de fuso, crítico em agendamento).
- **Formulário enxuto e uniforme:** nome, telefone e email em todos os países (finalidade comercial/lead). Sem documento fiscal — menos atrito para o +50 e i18n mais simples.

### 10.3. Impacto no fuso horário (crítico)
Slots e confirmações devem ser exibidos no **fuso da clínica**, não do navegador do visitante. O backend já trabalha com horários; o widget apenas **formata** com o `timeZone` do tenant via `Intl`. Isso evita o paciente ver "14:00" no fuso errado.

---

## 11. Instalação, Identificação do Tenant e Gestão no Super-Admin

### 11.1. Como o widget é injetado em cada landing (Q1)
O cliente cola **2 linhas** no HTML da landing — onde quiser que o botão de agendar apareça:

```html
<script src="https://cdn.mediflow-traffio.com/widget/v1/loader.js" async></script>
<mediflow-booking data-key="pk_live_xxxxxxxx"></mediflow-booking>
```

- **Onde colar por hospedagem:**
  - **HTML/PHP puro (Hostinger):** dentro do `.html`/`.php`, no ponto do botão (ou antes de `</body>`).
  - **WordPress:** bloco **"HTML personalizado"** ou no footer do tema.
  - **Node/Next/React:** no JSX/template como tag normal (o custom element é nativo do browser).
- **Mecânica do `loader.js`** (leve, ~2–3 kB):
  1. registra `customElements.define('mediflow-booking', …)`;
  2. **lazy-load** do bundle pesado só na 1ª interação (clique no CTA) ou quando o elemento entra na viewport → não pesa no LCP da landing;
  3. renderiza o **botão CTA**; ao clicar, abre o **drawer/off-canvas** inline (requisito #3).
- **Versionamento:** `/widget/v1/` fixo → atualizações sem quebrar landings; breaking changes vão para `/v2/`.

### 11.2. Como o widget identifica o tenant (Q2)
**A publishable key (`pk_live_...`) é o único identificador — ela É o tenant.** Fluxo:

```
loader lê data-key=pk_live_xxx
        │
        ▼
GET /widget-config  (Authorization: pk_live_xxx)
        │  API → SELECT * FROM tenant_public_keys WHERE public_key = pk AND is_active
        ▼
resolve: tenant_id + locale + country + timezone + theme + pixel_ids + success_path + allowed_domains
        │  valida: Origin/Referer ∈ allowed_domains  (key roubada não funciona em outro site)
        ▼
widget recebe a config pronta e se renderiza no idioma/tema certos
```

- **Por que a key e não o slug:** o slug é adivinhável; a key é um segredo público rotacionável + travada por domínio. Mesmo padrão do **Stripe publishable key**.
- **Segurança:** key só dá acesso de **leitura pública** (recursos ativos) + criar booking; nunca expõe dados de pacientes (RLS). Origem validada no POST.
- **`data-tenant` (slug)** continua aceito como apelido legível, mas **não é** a credencial.

### 11.3. Gestão completa no painel Super-Admin (Q3) — SIM
Local: **`Master → Tenants → [clínica] → aba "Widget"`** (estende `MasterTenants.tsx`; o painel já tem a navegação de tenants). Por tenant, o super-admin controla:

| Configuração | O que faz |
|---|---|
| **Publishable key** | Gerar / rotacionar / revogar `pk_live_` |
| **Domínios permitidos** | Lista de domínios onde a key funciona (anti-roubo) |
| **Idioma / País / Fuso** | Define `locale`/`country`/`timezone` → idioma e formatos automáticos (Seção 10) |
| **Tema / Paleta** | **1 cor primária** (a marca da clínica) → widget deriva a paleta e força AAA (Seção 9.6) |
| **FAB (botão flutuante)** | Texto do botão ("Agendar"), estilo (`solid`/`soft`/`outline`), posição/offset, atraso de aparição |
| **Rastreamento** | Meta Pixel ID, Google Ads ID, label de conversão, rota-fantasma de sucesso |
| **Status** | Ativar/desativar o widget (kill switch instantâneo) |
| **Snippet** | Campo "copiar" + **preview ao vivo** + instruções por hospedagem |

- **Vantagem central:** como **tudo é resolvido server-side pela key**, qualquer mudança aqui **reflete ao vivo em todas as landings** sem o cliente reeditar o snippet. Trocar o idioma, a cor ou o pixel é um clique no painel.
- **Provisionamento automático:** ao criar um tenant (fluxo `TenantService`), já gerar a `pk_live_` e o snippet — o widget nasce pronto junto com a clínica.
- **Evolução opcional:** a mesma tela pode ser exposta no painel do próprio tenant (self-service) no futuro; por ora, centralizado no super-admin (clínicas +50 não precisam mexer em nada técnico).
