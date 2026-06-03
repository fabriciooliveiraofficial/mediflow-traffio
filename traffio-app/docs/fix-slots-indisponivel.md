# Fix: Slots INDISPONÍVEL no Agendamento Expresso

**Data:** 2026-06-03  
**Severidade:** CRÍTICO — Todos os horários aparecem como INDISPONÍVEL independente da data

---

## Diagnóstico

### Causa Raiz 1 (CRÍTICA): Incompatibilidade de granularidade entre RPC e grid do frontend

**Arquivo:** `supabase/migrations/20260416200000_find_next_available_dates_v5.sql`  
**Linha do problema:** `generate_series(..., (p_duration_minutes || ' minutes')::interval)`

A função `find_next_available_dates` gera slots usando **`p_duration_minutes` como step** do `generate_series`. Se o serviço tem duração de 30 min, os slots gerados são:
```
09:00 → 09:30 → 10:00 → 10:30 → 11:00...
```

O grid do frontend (`SidebarBookingView.tsx` linhas 760-793) **sempre verifica em incrementos de 15 minutos**:
```
09:00, 09:15, 09:30, 09:45, 10:00, 10:15...
```

Para cada célula do grid, o frontend faz `slots.find(s => s.time === timeStr)`. Como os slots da RPC não existem nos marks de :15 e :45, esses cells mostram INDISPONÍVEL.

### Causa Raiz 2 (CRÍTICA): `start_time` não alinhado a 15 minutos

Se `doctor_availability.start_time` não é múltiplo de 15 (ex: `09:05`, `09:10`), os slots gerados pela RPC nunca vão coincidir com NENHUMA célula do grid de 15 minutos:
```
Slots gerados (duration=30, start=09:05): 09:05, 09:35, 10:05, 10:35...
Grid verifica:                             09:00✗, 09:15✗, 09:30✗, 09:45✗...
Resultado: TODOS = INDISPONÍVEL
```

Isso explica o cenário onde `slots.some(s => s.available) === true` (o grid renderiza), mas nenhuma célula encontra match → **100% INDISPONÍVEL**.

### Causa Raiz 3 (MÉDIA): `da.is_active = true` removido na v5

O filtro `is_active = true` existia na v4 (`dates_with_availability`) mas foi removido na v5, permitindo que blocos de disponibilidade inativos apareçam.

### Causa Raiz 4 (MENOR): `JOIN locations` exclui registros sem `location_id`

O `JOIN locations l ON l.id = swa.location_id` é INNER JOIN. Registros de `doctor_availability` com `location_id IS NULL` ficam invisíveis mesmo quando `p_location_id` é fornecido.

---

## Plano de Correção

### Fase 1: Diagnóstico no banco de dados ✅ CONCLUÍDA

- [x] **1.1** Verificar registros de `doctor_availability` — dados limpos
- [x] **1.2** Confirmar location_id nulo — nenhum encontrado
- [x] **1.3** Confirmar alinhamento de start_time — todos em :00 (múltiplos de 60 min)
- [x] **1.4** Testar RPC atual — confirmado: retornava 18 slots em intervalos de 30 min

### Fase 2: Aplicar fix SQL (find_next_available_dates v6) ✅ CONCLUÍDA

- [x] **2.1** Script v6 executado no SQL Editor do Supabase
- [x] **2.2** Função criada sem erros
- [x] **2.3** Teste confirmado: agora retorna 34 slots em intervalos de 15 min (08:00, 08:15, 08:30, 08:45...)

### Fase 3: Validação no frontend ← PRÓXIMA ETAPA

- [ ] **3.1** Acessar o Agendamento Expresso
- [ ] **3.2** Selecionar profissional → local → serviço → data
- [ ] **3.3** Confirmar que slots disponíveis aparecem sem overlay INDISPONÍVEL
- [ ] **3.4** Confirmar que slots ocupados mostram OCUPADO (não INDISPONÍVEL)
- [ ] **3.5** Confirmar que slots fora do horário de trabalho mostram INDISPONÍVEL (comportamento correto)
- [ ] **3.6** Testar agendamento completo e confirmação

### Fase 4: Correção de dados (se necessário) ✅ NÃO NECESSÁRIA

- [x] **4.1** location_id IS NULL — nenhum registro afetado
- [x] **4.2** start_time não alinhado — nenhum registro afetado

---

## Scripts SQL

### Script de Diagnóstico (executar primeiro)

```sql
-- Verificar registros de doctor_availability
SELECT 
  da.id,
  da.doctor_id,
  d.full_name AS doctor_name,
  da.day_of_week,
  da.start_time,
  da.end_time,
  da.location_id,
  l.name AS location_name,
  da.block_type,
  da.is_active,
  -- Verificar se start_time está alinhado a 15 min
  CASE WHEN EXTRACT(MINUTE FROM da.start_time) % 15 = 0 
       THEN 'OK' 
       ELSE 'NÃO ALINHADO (' || EXTRACT(MINUTE FROM da.start_time) || ' min)' 
  END AS start_time_alignment
FROM doctor_availability da
JOIN doctors d ON d.id = da.doctor_id
LEFT JOIN locations l ON l.id = da.location_id
ORDER BY d.full_name, da.day_of_week, da.start_time;
```

