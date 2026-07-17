-- Lock de conversa pooler-safe (substitui pg_try_advisory_lock/pg_advisory_unlock no process-inbox).
--
-- Por quê: advisory locks são de SESSÃO Postgres. Chamados via RPC REST (PostgREST/pooler),
-- o lock é adquirido numa conexão do pool e o unlock pode executar em OUTRA conexão —
-- falha silenciosa e o lock fica preso até a conexão ser reciclada (~2-3 min de fila parada,
-- observado em produção em 2026-07-16). O lease abaixo é uma única instrução atômica por
-- chamada (funciona em qualquer conexão) e tem TTL: worker que morre não trava a fila.

CREATE TABLE IF NOT EXISTS conversation_locks (
    tenant_id    uuid        NOT NULL,
    phone        text        NOT NULL,
    locked_until timestamptz NOT NULL,
    PRIMARY KEY (tenant_id, phone)
);

ALTER TABLE conversation_locks ENABLE ROW LEVEL SECURITY;
-- Sem policies: apenas service_role (via RPCs abaixo) acessa.

-- Tenta adquirir o lease. Retorna true se conseguiu; false se outro worker o detém (não expirado).
CREATE OR REPLACE FUNCTION try_conversation_lock(p_tenant uuid, p_phone text, p_ttl_seconds int DEFAULT 120)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO conversation_locks (tenant_id, phone, locked_until)
    VALUES (p_tenant, p_phone, now() + make_interval(secs => p_ttl_seconds))
    ON CONFLICT (tenant_id, phone) DO UPDATE
        SET locked_until = now() + make_interval(secs => p_ttl_seconds)
        WHERE conversation_locks.locked_until < now()
    RETURNING true;
$$;

CREATE OR REPLACE FUNCTION release_conversation_lock(p_tenant uuid, p_phone text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    DELETE FROM conversation_locks WHERE tenant_id = p_tenant AND phone = p_phone;
$$;

REVOKE ALL ON FUNCTION try_conversation_lock(uuid, text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_conversation_lock(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION try_conversation_lock(uuid, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION release_conversation_lock(uuid, text) TO service_role;
