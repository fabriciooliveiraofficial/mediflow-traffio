# TASKLIST — Tradução de Idioma da Plataforma (UI i18n / Multi-idioma)

> **Pilar 2 de 2** da internacionalização da Traffio. Ver também:
> [TASKLIST-I18N-FIELDS.md](TASKLIST-I18N-FIELDS.md) (Pilar 1 — formatação de dados).
>
> | Pilar | O que faz | Dirigido por |
> |-------|-----------|--------------|
> | **1. Formatação** | Telefone/CEP/CPF/Endereço/Data/Hora se adaptam ao país | `country` + `locale` |
> | **2. Tradução (este)** | Texto da UI muda de **idioma** (PT/EN/ES) | `language` (idioma escolhido) |
>
> **Objetivo:** traduzir **toda a plataforma** (todas as páginas, incl. sala de espera/app do paciente)
> para 🇧🇷 PT, 🇺🇸🇳🇿 EN e 🇲🇽 ES. Sem widget flutuante de tradução. O seletor de idioma fica em
> **Configurações da plataforma** (equipe) e **dentro do app do paciente** (paciente escolhe o seu).
>
> **Decisões aprovadas (2026-06-18):**
> 1. **Motor:** `react-i18next` (namespaces, lazy load, troca em runtime, plurais/ICU).
> 2. **Idiomas:** **PT, EN, ES** (US e NZ compartilham EN). Fallback → `pt-BR`.
> 3. **Tradução:** extrair fonte pt-BR → **pré-traduzir com IA** (EN/ES) → **revisar termos clínicos**.
> 4. **Idioma do paciente:** paciente escolhe (default = país da clínica), persistido.

---

## 📐 Diagnóstico (estado atual)

| Item | Situação |
|------|----------|
| Lib de i18n no app React (`src/`) | ❌ **Inexistente** — strings hardcoded em pt-BR no JSX |
| Escala | ⚠️ **120 arquivos `.tsx`, ~108 com texto PT** — praticamente toda a UI |
| Provider tree | `src/main.tsx` → só `BrowserRouter` + `App` (sem provider i18n) |
| Precedente i18n | ✅ Widget embarcado já tem mini-dicionário PT/EN (`public/widget/v1/widget-core.js`) — padrão a reaproveitar conceitualmente |
| App do paciente | `pages/patient/{PreCheckin,WaitingRoom}` + `pages/portal/{Book,Dashboard,Login,Profile,Register}` |
| `tenants.locale` | ✅ Já existe (`pt-BR`/`en-US`/`en-NZ`) — pode dar o **idioma padrão** da clínica |
| Preferência de idioma do usuário/paciente | ❌ Não há coluna/persistência |

**Conclusão:** não existe infraestrutura de tradução. É preciso (a) montar o motor, (b) extrair/migrar as
strings hardcoded para catálogos, (c) pré-traduzir, e (d) ligar os seletores de idioma à resolução por
tenant/usuário/paciente. **Maior esforço = migração das strings** (Fase C, incremental por domínio).

---

## 🏗️ Arquitetura proposta

```
src/lib/i18n/index.ts  ──init──>  i18next + react-i18next
        │                          fallbackLng: 'pt-BR'
        │                          detection: paciente/usuário/tenant
        ▼
src/locales/
  ├─ pt-BR/  { common, auth, settings, agenda, patient, billing, crm, ... }.json   (FONTE)
  ├─ en/     { ...mesmas namespaces... }.json   (IA + revisão)
  └─ es/     { ...mesmas namespaces... }.json   (IA + revisão)
        │
        ▼  consumido por
  useTranslation('namespace')  ->  t('chave')   em todos os .tsx
        │
        ▼  idioma resolvido por
  ┌─────────────────────────────────────────────────────────────┐
  │ EQUIPE  : localStorage > user.preferred_locale > tenant.locale │
  │ PACIENTE: localStorage > patients.preferred_locale > clínica   │
  └─────────────────────────────────────────────────────────────┘
```

**Relação com o Pilar 1 (formatação):** `language` (idioma da UI) e `country/locale` (formato dos dados) são
**eixos independentes mas com defaults ligados**. Ex.: clínica nos EUA → idioma EN + datas MM/dd; um paciente
pode ver a UI em PT enquanto seus próprios dados (telefone +55, CPF) seguem o formato BR. O `formatDateTime`
do Pilar 1 e o `i18next` compartilham a mesma noção de locale quando coincidem.

---

## FASE A — Infraestrutura do motor i18n

- [x] **A.1** Instalar: `npm i i18next react-i18next i18next-browser-languagedetector`
- [x] **A.2** Criar `src/lib/i18n/index.ts` — init i18next (`fallbackLng: 'pt-BR'`, `supportedLngs: ['pt-BR','en','es']`, `interpolation.escapeValue:false`, namespaces, lazy load dos catalogs)
- [x] **A.3** Mapear país→idioma: `BR→pt-BR`, `US→en`, `NZ→en`, `MX→es` (reusar registry do Pilar 1)
- [x] **A.4** Detector de idioma custom (ordem: `localStorage` → preferência do registro → `tenant.locale` → fallback) — implementado em `useApplyDefaultLanguageFromCountry()`
- [x] **A.5** Envolver `src/main.tsx` com o provider i18n (importar init; `<Suspense>` para lazy)
- [x] **A.6** Hook `useLang()` — expõe idioma atual + `setLanguage(lng)` (persiste em localStorage e, quando logado, no registro)

## FASE B — Estrutura de catálogos + ferramental de extração

- [x] **B.1** Definir namespaces por domínio: `common, auth, settings, agenda, patient, portal, billing, crm, medical, automations, communications`
- [x] **B.2** Criar `src/locales/{pt-BR,en,es}/*.json` (`common` populado; demais 10 namespaces como esqueleto `{}` aguardando Fase C)
- [ ] **B.3** Configurar `i18next-parser` (`npm i -D i18next-parser` + config) para extrair chaves `t()` e detectar faltantes
- [ ] **B.4** Convenção de chaves: `dominio.contexto.item` (ex.: `settings.clinics.title`) — documentar no README do diretório

## FASE C — Migração das strings (incremental, maior esforço)

> Estratégia: migrar **por domínio/página**, do mais compartilhado ao mais específico. Cada item entrega valor isolado.

- [x] **C.1** `common` — layout, sidebar, botões, toasts, estados vazios, validações (`src/layouts`, `src/components/shared`)

> **Notas de implementação (C.1):**
> - `common` namespace ganhou 4 seções novas: `nav` (itens do menu lateral do staff + injeções dinâmicas por especialidade — Odontologia/Odontograma/Prontuário/Nutrição/Plano Nutricional — + "Sair"/"Sair da Conta"), `layout` (placeholder de busca global, textos do banner de handoff humano), `patientSearch` (modal de busca de paciente compartilhado entre especialidades) e `calendar` (`weekdaysShort`, array de 7 letras lido via `t('calendar.weekdaysShort', { returnObjects: true })`).
> - `src/layouts/DashboardLayout.tsx` (shell principal do staff): `navItems` deixou de ser um array de módulo fixo e virou `buildNavItems(t)`, chamada dentro de um `useMemo` (`adaptiveNavItems`) com `t` nas deps — necessário porque os labels agora dependem do idioma ativo. Badges curtos (`Staff`, `Inbox`, `Z-API`, `Softphone`, `AI Hub`, `New`) foram deixados como estão (já em inglês/sigla, não são texto PT); o badge `IA` também ficou como literal por ser abreviação visual curta, não frase.
> - `src/contexts/ToastContext.tsx`: o `ConfirmDialog` genérico (usado em toda a base) tinha "Cancelar"/"Confirmar" hardcoded — agora usa `t('actions.cancel')`/`t('actions.confirm')`, reaproveitando chaves já existentes desde a Fase A/B. As mensagens dinâmicas passadas a `showToast`/`showConfirm` pelos call sites continuam de responsabilidade de cada domínio (migradas conforme cada Fase C.x avança).
> - `src/components/shared/{PatientSearchModal,SidebarCalendar}.tsx`: textos de busca/estado vazio e rótulo de especialidade traduzidos; em `SidebarCalendar.tsx`, o nome do mês por extenso (`format(currentMonth, 'MMMM yyyy', { locale: ptBR })`) foi deliberadamente deixado intacto — é o mesmo caso já triado na Fase 6.7 do Pilar 1 (segue o idioma da UI, mas a integração `useLocaleFormat()`→i18next ainda não foi feita; é trabalho da Fase F.2, não desta fase).
> - `src/layouts/{PatientAuthLayout,PatientPortalLayout}.tsx`: por serem layouts exclusivos do app do paciente (reutilizam o `tenant` do outlet-context das páginas do Portal já migradas na Fase C.5), as chaves foram adicionadas ao namespace `portal` (novas seções `nav` e `authLayout`) em vez de `common`, mantendo a convenção de 1 namespace por domínio em vez de espalhar texto do portal em `common`.
> - `src/layouts/MasterAdminLayout.tsx` deliberadamente **não tocado** — é a área administrativa interna (Master), já priorizada para a Fase C.9 (menor prioridade, uso interno), fora do escopo desta passada.
> - Validado: `tsc --noEmit` (129 linhas — idêntico ao baseline); `eslint` nos 6 arquivos tocados (15 problemas/13 erros/2 warnings vs. baseline de 16/14/2 — único delta real foi a remoção de 1 erro pré-existente `prefer-const` em `DashboardLayout.tsx`, corrigido como efeito colateral de trocar `let items` por `const items` ao reescrever a função `buildNavItems`; todo o resto são apenas deslocamentos de linha pelas novas importações); `npm run build` concluído sem erros (apenas o warning pré-existente de chunk >500kB).
- [x] **C.2** `auth` — Login, Register, ForgotPassword, AcceptInvite

