# Tasklist — Correção definitiva do erro de duplicidade em `patients`

> **Status:** Diagnóstico concluído. **NÃO executar/deployar ainda** — aguardando confirmação dos resultados do SQL de diagnóstico e autorização para codar.

## Contexto do erro
```
duplicate key value violates unique constraint "idx_patients_tenant_email"
HTTP 500 em public-booking (action=book)
```
Ocorre no passo final do widget (confirmar agendamento), ao criar/recuperar o paciente "guest" antes de chamar `book_appointment`.

## Causa raiz
`upsertGuestPatient` (em `traffio-app/supabase/functions/public-booking/index.ts`) usa um único filtro `.or("phone.eq.X,email.eq.Y")` para checar se o paciente já existe:
1. Não verifica `error` da consulta — trata falha de leitura como "não encontrado" e segue para o `INSERT`.
2. Se telefone e e-mail digitados pertencerem a **dois pacientes diferentes** (provável dado os testes repetidos com autofill), a consulta combinada só traz um deles — o código erra ao concluir que o e-mail "não existe" e tenta inserir, colidindo com `idx_patients_tenant_email`.

## Diagnóstico — ações de verificação (somente leitura)
- [ ] **D.1** Rodar no SQL Editor do Supabase o script de 3 queries fornecido no chat (lista de pacientes de teste + e-mails duplicados + constraints reais).
- [ ] **D.2** Confirmar com o resultado: há pacientes de teste com telefone/e-mail cruzados entre registros diferentes?
- [ ] **D.3** Confirmar nome exato das constraints únicas (`idx_patients_tenant_email`, e a de telefone, se existir) para mapear o `error.code`/`constraint` corretamente no tratamento de conflito.

## Correção de código (aguardando autorização para implementar)
- [ ] **C.1** Reescrever `upsertGuestPatient` em `public-booking/index.ts`:
  - [ ] Consulta **1**: buscar por e-mail (autoridade principal, é o canal de confirmação).
  - [ ] Consulta **2**: se não achar por e-mail, buscar por telefone.
  - [ ] Verificar `error` em **ambas** as consultas — nunca seguir para `INSERT` silenciosamente em caso de falha de leitura.
- [ ] **C.2** No catch do `INSERT` (`error.code === '23505'`):
  - [ ] Reconsultar por e-mail, depois por telefone, para recuperar o `id` real.
  - [ ] Se ainda assim não resolver, devolver erro **amigável** (`409` com mensagem clara), nunca o texto bruto do Postgres.
- [ ] **C.3** Adicionar log estruturado (console.error) nos pontos de falha de leitura para facilitar diagnóstico futuro sem precisar reproduzir no browser.
- [ ] **C.4** *(Melhoria não bloqueante)* Normalizar telefone para dígitos antes de gravar/comparar (hoje grava formatado, ex.: `(11) 90000-0000`), reduzindo falsas não-correspondências futuras.

## Deploy e validação (após autorização)
- [ ] **V.1** Deploy da edge function `public-booking` (`npx supabase functions deploy public-booking --no-verify-jwt`).
- [ ] **V.2** Teste via curl: mesmo e-mail + telefone novo → deve reusar paciente existente (sem erro).
- [ ] **V.3** Teste via curl: telefone já usado por paciente A + e-mail já usado por paciente B (cenário ambíguo) → deve resolver por e-mail (prioridade), sem 500.
- [ ] **V.4** Teste no widget real (demo) repetindo o fluxo completo 2x com os mesmos dados.
- [ ] **V.5** Confirmar que nenhum erro bruto do Postgres aparece mais no console do navegador.

## Itens não-bug (apenas para registro, sem ação necessária)
- [x] `favicon.ico 404` — cosmético; resolver depois adicionando um `<link rel="icon">` na demo, sem urgência.
- [x] `"A listener indicated an asynchronous response..."` — ruído de extensão do navegador, não relacionado ao nosso código. Confirmável testando em aba anônima sem extensões.
