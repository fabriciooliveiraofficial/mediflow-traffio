# Tasklist — Tratamento de identidade (e-mail já cadastrado) + CTA telefone

> **Status:** Diagnóstico concluído. **NÃO executar/deployar ainda** — aguardando: (1) decisão Nível A vs OTP; (2) autorização para codar/rodar SQL.

## Objetivo (do prompt)
Quando o e-mail informado já estiver cadastrado, **exibir ao paciente na tela** (sem dado sensível) e perguntar se quer **corrigir** ou **usar o cadastro existente** de forma segura, garantindo que é a mesma pessoa. Em caso de dúvida, exibir **CTA de chamada telefônica** para agendar com um atendente.

## Diagnóstico (confirmado, sem suposição)
- Hoje o backend **mescla silenciosamente** por e-mail (reaproveita cadastro existente sem avisar) → lacuna de identidade.
- **Só e-mail é único** (`idx_patients_tenant_email`). Telefone **não** é único (`idx_patients_phone` comum) → "telefone já cadastrado" **não é** condição de erro no schema atual.
- Garantir identidade sem login exige escolha de nível (A: declarado + CTA telefone / B: OTP por e-mail).

## DECISÕES PENDENTES (do usuário)
- [ ] **DEC.1** Nível de verificação: **A (recomendado)** ou **B (OTP)**?
- [ ] **DEC.2** Telefone duplicado deve gerar algum aviso? (Recomendado: **não** — telefones são legitimamente compartilhados por familiares.)
- [ ] **DEC.3** Origem do número do CTA: coluna `clinic_phone` em `tenant_public_keys` (admin define) — confirmar.

## Backend — `public-booking/index.ts` (após autorização)
- [ ] **B.1** `book`: aceitar `confirm_existing?: boolean` no payload.
- [ ] **B.2** Se e-mail já existe e `confirm_existing` != true → retornar `{ status: 'email_registered' }` (HTTP 200, sem agendar, sem dados sensíveis).
- [ ] **B.3** Se `confirm_existing` == true → reaproveitar cadastro existente e agendar.
- [ ] **B.4** Padronizar respostas de falha com `status`: `email_registered` | `slot_taken` | `error`. Mapear `no_overlap_appointments` e `slot_taken` do RPC → `slot_taken`. Nunca expor texto bruto do Postgres.
- [ ] **B.5** `config`: incluir `clinic_phone` na resposta.
- [ ] **B.6** *(Se DEC.1 = B/OTP)* endpoints `request_otp` / `verify_otp` por e-mail.

## Frontend — `widget.js` (após autorização)
- [ ] **F.1** Tela de identidade ao receber `email_registered`: mensagem neutra (sem expor dados) + 3 botões grandes: "Sim, sou eu — continuar" / "Corrigir e-mail" / "📞 Agendar por telefone".
- [ ] **F.2** "Sim, sou eu" → re-chamar `book` com `confirm_existing: true`.
- [ ] **F.3** "Corrigir e-mail" → voltar ao passo de dados, foco no campo e-mail.
- [ ] **F.4** "Agendar por telefone" → `tel:` com `clinic_phone` (esconder botão se número ausente).
- [ ] **F.5** Em **qualquer** erro de agendamento → exibir também o CTA de telefone ("se houver dúvida").
- [ ] **F.6** `slot_taken` → mensagem amigável + voltar aos horários + CTA telefone.
- [ ] **F.7** Acessibilidade +50: botões grandes, alto contraste, linguagem simples; CTA telefone visível.

## Schema/Config (SQL — rodar no SQL Editor quando aprovado)
- [ ] **S.1** `alter table tenant_public_keys add column if not exists clinic_phone text;`
- [ ] **S.2** `update ... set clinic_phone = '...' where public_key = '...';` (definir número do tenant de teste).
- [ ] **S.3** *(Fase 4)* expor `clinic_phone` como campo editável na aba Widget do painel super-admin.

## Deploy e validação
- [ ] **V.1** Deploy `public-booking` (`--no-verify-jwt`).
- [ ] **V.2** curl: e-mail existente sem `confirm_existing` → `{status:'email_registered'}` (não agenda).
- [ ] **V.3** curl: e-mail existente com `confirm_existing:true` → agenda no cadastro existente.
- [ ] **V.4** curl: e-mail novo → cria e agenda.
- [ ] **V.5** Widget real: e-mail existente → vê a tela de identidade; "Sim, sou eu" conclui; "Corrigir" volta; CTA telefone abre discador.
- [ ] **V.6** Forçar erro → confirmar que o CTA telefone aparece e nenhum texto bruto do Postgres vaza ao console.
