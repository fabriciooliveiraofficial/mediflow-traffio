# Auditoria — Página de Paciente (Prontuário)

**Data:** 04/08/2026
**Escopo:** `PatientDetails.tsx`, `MedicalRecordsHub.tsx` e toda a árvore de componentes/serviços/tabelas que elas consomem.
**Método:** leitura de código + confronto com as migrations do repositório e com os arquivos de i18n. Nenhum código foi executado ou alterado.

---

## 0. Descoberta estrutural: existem DUAS páginas de paciente

Antes dos bugs individuais, o achado que explica boa parte da sensação de "nada funciona":

| | `MedicalRecordsHub` | `PatientDetails` |
|---|---|---|
| Rota | `/dashboard/medical-records` | `/dashboard/patients/:id` |
| Como se chega | menu lateral "Prontuário" | card do CRM Leads / Propostas |
| Abas | Timeline · Detalhes · Receitas · Arquivos | Timeline · Calls · Medical Record · Dental · Exams |
| Timeline lê | `medical_records` direto | hook `usePatientTimeline` (outro modelo) |
| Receitas gravam | `content_json = { content, patient_name, date }` | `content_json = { medications: [...] }` |
| Documentos usam | tabela `patient_documents` + bucket `patient-documents` | tabela `documents` (category `exam_result`) |
| Editor de receita | textarea livre + impressão | modal estruturado por medicamento |

As duas telas **não se conhecem** (nenhuma navega para a outra) e escrevem em formatos mutuamente ilegíveis. O que você cadastra em uma some na outra. Qualquer correção pontual sem resolver isso volta a quebrar.

---

## 1. P0 — Funcionalidade quebrada

### A1. Exames nunca abrem — o arquivo nunca é enviado
`components/UploadDocumentModal.tsx:45-61`

```ts
// 2. Upload file to Storage (MOCK VERSION)
const fileUrl = URL.createObjectURL(file);
... .from('documents').insert([{ file_url: fileUrl, ... }])
```

Grava uma URL `blob:` (válida só naquela aba, naquela sessão) na coluna `file_url`. O arquivo **não sobe para o Storage**. Ao recarregar a página, o link está morto — é exatamente o "cliquei no resultado do exame e não abre".

### A2. A aba EXAMS não mostra os exames do paciente
`pages/PatientDetails.tsx:526` → `<DicomViewer fileUrl="mock" />`

O `fileUrl` é uma string fixa e, pior, `DicomViewer.tsx:82` **ignora a prop** e renderiza sempre a mesma foto do Unsplash, com metadados falsos no overlay (`ID: #DX-99281`, `DATE: 2026-03-23`, `HOSPITAL: TRAFFIO DENTAL HQ`). Os botões de maximizar (`:65`) e navegar entre imagens (`:106`, `:109`) não têm `onClick`. O estado `contrast` existe sem controle na UI. O banco já tem `documents.is_dicom` e `documents.dicom_metadata` (migration `20260323_add_dicom_support.sql`) — nunca usados.

### A3. Prescrições: três formatos incompatíveis no mesmo campo
`prescriptions.content_json` é escrito de três jeitos diferentes:

| Origem | Formato gravado |
|---|---|
| `types/patient.ts:70` (contrato canônico) | `PrescriptionItem[]` — `{ medication, dosage, frequency, duration }` |
| `NewPrescriptionModal.tsx:75` | `{ medications: [{ name, dosage, instructions }] }` |
| `MedicalRecordsHub.tsx:211` | `{ content, patient_name, date }` |

Consequências diretas:
- `ViewPrescriptionModal.tsx:28` lê `.medications` → receita criada no editor do Hub abre **em branco**;
- `MedicalRecordsHub.tsx:982` lê `.content` → receita criada pelo modal aparece na lista como `"..."` e o quick-view abre **vazio**.

É a causa raiz de "cliquei na prescrição que inseri e não abre nada".