> **Notas de implementação (C.2):**
> - `auth` namespace (até então `{}`) ganhou 4 seções: `login`, `forgotPassword`, `register` (incluindo `register.provisioning.*` para as 6 mensagens de status exibidas durante o cadastro em 3 etapas) e `acceptInvite` (incluindo `acceptInvite.roleLabels.*` para os 5 labels de cargo do convite, lidos via `t('acceptInvite.roleLabels', { returnObjects: true })`).
> - `src/pages/LoginPage.tsx`: heading, subtitle, labels, placeholders, link "Esqueceu a senha?", botão "Entrar", rodapé "Não tem uma conta?/Criar agora" e a mensagem de erro do toast (`t('login.errors.generic', { message })`) migrados.
> - `src/pages/ForgotPasswordPage.tsx`: heading/subtitle, label/placeholder de email, estado "Email enviado!", botão de envio e mensagem de erro do toast migrados.
> - `src/pages/RegisterPage.tsx` (fluxo de 3 etapas — Form/Provisioning/Payment): migradas as validações (`passwordMismatch`/`passwordTooShort`), as 6 mensagens de `addStep()` exibidas durante o provisionamento, o heading da etapa 2, e todo o formulário da etapa 1 (heading, card de plano selecionado com `Anual`/`Mensal`/`/mês`, todos os campos e placeholders, botão "Criar Conta", rodapé "Já tem uma conta?/Entrar"). O import de `PLANS`/`PLAN_ORDER`/`formatPrice` (`config/planConfig`) e `PaymentRequiredModal` (billing) não foi tocado — são dependências de billing fora do escopo desta fase.
> - `src/pages/AcceptInvitePage.tsx`: o objeto módulo `ROLE_LABELS` (hardcoded em PT) foi removido e substituído por `roleLabels = t('acceptInvite.roleLabels', { returnObjects: true })` lido dentro do componente (precisa do hook `useTranslation`, não pode mais ser constante de módulo); `ROLE_COLORS` (classes Tailwind, não é texto) ficou como estava. Migrados: todas as mensagens de erro do convite (inválido/não encontrado/aceito/revogado/expirado), validações do formulário, telas de loading/erro/sucesso, todo o formulário (labels, placeholders, botão, rodapé) e o rodapé "Traffio — Gestão Inteligente para Clínicas".
> - `src/pages/RegisterPaymentPage.tsx` inspecionado e **não precisou de migração** — não tem texto próprio, apenas renderiza `<PaymentRequiredModal>` (componente de billing, fora do escopo de `auth`).
> - Validado: `tsc --noEmit` (129 linhas — idêntico ao baseline); `eslint` nos 4 arquivos tocados (8 problemas/8 erros/0 warnings — idêntico ao baseline, todos os erros pré-existentes de `no-explicit-any` e o `roleColor` não utilizado, sem nenhuma regressão nova); `npm run build` concluído sem erros (apenas o warning pré-existente de chunk >500kB).
- [x] **C.3** `settings` — Settings.tsx + TeamManagement (página Configurações)

> **Notas de implementação (C.3):**
> - `settings` namespace (até então `{}`) ganhou catálogo completo: `tabs`, `header`, `actions` (save/cancel locais ao namespace), `guestProfile`, `toasts` (~25 chaves), `confirms` (com interpolação `{{number}}`/`{{email}}`), `phoneNumbers`, `clinics` (~25 chaves), `locations` (~25 chaves, incluindo array `weekdaysShort`), `insurance`, `communications` (~20 chaves), `profile`, `metaConnectModal`, `team` (com `roles`/`status` como `Record<string,string>` e `inviteModal` aninhado).
> - **Decisão: chaves locais (`settings.actions.save`/`cancel`) em vez de reaproveitar `common.actions.*`** — evita múltiplos namespaces em componentes que usam majoritariamente `'settings'`; usado nos formulários inline de Locais e Convênios. Já o modal de Conectar ao Meta tem seu próprio `metaConnectModal.cancel` dedicado (texto/contexto diferente do genérico).
> - `src/components/settings/TeamManagement.tsx` (reescrito por completo): `ROLE_META`/`STATUS_META` (constantes de módulo com texto PT hardcoded) foram divididas em `ROLE_COLORS`/`STATUS_COLORS` (apenas classes Tailwind, seguem como constantes de módulo) + funções builder `buildRoleMeta(labels)`/`buildStatusMeta(labels)` que recebem os labels vindos de `t('team.roles'/'team.status', { returnObjects: true })` e são invocadas dentro de cada componente. O componente `InviteModal`, por ser função separada (não closure do componente pai), precisou de seu próprio `useTranslation('settings')`. Pluralização via `t('team.pendingInvitesCount', { count })` (`_one`/`_other`). Confirmado via grep que o `ROLE_META` exportado não tinha consumidores externos antes de remover o `export`.
> - `src/pages/Settings.tsx`: migração incremental (arquivo de 1712 linhas, edição não foi reescrita por completo). Cobertas todas as 6 abas (Clínicas, Unidades, Convênios, Equipe, Comunicações, Meu Perfil), os toasts/confirms de todos os handlers (`handleSaveProfile`, `handleSaveTenant`, `handleSaveLocation`/`handleDeleteLocation`, `handleSaveInsurance`/`handleDeleteInsurance`, `handleSync`, fluxo OAuth do Meta), o sub-componente `PhoneNumbersList` (próprio `useTranslation`) e o modal inline de Conectar ao Meta. O badge `loc.type` (`'consultorio'`/`'clinica'`/`'hospital'`) foi deliberadamente deixado como está — é valor de dado, não texto de UI fixo.
> - Validado: `tsc --noEmit` (129 linhas — idêntico ao baseline, único erro nos arquivos tocados é o `ChevronDown` não utilizado pré-existente em `TeamManagement.tsx`, apenas deslocado de linha); `eslint` nos 2 arquivos tocados (30 problemas/27 erros/3 warnings vs. baseline de 31/28/3 — único delta real foi a remoção de 1 erro pré-existente `react-refresh/only-export-components` ao remover o `export` não utilizado de `ROLE_META`; o warning de `react-hooks/exhaustive-deps` no handler OAuth passou a listar `t`/`fetchSettingsData` como dependências faltantes, esperado já que `t` agora é referenciado dentro do efeito — mesma categoria de warning pré-existente, não é regressão nova); `npm run build` concluído sem erros (apenas o warning pré-existente de chunk >500kB).
- [x] **C.4** `agenda` — AgendaMestra, booking views, QuickBookingModal, SidebarAvailability

> **Notas de implementação (C.4):**
> - `agenda` namespace (até então `{}`) ganhou catálogo completo em `src/locales/pt-BR/agenda.json`: `mestra` (top bar, `SlotBadge`, `bookingModal`, `editModal`, `confirmDelete`, `toasts` — ~10 toasts de drag-and-drop/CRUD), `quickBooking` (4 steps do wizard + `errors`/`toasts`) e `sidebarAvailability` (seletor de profissional/data/horários + legenda).
> - `src/pages/AgendaMestra.tsx` (1142 linhas, edição incremental): migrados todos os toasts de `handleBook`/`handleUpdateStatus`/`handleSaveNotes`/`handleDelete` e do handler global de drag-and-drop (mover/redimensionar agendamento), o componente `SlotBadge`, o label "Hoje"/data, os contadores de agendamentos/horários livres (pluralização `_one`/`_other` via `t('mestra.appointmentsCount', { count })`), os fallbacks "Paciente"/"Consulta" do card do calendário, e os 3 modais completos (Novo Agendamento, Editar Agendamento, Confirmar Exclusão) incluindo o prop `patientName` passado ao `CheckoutModal`.
> - `src/components/QuickBookingModal.tsx` e `src/components/SidebarAvailabilityView.tsx`: embora consumidos por `HumanInboxPage.tsx` (domínio de comunicações/C.8), foram tratados como pertencentes ao namespace `agenda` por serem componentes de agendamento — escopo definido pelo componente, não pela página que o usa, conforme a redação original desta fase ("AgendaMestra, booking views, QuickBookingModal, SidebarAvailability").
> - **Decisão: chave compartilhada vs. divergente.** Quando o mesmo texto literal em PT aparece repetido dentro do mesmo componente (ex.: "Convênio" como label de botão, título de seção, fallback de `<option>` e badge), foi usada uma única chave compartilhada (`mestra.bookingModal.insurance`). Já quando dois componentes usam **textos diferentes** para o mesmo conceito (o `SlotBadge` de `AgendaMestra.tsx` usa "Nobre" para slot prime, enquanto a legenda de `SidebarAvailabilityView.tsx` usa "Prime"), foram mantidas **chaves separadas com o texto original de cada um** (`mestra.slotBadge.prime` vs. `sidebarAvailability.legendPrime`) — evita alterar texto visível numa passada que é só migração de strings.
> - **Escopo deliberadamente não tocado** (Pilar 1 / Fase F.2, mesmo precedente da Fase C.5): todas as chamadas `toLocaleDateString('pt-BR', {...})` (label de data em `AgendaMestra.tsx`, opções de data em `SidebarAvailabilityView.tsx`, label do dia no step 3 do `QuickBookingModal.tsx`) e o `.localeCompare(..., 'pt-BR')` em `loadDoctorServices` — formatação de data/ordenação ligada à localidade, não strings de UI. `console.error()` de diagnóstico também não migrado (texto para desenvolvedor, não usuário).
> - Validado: `tsc --noEmit` (zero erros novos nos 3 arquivos tocados — os únicos erros pré-existentes em `SidebarAvailabilityView.tsx` são 3 imports não utilizados de antes da migração, `React`/`User`/`supabase`, sem relação com o trabalho desta fase); `eslint` nos 3 arquivos (49 problemas/40 erros/9 warnings — idêntico ao baseline, zero regressão); `npm run build` concluído sem erros (apenas o warning pré-existente de chunk >500kB).
- [x] **C.5** **`patient` / `portal`** — PreCheckin, WaitingRoom, PortalBook/Dashboard/Login/Profile/Register (**app do paciente — prioridade do pedido**)

