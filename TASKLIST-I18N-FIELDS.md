# TASKLIST — Internacionalização de Campos (Field-Level i18n / Formatação)

> **Pilar 1 de 2.** Ver também: [TASKLIST-I18N-LANGUAGE.md](TASKLIST-I18N-LANGUAGE.md) (Pilar 2 — tradução de idioma da UI).
> Este pilar cuida da **formatação de dados** (telefone/CEP/CPF/endereço/data/hora); o Pilar 2 cuida do **idioma** do texto.

> **Objetivo:** permitir que clínicas operando em 🇧🇷 BR, 🇺🇸 US, 🇳🇿 NZ e 🇲🇽 MX
> "internacionalizem" campos de **identificação/contato** (Telefone, CEP/ZIP, CPF/Doc,
> Endereço) **e de data/hora/slots** (ex.: BR `18/06/2026 08:00` ↔ US `06/18/2026 8:00 AM`).
> Ao escolher o país, os campos adaptam **máscara, validação, rótulo, autocomplete e
> formato de data/hora** àquele país. **Não é tradução de idioma** — é formatação de dados.
>
> **Decisões aprovadas (2026-06-18):**
> 1. **Telefone:** `libphonenumber-js` (E.164 storage, validação/máscara reais por país).
> 2. **Documento do paciente:** colunas genéricas `national_id` + `national_id_type` + `country`, mantendo `cpf` para retrocompat BR.
> 3. **Escopo:** clínica/unidade define o **país padrão** (já existe `tenants.country`); cada campo tem **override por bandeira**.
>
> **Princípio de armazenamento:**
> - **Telefone → sempre E.164** (`+5541997759569`). O país está embutido no número. Máscara é só display/input.
> - **CEP/Doc/Endereço → valor + `country` do registro** (o país define como re-formatar e validar).
> - **Data/Hora → sempre UTC/ISO no banco (não muda)**. O que muda é só o **formato de exibição**,
>   dirigido por `locale` (já existe `tenants.locale`) + `timezone` (já existe `tenants.timezone`).
>   **Timezone (quando) já está resolvido**; falta o **formato (como mostrar)** — hoje hardcoded BR.

---

## 📐 Diagnóstico (estado atual)

| Item | Arquivo | Situação |
|------|---------|----------|
| Formatador de telefone (display) | `src/lib/formatPhone.ts` | ✅ Existe (detecta país pelo prefixo) — **não usado em inputs**, só leitura |
| Validadores BR | `src/lib/validators/brazilianDocs.ts` | ⚠️ `validateCPF/CNPJ`, `formatCPF/CNPJ/Zip` — **hardcoded BR** |
| Serviço de endereço | `src/services/addressService.ts` | ⚠️ Photon (global) + BrasilAPI (CEP BR) — **sem ZIP US/NZ/MX**, enviesado p/ BR |
| Autocomplete de endereço | `src/components/SmartAddressInput.tsx` | ⚠️ `osm_tag=place` fixo, regex de CEP BR (`\d{5}-?\d{3}`) |
| Form de endereço da clínica | `src/components/TenantAddressForm.tsx` | ⚠️ Rótulos BR ("CEP", "Bairro"), sem seletor de país |
| Página Clínicas | `src/pages/Settings.tsx` | ⚠️ Edita tenant + `locations` — **sem seletor de país no UI** |
| Modal de paciente | `src/components/NewPatientModal.tsx` | ⚠️ Inputs puros, placeholders BR fixos, **sem máscara/validação** |
| Coluna de país (tenant) | `supabase/migrations/20260617_widget_public_booking.sql` | ✅ `tenants.country`/`locale`/`timezone` **já existem** (default BR) |
| Coluna de país (location/patient) | DB | ❌ **Não existe** em `locations` nem `patients` |
| Documento genérico | `patients` | ❌ Só `cpf` (BR). Sem `national_id`/`national_id_type` |
| Tipagem no front | `src/contexts/TenantContext.tsx` | ⚠️ Carrega `select('*')` (country/locale já chegam) mas **interface `Tenant` não tipa** |
| **Infra de timezone** | `src/lib/timezoneUtils.ts` | ✅ Robusta (multi-IANA, `getLocalHour`, `localDateTimeToUTC`) — **quando** já resolvido |
| **Formato de data (display)** | `src/lib/dateUtils.ts` | ⚠️ `formatDisplayDate` **hardcoded `DD/MM/YYYY`** |
| **Formato data/hora (locale)** | `src/lib/timezoneUtils.ts` | ⚠️ `formatInTimezone` **força locale `'pt-BR'`** |
| **Formatação espalhada** | ~52 arquivos / ~119 chamadas | ⚠️ `date-fns format('dd/MM/yyyy'/'HH:mm', {locale: ptBR})` + `toLocale*('pt-BR')` ad-hoc |
| **Slots de horário** | `src/components/SidebarBookingView.tsx` (+ booking views) | ⚠️ `HH:00` **24h fixo**, sem AM/PM |
| **Locale por tenant** | DB | ✅ `tenants.locale` **já existe** (`pt-BR`/`en-US`/`en-NZ`) — pode dirigir o formato |

**Conclusão:** a base existe (país no tenant, formatador de telefone, stack de endereço grátis),
mas está **espalhada, hardcoded em BR e não conectada aos inputs**. O trabalho é
**centralizar num registry declarativo por país** e **plugar componentes reutilizáveis** nos formulários.

---

## 🏗️ Arquitetura proposta (inspiração: Stripe, Twilio, Shopify, Google libphonenumber)