### A4. Timeline nunca mostra receitas (e pode zerar inteira)
`hooks/usePatientTimeline.ts:26-32`

```ts
.from('prescriptions').select('*').in('medical_record_id', recordIds)
```

Só busca receitas **ligadas a uma evolução**. Nenhuma das duas telas preenche `medical_record_id` (fica NULL). Resultado: receita nenhuma entra na timeline.

E na linha `:63`: `rx.content_json?.map(m => m.medication)` — `content_json` é objeto, não array. Se alguma receita chegasse até aqui, seria `TypeError`, engolido pelo `catch` da linha `:77`, deixando a **timeline inteira vazia** sem mensagem de erro.

### A5. Timeline não mostra exames
Só entram anexos vindos de `medical_records.attachments_json`, campo que nenhuma tela preenche. Os registros da tabela `documents` (os exames de verdade) ficam fora.

### A6. A aba MEDICAL RECORD é um placeholder
`PatientDetails.tsx:486-493` renderiza apenas um card estático com ícone e o texto "Medical Record History / View all clinical notes as a continuous document". Nunca consulta `medical_records`. É um mock que foi para produção.

### A7. "IA Explain" não abre nada
`TimelineCard.tsx:80` chama `onExplain(event.title)` → `PatientDetails.tsx:555` renderiza `<AIExplainButton term={explainTerm} />`. Mas `AIExplainButton` **é um botão**, não um modal: aparece um botão solto no rodapé da coluna e você tem que achá-lo e clicar de novo. Além disso `explainTerm` nunca volta a `null` — o botão fica preso na tela.

### A8. Aba CALLS — quatro problemas somados
`PatientDetails.tsx:83-89`

1. Seleciona `call_notes`, coluna **ausente** na definição de `call_records` (`20260605_communications_infrastructure.sql:207`). Se não existir no banco real, o PostgREST devolve 400, `data` vem `undefined` e a lista fica **sempre vazia**, silenciosamente.
2. Sem `.eq('tenant_id', ...)`.
3. `.or(from_number.eq.${phone},to_number.eq.${phone})` exige match textual exato. `patients.phone` é gravado com máscara/sem `+`; a Telnyx grava E.164 (`+55...`). Nunca casa.
4. O telefone é interpolado cru no filtro PostgREST — vírgula ou parêntese no valor quebra a query.

### A9. Aba "Arquivos" do Hub aponta para tabela que não existe no repositório
`MedicalRecordsHub.tsx:172, 240, 247, 274, 278, 294, 314` usam a tabela `patient_documents` e o bucket `patient-documents`. **Nenhum dos dois aparece em qualquer migration.** Se de fato não existirem no banco: a listagem falha em silêncio (só `console.error`), e upload/download/delete/preview dão erro. *(item para confirmar — ver Fase 0)*

### A10. Controles mortos (clico e não acontece nada)

| Arquivo:linha | Controle |
|---|---|
| `MedicalRecordsHub.tsx:602` | `ChevronRight` no card da timeline — sem `onClick` |
| `TimelineCard.tsx:70` | Botão "Detalhes" — sem `onClick` |
| `PatientDetails.tsx:755` | Card de orçamento odontológico com `cursor-pointer` — sem `onClick` |
| `PatientDetails.tsx:538` | Botão "Progress" (nutrição) — sem `onClick` |
| `DicomViewer.tsx:65,106,109` | Maximizar, anterior, próximo — sem `onClick` |
| `MedicalRecordsHub.tsx:750` | "Excluir paciente" — `disabled` permanente |
| `MedicalRecordsHub.tsx:756` | "Editar cadastro" → toast "em breve" **com argumentos invertidos**: `showToast(mensagem, 'info')`, mas a assinatura é `showToast(type, message)` (`ToastContext.tsx:18`) |

