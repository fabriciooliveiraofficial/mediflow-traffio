-- ============================================================
-- Inbox worker: seleção justa por tenant (porta o padrão do outbound fair-claim)
--
-- Espelha `claim_outbound_messages` (migrations/20260701_outbound_fair_claim.sql)
-- para o lado de ENTRADA. Resolve, numa única chamada:
--   1. Reaper — mensagens presas em 'processing' há > 5 min (worker morto no meio
--      de um turno, ex.: timeout do edge) voltam para 'pending'. Fecha o gap em
--      que uma mensagem ficava invisível até a limpeza de 24h.
--   2. Justiça por tenant — CAP POR TENANT via window function: um tenant com
--      centenas de mensagens NÃO empurra os pacientes de um tenant pequeno para
--      trás da fila (head-of-line blocking / vizinho barulhento).
--   3. Limite de lote — LIMIT total por invocação, para o worker não tentar
--      drenar a fila inteira num tick só (e morrer no timeout).
--
-- Diferença para o outbound: o inbox agrupa por CONVERSA (tenant, phone) — várias
-- mensagens fragmentadas viram um turno fundido. Portanto o cap e o limite operam
-- por conversa distinta, não por mensagem solta. A RPC só SELECIONA candidatos
-- (não marca 'processing'): o worker mantém o lease-lock por conversa
-- (try_conversation_lock) como guarda de concorrência entre invocações, e marca
-- 'processing' ao entrar em cada conversa. A paralelização do loop de
-- processamento é um passo separado (ver docs/DIAGNOSTICO_CONCORRENCIA_AGENTE.md).
-- ============================================================

-- Timestamp de quando a mensagem foi reivindicada (marcada 'processing').
-- Alimenta o reaper. O worker passa a preencher junto com status='processing'.
ALTER TABLE public.message_inbox
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

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
  -- 1. Reaper: 'processing' preso há > 5 min → 'pending'. coalesce(claimed_at,
  --    created_at) cobre linhas legadas (marcadas 'processing' antes desta
  --    migração, sem claimed_at) sem tocar em nada que esteja em processamento
  --    legítimo agora (received/created há menos de 5 min).
  UPDATE public.message_inbox
  SET    status = 'pending', claimed_at = NULL, batch_id = NULL
  WHERE  status = 'processing'
    AND  coalesce(claimed_at, created_at) < now() - interval '5 minutes';

  -- 2. Seleção justa: conversas distintas (tenant, phone) com pendentes <= cutoff,
  --    cap por tenant, limite total de lote — ordenadas pela mensagem mais antiga.
  RETURN QUERY
  WITH convos AS (
    -- Usa idx_message_inbox_pending (tenant_id, phone, received_at) WHERE status='pending'
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
  WHERE  r.rn <= p_per_tenant_cap        -- nenhum tenant leva mais que o cap por lote
  ORDER  BY r.oldest
  LIMIT  p_batch_size;
END;
$$;

-- Trava de acesso: a função é SECURITY DEFINER (ignora RLS) e devolve
-- tenant_id+phone de conversas de TODOS os tenants, além de mutar message_inbox
-- (reaper). Só o service_role (Edge Functions) pode executar. O REVOKE FROM
-- PUBLIC não basta: o Supabase aplica default privileges concedendo EXECUTE a
-- anon/authenticated no CREATE — por isso o REVOKE explícito desses papéis.
REVOKE ALL ON FUNCTION public.claim_inbox_conversations(timestamptz, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_inbox_conversations(timestamptz, int, int) FROM anon;
REVOKE ALL ON FUNCTION public.claim_inbox_conversations(timestamptz, int, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_inbox_conversations(timestamptz, int, int) TO service_role;

SELECT 'claim_inbox_conversations + message_inbox.claimed_at aplicados.' AS resultado;
