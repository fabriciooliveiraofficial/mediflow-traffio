# Tasklist — Correção definitiva do erro de duplicidade em `patients`

> **Status:** Diagnóstico concluído. **NÃO executar/deployar ainda** — aguardando confirmação dos resultados do SQL de diagnóstico e autorização para codar.

## Contexto do erro
```
duplicate key value violates unique constraint "idx_patients_tenant_email"
HTTP 500 em public-booking (action=book)
```
Ocorre no passo final do widget (confirmar agendamento), ao criar/recuperar o paciente "guest" antes de chamar `book_appointment`.

## Causa raiz (confirmada com `pg_indexes`)
```
idx_patients_phone        → índice NORMAL, telefone NÃO é único (pode ser compartilhado, ex. familiares)
idx_patients_tenant_email → ÚNICO (tenant_id, email) WHERE email IS NOT NULL  ← única identidade real
```
`upsertGuestPatient` usava `.or("phone.eq.X,email.eq.Y")`, o que era desnecessário e frágil:
1. Não verificava `error` da consulta — falha de leitura era tratada como "não encontrado", seguindo para o `INSERT` às escuras.
2. Telefone nunca foi uma fonte válida de deduplicação (não é único); misturar os dois critérios só introduzia ambiguidade.

A correção usa **somente e-mail** como identidade de deduplicação — é a única coisa que o banco garante única.

## Diagnóstico — ações de verificação (somente leitura)
- [x] **D.1** Script de `pg_indexes` rodado pelo usuário — confirmou que telefone não é único, só e-mail.
- [x] **D.2/D.3** Causa raiz confirmada e simplificada (ver acima).

## Correção de código
- [x] **C.1** Reescrita `upsertGuestPatient` em `public-booking/index.ts`: busca **somente por e-mail**, com `error` verificado explicitamente (nunca segue para INSERT em caso de falha de leitura).
- [x] **C.2** Catch do `INSERT` (`23505`): reconsulta por e-mail e reaproveita o `id`; se não resolver, lança erro amigável (sem texto bruto do Postgres).
- [x] **C.3** `console.error` nos pontos de falha de leitura/insert.
- [ ] **C.4** *(Melhoria não bloqueante, não feita agora)* Normalizar telefone para dígitos antes de gravar (hoje grava formatado, ex.: `(11) 90000-0000`).

## Deploy e validação
- [x] **V.1** ✅ Deploy concluído (`npx supabase functions deploy public-booking --no-verify-jwt`).
- [x] **V.2** ✅ E-mail já existente + telefone novo → reaproveitou o mesmo `patient_id`, sem erro.
- [x] **V.3** ✅ E-mail novo → criou paciente novo normalmente, sem erro.
- [ ] **V.4** **Pendente — ação do usuário:** repetir o fluxo completo 2x no widget real (demo), incluindo reenviar o mesmo e-mail.
- [ ] **V.5** **Pendente — ação do usuário:** confirmar que não aparece mais erro bruto do Postgres no console do navegador.

> Nota: durante o teste V.3 apareceu, à parte, `no_overlap_appointments` ao reusar um horário já ocupado por testes anteriores — é o anti-double-booking funcionando corretamente, não um bug.

## Itens não-bug (apenas para registro, sem ação necessária)
- [x] `favicon.ico 404` — cosmético; resolver depois adicionando um `<link rel="icon">` na demo, sem urgência.
- [x] `"A listener indicated an asynchronous response..."` — ruído de extensão do navegador, não relacionado ao nosso código. Confirmável testando em aba anônima sem extensões.