### A11. Bloco de crédito é simulação
- `PatientDetails.tsx:818`: `initialAmount={2500} // Mock amount or pull from last budget`
- `CheckoutModal.tsx:71`: fluxo de cartão é `await new Promise(r => setTimeout(r, 2000))` e um toast de sucesso — nada acontece de verdade.
- O caminho de financiamento é Dr. Cash (produto brasileiro), exibido para um tenant configurado em inglês.
- Nada disso conversa com o módulo financeiro real (`billing_records` / Stripe Connect) já existente em `PaymentsPage`/`FinancialDashboard`.

### A12. "Voltar para a lista" sempre volta para o lugar errado
`App.tsx:75`: `onBack={() => navigate('/dashboard/leads')}` — fixo. Quem entrou vindo de Propostas (`ProposalsPage.tsx:539`) é jogado no CRM.

---

## 2. P1 — Internacionalização

Os arquivos `en/medical.json`, `pt-BR/medical.json` e `es/medical.json` estão **sincronizados** (429 chaves cada, zero divergência) e nenhuma chave usada no código está faltando. O problema não é o dicionário — é texto que nunca passou por ele.

### B1. `TimelineCard.tsx` não tem i18n nenhum
```
:19  label: 'Consulta'
:25  label: 'Receita'
:31  label: 'Exame'
:71  Detalhes <ChevronRight/>
:83  IA Explain
```
São exatamente as tags em português que aparecem na UI em inglês.

### B2. `event_type` exibido cru
`MedicalRecordsHub.tsx:596` imprime `record.event_type` direto. O valor é gravado em português pelo `<select>` das linhas `:789-792` (`consulta`/`exame`/`procedimento`/`nota`). O rótulo do select é traduzido; o valor salvo, não. Toda evolução criada mostra badge em PT em qualquer idioma.

### B3. Outros valores crus de banco na tela
- `prop.status` (`PatientDetails.tsx:662`) — `PENDING`, `APPROVED`, `SIGNED`
- `budget.status` (`PatientDetails.tsx:758`) — `draft`, `sent`…
- `selectedPatient.gender` (`MedicalRecordsHub.tsx:646`)

### B4. Locale e moeda fixados em pt-BR/BRL, ignorando a infraestrutura existente
Já existem `useLocaleFormat()` (locale/timezone do tenant) e `useTenantMoney()` (moeda operacional). Nenhum dos dois é usado nesta página. Ocorrências:

`PatientDetails.tsx` — `:255`, `:469`, `:600`, `:653` (BRL), `:721`, `:762` (BRL), `:765`
`MedicalRecordsHub.tsx` — `:426`, `:599`, `:797`, `:966`, `:1047`, `:1158`
`TimelineCard.tsx:61` · `NewMedicalRecordModal.tsx:268`
`NewDentalBudgetModal.tsx:194,249,253` — com `R$` escrito literalmente no JSX.

### B5. Strings PT injetadas por serviço
`services/dentalService.ts:133` — `recall_reason: 'Limpeza Semestral'`, `due_date: 'Hoje'`.

### B6. Badge `'New'` hardcoded na navegação
`layouts/DashboardLayout.tsx:257` (e nos itens de odonto/nutrição).

---

## 3. P1 — Design e layout

### C1. Overflow horizontal — causa raiz identificada
`PatientDetails.tsx:399-401`: a coluna de conteúdo é `lg:col-span-2` dentro de um `grid`, **sem `min-w-0`**. Item de grid tem `min-width: auto` por padrão, então ele cresce até caber o conteúdo e empurra a página inteira.

O conteúdo que estoura: `Odontogram.tsx:204-261` põe os 32 dentes em **uma única linha** (`<Tooth>` = SVG 40px + `gap-2` ≈ 48px cada, mais separadores e padding ≈ 1.600px de largura) dentro de uma coluna que tem ~700px. O `overflow-x-auto` interno não segura porque o pai já expandiu. Mesmo efeito com o `DicomViewer` (`h-[600px]` fixo).