```
                  ┌─────────────────────────────────────────┐
                  │   src/lib/i18n/countryFormats.ts (NOVO)  │  ← fonte única de verdade
                  │   BR · US · NZ · MX (extensível)          │
                  │   { dialCode, flag, phone, postal, doc,   │
                  │     addressFields, lookupProvider,        │
                  │     locale, dateFormat, timeFormat,       │
                  │     hour12 }                              │
                  └───────────────┬─────────────────────────┘
                                  │ consumido por
   ┌──────────────┬───────────────┼────────────┬──────────────┬───────────────┐
   ▼              ▼               ▼            ▼              ▼               ▼
IntlPhoneInput IntlPostalInput IntlDocInput SmartAddress  formatPhone/Doc   formatDateTime (NOVO)
(flag+E.164)   (label+mask+    (CPF/RFC/..) Input         /Zip (display)    formatDate/Time/Slot
 libphonenumber lookup)                     (country-aware)                  (Intl + locale+timezone)
```

- **Stripe:** um campo `country` reordena/relabela o form de endereço (postal_code vs ZIP). ✅ adotado.
- **Twilio / Google libphonenumber:** input de telefone com bandeira + E.164. ✅ adotado.
- **Shopify:** conjunto de campos de endereço por país via JSON. ✅ adotado (`addressFields`).
- **Free-stack atual:** Photon (autocomplete global) + BrasilAPI (CEP) + **Zippopotam.us** (ZIP US/NZ/MX, grátis, sem key) como fallback. ✅ adotado.
- **Data/Hora — `Intl.DateTimeFormat` (nativo, zero dependência):** o registry mapeia país → `locale` + `timezone`,
  e um único módulo `formatDateTime` substitui as formatações ad-hoc (`date-fns`/`toLocale*`). O banco permanece em UTC/ISO.

> **Nota de design (data/hora):** o formato numérico (ordem da data, 24h vs AM/PM) é dirigido pelo `locale` do país.
> Nomes longos de mês (ex.: "18 de junho" / "June 18") **seguem o idioma da UI** definido no Pilar 2
> ([TASKLIST-I18N-LANGUAGE.md](TASKLIST-I18N-LANGUAGE.md)) — pois a Traffio terá tradução total.

---

## FASE 0 — Banco de Dados (migração idempotente)

- [x] **0.1** Rodar **Script de Verificação** no SQL Editor (ver abaixo) para confirmar colunas reais — confirmado: `locations`/`patients` sem `country` antes da migração
- [x] **0.2** Rodar **Script de Migração** (adiciona `country` em `locations`/`patients` + doc genérico) — executado com sucesso (2026-06-18)
- [x] **0.3** Confirmar backfill (`cpf` → `national_id`/`national_id_type='cpf'` nos pacientes BR) — incluso no script de migração
- [x] **0.4** Conferir que `tenants.country/locale/timezone` continuam intactos — confirmado (`BR`/`pt-BR`/`America/Sao_Paulo` default)

> ⚠️ Memória do projeto: o schema real diverge dos `.sql` do repo e `patients.metadata` **não existe**.
> Por isso toda a migração usa `add column if not exists` (segura para rodar mais de uma vez).

## FASE 1 — Registry de formatos por país (fundação, sem UI)

- [x] **1.1** Criar `src/lib/i18n/countryFormats.ts`
  - [x] `COUNTRIES`: `BR | US | NZ | MX` com `{ code, name, flag, dialCode, phone, postal, doc, addressFields, locale, dateFormat, timeFormat, hour12 }`
  - [x] `getCountry(code)`, `listCountries()`, `getLocaleForCountry(code)`
- [x] **1.2** Instalar dependência: `npm i libphonenumber-js`
- [x] **1.3** Helpers de telefone (wrappers de `libphonenumber-js`): `toE164(input, country)`, `formatNational(e164)`, `isValidPhone(input, country)`, `phoneCountry(e164)`
- [x] **1.4** Helpers de postal: `formatPostal(value, country)`, `validatePostal(value, country)`
- [x] **1.5** Helpers de documento: `formatDoc(value, country)`, `validateDoc(value, country)` — BR usa `validateCPF` existente
- [x] **1.6** Refatorar `src/lib/formatPhone.ts` para delegar ao registry (manter assinatura pública p/ não quebrar imports) + `phoneFlag()` via registry
- [x] **1.7** Manter `brazilianDocs.ts` e referenciá-lo na entrada BR do registry (sem duplicar lógica)

## FASE 2 — Serviço de endereço country-aware

- [x] **2.1** `addressService.lookupPostal(value, country)` — roteia por país:
  - [x] `BR` → BrasilAPI (já existe `lookupCep`)
  - [x] `US | NZ | MX | *` → **Zippopotam.us** (`https://api.zippopotam.us/{cc}/{zip}`, grátis, sem key) via novo `lookupZip()`
  - [x] Fallback final: Photon (texto livre) — já cobre via `autocomplete()` em paralelo no `SmartAddressInput`
- [x] **2.2** `addressService.autocomplete()` — aceita `country` (bbox bias por país, já que Photon não tem filtro ISO nativo)
- [x] **2.3** Normalizar `AddressSuggestion` para sempre conter `countryCode` (ISO) — usa `properties.countrycode` do Photon, hardcoded nos demais providers

## FASE 3 — Componentes reutilizáveis (UI)

