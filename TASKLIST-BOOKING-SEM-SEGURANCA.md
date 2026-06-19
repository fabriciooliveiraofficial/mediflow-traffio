# Tasklist — Agendamento sem tratativa de segurança (verificação presencial)

> **Status:** Diagnóstico concluído. **NÃO executar/deployar ainda** — aguardando autorização.
> **Decisão do usuário:** sem verificação de identidade no widget; cadastro/confirmação de e-mail e telefone é feito **presencialmente pelos atendentes**. Permitir todas as informações e apenas confirmar o agendamento. **Sem CTA de chamada telefônica.**

## Diagnóstico (confirmado no código, sem suposição)
- O comportamento desejado **já é o atual**: `public-booking` aceita os dados, deduplica por e-mail silenciosamente (reaproveita cadastro existente) e confirma o agendamento.
- **Não existe** CTA de telefone, tela de identidade, `email_registered` ou `confirm_existing` no widget nem na edge function (verificado por grep).
- **Único ponto a corrigir:** em `handleBook` ([public-booking/index.ts:362]), uma falha por horário ocupado (`no_overlap_appointments`) devolve o **texto bruto do Postgres** ao cliente. Isso é higiene de erro (não segurança).

## Cancelamento
- [x] Plano `TASKLIST-IDENTITY-CONFLICT-UX.md` **CANCELADO** (não será implementado: sem identidade, sem CTA).

## Causa raiz exata (refinada após leitura do RPC real)
O `book_appointment` (migration 05) só nomeia `reason: 'slot_taken'` para `unique_violation`. Conflito de horário usa `exclusion_violation` (constraint `no_overlap_appointments`) — SQLSTATE diferente — que cai no `WHEN OTHERS` e retorna o **SQLERRM bruto** em `reason`. O código antigo fazia fallback `data?.message ?? data?.reason`, e como o RPC nunca devolve `message`, o texto cru vazava direto.

## Correção — Backend (`public-booking/index.ts`)
- [x] **B.1** Reescrito o bloco de falha de `handleBook`: detecta `slot_taken` OU texto correspondente a `overlap|conflict|exclusion|duplicate` (regex) → mensagem amigável "Este horário não está mais disponível. Por favor, escolha outro horário."; qualquer outro erro → "Não foi possível concluir o agendamento. Tente novamente."
- [x] **B.2** Texto bruto do Postgres nunca mais retorna ao cliente; logado via `console.error` só no servidor quando não é `slot_taken`.
- [x] **B.3** Retorna `status: 'slot_taken' | 'error'` para o widget reagir.

## Correção — Frontend (`widget.js`)
- [x] **F.1** Em `doBook`, ao receber `status === 'slot_taken'`: volta à etapa de horários, zera `cache.slots` (mostra spinner) e recarrega a lista atualizada; exibe aviso amigável (`_err`) assim que os horários chegam.
- [x] **F.2** Erro genérico: mensagem simples via `flash()` no formulário, botão "Confirmar" reabilitado. **Sem CTA de telefone.**
- [x] **F.3** Nenhuma mensagem bruta do Postgres chega ao usuário (confirmado nos testes).

## SQL
- [x] **Nenhum script necessário** (sem `clinic_phone`/CTA).

## Deploy e validação
- [x] **V.1** ✅ Deploy `public-booking` (`--no-verify-jwt`).
- [x] **V.2** ✅ curl: e-mail novo, horário livre → `success:true`.
- [x] **V.3** ✅ curl: e-mail já existente, horário livre → `success:true`, reaproveitando o `patient_id` existente.
- [x] **V.4** ✅ curl: horário já ocupado → `{status:'slot_taken', message:'Este horário não está mais disponível...'}` — **sem texto bruto do Postgres**.
- [ ] **V.5** **Pendente — ação do usuário:** validar no widget real (demo): concluir agendamento normalmente; forçar um horário ocupado e confirmar que volta aos horários com aviso amigável; nenhum CTA de telefone na tela; console do navegador limpo.
