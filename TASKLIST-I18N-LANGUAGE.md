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
- [ ] **C.9** Master/admin (menor prioridade — uso interno)
- [ ] **C.10** Varredura final: garantir 0 strings PT hardcoded nas telas voltadas ao cliente/paciente

## FASE D — Seletores de idioma + persistência

- [x] **D.1** SQL: adicionar `preferred_locale` em `profiles` (confirmado como tabela real de identidade — `members` é só vínculo tenant↔user) e `patients` — executado com sucesso (2026-06-18)
- [ ] **D.2** Tipar `preferred_locale` nas interfaces (`UserProfile`, `Patient`) e no `TenantContext`
- [ ] **D.3** Seletor de idioma em **Configurações da plataforma** (equipe) — grava no perfil + aplica em runtime
- [ ] **D.4** Seletor de idioma **dentro do app do paciente** (Portal/Sala de Espera) — default do país da clínica, paciente sobrescreve, persiste
- [ ] **D.5** Resolução de idioma no boot (sem flash): aplicar antes do primeiro render (detector + `<html lang>`)
- [ ] **D.6** Garantir que troca de idioma **não recarrega a página** (react-i18next runtime)

## FASE E — Tradução (PT → EN/ES)

- [ ] **E.1** Congelar catálogo fonte `pt-BR/*.json` (após Fase C estabilizar)
- [ ] **E.2** Pré-tradução automática EN e ES (IA/DeepL) preservando placeholders `{{var}}` e ICU
- [ ] **E.3** Revisão de **termos clínicos/odonto/nutrição** (glossário PT↔EN↔ES) para evitar erros sensíveis
- [ ] **E.4** Revisão de UX/curtos (botões, labels) — evitar overflow por strings longas
- [ ] **E.5** Lint de paridade: toda chave existe nos 3 idiomas (`i18next-parser` / script CI)

## FASE F — Integração com o Pilar 1 (formatação)

- [ ] **F.1** Garantir fonte única de locale: idioma escolhido alimenta `formatDateTime`/`Intl` quando aplicável
- [ ] **F.2** Resolver política de **nomes de mês por extenso** (Pilar 1, tarefa 6.7): seguir idioma da UI (decisão alinhada a este pilar)
- [ ] **F.3** `<html lang>` e `dir` coerentes com o idioma ativo

## FASE G — QA & Validação

- [ ] **G.1** `npm run build` + `npm run lint` sem erros
- [ ] **G.2** Trocar idioma na UI (PT→EN→ES) sem reload, sem chaves cruas (`settings.title` aparecendo)
- [ ] **G.3** App do paciente: paciente troca idioma, persiste entre sessões, independente da clínica
- [ ] **G.4** Fallback: chave faltante em EN/ES cai para PT sem quebrar
- [ ] **G.5** Paridade de chaves nos 3 catálogos (script)
- [ ] **G.6** Sem flash de idioma errado no primeiro carregamento

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

_Status: Fase A (motor) e Fase B.1/B.2 (namespaces + catálogos esqueleto) concluídas. SQL de `preferred_locale` executado. `npm run build`/`lint`/`tsc` verdes. Próximo: Fase C (migração de strings, começando por `patient`/`portal`) ou seguir com Pilar 1 Fase 2/3._