- [x] **3.1** `src/components/intl/CountryFieldSelector.tsx` — dropdown de bandeira (override por campo)
- [x] **3.2** `src/components/intl/IntlPhoneInput.tsx` — bandeira + dial code + máscara nacional; **emite E.164**; estado de validação inline
- [x] **3.3** `src/components/intl/IntlPostalInput.tsx` — rótulo dinâmico (CEP/ZIP/Postcode/CP) + máscara + lookup no blur (chama `lookupPostal`)
- [x] **3.4** `src/components/intl/IntlDocInput.tsx` — rótulo+máscara+validador por país (CPF/RFC/SSN/IRD…)
- [x] **3.5** Tornar `SmartAddressInput` country-aware (prop `country`, repassa ao service; rótulos/placeholder do registry)

## FASE 4 — Página Settings › Clínicas

- [x] **4.1** Tipar `country/locale` na interface `Tenant` (`TenantContext.tsx`) e em `ClinicLocation` (`locationService.ts`)
- [x] **4.2** Adicionar **seletor de País** da clínica (tenant) — grava `tenants.country` (+ `locale`/`timezone` sugeridos)
- [x] **4.3** Adicionar **seletor de País** por unidade (`locations.country`), default = país do tenant
- [x] **4.4** Refatorar `TenantAddressForm.tsx` para usar `IntlPostalInput` + `IntlPhoneInput` + `SmartAddressInput(country)` com override por campo
- [x] **4.5** Garantir persistência via `handleSaveTenant` / `locationService.update`

> **Notas de implementação (4.1-4.5):**
> - `Tenant.country?: CountryCode` + `Tenant.locale?: string` tipados em `TenantContext.tsx`; `ClinicLocation.country?: CountryCode` tipado em `locationService.ts`.
> - `Settings.tsx` › aba Clínicas: nova seção "País da Clínica" (select com bandeira+nome via `listCountries()`) ao lado do Fuso Horário — grava `{ country, locale }` via `handleSaveTenant` e propaga para `TenantContext` quando é o tenant ativo.
> - Form de criação/edição de unidade (`locForm`): novo select "País" (default = país do tenant) persistido em `locations.country`.
> - `TenantAddressForm.tsx` reescrito: CEP/ZIP cru → `IntlPostalInput` (lookup automático no blur via `addressService.lookupPostal`); Telefone cru → `IntlPhoneInput` (emite E.164); `SmartAddressInput` agora recebe `country`. Cada campo mantém override individual (bandeira) independente do país padrão da clínica/unidade.
> - Corrigido bug pré-existente em `TenantAddressForm.tsx`: importava um tipo `Location` inexistente (`locationService.ts` só exporta `ClinicLocation`) e usava `NodeJS.Timeout` sem os tipos do Node — ambos quebravam `tsc --noEmit`. Trocado para `ClinicLocation` e `ReturnType<typeof setTimeout>`.
> - Validado: `tsc --noEmit`, `eslint` (zero erros novos vs. baseline) e `npm run build` — todos verdes.

## FASE 5 — Propagar para Pacientes e Usuários

- [x] **5.1** `NewPatientModal.tsx` → `IntlPhoneInput` + `IntlDocInput`, país default = país da clínica ativa
- [x] **5.2** `SidebarRegisterView.tsx` / `SidebarPatientEditView.tsx` → idem
- [x] **5.3** `pages/portal/PortalRegister.tsx` (idem, default = país do tenant do widget) / `PreCheckin.tsx` (display formatado, ver notas)
- [x] **5.4** `components/settings/TeamManagement.tsx` → N/A, ver notas
- [x] **5.5** Salvar `patients.country`, `national_id`, `national_id_type` (e `cpf` quando BR p/ retrocompat)

