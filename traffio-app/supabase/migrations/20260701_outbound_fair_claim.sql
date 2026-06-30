-- ============================================================
-- Outbound queue: atomic fair claim (escala — milhares de msgs / centenas de tenants)
--
-- Substitui o padrão antigo (SELECT + advisory lock por mensagem + UPDATE processing
-- por mensagem) por UMA única chamada que:
--   1. Devolve à fila mensagens presas em 'processing' (reaper, crash recovery)
--   2. Trava um lote com FOR UPDATE SKIP LOCKED (sem contenção entre invocações)
--   3. Aplica justiça por tenant (cap por tenant via window function) — sem
--      head-of-line blocking: um tenant grande não trava os pequenos
--   4. Marca como 'processing' e retorna o lote — atômico, 1 round-trip
-- ============================================================

ALTER TABLE public.outbound_message_queue
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.claim_outbound_messages(
  p_batch_size     int DEFAULT 150,
  p_per_tenant_cap int DEFAULT 15
)
RETURNS SETOF public.outbound_message_queue
LANGUAGE plpgsql
AS $$
BEGIN
  -- 1. Reaper: mensagens presas em 'processing' há > 5 min (função anterior crashou)
  --    voltam para 'pending'. Conjunto pequeno e transitório — custo desprezível.
  UPDATE public.outbound_message_queue
  SET    status = 'pending', claimed_at = NULL
  WHERE  status = 'processing'
    AND  claimed_at < now() - interval '5 minutes';

  -- 2. Claim justo e atômico
  RETURN QUERY
  WITH locked AS (
    -- Usa o índice parcial idx_outbound_queue_pending (status='pending')
    SELECT q.id, q.tenant_id, q.scheduled_at
    FROM   public.outbound_message_queue q
    WHERE  q.status = 'pending'
      AND  q.scheduled_at <= now()
      AND  q.attempts < 3
    ORDER  BY q.scheduled_at
    FOR UPDATE SKIP LOCKED
    LIMIT  p_batch_size * 4          -- candidatos extras p/ aplicar o cap por tenant
  ),
  ranked AS (
    SELECT id, scheduled_at,
           row_number() OVER (PARTITION BY tenant_id ORDER BY scheduled_at) AS rn
    FROM   locked
  ),
  chosen AS (
    SELECT id
    FROM   ranked
    WHERE  rn <= p_per_tenant_cap     -- nenhum tenant leva mais que o cap por lote
    ORDER  BY scheduled_at
    LIMIT  p_batch_size
  )
  UPDATE public.outbound_message_queue q
  SET    status = 'processing', claimed_at = now()
  FROM   chosen
  WHERE  q.id = chosen.id
  RETURNING q.*;
END;
$$;

SELECT 'claim_outbound_messages + claimed_at aplicados.' AS resultado;
