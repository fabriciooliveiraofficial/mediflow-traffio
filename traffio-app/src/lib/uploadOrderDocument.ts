import { supabase } from './supabase';
import type { DocumentType } from '../constants/numberOrderRequirements';

export interface UploadResult {
  filePath: string;
  fileName: string;
  fileSize: number;
}

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES  = ['image/jpeg', 'image/png', 'application/pdf'];

export async function uploadOrderDocument(
  tenantId: string,
  orderId:  string,
  docType:  DocumentType,
  file:     File
): Promise<UploadResult> {
  if (file.size > MAX_SIZE_BYTES) {
    throw new Error(`Arquivo muito grande. Máximo permitido: 10 MB`);
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error(`Formato inválido. Use PDF, JPG ou PNG`);
  }

  const ext      = file.name.split('.').pop() ?? 'pdf';
  const filePath = `${tenantId}/${orderId}/${docType}_${Date.now()}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from('number-order-documents')
    .upload(filePath, file, { upsert: true, contentType: file.type });

  if (uploadErr) throw new Error(`Erro no upload: ${uploadErr.message}`);

  const { error: dbErr } = await supabase
    .from('number_order_documents')
    .upsert(
      {
        order_id:      orderId,
        tenant_id:     tenantId,
        document_type: docType,
        file_path:     filePath,
        file_name:     file.name,
        file_size:     file.size,
        status:        'pending',
      },
      { onConflict: 'order_id,document_type' }
    );

  if (dbErr) throw new Error(`Erro ao registrar documento: ${dbErr.message}`);

  return { filePath, fileName: file.name, fileSize: file.size };
}

export async function getDocumentSignedUrl(filePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('number-order-documents')
    .createSignedUrl(filePath, 3600); // TTL: 60 minutos

  if (error || !data?.signedUrl) throw new Error('Erro ao gerar URL do documento');
  return data.signedUrl;
}