> **Notas de implementação (5.1-5.5):**
> - `NewPatientModal.tsx`, `SidebarRegisterView.tsx`, `SidebarPatientEditView.tsx`: campo CPF cru → `IntlDocInput`; campo Telefone/Celular cru → `IntlPhoneInput`. `formData` trocou `cpf: ''` por `national_id: '', country: CountryCode`. Nenhum desses forms coleta endereço, então `IntlPostalInput` não se aplica aqui (já cobertos em `TenantAddressForm.tsx` na Fase 4).
> - Padrão de persistência (retrocompat) replicado em todos os 4 write-paths de paciente (`NewPatientModal` insert+update, `SidebarRegisterView` insert, `SidebarPatientEditView` update): `cpf` só grava quando `country === 'BR'` (legado); `national_id`/`national_id_type`/`country` gravam sempre, genéricos.
> - Padrão de leitura de registros legados (sem `country`): `national_id: initialData.national_id || initialData.cpf || ''`, `country: initialData.country || (initialData.cpf ? 'BR' : tenant?.country || DEFAULT_COUNTRY)` — usado em todo formulário de edição.
> - `PortalRegister.tsx` (cadastro público do paciente no portal): `IntlPhoneInput`/`IntlDocInput` com país default = `tenant.country`. Dados gravados em `auth.users.user_metadata` no `signUp` (`cpf`, `national_id`, `national_id_type`, `country`) — a criação do registro em `patients` depende do trigger `handle_new_user` do banco (fora do alcance do código-fonte da app; ver alerta abaixo).
> - **Gap real encontrado e corrigido**: `PortalLogin.tsx` → `handleJoinClinic` (quando um usuário autenticado já existente se vincula a uma nova clínica) inseria em `patients` apenas `full_name`/`email`/`phone`, sem `cpf`/`national_id`/`national_id_type`/`country` — esses campos já estavam disponíveis em `user_metadata` (gravados pelo `PortalRegister.tsx`) mas eram descartados. Corrigido para incluir os 4 campos no insert.
> - `PreCheckin.tsx` (página pública pós-agendamento, exibição **somente leitura** — não tem `<input>` para CPF/telefone): não dá para "propagar `Intl*Input`" literalmente. Aplicado o tratamento correto para essa página, que é de **display**: label "CPF" → dinâmico via `docLabel(patient.country || 'BR')`; telefone exibido via `formatNational(...)` (detecta o país a partir do E.164 armazenado). `types/patient.ts` ganhou os campos `national_id?`, `national_id_type?`, `country?` (estavam faltando no tipo `Patient`).
> - `TeamManagement.tsx` (5.4): auditado — **não existe campo de telefone para membros da equipe** nesse arquivo nem no `memberService`/tipo `Member` (convite de equipe é só por e-mail). Item é N/A, nada a propagar.
> - Auditoria de 5.5: `grep` por todos os `.from('patients')` insert/update no app confirma que os 5 write-paths reais (`NewPatientModal` ×2, `SidebarRegisterView`, `SidebarPatientEditView`, `PortalLogin.handleJoinClinic`) agora gravam `national_id`/`national_id_type`/`country` consistentemente. `PortalRegister.tsx` grava via metadata (dependente do trigger do banco).
> - ✅ **Achado confirmado e corrigido (banco de produção)**: a função real `handle_new_user` (divergente do `DEPLOY_SCHEMA.sql` do repo, como já era esperado) fazia o insert em `public.patients` usando só `tenant_id, user_id, full_name, email, phone, cpf` — `national_id`/`national_id_type`/`country` (presentes em `auth.users.raw_user_meta_data`, gravados pelo `signUp` de `PortalRegister.tsx`) eram descartados nesse insert, deixando pacientes US/NZ/MX (e BR via fluxo novo) com `country` no default `'BR'` e documento vazio mesmo após preenchimento correto no formulário. Confirmado via `pg_get_functiondef` no SQL Editor e corrigido com `CREATE OR REPLACE FUNCTION` adicionando as 3 colunas ao `INSERT` (mantendo o `ON CONFLICT ... DO UPDATE SET user_id = EXCLUDED.user_id` inalterado, mesmo comportamento conservador que já existia para `cpf`). Script executado pelo usuário no Supabase SQL Editor — função já reflete a correção.
> - Validado: `tsc --noEmit` (zero erros novos vs. baseline — os 3 erros restantes em `SidebarPatientEditView.tsx`/`PortalLogin.tsx` são pré-existentes, confirmados via `git stash`/`git stash pop`).

## FASE 6 — Datas, Horas e Slots (formato por país)

> Banco permanece UTC/ISO. Só muda o **display**, dirigido por `locale`+`timezone` do tenant.
> Infra de timezone (`timezoneUtils.ts`) já existe — esta fase troca o **formato** hardcoded BR.

- [x] **6.1** Criar `src/lib/i18n/formatDateTime.ts` (motor único, `Intl.DateTimeFormat`):
  - [x] `formatDate(value, { locale, timezone })` → `18/06/2026` (BR) / `06/18/2026` (US)
  - [x] `formatTime(value, { locale, timezone, hour12 })` → `08:00` (BR) / `8:00 AM` (US)
  - [x] `formatDateTime(value, opts)` → data + hora combinadas
  - [x] `formatSlot(timeStr, opts)` → slot de agenda (`08:00` ↔ `8:00 AM`)
  - [x] `formatRelative` / `formatWeekday` opcionais (`formatWeekday` implementado; `formatRelative` não foi necessário em nenhum call-site)
- [x] **6.2** Hook `useLocaleFormat()` — lê `locale`/`timezone` do `TenantContext` e expõe os formatadores já vinculados
- [x] **6.3** Refatorar `src/lib/dateUtils.ts` (`formatDisplayDate`) para delegar ao novo motor (manter assinatura)
- [x] **6.4** `src/lib/timezoneUtils.ts` → `formatInTimezone` recebe `locale` (parar de fixar `'pt-BR'`)
- [x] **6.5** Slots de agenda country-aware (`SidebarBookingView`, `QuickBookingModal`, `SidebarAvailabilityView`, `AgendaMestra`): trocar `HH:00` fixo por `formatSlot`
- [x] **6.6** Substituir `format(..., 'dd/MM/yyyy'|'HH:mm', {locale: ptBR})` e `toLocale*('pt-BR')` ad-hoc pelos helpers — **14 arquivos corrigidos no total (8 de alta prioridade + 6 de menor prioridade); restante foi triado e decidido fora de escopo (ver notas)**
- [x] **6.7** Nomes de mês por extenso → **seguem o idioma da UI** (decidido: Traffio terá tradução total — ver [TASKLIST-I18N-LANGUAGE.md](TASKLIST-I18N-LANGUAGE.md) Fase F.2). Ocorrências como `format(date, "dd 'de' MMMM", {locale: ptBR})` e `toLocaleDateString('pt-BR', {weekday:'long', month:'long'})` em `SidebarBookingView.tsx`/`QuickBookingModal.tsx`/`SidebarAvailabilityView.tsx`/`AgendaMestra.tsx` foram deixadas intactas de propósito — pertencem ao Pilar 2.

