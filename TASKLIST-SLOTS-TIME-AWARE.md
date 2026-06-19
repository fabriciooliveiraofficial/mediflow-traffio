# Tasklist — Regras sólidas de data/horário (não exibir horários passados)

> **Status:** Diagnóstico concluído. **NÃO executar/deployar ainda** — aguardando autorização.
> **Bug:** às 14:47, o widget exibe horários já vencidos (08:30, 09:00, …, 14:30) para "Hoje".

## Causa raiz (confirmada no código)
- **RPC deployada = v6** (`docs/fix-slots-indisponivel.md`, executada no SQL editor em 2026-06-03). Assinatura: `find_next_available_dates(p_doctor_id, p_from_date, p_limit, p_duration_minutes, p_location_id, p_current_time)`; retorna `slots:[{time,available,block_type}]`.
- A v6 filtra o passado de "hoje" **apenas** se `p_current_time` for informado (buffer de 30 min HARDCODED na RPC). A edge function chama **sem** esse parâmetro → `v_buffer = 00:00` → todos os horários de hoje passam.
- A hora correta é a do **fuso do tenant** (`config.timezone` = America/Sao_Paulo), não a do servidor (UTC). A RPC compara com `CURRENT_DATE` do servidor → erra perto da meia-noite.
- `handleDates` retorna "Hoje" com `slot_count` cheio mesmo sem horário futuro restante.

## Verificação: config de buffer por tenant?  → ❌ NÃO EXISTE
- **Não há** coluna/config de buffer-antecedência por tenant, profissional ou serviço.
- Único buffer existente: **30 min HARDCODED** na RPC v6 (inerte hoje, pois `p_current_time` não é passado).
- `doctors.auto_release_hours` (default 24h) existe mas é **outro conceito** (liberação de slot reservado/prime), não antecedência de agendamento.
- `appointment_types`: só `duration_minutes` e `preparation_instructions`.

## Decisão de arquitetura
- **Pós-filtrar no edge function** (`public-booking`), usando o fuso do tenant. **NÃO** alterar a RPC `find_next_available_dates` v6 (compartilhada com app/agente IA → risco de regressão).

## DECISÃO (definida)
- [x] **DEC.1** ✅ **Opção B** escolhida: buffer configurável por tenant via `tenants.booking_min_lead_minutes` (default 30).

## Correção — Edge function `public-booking/index.ts`
- [x] **C.1** Helper `tenantNow(tz)` (date + minutos desde 00:00 no fuso do tenant) + `availTimes()` + `slotPassesLead()`.
- [x] **C.2** `tz` e `leadMin` (de `config.tenant`) passados a `handleDates` e `handleSlots`; `config` retorna `booking_min_lead_minutes`.
- [x] **C.3** `handleSlots`: filtra horários disponíveis por `slotPassesLead` (passado/lead) no fuso do tenant.
- [x] **C.4** `handleDates`: recalcula `slot_count` só com horários futuros válidos e **remove a data** se ficar zero (some "hoje" quando não há mais horário). `p_from_date` default = hoje no fuso do tenant.
- [x] **C.5** `dates` e `slots` usam o MESMO filtro (`availTimes` + `slotPassesLead`) → consistência garantida.

## SQL (Opção B) — rodar no SQL Editor
```sql
alter table public.tenants
  add column if not exists booking_min_lead_minutes integer not null default 30;
```
- [ ] **S.1** Coluna criada (ação do usuário).
- [x] **S.2** `config` do widget retorna `booking_min_lead_minutes` (já no código).
- [x] **S.3** Campo editável "Antecedência mínima (minutos)" em `Settings.tsx` (aba Clínicas, junto do Fuso Horário) — salva em `tenants.booking_min_lead_minutes` via `handleSaveTenant`.

> Migration de rastreio: `traffio-app/supabase/migrations/20260617_tenant_booking_lead.sql`.

## Deploy e validação
- [x] **V.1** ✅ Deploy `public-booking` (`--no-verify-jwt`).
- [x] **V.2** ✅ curl `slots` hoje (2026-06-17, ~15:27 BRT): primeiro horário retornado foi `16:15` — nenhum horário ≤ agora+30min apareceu.
- [x] **V.3** ✅ curl `dates`: hoje (17/06) permanece na lista com `slot_count` **reduzido** (7→ depois 6, conforme o relógio avançava durante o teste) em vez do total de 32 — confirma que o filtro está vivo minuto a minuto; dias futuros mantêm contagem cheia.
- [x] **V.4** ✅ curl `slots` para 2026-06-18 (futuro): retornou lista **completa**, desde `08:00` — comportamento inalterado para dias futuros.
- [ ] **V.5** **Pendente — ação do usuário:** abrir o widget real (demo) agora e confirmar visualmente que "Hoje" só mostra horários futuros (ou some se esgotado), datas futuras completas, e o campo "Antecedência mínima" em Settings → Clínicas reflete/edita o valor salvo.

## Fora de escopo (registro)
- O app `PortalBook` provavelmente tem o mesmo comportamento (chama a RPC sem `p_current_time`). Não será alterado nesta tarefa; avaliar depois se desejado.