### C2. O modal que estoura e não fecha
`MedicalRecordsHub.tsx:914 → 994`: o overlay `fixed inset-0` do quick-view de receita está **dentro** do `<motion.div key="view-prescriptions">`, que o framer-motion anima com `transform`. Um ancestral com `transform` vira bloco de contenção: o `position: fixed` deixa de ser relativo à viewport e passa a ser relativo à coluna rolável. O modal renderiza maior que a área visível, clipado, com o cabeçalho (e o botão de fechar) fora de alcance. É o "elemento ocupando mais de 100% da página e eu não consigo ver como fechar".

### C3. Botão de fechar não parece um botão de fechar
`MedicalRecordsHub.tsx:1019`: um `<Plus size={28} className="rotate-45" />` em `text-graphite-400`, sem `aria-label`, sem borda, sem fundo. Mesmo padrão em `:1221`.

### C4. Folha A4 com aspecto fixo
`MedicalRecordsHub.tsx:1024`: `aspect-[1/1.414]` + `p-16`. Receita mais longa que a altura calculada transborda para fora do "papel", sem scroll próprio.

### C5. `AnimatePresence` envolvendo `<div>` puro
`MedicalRecordsHub.tsx:992-994`: o filho direto não é um `motion.*`, então a animação de saída nunca roda — o modal some com corte seco.

### C6. Alturas em cascata conflitantes
Raiz `h-[calc(100vh-140px)]` + `overflow-hidden` (`:400`) e, dentro dela, a view de receitas com `h-[calc(100vh-280px)]` (`:919`). Os dois cálculos brigam → scroll duplo e conteúdo cortado no rodapé.

### C7. Hub não é responsivo
`:400` `flex` + `:443` `w-80 shrink-0` + `overflow-hidden`, sem nenhum breakpoint. Abaixo de ~900px a lista de pacientes come a tela e o painel de detalhes fica inutilizável.

### C8. `Odontogram.tsx:152` usa `h-full` dentro de um pai sem altura definida — o `flex-1 min-h-[500px]` interno não se comporta como esperado.

### C9. Ações escondidas atrás de hover
`PatientDetails.tsx:609` (abrir receita) e `:729` (abrir exame) são `opacity-0 group-hover:opacity-100`. Em touch e em navegação por teclado, esses botões são invisíveis — o usuário conclui que "não tem como abrir".

### C10. `PatientDetails.tsx:718`: nome do exame limitado a `max-w-[120px]` com `truncate` — nomes reais ficam ilegíveis.

### C11. Badge "Active" fixo
`PatientDetails.tsx:248` sempre mostra "ACTIVE", independentemente de qualquer estado real do paciente.

### C12. Densidade fora do padrão do Design System
`docs/DESIGN_SYSTEM.md` define `radius 3xl/2xl/xl`. A página usa `rounded-[32px]`, `[40px]`, `[48px]`, `[24px]`, `[28px]` misturados, e tipografia em `text-[9px]`/`text-[10px]` em blocos inteiros do sidebar — abaixo do mínimo legível.

---

## 4. P1 — Dados, integração e segurança

### D1. Contexto de tenant obtido de forma insegura
`NewPrescriptionModal.tsx:62` e `UploadDocumentModal.tsx:37`:
```ts
await supabase.from('members').select('user_id, tenant_id').limit(1).single()
```
Pega **uma linha arbitrária** de `members`, sem filtrar por `auth.uid()`. Para um usuário que pertence a mais de um tenant (ou se a RLS de `members` for mais permissiva que o esperado), grava receita/documento no tenant errado. O correto é `useTenant()`, que o resto do app já usa.

### D2. Queries sem `tenant_id` explícito
`prescriptions`, `documents`, `financing_proposals` (`PatientDetails.tsx:151-176`), `dental_records` (`dentalService.ts:71`), `call_records` (`:83`). Dependem 100% de RLS estar correta em todas as tabelas — defesa em camada única.

### D3. RLS incompleta
`20260323_add_prescriptions_and_documents.sql` cria políticas apenas de **SELECT e INSERT** para `prescriptions` e `documents`. Sem policy de DELETE/UPDATE, `handleDeleteDocument` falha silenciosamente (0 linhas afetadas, sem erro).