> **Notas de implementação (6.1-6.5):**
> - `formatDateTime.ts` separa `formatDate` (calendário puro `YYYY-MM-DD`, **sem** conversão de timezone — preserva a garantia de "sem deslocamento de data" que `dateUtils.formatDisplayDate` já tinha, essencial para `birth_date`) de `formatTime`/`formatDateTime` (instantes ISO, **aplicam** `timezone`). `formatSlot` trata strings soltas `"HH:mm"` (slot de agenda, sem data/timezone) — faz `split(':')` então tolera sufixo de segundos (`"14:30:00"`) sem precisar de `.substring(0,5)` antes de chamar.
> - `useLocaleFormat()` lê `tenant.locale`/`tenant.timezone` do `TenantContext` autenticado, com fallback para `getCountry(tenant?.country || DEFAULT_COUNTRY).locale` em tenants legados sem `locale` setado.
> - ⚠️ **Limite arquitetural identificado**: `useLocaleFormat()` depende de `useTenant()` (só funciona dentro de `TenantProvider`, ou seja, área autenticada normal). Páginas públicas (`PortalRegister`, `PortalLogin`, `PreCheckin`) usam um tenant vindo de `useOutletContext` e **não devem** usar esse hook — qualquer trabalho futuro ali deve chamar os formatadores soltos de `formatDateTime.ts` direto, com locale derivado do tenant do outlet-context.
> - `AgendaMestra.tsx` é uma visão master multi-tenant de super-admin: não usa `useTenant()`/`TenantContext` em nenhum momento — carrega a lista completa de `tenants` e mantém um `selectedTenant` que o admin troca livremente. Usar `useLocaleFormat()` ali formataria com o tenant do próprio admin, não com o tenant **selecionado/visualizado** — errado. Solução aplicada: `useMemo` que busca o tenant correspondente em `tenants.find(t => t.id === selectedTenant)` e deriva `locale` dele (com fallback ao registry), depois um wrapper local `formatSlot` que chama o `formatSlot` standalone de `formatDateTime.ts` com esse locale. Aplicado nos 6 pontos de exibição de horário do arquivo: rótulo de hora da grade (`HH:00`), faixa de horário do agendamento no card, cabeçalho do modal de novo agendamento (×2: preview flutuante e modal fixo), e cabeçalho do modal de edição de agendamento.
> - Validado: `npx tsc --noEmit` (zero erros novos vs. baseline — total caiu de 160 para 155 erros após os edits, já que algumas correções reduziram erros pré-existentes incidentalmente); `npx eslint` nos 8 arquivos tocados (68 problemas antes e depois — idêntico, confirmado via `git stash`/`pop`, os erros restantes são pré-existentes e não relacionados — ex.: acesso a `ref.current` durante render em `AgendaMestra.tsx`, imports não usados em `SidebarAvailabilityView.tsx`); `npm run build` concluído sem erros (warning de chunk grande é pré-existente).

> **Notas de implementação (6.6 — lote de alta prioridade):**
> - `SidebarAppointmentsView.tsx`: `useLocaleFormat()` adicionado; 4 pontos (confirmação de cancelamento, mensagens WhatsApp de check-in/lembrete, linha de listagem de consultas) trocados de `new Date(appt.date+'T12:00:00').toLocaleDateString('pt-BR')`/`String(appt.start_time).substring(0,5)` para `formatDate(appt.date)`/`formatSlot(appt.start_time)`.
> - `SidebarPaymentView.tsx`: `useLocaleFormat()` adicionado; data de criação da cobrança recente (`b.created_at`) trocada para `formatDate()`. Linhas de **moeda** (`toLocaleString('pt-BR', {style:'currency'})`) deliberadamente **não tocadas** — fora do escopo desta fase (formatação monetária é feature distinta de Phone/CEP/CPF/Endereço/Data-Hora).
> - `ViewPrescriptionModal.tsx`: não tinha acesso a tenant/locale; `useLocaleFormat()` adicionado (chamado antes do `if (!isOpen...) return null` early-return, respeitando a regra de hooks); data de criação da receita trocada para `formatDate()`.
> - `NewMedicalRecordModal.tsx`: `useLocaleFormat()` adicionado; texto padrão gerado ao salvar evolução SOAP (`Evolução SOAP - ${new Date().toLocaleDateString()}`) trocado para `formatDate(new Date())`. Ocorrência com `month: 'short'` (linha ~264, exibição de histórico) deixada intacta — adiada para o Pilar 2 (nome de mês por extenso), mesma decisão da Fase 6.7.
> - `PortalBook.tsx` / `PortalDashboard.tsx`: páginas públicas do portal do paciente — **não usam `useLocaleFormat()`** (fora do `TenantProvider`); usam os formatadores soltos de `formatDateTime.ts` com `locale` derivado do tenant recebido via `useOutletContext` (mesmo padrão arquitetural documentado nas notas da Fase 6.1-6.5). Em `PortalBook.tsx`: grid de horários disponíveis, horário selecionado no resumo e aviso de reagendamento (data+hora) corrigidos; ocorrência com `month: 'long'` no resumo de confirmação deixada intacta (Pilar 2). Em `PortalDashboard.tsx`: data+hora da consulta na listagem e no modal de confirmação de cancelamento corrigidos.
> - `ReceptionDashboard.tsx`: não tinha acesso a tenant/locale; `useLocaleFormat()` adicionado. Horário de cada consulta na lista (`new Date(a.start_time).toLocaleTimeString('pt-BR',...)`) e relógio atual no cabeçalho corrigidos para `formatTime()`; `formatTime` adicionado às deps do `useCallback` de `fetchAppointments` (eslint `react-hooks/exhaustive-deps` pegou a omissão). Data por extenso com dia da semana (`weekday:'long', month:'long'`) deixada intacta (Pilar 2).
> - `FollowUpBoard.tsx`: já tinha `useTenant()`; `useLocaleFormat()` adicionado. Data de atualização do card no Kanban (`session.updated_at`) corrigida para `formatDate()`. Linha de **moeda** (`revenue_estimated.toLocaleString('pt-BR')`) deixada intacta — fora do escopo (mesma razão do `SidebarPaymentView.tsx`).
> - `TimelineCard.tsx`: auditado — única ocorrência (`month: 'short'`) é textual, sem nada numérico em escopo; **nenhuma alteração feita** (Pilar 2).
> - Validado: `tsc --noEmit` (zero erros novos vs. baseline nos 8 arquivos tocados, confirmado via `git stash`/`pop`); `eslint` nos 8 arquivos (42 problemas antes e depois — idêntico após adicionar `formatTime` às deps do `useCallback` em `ReceptionDashboard.tsx`, que era o único delta real introduzido); `npm run build` concluído sem erros.
> - **Restante da Fase 6.6 (~22 arquivos de menor prioridade) — triado e concluído**: dos arquivos listados anteriormente, `followup/PerformanceStats.tsx` e `admin/Services.tsx` foram auditados e contêm **apenas** formatação de moeda (sem data/hora) — nenhuma ação necessária, já estavam fora de escopo. Os 6 arquivos restantes com data/hora ad-hoc real foram corrigidos nesta passada.