> **Notas de implementação (C.5):**
> - `patient` namespace: `WaitingRoom.tsx`, `QueueStatusBadge.tsx`, `PreCheckin.tsx`, `useGeofence.ts`, `geolocationService.ts`, `QRPassGenerator.tsx` — todas as strings de UI/erro migradas para `t('patient.xxx')`.
> - `portal` namespace: `PortalLogin.tsx`, `PortalProfile.tsx`, `PortalRegister.tsx`, `PortalDashboard.tsx`, `PortalBook.tsx` — 5 sub-namespaces (`login`, `profile`, `register`, `dashboard`, `book`) criados em `src/locales/pt-BR/portal.json`; EN/ES seguem `{}` até a Fase E.
> - Padrão de chave prefix/suffix (e variantes multi-parte `Part1/Part2/Part3`) usado para frases com `<strong>`/interpolação de variável no meio (ex.: nome do tenant em negrito, pergunta de confirmação de cancelamento com médico+data+hora, avisos de reagendamento/multa por atraso) — preserva o JSX/estilo exato em torno do valor dinâmico.
> - Pluralização via sufixos `_one`/`_other` do i18next usada em `book.professionalCount` (`t('book.professionalCount', { count })`).
> - **Escopo deliberadamente não tocado** (Pilar 1 / fora desta fase): sufixos ordinais, placeholders `'---'`, e o formato de data por extenso (`toLocaleDateString('pt-BR', { month: 'long' })`) no passo de confirmação do `PortalBook.tsx` — trocar para `formatDate()` mudaria visivelmente o formato (`'2-digit'` vs `'long'`), então foi revertido.
> - **Bug introduzido e corrigido durante a migração**: adicionar `t('book.errors.loadSpecialties')` dentro de `fetchSpecialties` (função simples, não memoizada) fez o eslint (`react-hooks/exhaustive-deps`, versão com análise de estabilidade de função) sinalizar o `useEffect` de montagem por dependência faltante na própria função. Corrigido envolvendo `fetchSpecialties` em `useCallback(..., [t])` e adicionando-a ao array de deps do efeito — exigiu também **reordenar** a declaração de `fetchSpecialties` para antes do `useEffect` que a referencia (array de deps é avaliado em tempo de render; declará-la depois causava `ReferenceError` por temporal dead zone).
> - Validado: `tsc --noEmit` (129 linhas — idêntico ao baseline); `eslint` nos 5 arquivos do portal (36 problemas/36 erros/0 warnings — idêntico ao baseline, eliminando o warning novo introduzido); `npm run build` concluído sem erros (apenas o warning pré-existente de chunk >500kB).
- [x] **C.6** `crm` — CrmLeads, FollowUpBoard, automações

> **Notas de implementação (C.6):**
> - `crm` namespace (já pré-registrado em `src/lib/i18n/index.ts`): `CrmLeads.tsx`, `FollowUpBoard.tsx`, `src/components/followup/PerformanceStats.tsx` — 3 seções criadas em `src/locales/pt-BR/crm.json` (`leads`, `followUp`, `performanceStats`); EN/ES seguem `{}` até a Fase E.
> - `followUp.daysFilter` (`"{{count}} dias"` nos botões de filtro 7/30/90 dias): decidido **não** usar sufixos de pluralização `_one`/`_other` do i18next porque a UI atual nunca apresenta a opção de 1 dia — uma única chave interpolada preserva o texto original sem inventar variantes não solicitadas.
> - **Escopo deliberadamente não tocado**: textos derivados de `KANBAN_STAGES` (`src/lib/kanbanStages.ts`) — cabeçalhos de coluna do Kanban em `FollowUpBoard.tsx` e rótulos de categoria do funil em `PerformanceStats.tsx` (`YAxis dataKey="stage"`). Essas strings em PT (`'Novos Leads'`, `'Vendido/Procedimento'` etc.) são simultaneamente (a) os valores reais da coluna `kanban_stage` no banco, (b) cabeçalhos de UI, e (c) rótulos de gráfico, e são compartilhadas com `SidebarLeadClassifyView.tsx` (fora do escopo desta fase). Traduzir apenas a exibição sem alterar a camada de dados exigiria um refactor de mapeamento chave-estágio→rótulo abrangendo arquivos não nomeados no escopo desta fase ("CrmLeads, FollowUpBoard, automações") — registrado aqui como melhoria futura, análogo ao precedente do enum `loc.type` na Fase C.3.
> - **Escopo deliberadamente não tocado**: `src/components/NewPatientModal.tsx` — compartilhado entre `CrmLeads.tsx` (nesta fase) e `ReceptionDashboard.tsx` (ainda sem fase/namespace definido); migração adiada para não decidir prematuramente a propriedade do namespace antes da fase do `ReceptionDashboard`.
> - Formatação locale-specific deixada intacta (consistente com fases anteriores): `new Intl.DateTimeFormat('pt-BR', ...)` em `CrmLeads.tsx` (`formatDate`) e `.toLocaleString('pt-BR')` para moeda/números em `FollowUpBoard.tsx`/`PerformanceStats.tsx` — concerns do Pilar 1 / Fase F.2, não desta fase.
> - Validado: `tsc --noEmit` (131 linhas — idêntico ao baseline); `eslint` nos 3 arquivos tocados (16 problemas/15 erros/1 warning — idêntico ao baseline, zero regressão); `npm run build` concluído sem erros (apenas o warning pré-existente de chunk >500kB).
- [x] **C.7** `medical` — MedicalRecordsHub, OdontologyHub, NutritionHub, modais clínicos

> **Notas de implementação (C.7):**
> - `medical` namespace (já pré-registrado em `src/lib/i18n/index.ts`): `MedicalRecordsHub.tsx`, `OdontologyHub.tsx`, `NutritionHub.tsx`, `DicomViewerModal.tsx`, `OdontogramModal.tsx`, `Odontogram.tsx`, `NewDentalBudgetModal.tsx`, `NewNutritionEvaluationModal.tsx`, `MealPlannerModal.tsx` — 6 seções criadas em `src/locales/pt-BR/medical.json` (`recordsHub`, `odontologyHub`, `nutritionHub`, `dentalModals`, `nutritionModals`); EN/ES seguem `{}` até a Fase E.
> - **Escopo definido pela propriedade do componente, não pela página**: `Odontogram.tsx` foi incluído por ser usado exclusivamente pelo `OdontogramModal.tsx` (dentro do escopo); `Tooth.tsx` foi confirmado limpo via grep (zero texto traduzível) e não precisou de edição.
> - **Escopo deliberadamente não tocado**: `DicomViewer.tsx` (compartilhado entre `DicomViewerModal.tsx`, nesta fase, e `PatientDetails.tsx`, sem fase/namespace definido — 1 string "Série Imagens" permanece em PT) e `AnthropometryForm.tsx` (compartilhado entre `NewNutritionEvaluationModal.tsx`, nesta fase, e `PatientDetails.tsx`) — migração adiada pelo mesmo motivo do precedente do `NewPatientModal.tsx` na Fase C.6 (evitar decidir prematuramente a propriedade do namespace antes da fase do `PatientDetails.tsx`).
> - Strings textualmente idênticas entre componentes (ex.: "Orçamento criado com sucesso!", toasts de CPF/iDocs) foram mantidas como chaves separadas por componente (`odontologyHub.toasts.budgetCreated` vs `dentalModals.newBudget.toasts.created`) em vez de compartilhadas, mantendo cada seção autocontida.
> - Nomes de marca e dados mock/demo deixados intactos mesmo embutidos em texto traduzível: "TRAFFIO MED" / "Traffio Med" / "Traffio Medical" (marca), "CRM/CRO 123.456" / "CRM/CRO 12345" / "CRM/CRO: 123.456-SP" (registros profissionais fictícios), "Brasília - DF" (localização mock), `placeholder="sk-proj-..."` (dica de formato de chave de API).
> - Typos da fonte original preservados (fora do escopo de uma migração i18n): "Dol aguda" (`MedicalRecordsHub.tsx`, placeholder do título da evolução) e "Precrição assistida" (`MealPlannerModal.tsx`, subtítulo do card de IA).
> - **Bug pré-existente não corrigido**: em `MedicalRecordsHub.tsx`, a chamada `showToast(t('recordsHub.toasts.editComingSoon'), 'info')` mantém a ordem de argumentos invertida em relação ao padrão `showToast(type, message)` usado no resto do arquivo (gera o erro de tipo `TS2345` já presente no baseline) — apenas a string foi traduzida, a inversão de argumentos é anterior a esta migração e está fora do escopo de uma passada de i18n.
> - Distinção entre enum fixo de banco (excluído, ver `KANBAN_STAGES` na Fase C.6) e texto-semente mutável: os nomes padrão de período de refeição em `MealPlannerModal.tsx` (`'Café da Manhã'`, `'Almoço'`, `'Jantar'`, `'Nova Refeição'`) foram traduzidos por serem texto editável pelo usuário sem restrição de enum/coluna no banco.
> - Formatação locale-specific deixada intacta: `toLocaleDateString('pt-BR', ...)` / `toLocaleString('pt-BR')` em vários pontos dos hubs e modais — concerns do Pilar 1 / Fase F.2, não desta fase.
> - Validado: `tsc --noEmit` (131 linhas — idêntico ao baseline, incluindo o erro pré-existente `TS2345` do bug de argumentos do `showToast`); `eslint` nos 10 arquivos tocados (28 problemas/22 erros/6 warnings — mesmos padrões pré-existentes do baseline: `no-explicit-any`, `no-unused-vars`, `react-hooks/exhaustive-deps`, zero regressão introduzida pela migração); `npm run build` concluído sem erros (apenas o warning pré-existente de chunk >500kB).
- [x] **C.8** `billing` / `communications` — Billing/Payments, CommunicationsHub, HumanInbox