### D4. Coluna inexistente: `patients.notes`
`MedicalRecordsHub.tsx:60` declara e `:742` lê `selectedPatient.notes`. A coluna real (migration + `types/patient.ts:21`) é `medical_notes`. O bloco "Observações" está **sempre vazio**.

### D5. `insurance_card` vs `insurance_card_number`
`MedicalRecordsHub.tsx:721` faz fallback entre as duas; `PatientDetails.tsx:291` só lê `insurance_card`. As duas colunas existem (base + migration) e ninguém definiu qual é a canônica.

### D6. Prioridade de telefone invertida entre telas
`PatientDetails.tsx:81,307,336` usa `mobile || phone`; `CrmLeads.tsx:202` usa `phone || mobile`. E `mobile` **não aparece em nenhuma migration** — é campo legado. Isso alimenta a mesma classe de problema já documentada em `incident_phone_duplicate_and_language_drift`.

### D7. Refetch redundante
`PatientDetails.tsx:116-120`: `fetchHistoryData()` roda a **cada** troca de aba — 4 queries por clique, mesmo indo para a aba de chamadas.

### D8. Sem paginação em `prescriptions`, `documents`, `medical_records`, `patients` — carrega a tabela inteira.

### D9. `PatientDetails.tsx:246`: `patient.full_name.charAt(0)` sem guarda contra nome nulo.

### D10. Página desconectada do resto do produto
A ficha do paciente **não mostra**: agendamentos (`appointments`), conversas do inbox/WhatsApp, cobranças reais (`billing_records`), jornada de CRM (`crm_journeys`), lista de espera. Tudo isso existe no produto e é acessível por outras telas usando o mesmo `patient_id`.

---

## 5. Plano de correção

### Fase 0 — Verificação no banco (antes de escrever qualquer linha)
O schema real diverge dos `.sql` do repositório. Confirmar via query:
1. `patient_documents` existe? E o bucket `patient-documents`?
2. `call_records.call_notes` existe?
3. `patients`: `mobile`, `notes`, `national_id`, `country`, `last_visit_at` — quais existem de fato?
4. Policies de UPDATE/DELETE em `prescriptions` e `documents`.
5. **Inventário do que já foi gravado** em `prescriptions.content_json` (quantos registros em cada um dos 3 formatos) e em `documents.file_url` (quantos são `blob:` — esses são irrecuperáveis, o arquivo nunca existiu no servidor).

### Fase 1 — Contratos de dados (base de tudo)
1.1 Formato único de receita: `{ version: 2, medications: PrescriptionItem[], freeText?: string }`. Migration de normalização dos registros existentes + leitor retrocompatível (aceita os 3 formatos legados, escreve só o novo).
1.2 Unificar documentos na tabela `documents`. Criar bucket privado com policy por tenant. Migrar/descontinuar `patient_documents`.
1.3 Preencher `medical_record_id` quando a receita nasce de uma evolução.
1.4 Padronizar telefone em E.164 na leitura (helper já existe em `lib/i18n/phone`), e eleger `phone` como coluna canônica.
1.5 Corrigir `notes` → `medical_notes` e eleger `insurance_card` ou `insurance_card_number`.

### Fase 2 — Funcionalidade
2.1 Upload real de exame: Storage + `createSignedUrl` (o Hub já tem esse fluxo correto em `handleViewDocument` — reaproveitar).
2.2 Visualizador de exame que abre o arquivo real (PDF / imagem / DICOM), com fallback de download. `DicomViewer` passa a receber URL de verdade; remover imagem e metadados fake.
2.3 Timeline unificada: `medical_records` + `prescriptions` por `patient_id` + `documents`, com `tenant_id`, e corrigindo o `.map` sobre objeto.
2.4 Aba MEDICAL RECORD: lista real de evoluções com SOAP (aproveitar o layout que já existe no Hub).
2.5 `AIExplainButton` vira modal controlado (`open`/`onClose`) — ou o botão migra para dentro do `TimelineCard`.
2.6 Calls: `tenant_id` + normalização E.164 + filtro parametrizado + remover `call_notes` se não existir.
2.7 Ligar todos os controles da tabela A10 — ou removê-los. Corrigir a ordem dos argumentos do `showToast`.
2.8 Financeiro: substituir o mock de R$ 2.500 pelo último orçamento real; esconder Dr. Cash fora do BR; ligar ao módulo financeiro real.
2.9 `onBack` → `navigate(-1)` com fallback.

