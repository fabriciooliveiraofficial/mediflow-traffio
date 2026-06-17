-- =============================================================================
-- TRAFFIO / MEDIFLOW — Configurações de SMTP do Tenant e URL de Privacidade (LGPD)
-- -----------------------------------------------------------------------------
-- 1. Adiciona as colunas smtp_* na tabela `tenants` para que cada clínica possa
--    configurar e enviar e-mails de confirmação com seu próprio domínio.
-- 2. Adiciona a coluna privacy_policy_url na tabela `tenant_public_keys` para
--    o tenant definir o link da sua Política de Privacidade no widget.
-- =============================================================================

-- 1. Colunas de SMTP próprio na tabela tenants
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS smtp_host text,
  ADD COLUMN IF NOT EXISTS smtp_port integer DEFAULT 465,
  ADD COLUMN IF NOT EXISTS smtp_user text,
  ADD COLUMN IF NOT EXISTS smtp_pass text,
  ADD COLUMN IF NOT EXISTS smtp_from text;

-- 2. Coluna de Política de Privacidade na tabela tenant_public_keys
ALTER TABLE public.tenant_public_keys
  ADD COLUMN IF NOT EXISTS privacy_policy_url text;