> **Notas de implementação (C.8):**
> - `billing` namespace (já pré-registrado em `src/lib/i18n/index.ts`): `PaymentRequiredModal.tsx`, `SubscriptionGuard.tsx`, `BillingPage.tsx`, `SidebarPaymentView.tsx`, `PaymentsPage.tsx` — 5 seções criadas em `src/locales/pt-BR/billing.json` (`paymentRequiredModal`, `subscriptionGuard`, `billingPage`, `sidebarPaymentView`, `paymentsPage`); `RegisterPaymentPage.tsx` confirmado limpo via grep (zero texto traduzível, página puramente de redirecionamento); EN/ES seguem `{}` até a Fase E.
> - `communications` namespace (já pré-registrado): `CommunicationsHub.tsx` (seção `communicationsHub`) e `HumanInboxPage.tsx` (seção `humanInbox`, a maior do projeto — 3191 linhas, ~200 chaves) criadas em `src/locales/pt-BR/communications.json`.
> - **`HumanInboxPage.tsx`** exigiu múltiplas passadas pelo tamanho/complexidade: `StatusBadge`, `ConversationRow`, `AudioPlayer`, `MessageBubble`, `ChatInput` (memo, composer completo: scripts, modal de variáveis, GIF picker stub, gravação de áudio, preview de mídia, contexto de resposta/edição, abas de modo), `PatientPanel` e a função principal `HumanInboxPage()` (toasts, segmented control de canais, dropdown de estágio Kanban, abas da fila, modais de encaminhar/transferir).
> - **Função module-level sem acesso a hooks** (`slaLabel`): em vez de chamar `useTranslation` fora de um componente, o fallback `'agora'` passou a ser recebido via parâmetro (`nowLabel: string`), fornecido pelo chamador (`ConversationRow`/`HumanInboxPage`, que têm acesso ao hook).
> - **Constantes module-level dependentes de tradução** (`TEMPERATURE_MAP`, `PRIORITY_MAP`): movidas de escopo de módulo para dentro do único componente consumidor (`ConversationRow`), já que precisavam de `t()`.
> - **Shadowing de variável corrigido**: o tick de SLA usava `const t = setInterval(...)` dentro de um `useEffect`, conflitando com o `t` de `useTranslation` no escopo da função `HumanInboxPage()` — renomeado para `interval`.
> - **Chaves compartilhadas entre componentes**: `humanInbox.fallbackNames.*` e `humanInbox.channels.*` (nomes de fallback de visitante/canal Instagram/Messenger/Live Chat) reutilizados em `ConversationRow`, `PatientPanel`, no header do chat e nos modais de encaminhar/transferir, em vez de duplicados; `humanInbox.messageBubble.mediaPlaceholder` (`"[mídia]"`) reutilizado em `MessageBubble`, no contexto de resposta do `ChatInput` e no preview do modal de encaminhar.
> - **Preservação literal de variações de capitalização**: o fallback de texto encaminhado usa duas variantes distintas da mesma palavra — `"[mídia]"` (preview do modal, chave reutilizada `messageBubble.mediaPlaceholder`) e `"[Mídia]"` (texto efetivamente enviado ao destino do encaminhamento, nova chave `humanInbox.main.forwardModal.mediaFallback`) — mantidas como chaves separadas por respeitar o texto original exato, sem "corrigir" a inconsistência de capitalização da fonte.
> - **Pluralização i18next**: `queueWaiting_one`/`queueWaiting_other` (mensagem de fila vazia/aguardando no painel central, com `{{count}}`), no mesmo padrão de `daysLeft_one`/`daysLeft_other` já usado na Fase C.2.
> - **Escopo deliberadamente não tocado — lógica de template, não texto de UI**: o sistema de variáveis dos scripts de venda em `ChatInput.handleSelectScript` (arrays `autoVars`/`reservedNames`, regex de substituição `/\[Nome da Clínica\]/gi` etc., fallbacks `'Nossa Clínica'`/`'Paciente'` usados *dentro* dessa lógica de casamento de padrão) — são dados/lógica de template que casam com conteúdo de scripts autorados pelo tenant, não strings de exibição de UI; análogo ao precedente do `KANBAN_STAGES` (Fase C.6).
> - **Escopo deliberadamente não tocado — dado, não rótulo de UI**: nomes de estágio Kanban usados como valores de comparação (`selectedStage === 'Avaliação'`, `'Perdido'`, `'Vendido/Procedimento'`) — mesmos valores reais da coluna `kanban_stage`, consistente com o precedente da Fase C.6.
> - **Escopo deliberadamente não tocado — `MasterBilling.tsx`**: adiado para a Fase C.9 (Master/admin), fora do escopo desta passada.
> - Código comentado/morto (bloco `QUICK_REPLIES` e `handleUpdateStage` comentados, comentários de código) deixado intacto — não é texto de UI ativo.
> - `console.error`/`console.warn` deixados intactos — texto voltado a desenvolvedores, não a usuários.
> - Validado: `tsc --noEmit` (131 linhas — idêntico ao baseline, zero regressão); `eslint` nos 8 arquivos tocados (79 problemas/65 erros/14 warnings — idêntico ao baseline em contagem total; duas mensagens de warning mudaram de texto, de `missing dependency: 'showToast'`/`'showConfirm'` para `missing dependency: 'showToast' and 't'`/`'showConfirm' and 't'`, sem aumento na contagem); `npm run build` concluído sem erros (apenas o warning pré-existente de chunk >500kB).
- [x] **C.9** Master/admin (menor prioridade — uso interno)

> **Notas de implementação (C.9):**
> - Novo namespace `master` registrado em `src/lib/i18n/index.ts` (`NAMESPACES`) e criados os 3 catálogos (`src/locales/{pt-BR,en,es}/master.json`); EN/ES seguem `{}` até a Fase E.
> - 10 arquivos migrados: `MasterProtectedRoute.tsx` (confirmado limpo via leitura — apenas lógica de guard de rota, zero texto traduzível), `MasterAdminLayout.tsx`, `MasterApp.tsx`, `MasterDashboard.tsx`, `MasterTenants.tsx`, `MasterBilling.tsx` (item previamente adiado da Fase C.8), `MasterWhatsApp.tsx`, `MasterIntelligence.tsx`, `MasterLogs.tsx`, `MasterTenantWidgetConfig.tsx` — 9 seções criadas em `master.json` (`adminLayout`, `app`, `dashboard`, `tenants`, `billing`, `whatsapp`, `intelligence`, `logs`, `widgetConfig`).
> - **Duas camadas de "Master" coexistem no código**: `MasterAdminLayout.tsx` (sidebar com 5 itens de nav) e `MasterApp.tsx` (shell de rotas com 6 itens de nav, é o efetivamente montado em `/master/*`) têm menus de navegação distintos e independentes — ambos migrados separadamente, sem assumir que um substituiu o outro.
> - **Shadowing de `t` corrigido em múltiplos pontos** (mesmo padrão da Fase C.8): parâmetros de callback nomeados `t` que colidiam com o `t` de `useTranslation` foram renomeados para `tenant`/`tx` — em `MasterTenants.tsx` (`getStatusBadge`, `tenants.filter`), `MasterBilling.tsx` (`tenants.forEach`, `transactions.forEach`, `tenants.map`) e `MasterWhatsApp.tsx` (`data.map`, `tenantsWithoutZapi.map`).
> - **Constantes module-level dependentes de tradução movidas para dentro do componente** (mesmo padrão `TEMPERATURE_MAP`/`PRIORITY_MAP` da Fase C.8): `navItems` em `MasterAdminLayout.tsx` e `MasterApp.tsx`, `statusConfig` em `MasterBilling.tsx`, `typeConfig`/`HEALTH` em `MasterLogs.tsx`.
> - **Escopo deliberadamente não tocado — dados mock/demo**: o array `MOCK_LOGS` em `MasterLogs.tsx` (mensagens de log, nomes de usuário/tenant fictícios como "Dr. Nômade", "Clínica Downtown") deixado intacto — é dataset de demonstração, não texto estrutural de UI, mesmo precedente de nomes de marca/dados mock estabelecido na Fase C.7.
> - **Escopo deliberadamente não tocado — identificadores técnicos e nomes de modelo/marca**: `config.key`/`config.description` em `MasterIntelligence.tsx` (vêm da tabela `master_config` no banco — dados, não strings de código); nomes de provedores/modelos de IA ("Google Gemini", "OpenAI ChatGPT", "GPT-4o", "Gemini 1.5 Flash" etc.) e nomes de serviços de infraestrutura ("Supabase (PostgreSQL)", "Z-API Gateway", "Edge Functions") em `MasterLogs.tsx`/`MasterIntelligence.tsx`.
> - **Texto livre editável traduzido apesar de ser também valor-padrão de dado** (precedente da Fase C.7, "Café da Manhã"/"Almoço"): o fallback `fab_label: 'Agendar'` em `MasterTenantWidgetConfig.tsx` (usado no estado inicial, no fallback de `fetchData` e como `placeholder`) foi migrado para uma única chave `widgetConfig.defaults.fabLabel`, pois é rótulo de botão livremente editável pelo admin, sem restrição de enum/coluna.
> - **Caminho de rota virtual deixado intacto**: `success_virtual_path` (`'/agendamento-confirmado'`) em `MasterTenantWidgetConfig.tsx` não foi traduzido — é um path/slug usado para tracking de URL (`pushState`), não texto de exibição.
> - Validado: `tsc --noEmit` (131 linhas — idêntico ao baseline, zero regressão); `eslint` nos 10 arquivos tocados (32 problemas/29 erros/3 warnings — idêntico ao baseline, zero regressão); `npm run build` concluído sem erros, novo chunk `master-*.js` gerado corretamente (apenas o warning pré-existente de chunk >500kB).
- [x] **C.10** Varredura final: garantir 0 strings PT hardcoded nas telas voltadas ao cliente/paciente

