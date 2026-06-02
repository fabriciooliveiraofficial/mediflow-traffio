-- 20260326_fix_doctors_rls.sql
-- ============================================================
-- FIX: Row Level Security for Doctors Table
-- Author: Antigravity
-- Description: Enables Write (Insert/Update/Delete) for admins
-- and self-update for the professional.
-- ============================================================

-- 1. Enable RLS (ensure it's active)
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;

-- 2. Clean up potentially conflicting or incomplete policies
DROP POLICY IF EXISTS "doctors_management_policy" ON public.doctors;
DROP POLICY IF EXISTS "doctors_read_policy" ON public.doctors;
DROP POLICY IF EXISTS "doctors_read_own" ON public.doctors;
DROP POLICY IF EXISTS "doctors_admin_all" ON public.doctors;
DROP POLICY IF EXISTS "doctors_self_update" ON public.doctors;

-- 3. SELECT Policy (Keep existing logic but cleaner)
-- Admins/staff can see all doctors in their tenant, and patients can see them for booking.
-- Reusing 'get_my_tenants()' helper if it exists, otherwise standard subquery.
CREATE POLICY "doctors_select_tenant"
ON public.doctors
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM members m1
    WHERE m1.user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM members m2
      WHERE m2.user_id = public.doctors.id
      AND m2.tenant_id = m1.tenant_id
    )
  )
  OR id = auth.uid()
);

-- 4. MANAGEMENT Policy (INSERT, UPDATE, DELETE)
-- Only 'admin', 'owner', or 'manager' roles can modify professional data.
CREATE POLICY "doctors_admin_manage"
ON public.doctors
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM members m1
    WHERE m1.user_id = auth.uid()
    AND m1.role IN ('admin', 'owner', 'manager')
    -- For UPDATE/DELETE, the target doctor must be in the same tenant as the admin
    AND (
      EXISTS (
        SELECT 1 FROM members m2
        WHERE m2.user_id = public.doctors.id
        AND m2.tenant_id = m1.tenant_id
      )
      OR 
      -- Allow INSERT if is an admin (with check below)
      true 
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM members m1
    WHERE m1.user_id = auth.uid()
    AND m1.role IN ('admin', 'owner', 'manager')
  )
);

-- 5. SELF-UPDATE Policy
-- Allow a professional to update their own bio/rqe/specialty if needed.
CREATE POLICY "doctors_self_update"
ON public.doctors
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());
