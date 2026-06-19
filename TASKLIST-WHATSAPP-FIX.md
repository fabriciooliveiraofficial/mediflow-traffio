# Correção: Preenchimento do Campo WhatsApp com ID da Meta

## Diagnóstico
O problema ocorre porque, no módulo de atendimento (`HumanInboxPage.tsx`), o componente de cadastro rápido (`SidebarRegisterView`) recebe a prop `initialPhone` diretamente do campo `session.patient_phone`. 

Para conversas originadas no WhatsApp, esse comportamento é correto. Porém, para interações via Instagram ou Facebook Messenger, o campo `patient_phone` armazena o ID do contato na plataforma (IGSID ou PSID, como o valor `1321369540149267`), não um número de telefone real. Como o formulário não diferencia a origem (canal), ele preenche o campo "WhatsApp" com esse ID. 

Adicionalmente, o campo de WhatsApp em `SidebarRegisterView.tsx` encontra-se `disabled`, impossibilitando que o recepcionista apague o ID incorreto e insira o número verdadeiro do paciente caso ele seja informado durante a conversa.

## Plano de Ação

- [x] **1. Ajustar o repasse do telefone no `PatientPanel` (`HumanInboxPage.tsx`)**:
  - Verificar a propriedade `session.channel` (se é `whatsapp`, `cloud_api`, `waba`, `zapi` ou se não é `instagram`/`facebook`).
  - Passar o `session.patient_phone` apenas se a origem for um canal do WhatsApp. Caso contrário, repassar uma string vazia `''`.

- [x] **2. Liberar edição do campo WhatsApp (`SidebarRegisterView.tsx`)**:
  - Remover o atributo `disabled` e as classes CSS que bloqueiam a interação (`bg-gray-100`, `cursor-not-allowed`, `opacity-70`).
  - Adicionar a propriedade `onChange` para atualizar o `formData.phone`, permitindo que o recepcionista digite o telefone real quando o atendimento for originado do Instagram.

- [x] **3. Ajustar formulário de Edição (`SidebarPatientEditView.tsx`) (Revisão UX)**:
  - O campo de WhatsApp também encontra-se `readOnly` neste componente.
  - Avaliar a necessidade de remover o `readOnly` para que seja possível corrigir e inserir o número de pacientes criados a partir do Instagram/Facebook posteriormente.

- [x] **4. Corrigir formatação de "telefone/bandeira" para DMs do Instagram/Facebook (`FollowUpBoard.tsx` e `HumanInboxPage.tsx`)**:
  - Adicionar o campo `channel` e `context` na tipagem do Kanban (`FollowUpBoard.tsx`).
  - Ajustar a renderização dos nomes e subtítulos nos cards do Kanban e no painel do paciente no chat para que mostre o @username ou "Instagram Direct" ao invés de tratar o ID numérico da Meta como telefone (excluindo os prefixos de bandeira `us` e formatação `+`).

## SQL Editor (Supabase)
Nenhum script de banco de dados (SQL) é necessário para corrigir essa falha de UI/UX. Todos os ajustes são exclusivamente a nível de Front-end/React.