> **Notas de implementação (C.10):**
> - **Escopo: "full sweep" expandido em duas etapas.** A fase começou com uma lista de ~35 arquivos previamente identificados como não migrados (grupos `communications`, `automations`, `flowBuilder`) e, ao final dessa lista, uma varredura por acentuação PT (`grep [áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]`) em `src/pages` revelou **11 páginas inteiras nunca antes inventariadas** (`Settings.tsx`, `admin/Professionals.tsx`, `BillingPage.tsx`, `RegisterPaymentPage.tsx`, `LinkRedirectPage.tsx`, `PagarmeCallback.tsx` e os 5 arquivos `master/*` ligados à feature recente de monitoramento de saldo Telnyx). Confirmado com o usuário (decisão explícita) que o escopo de C.10 deveria absorver esses arquivos também, em vez de adiá-los para uma fase futura — "full sweep" significou migrar **tudo que fosse encontrado**, não apenas a lista original.
> - **Grupo `communications` (10 arquivos)**: `PendingOrdersList.tsx`, `IncomingCallNotification.tsx`, `ActiveCallView.tsx`, `SoftphoneWidget.tsx`, `FloatingCommunicationsButton.tsx`, `ChannelPreferenceSelector.tsx`, `ScriptManagerDrawer.tsx` e `BuyNumberModal.tsx` (1557 linhas — o maior arquivo único de toda a campanha de i18n) migrados para `communications.json`, que cresceu de 3 para 13 seções de topo.
> - **Grupo `automations` (5 arquivos)**: `JornadaPaciente.tsx`, `FunilCaptacao.tsx` (incl. sub-componente `FunnelColumn`, que precisou do próprio `useTranslation` por ser função separada no mesmo arquivo), `PatientStageCard.tsx` (exigiu nova seção `patientStageCard.stages.*` em `automations.json`, espelhando os labels já existentes em `funilCaptacao.columns.*`), `DesempenhoAutomacoes.tsx` e `FilaAutomacoes.tsx` (~45 strings, incl. correção de shadowing de `t` no toggle de tipo de titular).
> - **Componentes compartilhados de endereço/intl/sessão (6 arquivos)**: `CountryFieldSelector.tsx`, `IntlDocInput.tsx`, `IntlPhoneInput.tsx`, `SmartAddressInput.tsx` (placeholder default precisou ser movido de valor-padrão de prop, calculado fora de hook, para dentro do corpo do componente, já que `t()` exige o hook React), `TenantAddressForm.tsx` e `SessionKickedModal.tsx` (namespace `auth`, nova seção `sessionKickedModal`) — todos migrados para o namespace `common` (novas seções `countryFieldSelector`, `intlDocInput`, `intlPhoneInput`, `smartAddressInput`, `tenantAddressForm`).
> - **Páginas novas descobertas na varredura — migradas via 3 subagentes em paralelo** (dado o volume: `Settings.tsx` 2169 linhas, `admin/Professionals.tsx` 1408 linhas, `master/*` ~2000 linhas combinadas): cada subagente recebeu o catálogo já existente (a maior parte de `settings.json`/`tenantAdmin.json`/`master.json` já estava populada por uma passada anterior, mas os componentes nunca tinham sido conectados via `useTranslation`/`t()`). Resultado: `Settings.tsx` só precisou de uma seção nova (`wallet.*`, ~20 chaves, painel de carteira/créditos de comunicação não cobertos antes); `admin/Professionals.tsx` não precisou de nenhuma chave nova (catálogo já cobria tudo, só faltava a fiação); `master/*` só precisou de uma seção nova (`billing.masterAccount.*`, ~21 chaves, o banner de status da conta-mestre Telnyx adicionado nos commits recentes "monitoramento de saldo central da telnyx").
> - **`BillingPage.tsx`, `RegisterPaymentPage.tsx`**: confirmados já 100% migrados/sem texto próprio (apenas comentários restantes na varredura por acentuação) — nenhuma alteração necessária.
> - **`LinkRedirectPage.tsx`** (página pública de redirecionamento de link curto) e **`PagarmeCallback.tsx`** (callback OAuth do Pagar.me): migrados manualmente — novas seções `common.linkRedirectPage.*` e `billing.pagarmeCallback.*`.
> - **Varredura estendida a `src/hooks` e `src/contexts`** (não apenas componentes/páginas), já que strings de fallback usadas em dados retornados por hooks também aparecem na tela: `usePatientTimeline.ts` (fallbacks de timeline médica — "Evolução Clínica", "Resultado de Laboratório", "Anexo", "Prescrição", contagem de medicamentos — nova seção `medical.patientTimeline.*`) e `useAutomacaoMetrics.ts` (`formatTemplateName`, função module-level sem acesso a hook — recebe `t` por parâmetro do hook chamador, padrão já estabelecido na Fase C.8 para `slaLabel`; nova seção `automations.desempenhoAutomacoes.templateNames.*`).
> - **Dois pequenos fallbacks de UI encontrados fora dos arquivos-alvo originais, migrados como achado da varredura**: `admin/Services.tsx` (`'Sem nome'`/`'Especialidade não definida'` → `tenantAdmin.services.noNameFallback`/`noSpecialtyFallback`) e `Dashboard.tsx` (`'Clínica'` como fallback de nome de clínica no export PDF → `dashboard.pdfReport.clinicNameFallback`).
> - **Arquivos confirmados fora de escopo — código morto/não referenciado**: `WebhookSimulator.tsx` e `P02_AgendaMestra_Raw.html` não são importados por nenhum outro arquivo do projeto (confirmado via grep) — não são alcançáveis pela UI em produção, mesmo critério de exclusão de "não visível ao usuário". `useTelnyxWebRTC.ts` tem uma string de erro (`setError(...)`) que também nunca é lida pelos dois consumidores (`SoftphoneWidget.tsx`/`FloatingCommunicationsButton.tsx`, que só usam `status`, não a mensagem) — mesmo critério, deixado intacto.
> - **Reforço de precedentes já estabelecidos em fases anteriores**: dados mock/seed (`MOCK_LOGS` em `MasterLogs.tsx`, exemplos "CRM/CRO 123.456"/"Brasília - DF" em template de impressão de receita) deixados intactos; valores-padrão de mensagens de automação editáveis pelo tenant (`reminder_captions` em `Intelligence.tsx`) tratados como dado, não UI; tokens literais de template de script (`[Nome da Clínica]`, `[Nome Paciente]` em `HumanInboxPage.tsx`) tratados como lógica de casamento de padrão, não texto de exibição — mas os fallbacks de exibição reais (`patientName`/`effectiveClinicName`) que usam texto idêntico a chaves **já existentes** em `humanInbox.fallbackNames.*` foram conectados via `t()`.
> - **Validação final**: `npx tsc --noEmit` limpo (0 erros) após cada lote de edições e na consolidação final; todos os 17 catálogos `src/locales/pt-BR/*.json` parseiam corretamente (`node -e "require(...)"`); `npm run build` concluído com sucesso (apenas os 2 warnings pré-existentes — chunk >500kB e ordem do `@import` de fonte no CSS — sem relação com esta migração).
> - **EN/ES permanecem vazios** (`{}`) em todos os namespaces tocados nesta fase — confirma o padrão já estabelecido: o app funciona via `fallbackLng: 'pt-BR'`; a tradução para EN/ES é a Fase E, ainda não iniciada.

## FASE D — Seletores de idioma + persistência

- [x] **D.1** SQL: adicionar `preferred_locale` em `profiles` (confirmado como tabela real de identidade — `members` é só vínculo tenant↔user) e `patients` — executado com sucesso (2026-06-18)
- [x] **D.2** Tipar `preferred_locale` nas interfaces (`UserProfile`, `Patient`) e no `TenantContext`
- [x] **D.3** Seletor de idioma em **Configurações da plataforma** (equipe) — grava no perfil + aplica em runtime
- [x] **D.4** Seletor de idioma **dentro do app do paciente** (Portal/Sala de Espera) — default do país da clínica, paciente sobrescreve, persiste
- [x] **D.5** Resolução de idioma no boot (sem flash): aplicar antes do primeiro render (detector + `<html lang>`)
- [x] **D.6** Garantir que troca de idioma **não recarrega a página** (react-i18next runtime)