> **Notas de implementação (6.6 — lote de menor prioridade, 6 arquivos):**
> - `Dashboard.tsx` (analytics de ads): `useLocaleFormat()` adicionado; helper local `formatDateBR()` removido e seus 2 call-sites trocados para `formatDate()`; rótulo de data do eixo X do gráfico (dia/mês numérico, sem ano) trocado para `new Intl.DateTimeFormat(locale, {day:'2-digit',month:'2-digit'})` (não existe helper dedicado para "dia+mês sem ano" em `formatDateTime.ts` — uso direto de `locale` exposto pelo hook); timestamp do export PDF (`Gerado em:`) e timestamp de "Última Sincronização" trocados para `formatDateTime()`. `locale` adicionado às deps do `useMemo` de `chartData` (eslint `react-hooks/exhaustive-deps` pegaria a omissão). **Não tocado** (fora de escopo): `formatCurrency` e `toLocaleString('pt-BR')` em `totImpressions`/`totClicks`/`c.impressions`/`c.clicks` — formatação de número puro (sem moeda), categoria distinta de Phone/CEP/CPF/Endereço/Data-Hora.
> - `numbers/PendingOrdersList.tsx`: não tinha acesso a tenant/locale (recebe só `tenantId` como prop); `useLocaleFormat()` adicionado (usa o `useTenant()` interno do hook, correto pois o componente só é renderizado dentro da área autenticada do próprio tenant). Data de criação do pedido de número trocada para `formatDate()`.
> - `settings/TeamManagement.tsx`: já tinha `useTenant()`; `useLocaleFormat()` adicionado. 2 datas de convite (criação + expiração) trocadas para `formatDate()`.
> - `hooks/useFollowUpMetrics.ts` (hook customizado, consumido por `FollowUpBoard`/`PerformanceStats`): `useLocaleFormat()` chamado internamente (hook chamando hook — padrão já validado na Fase 6.6 anterior); rótulo de data do bucket do gráfico de série temporal trocado de `toLocaleDateString('pt-BR', {day,month})` para `new Intl.DateTimeFormat(locale, {day,month})`; `locale` adicionado preventivamente às deps do `useCallback` de `fetchMetrics`.
> - `FinancialDashboard.tsx`: `useLocaleFormat()` adicionado; data de vencimento/criação da cobrança (`rec.due_date || rec.created_at`) trocada para `formatDate()`.
> - `PaymentsPage.tsx`: `useLocaleFormat()` adicionado; data de criação da proposta de financiamento trocada para `formatDate()`.
> - Validado: `tsc --noEmit` (131 linhas de output — idêntico ao baseline, zero erros novos, confirmado via `git stash`/`pop`); `eslint` nos 6 arquivos (50 problemas antes e depois — idêntico, após adicionar `locale` às deps do `useMemo` de `chartData` em `Dashboard.tsx`, que era o único delta real introduzido); `npm run build` concluído sem erros.
> - **Decisões de fora-de-escopo (documentadas, não revertidas no futuro sem motivo novo)**:
>   - `src/backend/server.ts` (linha ~150): `new Date().toLocaleDateString('pt-BR')` injetado no prompt de sistema do bot de WhatsApp (Gemini). Não é campo de UI — é texto enviado a um modelo de IA. Corrigir exigiria propagar o locale do tenant para esse handler de backend, fora de proporção para este lote incremental de formatação de exibição.
>   - `billing/PaymentRequiredModal.tsx` + `BillingPage.tsx`: módulo de cobrança da própria Traffio (assinatura SaaS cobrada da clínica) — usa `formatPrice()` de `planConfig.ts`, hardcoded em `currency: 'BRL'`, e `BillingPage.tsx` tem texto em português fixo + link `mailto:contato@traffio.com.br`. Módulo é BR-only/PT-only por design; corrigir só a data seria inconsistente. Deferido como módulo completo para uma iniciativa futura dedicada de i18n de billing.
>   - `master/{MasterBilling,MasterDashboard,MasterLogs,MasterTenants}.tsx`: console interno de administração da própria Traffio (visão agregada de todos os tenants — MRR/ARR, logs de sistema, lista de tenants), usado pela equipe de ops/eng da Traffio, não pela equipe da clínica. Diferente de `AgendaMestra.tsx` (Fase 6.5, já corrigido) que é uma visão operacional de agenda para um tenant específico selecionado — os `Master*.tsx` são gestão/métricas internas do provedor SaaS, razoavelmente pt-BR sempre.