---

### Script: find_next_available_dates v6 (CORREÇÃO PRINCIPAL)

> Cole e execute no SQL Editor do Supabase

```sql
-- =============================================================================
-- TRAFFIO MEDICAL — find_next_available_dates V6
--
-- Correções em relação à v5:
--   1. [CRÍTICO] generate_series step: sempre '15 minutes' (antes: p_duration_minutes)
--      Garante que slot times sejam SEMPRE HH:00, HH:15, HH:30, HH:45
--      alinhados com o grid de 15 minutos do frontend.
--   2. [CRÍTICO] start_time arredondado para CIMA ao próximo múltiplo de 15min
--      Garante alinhamento mesmo quando o médico começa em horário quebrado.
--   3. [MÉDIO] Restaurado filtro da.is_active = true (removido na v5)
--   4. [MENOR] LEFT JOIN locations para segurança contra location_id NULL
-- =============================================================================

CREATE OR REPLACE FUNCTION find_next_available_dates(
    p_doctor_id        UUID,
    p_from_date        DATE    DEFAULT CURRENT_DATE,
    p_limit            INTEGER DEFAULT 3,
    p_duration_minutes INTEGER DEFAULT 30,
    p_location_id      UUID    DEFAULT NULL,
    p_current_time     TIME    DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSON;
    v_buffer TIME;
BEGIN
    -- Adiciona buffer de 30 min para slots do dia atual
    v_buffer := COALESCE(p_current_time + interval '30 minutes', '00:00'::time);

    WITH

    -- 1. Datas candidatas: janela de 180 dias a partir de p_from_date
    candidate_dates AS (
        SELECT d::date AS check_date
        FROM generate_series(p_from_date, p_from_date + 180, '1 day'::interval) d
    ),

    -- 2. Blocos de disponibilidade do médico (apenas ativos, sem bloqueios)
    dates_with_availability AS (
        SELECT
            cd.check_date,
            da.start_time,
            da.end_time,
            da.location_id,
            COALESCE(da.block_type, 'regular') AS block_type
        FROM candidate_dates cd
        JOIN doctor_availability da
          ON  da.doctor_id   = p_doctor_id
         AND  da.is_active   = true                          -- v6: restaurado
         AND  COALESCE(da.block_type, 'regular') != 'blocked'
         AND  (p_location_id IS NULL OR da.location_id = p_location_id)
         AND  (
                   da.day_of_week = EXTRACT(ISODOW FROM cd.check_date)::int
               OR (EXTRACT(ISODOW FROM cd.check_date)::int = 7 AND da.day_of_week = 0)
              )
    ),

    -- 3. Gerar todos os slots em granularidade de 15 MINUTOS (correção crítica)
    --    slot_start = início do slot (alinhado a 15min)
    --    slot_end   = início + p_duration_minutes (para checar conflito com agendamentos)
    all_slots AS (
        SELECT
            dwa.check_date,
            slot_ts::time                                                          AS slot_start,
            (slot_ts + (p_duration_minutes || ' minutes')::interval)::time        AS slot_end,
            to_char(slot_ts::time, 'HH24:MI')                                     AS slot_time,
            dwa.location_id,
            dwa.block_type
        FROM dates_with_availability dwa,
             generate_series(
                 -- v6: Arredonda start_time para CIMA ao próximo múltiplo de 15 min
                 -- Ex: 09:05 → 09:15 | 09:30 → 09:30 | 09:45 → 09:45
                 date_trunc('hour', '2000-01-01'::date + dwa.start_time) +
                     CEIL(EXTRACT(MINUTE FROM dwa.start_time) / 15.0) * interval '15 minutes',
                 -- Último início possível: end_time menos duração do serviço
                 ('2000-01-01'::date + dwa.end_time
                      - (p_duration_minutes || ' minutes')::interval)::timestamp,
                 interval '15 minutes'                                             -- v6: SEMPRE 15 minutos
             ) AS slot_ts
        WHERE dwa.check_date > CURRENT_DATE
           OR (dwa.check_date = CURRENT_DATE AND slot_ts::time >= v_buffer)
    ),

    -- 4. Verificar disponibilidade: slot está livre se não há agendamento conflitante
    --    Verifica o bloco COMPLETO de p_duration_minutes (não apenas o início)
    slots_with_availability AS (
        SELECT
            s.check_date,
            s.slot_start,
            s.slot_time,
            s.location_id,
            s.block_type,
            NOT EXISTS (
                SELECT 1
                FROM appointments a
                WHERE a.doctor_id = p_doctor_id
                  AND a.date       = s.check_date
                  AND a.status NOT IN ('canceled', 'cancelled', 'noshow', 'no_show')
                  AND a.start_time  < s.slot_end
                  AND a.end_time    > s.slot_start
            ) AS available
        FROM all_slots s
    ),

    -- 5. Agrupar por (data, local): array unificado de slots + bounds do grid
    --    Inclui apenas datas com ao menos 1 slot disponível
    dates_with_slots AS (
        SELECT
            swa.check_date,
            swa.location_id,
            COALESCE(l.name, 'Principal')                                          AS location_name,
            json_agg(
                json_build_object(
                    'time',       swa.slot_time,
                    'available',  swa.available,
                    'block_type', swa.block_type
                ) ORDER BY swa.slot_time
            )                                                                      AS slots,
            EXTRACT(HOUR FROM MIN(swa.slot_start))::int                            AS start_hour,
            EXTRACT(HOUR FROM MAX(swa.slot_start))::int                            AS end_hour,
            COUNT(*) FILTER (WHERE swa.available)::int                             AS slot_count
        FROM slots_with_availability swa
        LEFT JOIN locations l ON l.id = swa.location_id                           -- v6: LEFT JOIN
        GROUP BY swa.check_date, swa.location_id, l.name
        HAVING COUNT(*) FILTER (WHERE swa.available) > 0
        ORDER BY swa.check_date, l.name
    ),

    -- 6. Limitar ao primeiro p_limit datas distintas com disponibilidade
    limited_dates AS (
        SELECT DISTINCT check_date
        FROM dates_with_slots
        ORDER BY check_date
        LIMIT p_limit
    )

    SELECT json_agg(
        json_build_object(
            'date',          to_char(dws.check_date, 'YYYY-MM-DD'),
            'location_id',   dws.location_id,
            'location_name', dws.location_name,
            'slots',         dws.slots,
            'start_hour',    dws.start_hour,
            'end_hour',      dws.end_hour,
            'slot_count',    dws.slot_count
        )
        ORDER BY dws.check_date, dws.location_name
    )
    INTO v_result
    FROM dates_with_slots dws
    JOIN limited_dates ld ON ld.check_date = dws.check_date;

    RETURN COALESCE(v_result, '[]'::json);
END;
$$;

-- Conceder permissão para service_role (Edge Functions) e authenticated (frontend)
GRANT EXECUTE ON FUNCTION find_next_available_dates(UUID, DATE, INTEGER, INTEGER, UUID, TIME)
    TO service_role, authenticated;
```