> **Notas de implementação (Fase D):**
> - **D.2**: `preferred_locale?: string | null` adicionado a `UserProfile` (`src/contexts/TenantContext.tsx`, incluído na query `select('id, full_name, email, avatar_url, role, preferred_locale')`) e a `Patient` (`src/types/patient.ts`).
> - **Hook central redesenhado**: `useApplyDefaultLanguageFromCountry` (criado na Fase A, nunca chamado em produção — gap identificado nesta fase) foi substituído por `useApplyDefaultLanguage({ userPreferredLocale, tenantCountry })` em `src/hooks/useLang.ts`, que materializa a cadeia de prioridade documentada na Fase A (`localStorage > user.preferred_locale > tenant.locale/country`). Ambos os parâmetros são independentemente opcionais — cada chamador passa o que tiver disponível.
> - **D.3 — equipe**: `src/pages/Settings.tsx`, aba "Meu Perfil" — novo campo "Idioma da Plataforma" ao lado de Cargo/Especialidade/CRM. `onChange` chama `setLanguage()` (`useLang`, aplica em runtime + localStorage imediatamente) e persiste em paralelo via `supabase.from('profiles').update({ preferred_locale })`, com toast de sucesso/erro — **não** depende do botão genérico "Salvar Alterações" (grava na hora, como um seletor de idioma deve se comportar). `useApplyDefaultLanguage` é chamado dentro do próprio `TenantProvider` (sempre montado, tem `tenant`/`userProfile` prontos), cobrindo toda a área autenticada da equipe sem precisar repetir a chamada em cada página.
> - **D.4 — paciente**: `src/pages/portal/PortalProfile.tsx` ganhou a mesma UX (seletor + persistência imediata em `patients.preferred_locale`, toast de sucesso/erro) — primeira capacidade de "escrita" adicionada a essa página, que antes era somente leitura. `useApplyDefaultLanguage` chamado em `PatientPortalLayout.tsx` (cobre Dashboard/Book/Profile do portal autenticado) e em `PreCheckin.tsx` (cobre o fluxo de check-in via link mágico, usando apenas `patient.preferred_locale` — sem fallback de país, já que essa página não busca o `tenant` completo).
> - **Escopo deliberadamente não estendido a `WaitingRoom.tsx`**: página pública via link mágico que não busca o objeto `patient` nem `tenant` completos (só IDs para a fila em tempo real) — buscar dados extras só para resolver idioma não se justificava para um link efêmero de uso único; a resolução por `localStorage`/`navigator` do detector de boot já cobre o caso. Documentado aqui em vez de silenciosamente pulado.
> - **D.5**: `useSyncHtmlLang()` (novo, em `useLang.ts`) sincroniza `document.documentElement.lang` com o idioma ativo a cada troca; chamado uma única vez em `AppRoutes()` (`src/App.tsx`), cobrindo toda rota pública ou autenticada. `dir="ltr"` permanece implícito — nenhum dos 3 idiomas (pt-BR/en/es) é RTL, então a Fase F.3 ("`<html lang>` e `dir` coerentes") já fica resolvida por esta entrega.
> - **D.6**: confirmado por construção — `useLang().setLanguage()` chama apenas `i18n.changeLanguage()` (já usado desde a Fase A.6) e `localStorage.setItem`; nenhuma chamada a `window.location.reload()` em todo o caminho de troca de idioma. A troca real em navegador (sem flash, sem reload) ainda depende da QA manual da Fase G.2.
> - **Achado incidental corrigido**: `src/App.tsx` (`TenantApp`, tela de polling pós-checkout Stripe) tinha 2 strings PT hardcoded ("Confirmando pagamento...", "Estamos recebendo a confirmação do Stripe...") que escaparam de todas as fases C.x anteriores por estarem fora de qualquer arquivo de página/componente nomeado nas fases — migradas para `billing.paymentPolling.*` ao tocar o arquivo nesta fase.
> - Validado: `npx tsc --noEmit` (0 erros); `npm run build` concluído com sucesso (apenas os 2 warnings pré-existentes, sem relação com esta fase); catálogos `settings.json`/`billing.json`/`portal.json`/`common.json` parseiam corretamente.
> - **Pendência de infraestrutura — política RLS de `patients`**: nenhum código existente fazia self-update da própria linha em `patients` antes desta fase (toda escrita em `patients` era pelo lado da equipe/staff). O `UPDATE` adicionado em `PortalProfile.tsx` pode falhar silenciosamente se não houver uma policy RLS permitindo que o paciente autenticado atualize sua própria linha. Script de verificação/criação idempotente abaixo — **executar no SQL Editor do Supabase**:
> ```sql
> -- Verificar se já existe uma policy de UPDATE para o paciente sobre a própria linha
> select polname, polcmd from pg_policy
> where polrelid = 'public.patients'::regclass and polcmd = 'w';
>
> -- Se não houver nenhuma cobrindo auth.uid() = user_id, criar (idempotente: remove antes de recriar)
> drop policy if exists "patients_update_own_row" on public.patients;
> create policy "patients_update_own_row"
>   on public.patients
>   for update
>   using (auth.uid() = user_id)
>   with check (auth.uid() = user_id);
> ```

## FASE E — Tradução (PT → EN/ES)

- [x] **E.1** Congelar catálogo fonte `pt-BR/*.json` (após Fase C estabilizar)
- [x] **E.2** Pré-tradução automática EN e ES (IA/DeepL) preservando placeholders `{{var}}` e ICU
- [x] **E.3** Revisão de **termos clínicos/odonto/nutrição** (glossário PT↔EN↔ES) para evitar erros sensíveis — **testado manualmente pelo usuário, aprovado** (2026-06-23). Lista de termos revisados abaixo, mantida como referência.
- [x] **E.4** Revisão de UX/curtos (botões, labels) — evitar overflow por strings longas — **testado manualmente pelo usuário, aprovado** (2026-06-23).
- [x] **E.5** Lint de paridade: toda chave existe nos 3 idiomas (script ad-hoc — `i18next-parser` formal não configurado)

> **Notas de implementação (E.1/E.2/E.5):**
> - **Escala**: 17 namespaces × 2 idiomas = 34 arquivos, ~3.460 chaves-folha traduzidas (medical.json e communications.json são os maiores, com 426 e 481 chaves respectivamente).
> - **Execução paralela via 5 subagentes em background**, cada um traduzindo um lote balanceado de namespaces (pt-BR → en + es simultaneamente), para caber a tradução completa em uma única passada sem sequenciar 17 traduções uma a uma:
>   - Lote A: `medical`, `automations`, `auth`, `flowBuilder`
>   - Lote B: `communications`, `agenda`, `patient`, `common`
>   - Lote C: `tenantAdmin`, `billing`, `portal`
>   - Lote D: `master`, `landing`, `crm`
>   - Lote E: `legal`, `settings`, `dashboard`
> - **E.5 — script de paridade de chaves** (`check-parity.cjs`, descartável, criado e removido nesta sessão): compara recursivamente o conjunto de chaves-folha de cada arquivo `pt-BR/*.json` contra `en/*.json` e `es/*.json`. Resultado: **paridade total nos 17 namespaces** — nenhuma chave faltante ou extra em nenhum idioma.
> - **Bug real encontrado e corrigido — preço fabricado em `landing.json`**: o subagente do Lote D, ao traduzir a copy de marketing da landing page, **inventou preços em USD** (R$197→$39, R$397→$79, R$897→$179) sem qualquer base real — o sistema de cobrança real (`src/config/planConfig.ts`) é **exclusivamente BRL** (`currency: 'BRL'`), sem nenhuma tabela de preço em USD. Isso teria exibido valores de assinatura falsos para visitantes em EN/ES, divergindo do que o checkout Stripe real cobra. Corrigido: os preços em `landing.json` (en + es) agora mantêm os valores reais em R$ (197/397/897), traduzindo apenas o texto ao redor ("Plano"→"Plan", "mês"→"month"/"mes"). Validado que nenhum outro arquivo tinha o mesmo problema (os únicos outros valores em `$` encontrados, em `master.json`, já existiam idênticos no pt-BR original — um limite real de saldo Telnyx em USD e um valor de referência de MRR em BRL — não foram inventados pela tradução).
> - **Inconsistência real encontrada e corrigida — rótulo "CRM"**: `tenantAdmin.json` (Lote C) manteve corretamente "CRM"/"RQE" como siglas literais (registro profissional brasileiro de médico/especialidade, sem equivalente direto em outros países) tanto em EN quanto ES — mas `settings.json` (Lote E), para o mesmo conceito (`profile.crmLabel`, campo "CRM/Registro" na aba Meu Perfil), traduziu para um genérico "License/Registration Number" / "Número de Cédula/Registro Profesional", divergindo do padrão. Corrigido para `"CRM / License Number"` (EN) e `"CRM / Número de Registro"` (ES), mantendo a sigla "CRM" literal como em `tenantAdmin.json`.
> - **Regra seguida nos 5 lotes**: nomes de marca/produto (Traffio, WhatsApp, Instagram, Facebook Messenger, Z-API, Telnyx, Pagar.me, Stripe, Asaas, Dr. Cash, Meta, Supabase, modelos de IA) mantidos como substantivos próprios em EN/ES; siglas regulatórias/profissionais brasileiras sem equivalente direto mantidas literais (ver lista de revisão E.3 abaixo); `{{variável}}`, sufixos de plural `_one`/`_other` do i18next, arrays (incl. `weekdaysShort` localizado por idioma) e marcação inline (`<strong>`) preservados em todos os arquivos.
> - Validado: `npx tsc --noEmit` (0 erros); `npm run build` concluído com sucesso — cada namespace agora gera 3 variantes de chunk lazy-loaded (pt-BR/en/es), confirmando que o engine de carregamento por idioma+namespace funciona corretamente com os novos catálogos; os 34 arquivos `en/*.json`/`es/*.json` parseiam corretamente.
>
> **Lista de termos para revisão humana (E.3 — pendente, requer julgamento de domínio clínico/jurídico/regulatório que não pode ser totalmente automatizado):**
> | Termo | Onde aparece | Decisão tomada nesta fase | Por que precisa de revisão humana |
> |---|---|---|---|
> | `CRM` / `CRO` | `tenantAdmin.json` (campo real), `medical.json` (texto de exemplo em modelo de impressão), `settings.json` (campo real) | Mantido literal | Registro profissional brasileiro (médico/dentista) sem equivalente direto nos EUA/México — confirmar se o campo deve ficar oculto/opcional para clínicas não-brasileiras |
> | `RQE` | `tenantAdmin.json` | Mantido literal | Registro de Qualificação de Especialista — específico do CFM brasileiro |
> | `ANS` | `settings.json` (`locations.ansLabel`, `insurance.codeLabel`) | Mantido literal | Código de operadora de plano de saúde regulado pela ANS — não existe nos EUA/México; campo é efetivamente Brasil-only |
> | `CPF` / `CNPJ` | `medical.json`, `communications.json`, `crm.json`, `portal.json`, `legal.json` | Mantido literal (com glosa em `legal.json`) | Identificador fiscal brasileiro sem equivalente direto (SSN/CURP não são equivalentes) |
> | `LGPD` | `legal.json` | Mantido literal, com glosa parentética no primeiro uso ("Brazil's General Data Protection Law" / "Ley General de Protección de Datos de Brasil") | Lei brasileira específica citada na Política de Privacidade — qualquer alteração de escopo precisa de revisão jurídica, não só linguística |
> | Foro/jurisdição em `termsOfService.termsChangesAndJurisdiction` | `legal.json` | Traduzido mantendo a jurisdição real (República Federativa do Brasil) | Cláusula legal de foro — não deve ser alterada sem revisão de um advogado |
> | `slotBadge.prime`/`legendPrime` ("Nobre") | `agenda.json` | Traduzido como "Prime" (EN) / "Premium" (ES) | Escolha de terminologia de produto — confirmar se corresponde à convenção de nomenclatura de planos/tiers usada no resto do app |
> | `newMedicalRecordModal.errors.noSession`/`.noClinic` | `medical.json` | Mantidos idênticos nos 3 idiomas (já estavam em inglês na fonte pt-BR original — provável lacuna de uma fase anterior) | Não é problema desta fase, mas a fonte pt-BR tem 2 strings em inglês que deveriam estar em português — considerar corrigir na fonte numa fase futura |
> | `neighborhood` (campo de endereço) | `medical.json` (ES) | Traduzido como "Colonia" (termo neutro para México) em vez de "Barrio" | Confirmar se "Colonia" é o termo preferido para o público-alvo real do locale `es` |

