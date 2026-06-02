-- ##########################################################
-- TRAFFIO MEDICAL - FIX RLS SERVICES
-- ##########################################################
-- Corrige o erro 403 (Forbidden) ao criar Tipos de Consulta.
-- O script anterior esqueceu de criar a policy para appointment_types.

-- 1. Policy para APPOINTMENT_TYPES (Permite tudo para membros do tenant)
DROP POLICY IF EXISTS "appointment_types_tenant_access" ON appointment_types;
CREATE POLICY "appointment_types_tenant_access" ON appointment_types 
FOR ALL 
USING (tenant_id IN (SELECT get_my_tenant_ids()))
WITH CHECK (tenant_id IN (SELECT get_my_tenant_ids()));

-- 2. Garantir que Members seja legível (Correção potencial para erro 406/Recursão)
-- A função get_my_tenant_ids já é SECURITY DEFINER, o que evita recursão, 
-- mas vamos garantir que o usuário possa ver seus próprios dados em 'members'.
DROP POLICY IF EXISTS "members_read_own" ON members;
CREATE POLICY "members_read_own" ON members 
FOR SELECT 
USING (user_id = auth.uid());
-- Isso se soma à policy existente de "ver membros do meu tenant".

-- 3. Confirmação
SELECT 'Policies aplicadas com sucesso' as status;