---

### Script de Teste (executar após v6)

> Substitua os UUIDs pelos valores reais do seu banco

```sql
-- Teste a nova função v6
-- Substitua 'SEU_DOCTOR_ID' e 'SEU_LOCATION_ID' pelos valores reais
SELECT find_next_available_dates(
    p_doctor_id        := 'SEU_DOCTOR_ID'::uuid,
    p_from_date        := CURRENT_DATE,
    p_limit            := 3,
    p_duration_minutes := 30,
    p_location_id      := 'SEU_LOCATION_ID'::uuid,
    p_current_time     := NULL
);

-- Para descobrir os IDs reais:
SELECT d.id AS doctor_id, d.full_name, l.id AS location_id, l.name
FROM doctors d
JOIN doctor_availability da ON da.doctor_id = d.id
JOIN locations l ON l.id = da.location_id
LIMIT 10;
```

---

### Script de Backfill (OPCIONAL — apenas se diagnóstico mostrar location_id IS NULL)

```sql
-- Corrigir registros de disponibilidade sem location_id
-- Define o local padrão (primeiro local do tenant) para cada registro
UPDATE doctor_availability da
SET location_id = (
    SELECT l.id 
    FROM locations l 
    WHERE l.tenant_id = da.tenant_id 
      AND l.is_active = true
    ORDER BY l.created_at
    LIMIT 1
)
WHERE location_id IS NULL
  AND EXISTS (
    SELECT 1 FROM locations l 
    WHERE l.tenant_id = da.tenant_id 
      AND l.is_active = true
  );

-- Verificar resultado
SELECT COUNT(*) AS registros_sem_location FROM doctor_availability WHERE location_id IS NULL;
```

---

## Resumo Técnico

| # | Bug | Onde | Impacto | Solução |
|---|-----|------|---------|---------|
| 1 | `generate_series` usa `p_duration_minutes` como step | SQL v5 `all_slots` | CRÍTICO: slots em :30, :45, etc. nunca encontrados pelo grid de 15min | Mudar step para `'15 minutes'` |
| 2 | `start_time` não arredondado para 15min | SQL v5 `all_slots` | CRÍTICO: se start_time = 09:05, NENHUM slot coincide com o grid | Snap para ceiling 15min |  
| 3 | `is_active = true` ausente | SQL v5 `dates_with_availability` | MÉDIO: blocos inativos aparecem | Restaurar filtro |
| 4 | INNER JOIN `locations` | SQL v5 `dates_with_slots` | MENOR: location_id NULL invisível | Mudar para LEFT JOIN |