## FASE F — Integração com o Pilar 1 (formatação)

- [x] **F.1** Fonte única de locale para nomes de mês/dia: novo helper `getIntlLocale(language)` em `src/lib/i18n/index.ts` (mapa `'pt-BR'→'pt-BR'`, `en→'en-US'`, `es→'es-MX'`) e `getDateFnsLocale(language)` em `src/lib/i18n/dateFnsLocale.ts` (mesmo mapa para objetos de locale do date-fns) — usados em todos os pontos que precisam do **idioma da UI** para texto por extenso, distintos do `locale` do tenant (Pilar 1, digit-order/separadores), que continua intocado.
- [x] **F.2** Política de **nomes de mês/dia por extenso = idioma da UI**, implementada nos 6 pontos que ainda usavam `'pt-BR'`/locale do tenant hardcoded para texto por extenso: `MedicalRecordsHub.tsx` (data da prescrição), `ReceptionDashboard.tsx` (cabeçalho "hoje é..."), `PortalBook.tsx` (confirmação de agendamento do paciente), `QuickBookingModal.tsx` (seleção de dia, step 3), `SidebarCalendar.tsx` (nome do mês na navegação do calendário, date-fns) e `AgendaMestra.tsx` (label "Hoje"/data com dia da semana abreviado). Também corrigido `useLocaleFormat().formatWeekday()` (`src/hooks/useLocaleFormat.ts`) — função já existia desde a Fase A com o comentário "follows the UI language (Pilar 2)" em `formatDateTime.ts`, mas estava de fato recebendo o `locale` do tenant (Pilar 1), nunca o idioma da UI; **dead code nunca consumido em produção** (confirmado via grep, mesma classe de gap do `useApplyDefaultLanguageFromCountry` encontrado na Fase D) — corrigido para receber `getIntlLocale(i18n.language)` internamente, agora correto para quando for consumida.
- [x] **F.3** `<html lang>` e `dir` coerentes com o idioma ativo — já resolvido na Fase D.5 (`useSyncHtmlLang()`); `dir="ltr"` permanece implícito pois nenhum dos 3 idiomas (pt-BR/en/es) é RTL.

> **Nota de design**: `language` (idioma da UI) e `locale`/`country` (formato dos dados, Pilar 1) seguem **eixos independentes**, por decisão já documentada na arquitetura proposta — esta fase só conecta os dois onde o texto exibido é uma **palavra** (nome do mês/dia), nunca a ordem dos dígitos (`dd/MM/yyyy` vs `MM/dd/yyyy`), que continua 100% determinada pelo país/locale do tenant em todos os formatadores (`formatDate`/`formatTime`/`formatDateTime`/`formatSlot`).
> Validado: `tsc --noEmit` e `npm run build` limpos.

## FASE G — QA & Validação

- [x] **G.1** `npm run build` ok (build limpo, único warning pré-existente de chunk size). `npm run lint`: 723 problemas pré-existentes em todo o repo (`no-explicit-any`, `react-hooks/exhaustive-deps`, etc.) — **nenhum novo** introduzido pelo trabalho de i18n (verificado arquivo por arquivo nos ~24 arquivos tocados nesta fase).
- [x] **G.2** Verificado via Playwright headless contra landing page pública: `<html lang>` muda corretamente pt-BR→en→es; nenhuma chave crua (`settings.title` etc.) apareceu no texto renderizado (único falso-positivo do regex de varredura foi a marca "Pagar.me", que é proposital). Console sem erros em nenhum dos 3 idiomas.
- [x] **(Pricing fix confirmado)** Landing EN/ES mostram R$197/R$397/R$897 reais (não mais USD fabricado).
- [x] **G.2b** Seletor de idioma autenticado em **Configurações → Meu Perfil** (troca instantânea sem reload) — **testado manualmente pelo usuário, confirmado funcionando** (2026-06-23). Os 2 bugs reais encontrados durante esse teste (Sales Funnel/Kanban e ScriptEditorForm, ambos abaixo) já foram corrigidos.
- [x] **G.3** App do paciente: paciente troca idioma, persiste entre sessões, independente da clínica — **testado manualmente pelo usuário, confirmado funcionando** (2026-06-23).
- [x] **G.4** Fallback: chave faltante em EN/ES cai para PT sem quebrar — coberto pela paridade 100% confirmada na Fase E (não há chave real faltante para forçar o caso) + nenhuma chave crua observada durante os testes manuais do usuário.
- [x] **G.5** Paridade de chaves nos 3 catálogos — confirmada na Fase E via `check-parity.cjs` (script descartável), 100% paridade nos 17 namespaces (~3.460 chaves).
- [x] **G.6** Sem flash de idioma errado no primeiro carregamento — confirmado via Playwright: `<html lang>` já correto no primeiro paint da landing page (pt-BR por padrão, sem localStorage).

> **Bug real encontrado via teste manual do usuário (pós-Fase G) — corrigido:** o card "Sales Funnel" (`src/components/followup/PerformanceStats.tsx`, dentro de Follow-up/CRM) exibia os rótulos do funil (`Novos Leads`, `Em Contato`, `Avaliação`, `Consulta`, `Vendido/Procedimento`) sempre em PT, independente do idioma ativo. Este era exatamente o item **deliberadamente deferido na Fase C.6** ("textos derivados de `KANBAN_STAGES`... registrado aqui como melhoria futura") — agora resolvido. Solução: novo mapa `STAGE_LABEL_KEYS` em `src/lib/kanbanStages.ts` (associa cada valor real de `kanban_stage`, ex. `'Novos Leads'`, a uma chave de tradução, ex. `novosLeads` — **o valor do banco continua intocado**, é só uma camada de exibição) + nova seção `crm.json` → `kanbanStages.*` (9 chaves, PT/EN/ES). Corrigidos os 3 pontos de exibição que usavam o valor raw diretamente: `PerformanceStats.tsx` (gráfico de funil — `translatedFunnelData` mapeia `stage` antes de passar ao `recharts`, preservando `metrics.funnelData` original), `FollowUpBoard.tsx` (cabeçalho de cada coluna do Kanban) e `SidebarLeadClassifyView.tsx` (dropdown "Estágio do Funil" — mesmo problema, mesma correção, encontrado na mesma varredura). Validado: `tsc --noEmit` e `npm run build` limpos.
>
> **Bug real encontrado via teste manual do usuário (pós-Fase G) — corrigido:** `src/components/ScriptEditorForm.tsx` (formulário "Editar/Novo Script" usado dentro de `ScriptManagerDrawer.tsx`, página Atendimento) tinha **todos os labels/placeholders/botões hardcoded em PT**, apesar de já importar `useTranslation('communications')` e usar `t()` apenas nos toasts. O catálogo `communications.json` (`scriptEditorForm.*`) já tinha 100% das chaves necessárias nos 3 idiomas (header, suggestedBanner, fields, variables, attachments, footer, icons) — provavelmente populado numa passada de tradução anterior sem o componente ter sido conectado. Esse é o motivo pelo qual a varredura por acentuação PT da Fase C.10 não pegou o arquivo: ele só tinha 1 string PT residual fora do form (`reservedNames` de matching de variável, dado/lógica, não UI — deixado intacto pelo mesmo precedente do `ChatInput.handleSelectScript`). Corrigido: todos os labels/placeholders/textos de botão agora usam `t('scriptEditorForm.*')`. **Bug colateral também corrigido**: o seletor de ícone renderizava `{i.char} {i.name}` mas o objeto só tinha `char`/`nameKey` (sem `name`) — todo option aparecia sem nome (`💬 ` em branco, visível no screenshot do usuário); agora usa `t(\`scriptEditorForm.${i.nameKey}\`)` corretamente. Validado: `tsc --noEmit` e `npm run build` limpos.

