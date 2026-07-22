-- Reaper de claim_inbox_conversations: TTL 5min → 15min.
--
-- Achado no teste de carga (docs/DIAGNOSTICO_CONCORRENCIA_AGENTE.md, N=100 a
-- conc=8 com cold-start): sob drenagem lenta, um isolate que reivindicou
-- mensagens (marcou 'processing') e ESTALOU por >5min (cold-start / starvation
-- de CPU/event-loop, não morte real) tinha suas mensagens reivindicadas de volta
-- pelo reaper de 5min. Outro isolate reprocessava (2ª vez) → corrida →
-- deferred_newer_message + exceções → 13/100 mensagens marcadas 'failed'
-- (silenciosamente perdidas, sem resposta e sem ir pra fila humana).
--
-- Turnos reais levam ~30s; nenhum turno legítimo fica 'processing' por 15min.
-- 15min elimina o false-reap sob drenagem lenta, e um worker GENUINAMENTE morto
-- ainda recupera em 15min — muito melhor que o comportamento pré-item-1 (só a
-- limpeza de 24h). Fora o TTL, a função é idêntica à 20260722130000.
CREATE OR REPLACE FUNCTION public.claim_inbox_conversations(
  p_cutoff         timestamptz,
  p_batch_size     int DEFAULT 50,
  p_per_tenant_cap int DEFAULT 15
)
RETURNS TABLE(tenant_id uuid, phone text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Reaper: 'processing' preso há > 15 min → 'pending' (worker genuinamente
  --    morto). coalesce(claimed_at, created_at) cobre linhas legadas.
  UPDATE public.message_inbox
  SET    status = 'pending', claimed_at = NULL, batch_id = NULL
  WHERE  status = 'processing'
    AND  coalesce(claimed_at, created_at) < now() - interval '15 minutes';

  -- 2. Seleção justa: conversas distintas (tenant, phone) com pendentes <= cutoff,
  --    cap por tenant, limite total de lote — ordenadas pela mensagem mais antiga.
  RETURN QUERY
  WITH convos AS (
    SELECT mi.tenant_id, mi.phone, min(mi.received_at) AS oldest
    FROM   public.message_inbox mi
    WHERE  mi.status = 'pending'
      AND  mi.received_at <= p_cutoff
    GROUP  BY mi.tenant_id, mi.phone
  ),
  ranked AS (
    SELECT c.tenant_id, c.phone, c.oldest,
           row_number() OVER (PARTITION BY c.tenant_id ORDER BY c.oldest) AS rn
    FROM   convos c
  )
  SELECT r.tenant_id, r.phone
  FROM   ranked r
  WHERE  r.rn <= p_per_tenant_cap
  ORDER  BY r.oldest
  LIMIT  p_batch_size;
END;
$$;

-- CREATE OR REPLACE preserva os grants; reafirmados por clareza/segurança.
REVOKE ALL ON FUNCTION public.claim_inbox_conversations(timestamptz, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_inbox_conversations(timestamptz, int, int) FROM anon;
REVOKE ALL ON FUNCTION public.claim_inbox_conversations(timestamptz, int, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_inbox_conversations(timestamptz, int, int) TO service_role;

SELECT 'claim_inbox_conversations: reaper TTL 5min → 15min.' AS resultado;
