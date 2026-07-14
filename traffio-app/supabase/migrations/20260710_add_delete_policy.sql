-- Add DELETE policy for dental_records table to allow record deletion and duplication prevention
DROP POLICY IF EXISTS "Users can delete their clinic's dental records" ON public.dental_records;

CREATE POLICY "Users can delete their clinic's dental records"
    ON public.dental_records FOR DELETE
    USING (auth.uid() IN (
        SELECT user_id FROM public.members WHERE tenant_id = dental_records.tenant_id
    ));
