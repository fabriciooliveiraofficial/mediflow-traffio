import React, { useRef, useState } from 'react';
import { Upload, CheckCircle, XCircle, Loader, FileText, X } from 'lucide-react';
import type { DocumentType } from '../../constants/numberOrderRequirements';
import { DOCUMENT_LABELS } from '../../constants/numberOrderRequirements';
import { uploadOrderDocument } from '../../lib/uploadOrderDocument';

interface Props {
  documentType: DocumentType;
  tenantId:     string;
  orderId:      string;
  onUploaded:   (filePath: string, fileName: string) => void;
  uploadedFile?: { name: string; path: string } | null;
  onRemove?:    () => void;
}

export function DocumentUploadField({ documentType, tenantId, orderId, onUploaded, uploadedFile, onRemove }: Props) {
  const inputRef               = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const req = DOCUMENT_LABELS[documentType];

  const handleFile = async (file: File) => {
    setError(null);
    setLoading(true);
    try {
      const result = await uploadOrderDocument(tenantId, orderId, documentType, file);
      onUploaded(result.filePath, result.fileName);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  if (uploadedFile) {
    return (
      <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-xl">
        <CheckCircle size={18} className="text-green-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-black text-graphite-800">{req.label}</p>
          <p className="text-xs text-graphite-400 truncate">{uploadedFile.name}</p>
        </div>
        {onRemove && (
          <button onClick={onRemove} className="p-1 hover:bg-green-100 rounded-lg transition-colors border-none cursor-pointer bg-transparent">
            <X size={14} className="text-graphite-400" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs font-black text-graphite-700 mb-1">
        {req.label}
        <span className="ml-1 text-red-400">*</span>
      </p>
      <p className="text-[11px] text-graphite-400 mb-2">{req.description}</p>
      <div
        onClick={() => !loading && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`
          border-2 border-dashed rounded-xl px-4 py-5 text-center transition-all cursor-pointer
          ${dragging ? 'border-brand-primary bg-brand-primary/5' : 'border-ice-300 bg-ice-50 hover:border-brand-primary/50 hover:bg-brand-primary/5'}
          ${loading ? 'opacity-60 cursor-wait' : ''}
        `}
      >
        {loading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader size={20} className="animate-spin text-brand-primary" />
            <p className="text-xs text-graphite-400">Enviando...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <Upload size={18} className="text-graphite-300" />
            <p className="text-xs font-bold text-graphite-600">Arraste ou clique para enviar</p>
            <p className="text-[10px] text-graphite-300">PDF, JPG ou PNG · Máx. 10 MB</p>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <XCircle size={13} className="text-red-400 shrink-0" />
          <p className="text-[11px] text-red-500">{error}</p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={req.accept}
        onChange={onInputChange}
        className="hidden"
      />
    </div>
  );
}
