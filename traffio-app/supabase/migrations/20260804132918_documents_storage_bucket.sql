-- ============================================================
-- Exames/documentos do paciente: bucket privado + file_path
-- ------------------------------------------------------------
-- UploadDocumentModal.tsx gravava file_url = URL.createObjectURL(file)
-- (comentário no próprio código: "MOCK VERSION") — uma blob: URL válida
-- só na aba/sessão que fez o upload. O arquivo nunca chegava ao Storage,
-- então ao reabrir a ficha do paciente o link do exame estava morto.
--
-- Este migration cria o bucket privado 'documents' (mesmo nome da tabela
-- public.documents que a aba Exams já usa) e passa a referenciar o objeto
-- por caminho (file_path), servido via signed URL no frontend — mesmo
-- padrão já corrigido para call-recordings em 20260626_call_recordings_bucket.sql.
-- ============================================================

-- 1. Bucket privado (idempotente; força privado mesmo se já existir)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'documents',
    'documents',
    false,
    26214400, -- 25 MB
    ARRAY['application/pdf','image/jpeg','image/png','image/webp','application/dicom']
)
ON CONFLICT (id) DO UPDATE SET public = false;

-- 2. Caminho do objeto no Storage (file_url deixa de ser a fonte de verdade)
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS file_path TEXT;
ALTER TABLE public.documents ALTER COLUMN file_url DROP NOT NULL;

-- 3. RLS em storage.objects — tenant autenticado só acessa a própria pasta
--    (convenção de caminho: <tenant_id>/<patient_id>/<arquivo>)
DROP POLICY IF EXISTS "Tenant read own documents" ON storage.objects;
CREATE POLICY "Tenant read own documents"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'documents'
        AND (storage.foldername(name))[1] = (
            SELECT m.tenant_id::text FROM public.members m
            WHERE m.user_id = auth.uid() AND m.is_active = true
            LIMIT 1
        )
    );

DROP POLICY IF EXISTS "Tenant upload own documents" ON storage.objects;
CREATE POLICY "Tenant upload own documents"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'documents'
        AND (storage.foldername(name))[1] = (
            SELECT m.tenant_id::text FROM public.members m
            WHERE m.user_id = auth.uid() AND m.is_active = true
            LIMIT 1
        )
    );

DROP POLICY IF EXISTS "Tenant delete own documents" ON storage.objects;
CREATE POLICY "Tenant delete own documents"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'documents'
        AND (storage.foldername(name))[1] = (
            SELECT m.tenant_id::text FROM public.members m
            WHERE m.user_id = auth.uid() AND m.is_active = true
            LIMIT 1
        )
    );

DROP POLICY IF EXISTS "Service role full access documents" ON storage.objects;
CREATE POLICY "Service role full access documents"
    ON storage.objects FOR ALL
    TO service_role
    USING (bucket_id = 'documents')
    WITH CHECK (bucket_id = 'documents');

-- 4. RLS da tabela public.documents tinha apenas SELECT/INSERT
--    (20260323_add_prescriptions_and_documents.sql) — sem UPDATE/DELETE,
--    então excluir um exame falhava em silêncio (0 linhas afetadas).
DROP POLICY IF EXISTS "Members can update tenant documents" ON public.documents;
CREATE POLICY "Members can update tenant documents" ON public.documents
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.members
            WHERE members.tenant_id = documents.tenant_id
            AND members.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Members can delete tenant documents" ON public.documents;
CREATE POLICY "Members can delete tenant documents" ON public.documents
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.members
            WHERE members.tenant_id = documents.tenant_id
            AND members.user_id = auth.uid()
        )
    );

-- 5. Mesma lacuna de RLS existe em public.prescriptions
DROP POLICY IF EXISTS "Members can update tenant prescriptions" ON public.prescriptions;
CREATE POLICY "Members can update tenant prescriptions" ON public.prescriptions
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.members
            WHERE members.tenant_id = prescriptions.tenant_id
            AND members.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Members can delete tenant prescriptions" ON public.prescriptions;
CREATE POLICY "Members can delete tenant prescriptions" ON public.prescriptions
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.members
            WHERE members.tenant_id = prescriptions.tenant_id
            AND members.user_id = auth.uid()
        )
    );
