-- Add is_dicom flag and metadata to documents table
ALTER TABLE public.documents 
ADD COLUMN IF NOT EXISTS is_dicom BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS dicom_metadata JSONB DEFAULT '{}'::jsonb;

-- Create an index for faster filtering of DICOM files
CREATE INDEX IF NOT EXISTS idx_documents_is_dicom ON public.documents(is_dicom) WHERE is_dicom = TRUE;