## FASE 7 — Normalização de exibição (campos de identificação)

- [x] **7.1** Substituir formatações ad-hoc por helpers do registry em: `FollowUpBoard`, `HumanInboxPage`, `PatientDetails`, `CrmLeads`, `MedicalRecordsHub`, `CommunicationsHub`
- [x] **7.2** Mostrar bandeira + número nacional onde hoje só há dígitos crus

> **Notas de implementação (7.1-7.2):**
> - `FollowUpBoard.tsx`: já usava `formatPhone`/`phoneFlag` corretamente — nenhuma alteração necessária.
> - `HumanInboxPage.tsx`: função local `maskCpf()` (regex BR-only, ex.: `123.***.***-45`) substituída por `docLabel()` + `formatDoc()` country-aware, preservando o mascaramento de privacidade (meio do documento oculto) via novo helper local `maskDoc()` que opera sobre a string já formatada (genérico, não depende do formato de máscara). Query de `patients` e `interface PatientInfo` ganharam `national_id`/`national_id_type`/`country`.
> - `PatientDetails.tsx`: CPF cru → `docLabel()` + `formatDoc()`; celular cru → `formatNational()`.
> - `CrmLeads.tsx`: CPF cru → `docLabel()` + `formatDoc()` (telefone já usava `formatPhone`/`phoneFlag`).
> - `MedicalRecordsHub.tsx`: 2 ocorrências de CPF cru (lista lateral + `InfoField` no painel de detalhes) → `docLabel()`/`formatDoc()`; telefone cru no `InfoField` de contato → `formatNational()`. Interface `Patient` local (distinta de `types/patient.ts`) ganhou `national_id?`/`national_id_type?`/`country?`.
> - `CommunicationsHub.tsx`: função local `fmtPhone()` (regex BR-only, só cobria 11/13 dígitos) removida; as 6 ocorrências (`num`, `selected.patient_phone`, `selected.from_number`, `s.patient_phone`, `vm.from_number`) passaram a usar `formatPhone()` (mesmo helper já usado em `FollowUpBoard`/`CrmLeads`, delegando a `libphonenumber-js`/i18n).
> - **7.2 (auditoria adicional fora dos 6 arquivos nomeados)**: busca por `{x.phone}`/`{x.mobile}`/`{x.cpf}` sem formatador em todo `src/pages`/`src/components` encontrou mais 3 pontos de exibição crua: `pages/admin/Professionals.tsx` (telefone do profissional na lista) e `pages/Settings.tsx` + `components/SidebarDirectoryView.tsx` (telefone da unidade/local) — todos corrigidos com `phoneFlag()` + `formatPhone()`. No link `tel:` do `SidebarDirectoryView`, o `href` continua com o valor cru (necessário para o protocolo `tel:` funcionar) — só o texto visível foi formatado. Props `patientCpf`/`patientPhone` passados a `OdontogramModal`, `NewMedicalRecordModal` e `ChannelPreferenceSelector` foram auditados e usados apenas para lookup/validação (nunca exibidos cru em JSX) — fora do escopo de 7.2.
> - Validado: `tsc --noEmit` (155 erros — idêntico ao baseline pós-Fase 6, zero regressões); `eslint` nos 9 arquivos tocados (104 + 35 problemas — idêntico antes/depois, confirmado via `git stash`/`pop`); `npm run build` concluído sem erros.

## FASE 8 — QA & Validação

- [ ] **8.1** `npm run build` + `npm run lint` sem erros
- [ ] **8.2** Teste por país: criar clínica BR/US/NZ/MX e validar máscara/lookup/validação de cada campo
- [ ] **8.3** Teste de override por campo (ex.: clínica US com telefone +55)
- [ ] **8.4** Teste de retrocompat: pacientes BR antigos continuam exibindo CPF corretamente
- [ ] **8.5** Teste de fallback: postal inexistente → autocomplete Photon assume
- [ ] **8.6** Teste data/hora: agenda/slots/lembretes exibem `18/06/2026 08:00` (BR) e `06/18/2026 8:00 AM` (US) no fuso correto

---

## 🗄️ SQL — Script de Verificação (rodar PRIMEIRO no Supabase SQL Editor)

```sql
-- Confirma colunas reais antes de migrar (schema real diverge do repo)
select table_name, column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('tenants','locations','patients')
  and column_name in (
    'country','locale','timezone',
    'cpf','national_id','national_id_type',
    'address_zip_code','phone'
  )
order by table_name, column_name;
```

## 🗄️ SQL — Script de Migração (idempotente — seguro rodar mais de uma vez)