> **Bug real encontrado via teste manual do usuário (pós-Fase G) — corrigido:** na página **Comunicações**, o histórico de chamadas/SMS/voicemail (`src/pages/CommunicationsHub.tsx`) exibia data/hora **sempre em `pt-BR`** (ex.: "21 de jun."), independente do idioma ativo — a função `fmtTime()` chamava `d.toLocaleDateString('pt-BR', ...)`/`toLocaleTimeString('pt-BR', ...)` com a string `'pt-BR'` **hardcoded como Intl locale**, ignorando completamente o idioma da UI. Mesma causa raiz no gráfico "Últimos 7 dias" do Dashboard interno (`format(day, 'EEE', { locale: ptBR })`, date-fns também hardcoded). Diferente do caso do Kanban/Sales Funnel (onde o valor é dado real de banco), aqui é puramente uma string de exibição de data — sem risco de identidade de dado. Corrigido: novos mapas `INTL_LOCALE`/`DATE_FNS_LOCALE` (`'pt-BR'→'pt-BR'`, `en→'en-US'`/`enUS`, `es→'es-MX'`/`es`, mesma convenção já usada no registro de países do Pilar 1) escolhidos dinamicamente via `i18n.language`; `fmtTime()` passou a receber `language` como parâmetro (função module-level sem acesso a hook, mesmo padrão já estabelecido para `slaLabel`/`formatTemplateName` nas Fases C.8/C.10) — todos os 8 pontos de chamada em `CommunicationsHub()` atualizados para passar `i18n.language`. Validado: `tsc --noEmit` e `npm run build` limpos.
>
> **Bug real encontrado via teste manual do usuário (pós-Fase G) — corrigido:** na página **Assinaturas** (`src/pages/BillingPage.tsx`), os 3 cards de plano (Essencial/Clínica/Rede) exibiam nome, descrição e a lista de recursos **sempre em PT**, mesmo com badge/botões ("Your Plan", "Current plan", "Upgrade", "Talk to sales") já traduzidos — porque esses textos vêm de `src/config/planConfig.ts` (`PLANS[id].name`/`.description`/`.highlightFeatures`), um **módulo de configuração estático sem acesso a `t()`**, nunca conectado ao catálogo de tradução. O mesmo padrão de bug existia também na landing page pública (`LandingPage.tsx`, seção de preços + tabela comparativa) e no modal pós-cadastro (`PaymentRequiredModal.tsx`) e na tela de registro (`RegisterPage.tsx`), todos consumindo os mesmos campos crus de `PLANS`. Corrigido: nova seção `billing.json` → `plans.<essencial|clinica|rede>.{name,description,features}` (PT/EN/ES) — os campos originais em `planConfig.ts` (`name`/`description`/`highlightFeatures`) foram mantidos intactos como dado (são a fonte de verdade para o `id` do plano e não têm outro consumidor que dependa do texto cru), e os 4 componentes passaram a ler via `t(\`plans.${id}.name\`)`/`.description`/`t(..., { returnObjects: true })` para a lista de features. `LandingPage.tsx` e `RegisterPage.tsx` (namespaces `landing`/`auth`, diferentes de `billing`) precisaram declarar `useTranslation(['landing','billing'])`/`['auth','billing']` para garantir o carregamento do namespace cruzado antes da renderização (Suspense), com `{ ns: 'billing' }` explícito em cada chamada `t()` cruzada. **Bugs colaterais da mesma classe também corrigidos**: `BillingPage.tsx` e `PaymentRequiredModal.tsx` tinham `toLocaleDateString('pt-BR')` hardcoded (datas de renovação/trial) — mesma causa raiz do bug de Comunicações acima; extraído o mapa de locale para um helper compartilhado `getIntlLocale()` em `src/lib/i18n/index.ts` (reaproveitado também em `CommunicationsHub.tsx`, substituindo o mapa local duplicado). Validado: `tsc --noEmit` e `npm run build` limpos.
>
> ✅ **Fase G oficialmente concluída em 2026-06-23** — todos os itens G.1–G.6 verificados (parte via Playwright/build/lint automatizados, parte via teste manual do usuário logado em Configurações e no portal do paciente). 4 bugs reais encontrados durante o teste manual (rótulos do Kanban/Sales Funnel, formulário de Editar Script, data/hora hardcoded em pt-BR no histórico de Comunicações, e cards de plano hardcoded em pt-BR em Assinaturas/Landing/Cadastro) foram corrigidos e validados (`tsc`/`build` limpos).

---

## 🗄️ SQL — Preferência de idioma (idempotente)

```sql
-- =============================================================================
-- TRAFFIO — Preferência de idioma por usuário e por paciente
-- Idempotente. tenants.locale JÁ existe (idioma padrão da clínica).
-- =============================================================================

-- Idioma preferido da equipe (perfil do usuário no tenant)
-- Ajustar o nome da tabela conforme o schema real (profiles | users | tenant_users)
alter table public.profiles
  add column if not exists preferred_locale text;   -- 'pt-BR' | 'en' | 'es' (null = herda do tenant)

-- Idioma preferido do paciente (app do paciente)
alter table public.patients
  add column if not exists preferred_locale text;   -- null = herda do país da clínica

-- (Opcional) índice se houver consulta por idioma em campanhas
-- create index if not exists idx_patients_preferred_locale on public.patients(tenant_id, preferred_locale);
```

> ⚠️ Antes de rodar, confirme o nome real da tabela de perfis de usuário com o **Script de Verificação**
> do [TASKLIST-I18N-FIELDS.md](TASKLIST-I18N-FIELDS.md) (o schema real diverge dos `.sql` do repo).
> Verificar perfis:
> ```sql
> select table_name from information_schema.tables
> where table_schema='public' and table_name in ('profiles','users','tenant_users','members');
> ```

---

## 🔗 Arquivos impactados (mapa rápido)

**Novos:** `src/lib/i18n/index.ts`, `src/hooks/useLang.ts`, `src/locales/{pt-BR,en,es}/*.json`,
componente `LanguageSelector` (equipe + paciente), config `i18next-parser`

**Editados (infra):** `src/main.tsx`, `src/contexts/TenantContext.tsx`, `src/pages/Settings.tsx`,
app do paciente (`pages/patient/*`, `pages/portal/*`), `src/types/patient.ts`

**Editados (migração de strings):** ~108 arquivos `.tsx` (Fase C, incremental por domínio)

---

## ⚖️ Ordem recomendada entre os dois pilares

1. **Pilar 1 — Fase 0/1** (DB + registry) primeiro: estabelece `country`/`locale` como base.
2. **Pilar 2 — Fase A/B** (motor i18n + catálogos) em paralelo.
3. **Pilar 1 — Fase 6** (data/hora) e **Pilar 2 — Fase C** (migração) podem andar juntas.
4. Selecionadores de idioma/país (Pilar 1 Fase 4 + Pilar 2 Fase D) entregam o recurso visível ao usuário.

---

_Status: ✅ **Pilar 2 (i18n) CONCLUÍDO em 2026-06-23** — todas as fases A–G fechadas: **Fase A** (motor), **Fase B** (namespaces + catálogos), **Fase C completa (C.1–C.10)** (migração de strings), **Fase D completa (D.1–D.6)** (seletores + persistência), **Fase E completa (E.1–E.5)** (tradução EN/ES + revisão humana de termos clínicos/legais + revisão de overflow, ambas aprovadas pelo usuário em 2026-06-23), **Fase F completa (F.1–F.3)** (nomes de mês/dia por extenso seguindo o idioma da UI) e **Fase G completa (G.1–G.6)** (QA automatizado + manual). UI 100% migrada para `t()`, EN/ES traduzidos nos 17 namespaces (~3.460 chaves, paridade total), seletores de idioma funcionando e validados em produção via teste manual do usuário (Configurações, portal do paciente, Atendimento, Comunicações, Follow-up/CRM, Assinaturas, Landing, Cadastro). RLS de `patients` já executada pelo usuário. 4 bugs reais encontrados e corrigidos durante os testes manuais (rótulos do Kanban/Sales Funnel, formulário de Editar Script, data/hora hardcoded em Comunicações, cards de plano hardcoded em Assinaturas/Landing/Cadastro). `npm run build`/`tsc` verdes em todas as validações._
