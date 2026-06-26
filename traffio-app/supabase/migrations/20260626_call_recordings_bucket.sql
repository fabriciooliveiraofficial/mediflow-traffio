-- ============================================================
-- Call recordings: bucket privado + RLS + recording_path
-- ------------------------------------------------------------
-- Corrige gravações de chamadas inacessíveis na página Comunicações.
-- O webhook telnyx-call-webhook tentava subir o áudio para o bucket
-- 'call-recordings', mas nenhum bucket existia → upload falhava e o
-- recording_url ficava apontando para a URL temporária da Telnyx, que
-- expira após a retenção. Aqui criamos o bucket (privado, pois é áudio
-- sensível de pacientes) e passamos a referenciar o objeto por caminho,
-- servindo via URL assinada no frontend.
-- ============================================================

-- 1. Bucket privado (idempotente; força privado mesmo se já existir)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'call-recordings',
    'call-recordings',
    false,
    52428800, -- 50 MB
    ARRAY['audio/mpeg','audio/wav','audio/mp3']
)
ON CONFLICT (id) DO UPDATE SET public = false;

-- 2. RLS em storage.objects (espelha number-order-documents)
-- Tenant autenticado lê apenas a própria pasta (folder[1] = tenant_id)
DROP POLICY IF EXISTS "Tenant read own recordings" ON storage.objects;
CREATE POLICY "Tenant read own recordings"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'call-recordings'
        AND (storage.foldername(name))[1] = (
            SELECT m.tenant_id::text FROM public.members m
            WHERE m.user_id = auth.uid() AND m.is_active = true
            LIMIT 1
        )
    );

-- Service role (webhook) faz upload/gestão completa
DROP POLICY IF EXISTS "Service role full access call-recordings" ON storage.objects;
CREATE POLICY "Service role full access call-recordings"
    ON storage.objects FOR ALL
    TO service_role
    USING (bucket_id = 'call-recordings')
    WITH CHECK (bucket_id = 'call-recordings');

-- 3. Colunas de caminho do objeto no Storage
ALTER TABLE public.call_records ADD COLUMN IF NOT EXISTS recording_path TEXT;
ALTER TABLE public.voicemails   ADD COLUMN IF NOT EXISTS recording_path TEXT;

-- 4. Backfill: recuperar objetos que já estavam no Storage (URL pública antiga)
-- extrai o caminho de URLs no formato .../object/public/call-recordings/<path>
UPDATE public.call_records
SET recording_path = split_part(recording_url, '/object/public/call-recordings/', 2)
WHERE recording_url LIKE '%/object/public/call-recordings/%'
  AND recording_path IS NULL;

UPDATE public.voicemails
SET recording_path = split_part(recording_url, '/object/public/call-recordings/', 2)
WHERE recording_url LIKE '%/object/public/call-recordings/%'
  AND recording_path IS NULL;