### Fase 3 — i18n
3.1 `TimelineCard` inteiro para o namespace `medical`.
3.2 Dicionário de rótulos para `event_type`, `status` (proposta/orçamento) e `gender`. Avaliar migrar os valores gravados em PT para chaves neutras.
3.3 Substituir as 14 ocorrências de `pt-BR`/`BRL` por `useLocaleFormat()` e `useTenantMoney()`.
3.4 `dentalService.getRecalls` e badge `'New'`.

### Fase 4 — Design
4.1 `min-w-0` na coluna de grid + odontograma em 2 linhas (16 dentes cada) com scroll contido.
4.2 Modais via `createPortal` no `document.body` — elimina de vez o problema do ancestral com `transform`.
4.3 Botão de fechar real (`<X>`), com `aria-label`, contraste adequado e `Esc` funcionando.
4.4 Folha A4 com `min-height` em vez de `aspect` fixo, com scroll próprio.
4.5 Normalizar as alturas em cascata; uma única fonte de altura.
4.6 Responsividade do Hub (lista vira drawer abaixo de `lg`).
4.7 Ações do sidebar sempre visíveis (não só em hover).
4.8 Alinhar raios e tipografia ao `DESIGN_SYSTEM.md`.

### Fase 5 — Arquitetura
Decidir a **página única** de paciente. Recomendação: `PatientDetails` como ficha canônica (é para onde CRM e Propostas apontam), e o `MedicalRecordsHub` vira apenas o *seletor* de paciente + redirect. As abas Detalhes/Receitas/Arquivos do Hub migram como abas do `PatientDetails`.

### Fase 6 — Segurança
6.1 `useTenant()` no lugar de `members.limit(1).single()`.
6.2 `tenant_id` explícito em todas as queries da página.
6.3 Policies de UPDATE/DELETE em `prescriptions` e `documents`.

---

## 6. Melhorias recomendadas (fora da correção)

1. **Ficha 360º**: próximos/últimos agendamentos, conversas do inbox, cobranças reais, estágio no CRM e lista de espera — tudo já existe no banco com o mesmo `patient_id`.
2. **Editar cadastro** de dentro da ficha (hoje é um toast "em breve"); reaproveitar `SidebarPatientEditView`.
3. **Receita em PDF de verdade** (hoje é `window.print()`), com cabeçalho do tenant e CRM/CRO reais — os campos hoje são literais `CRM/CRO 123.456` e `Brasília - DF` (`MedicalRecordsHub.tsx:410-411`).
4. **Log de acesso ao prontuário** (quem abriu, quando) — requisito de LGPD/HIPAA para dado clínico.
5. **Empty states acionáveis**: hoje várias abas mostram "nenhum registro" sem oferecer a ação de criar.
6. **Paginação e cache** (React Query ou similar) nas listas.
7. **Testes de fumaça** por aba, para que "quebrou tudo de novo" seja detectado antes do usuário.

---

## 7. Ordem de execução sugerida

`Fase 0` → `Fase 1` → `Fase 2.1–2.5` → `Fase 4.1–4.3` (os três bugs visuais que mais atrapalham) → `Fase 3` → `Fase 2.6–2.9` → `Fase 6` → `Fase 4.4–4.8` → `Fase 5`.

As Fases 0 e 1 são pré-requisito de todo o resto: sem contrato de dados único, cada correção de tela reintroduz o problema em outro lugar.