```sql
-- =============================================================================
-- TRAFFIO — Internacionalização de campos (país por unidade + doc genérico)
-- Idempotente: usa "if not exists". tenants.country/locale/timezone JÁ existem.
-- =============================================================================

-- 1) País por unidade (a aplicação herda do tenant ao criar)
alter table public.locations
  add column if not exists country text not null default 'BR';

-- 2) Paciente: país + documento genérico (mantém cpf p/ retrocompat BR)
alter table public.patients
  add column if not exists country          text not null default 'BR',
  add column if not exists national_id      text,
  add column if not exists national_id_type text;   -- 'cpf'|'rfc'|'curp'|'ssn'|'ird'|...

-- 3) Backfill: pacientes BR existentes (cpf preenchido) -> national_id
update public.patients
  set national_id      = regexp_replace(cpf, '\D', '', 'g'),
      national_id_type = 'cpf'
  where cpf is not null
    and coalesce(cpf, '') <> ''
    and national_id is null;

-- 4) Índices p/ busca e deduplicação por documento
create index if not exists idx_patients_national_id
  on public.patients (tenant_id, national_id);

create index if not exists idx_locations_country
  on public.locations (country);

-- 5) (Opcional) Sincronizar tenants sem locale/timezone coerentes — apenas leitura aqui
-- select id, name, country, locale, timezone from public.tenants order by created_at;
```

---

## 📋 Registry de referência (rascunho do `countryFormats.ts`)

| País | dialCode | Telefone (nacional) | Postal (rótulo / máscara) | Documento (rótulo) | Lookup postal |
|------|----------|---------------------|---------------------------|--------------------|---------------|
| 🇧🇷 BR | +55 | (41) 99775-9569 | CEP `#####-###` | CPF `###.###.###-##` | BrasilAPI |
| 🇺🇸 US | +1  | (404) 925-7024 | ZIP code `#####(-####)` | SSN/—(opcional) | Zippopotam.us |
| 🇳🇿 NZ | +64 | 21 123 4567 | Postcode `####` | IRD (opcional) | Zippopotam.us |
| 🇲🇽 MX | +52 | 55 1234 5678 | Código Postal `#####` | RFC / CURP | Zippopotam.us |

> Telefone/validação são delegados a `libphonenumber-js` (a tabela acima é só ilustrativa do display).

**Data / Hora (dirigido por `locale` — `Intl.DateTimeFormat`):**

| País | locale | Data | Hora | Exemplo combinado |
|------|--------|------|------|-------------------|
| 🇧🇷 BR | `pt-BR` | `18/06/2026` (dd/MM/yyyy) | `08:00` (24h) | `18/06/2026 08:00` |
| 🇺🇸 US | `en-US` | `06/18/2026` (MM/dd/yyyy) | `8:00 AM` (12h) | `06/18/2026 8:00 AM` |
| 🇳🇿 NZ | `en-NZ` | `18/06/2026` (dd/MM/yyyy) | `8:00 AM` (12h) | `18/06/2026 8:00 AM` |
| 🇲🇽 MX | `es-MX` | `18/06/2026` (dd/MM/yyyy) | `8:00` ou `8:00 a.m.` | `18/06/2026 8:00` |

---

## 🔗 Arquivos impactados (mapa rápido)

**Novos:** `src/lib/i18n/countryFormats.ts`, `src/lib/i18n/formatDateTime.ts`, `src/hooks/useLocaleFormat.ts`,
`src/components/intl/{CountryFieldSelector,IntlPhoneInput,IntlPostalInput,IntlDocInput}.tsx`

**Editados:** `src/lib/formatPhone.ts`, `src/lib/dateUtils.ts`, `src/lib/timezoneUtils.ts`,
`src/lib/validators/brazilianDocs.ts`, `src/services/addressService.ts`,
`src/components/SmartAddressInput.tsx`, `src/components/TenantAddressForm.tsx`, `src/pages/Settings.tsx`,
`src/contexts/TenantContext.tsx`, `src/services/locationService.ts`, `src/components/NewPatientModal.tsx`,
`src/components/Sidebar{RegisterView,PatientEditView,BookingView,AvailabilityView}.tsx`,
`src/components/QuickBookingModal.tsx`, `src/pages/AgendaMestra.tsx`, `src/pages/portal/PortalRegister.tsx`,
`src/pages/patient/PreCheckin.tsx`, `src/components/settings/TeamManagement.tsx`,
_+ 14 arquivos com formatação de data/hora ad-hoc corrigidos na Fase 6.6 (8 alta prioridade + 6 menor prioridade); ~7 arquivos triados e decididos fora de escopo (ver notas da Fase 6.6)_

---

_Status: Fases 0, 1, 2, 3, 4, 5, 6 (6.1-6.7 completas) e 7 concluídas — DB + registry + addressService country-aware + componentes Intl*Input + integração em Settings.tsx/TenantAddressForm.tsx + propagação para todos os write-paths de paciente (incluindo o trigger `handle_new_user`, corrigido em produção) + motor único de data/hora/slot (`formatDateTime.ts`) propagado nas 4 telas de agenda + 14 telas paciente/agenda/admin/financeiro (Fase 6.6, em 2 lotes) + normalização de exibição de telefone/documento em 9 arquivos (6 nomeados na Fase 7.1 + 3 achados na auditoria da 7.2). `tsc`/`eslint`/`build` verdes (zero regressões vs. baseline, confirmado via `git stash`/`pop` em cada fase/lote). Fora de escopo, decisão documentada: `src/backend/server.ts` (prompt de IA), módulo de billing da própria Traffio (`PaymentRequiredModal.tsx`/`BillingPage.tsx`, BR/PT-only por design), console interno `master/Master*.tsx` (não voltado à clínica) — ver notas da Fase 6.6. Pendente: Fase 8 (QA & Validação manual por país). Próximo: Fase 8, a critério do usuário._
