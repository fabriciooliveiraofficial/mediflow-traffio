import React, { useState, useEffect, useRef } from 'react';
import { 
  X, Paperclip, Link as LinkIcon, Trash2, Loader2, Sparkles, 
  Image as ImageIcon, Music, FileText, Globe, Plus, MessageSquare,
  AlertTriangle
} from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { salesScriptService } from '../services/salesScriptService';
import type { SalesScript, ScriptAttachment } from '../services/salesScriptService';
import { shortLinkService } from '../services/shortLinkService';

interface ScriptEditorFormProps {
  tenantId: string;
  script?: SalesScript | null;
  onSave: (scriptData: Partial<SalesScript>) => Promise<void>;
  onCancel: () => void;
}

const PREDEFINED_ICONS = [
  { char: '💬', name: 'Chat' },
  { char: '📅', name: 'Agenda' },
  { char: '🎉', name: 'Festa' },
  { char: '⚠️', name: 'Aviso' },
  { char: '💰', name: 'Preço' },
  { char: '📍', name: 'Local' },
  { char: '🎁', name: 'Brinde' },
  { char: '⏱️', name: 'Urgente' },
  { char: '📝', name: 'Nota' },
  { char: '🤝', name: 'Acordo' }
];

export function ScriptEditorForm({ tenantId, script, onSave, onCancel }: ScriptEditorFormProps) {
  const { showToast } = useToast();
  
  const [shortcut, setShortcut] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Geral');
  const [icon, setIcon] = useState('💬');
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<ScriptAttachment[]>([]);
  
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Link Dialog State
  const [showLinkFields, setShowLinkFields] = useState(false);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [shouldShorten, setShouldShorten] = useState(false);
  const [customAlias, setCustomAlias] = useState('');
  const [shortening, setShortening] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setShouldShorten(false);
    setCustomAlias('');
    setShortening(false);
    if (script) {
      setShortcut(script.shortcut || '');
      setTitle(script.title || '');
      setCategory(script.category || 'Geral');
      setIcon(script.icon || '💬');
      setContent(script.content || '');
      setAttachments(script.attachments || []);
    } else {
      setShortcut('');
      setTitle('');
      setCategory('Geral');
      setIcon('💬');
      setContent('');
      setAttachments([]);
    }
  }, [script]);

  const insertVariable = (variable: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const startPos = textarea.selectionStart;
    const endPos = textarea.selectionEnd;
    const beforeText = content.substring(0, startPos);
    const afterText = content.substring(endPos, content.length);
    
    const newContent = beforeText + variable + afterText;
    setContent(newContent);
    
    // Reset focus and cursor position
    setTimeout(() => {
      textarea.focus();
      const cursorPosition = startPos + variable.length;
      textarea.setSelectionRange(cursorPosition, cursorPosition);
    }, 50);
  };

  const handleShortcutChange = (val: string) => {
    // Remove slash, spaces, and special characters, keep alphanumeric and hyphens/underscores
    const cleanVal = val
      .replace(/^\//, '')
      .replace(/\s+/g, '')
      .replace(/[^a-zA-Z0-9-_]/g, '')
      .toLowerCase();
    setShortcut(cleanVal);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const url = await salesScriptService.uploadAttachment(tenantId, file);
      
      const fileType = file.type;
      let type: 'image' | 'audio' | 'video' | 'document' = 'document';
      if (fileType.startsWith('image/')) type = 'image';
      else if (fileType.startsWith('audio/')) type = 'audio';
      else if (fileType.startsWith('video/')) type = 'video';

      const newAttachment: ScriptAttachment = {
        type,
        url,
        name: file.name,
        mimeType: fileType,
        fileSize: file.size
      };

      setAttachments(prev => [...prev, newAttachment]);
      showToast('success', 'Arquivo carregado com sucesso!');
    } catch (err: any) {
      showToast('error', 'Erro ao carregar arquivo: ' + err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAddLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkTitle || !linkUrl) return;

    let formattedUrl = linkUrl.trim();
    if (!/^https?:\/\//i.test(formattedUrl)) {
      formattedUrl = 'https://' + formattedUrl;
    }

    setShortening(true);
    try {
      let finalUrl = formattedUrl;
      
      if (shouldShorten) {
        // Create shortened link in database
        const cleanAlias = customAlias.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
        const shortLink = await shortLinkService.create(tenantId, formattedUrl, cleanAlias || undefined);
        finalUrl = window.location.origin + '/l/' + shortLink.code;
        showToast('success', 'Link encurtado criado com sucesso!');
      }

      const newAttachment: ScriptAttachment = {
        type: 'link',
        url: finalUrl,
        name: linkTitle
      };

      setAttachments(prev => [...prev, newAttachment]);
      setLinkTitle('');
      setLinkUrl('');
      setCustomAlias('');
      setShouldShorten(false);
      setShowLinkFields(false);
    } catch (err: any) {
      showToast('error', 'Erro ao encurtar/adicionar link: ' + err.message);
    } finally {
      setShortening(false);
    }
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shortcut) {
      showToast('warning', 'O atalho do script é obrigatório.');
      return;
    }
    if (!title) {
      showToast('warning', 'O título do script é obrigatório.');
      return;
    }
    if (!content) {
      showToast('warning', 'O conteúdo do script é obrigatório.');
      return;
    }

    setSaving(true);
    try {
      // Automatically detect any custom variables like [[Dia e Hora]] inside content
      const manualMatches: string[] = [];
      const manualRegex = /\*\*\[(.*?)\]\*\*|\[\[(.*?)\]\]|\[([^\]]+?)\]/g;
      let match;
      const reservedNames = ['Nome Paciente', 'Seu Nome/atendente', 'Nome da Clínica', 'Nome', 'Seu Nome', 'paciente_nome', 'clinica_nome', 'atendente_nome'];

      while ((match = manualRegex.exec(content)) !== null) {
        const varName = match[1] || match[2] || match[3];
        if (varName && !manualMatches.includes(varName)) {
          if (varName === ' ' || varName.toLowerCase() === 'x') continue;
          if (reservedNames.includes(varName)) continue;
          manualMatches.push(varName);
        }
      }

      await onSave({
        shortcut,
        title,
        category,
        icon,
        content,
        attachments,
        variables: manualMatches,
        tenant_id: tenantId
      });
      showToast('success', script ? 'Script atualizado!' : 'Script criado com sucesso!');
    } catch (err: any) {
      showToast('error', 'Erro ao salvar script: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const getAttachmentIcon = (type: string) => {
    switch (type) {
      case 'image': return <ImageIcon className="w-4 h-4 text-emerald-500" />;
      case 'audio': return <Music className="w-4 h-4 text-indigo-500" />;
      case 'link': return <Globe className="w-4 h-4 text-sky-500" />;
      default: return <FileText className="w-4 h-4 text-amber-500" />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-blue-50/50 to-white">
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-blue-600" />
          {script ? 'Editar Script' : 'Novo Script'}
        </h3>
        <button 
          onClick={onCancel}
          className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 border-none bg-transparent cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Form Area */}
      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {script && script.tenant_id === null && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-[11px] text-amber-800 leading-normal font-medium">
              <span className="font-bold">Modelo Sugerido da Plataforma:</span> Este script é um modelo sugerido. Ao salvá-lo, uma cópia personalizada será criada exclusivamente para sua clínica, mantendo o modelo original intacto.
            </div>
          </div>
        )}
        {/* Shortcut and Category */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Atalho (sem espaço)</label>
            <div className="relative flex items-center">
              <span className="absolute left-3.5 text-gray-400 font-bold text-sm">/</span>
              <input
                type="text"
                required
                value={shortcut}
                onChange={e => handleShortcutChange(e.target.value)}
                placeholder="ex: boasvindas"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-7 pr-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Categoria</label>
            <input
              type="text"
              value={category}
              onChange={e => setCategory(e.target.value)}
              placeholder="ex: Atendimento, Vendas"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>
        </div>

        {/* Title and Icon */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 flex flex-col gap-1">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Título do Script</label>
            <input
              type="text"
              required
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="ex: Apresentação inicial da clínica"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Ícone</label>
            <select
              value={icon}
              onChange={e => setIcon(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-center"
            >
              {PREDEFINED_ICONS.map(i => (
                <option key={i.char} value={i.char}>{i.char} {i.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Text Content */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Conteúdo da Mensagem</label>
          <textarea
            ref={textareaRef}
            required
            rows={6}
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Digite sua mensagem de venda aqui. Use [[Variável]] para campos que deseja preencher na hora de enviar."
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none leading-relaxed"
          />
        </div>

        {/* Quick Variable Insert */}
        <div className="space-y-1.5">
          <span className="text-[9px] font-black text-gray-400 uppercase tracking-wider block">Inserir Variável Automática</span>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => insertVariable('{{paciente_nome}}')}
              className="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-bold border border-blue-200/50 cursor-pointer transition-colors"
            >
              👤 Paciente
            </button>
            <button
              type="button"
              onClick={() => insertVariable('{{clinica_nome}}')}
              className="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-bold border border-blue-200/50 cursor-pointer transition-colors"
            >
              🏥 Clínica
            </button>
            <button
              type="button"
              onClick={() => insertVariable('{{atendente_nome}}')}
              className="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-bold border border-blue-200/50 cursor-pointer transition-colors"
            >
              💼 Atendente
            </button>
            <button
              type="button"
              onClick={() => insertVariable('[[Dia e Hora]]')}
              className="px-2 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 text-[10px] font-bold border border-amber-200/50 cursor-pointer transition-colors flex items-center gap-1"
            >
              <Plus size={10} /> Variável Manual
            </button>
          </div>
        </div>

        {/* Attachments Section */}
        <div className="border-t border-gray-100 pt-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Mídia & Anexos ({attachments.length})</span>
            <div className="flex gap-2">
              <input
                type="file"
                ref={fileInputRef}
                hidden
                onChange={handleFileUpload}
                accept="image/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-[10px] font-black border-none cursor-pointer flex items-center gap-1 transition-all disabled:opacity-50"
              >
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />}
                Arquivo
              </button>
              <button
                type="button"
                onClick={() => setShowLinkFields(!showLinkFields)}
                className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-[10px] font-black border-none cursor-pointer flex items-center gap-1 transition-all"
              >
                <LinkIcon size={12} />
                Link
              </button>
            </div>
          </div>

          {/* Inline Link Form */}
          {showLinkFields && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Título do Link"
                  value={linkTitle}
                  onChange={e => setLinkTitle(e.target.value)}
                  className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold focus:outline-none"
                />
                <input
                  type="text"
                  placeholder="URL (ex: google.com)"
                  value={linkUrl}
                  onChange={e => setLinkUrl(e.target.value)}
                  className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold focus:outline-none"
                />
              </div>

              {/* Shortener options */}
              <div className="space-y-2 pt-1 border-t border-gray-100/50">
                <label className="flex items-center gap-2 text-[10px] font-bold text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={shouldShorten}
                    onChange={e => {
                      setShouldShorten(e.target.checked);
                      if (!e.target.checked) setCustomAlias('');
                    }}
                    className="rounded text-blue-600 focus:ring-blue-500 border-gray-300 w-3.5 h-3.5"
                  />
                  Encurtar link com domínio Traffio
                </label>

                {shouldShorten && (
                  <div className="pl-5 space-y-1.5 animate-in fade-in duration-200">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-wide">Sufixo Personalizado (Opcional)</span>
                      <div className="relative flex items-center">
                        <span className="absolute left-2.5 text-gray-400 font-bold text-[10px]">/l/</span>
                        <input
                          type="text"
                          placeholder="ex: promocao-junho"
                          value={customAlias}
                          onChange={e => setCustomAlias(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                          className="bg-white border border-gray-200 rounded-lg pl-6 pr-2.5 py-1 text-[10px] font-semibold focus:outline-none w-full"
                        />
                      </div>
                    </div>
                    <div className="text-[9px] font-bold text-blue-600 bg-blue-50/50 border border-blue-100/30 rounded-lg px-2 py-1 flex items-center gap-1">
                      <span>Visualização:</span>
                      <span className="font-mono text-slate-600 select-all">
                        {window.location.origin}/l/{customAlias || '[aleatório]'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  disabled={shortening}
                  onClick={() => setShowLinkFields(false)}
                  className="px-2 py-1 text-[10px] font-bold text-gray-500 hover:text-gray-900 border-none bg-transparent cursor-pointer disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={shortening}
                  onClick={handleAddLink}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-[10px] font-bold border-none cursor-pointer flex items-center gap-1"
                >
                  {shortening && <Loader2 size={10} className="animate-spin" />}
                  Adicionar
                </button>
              </div>
            </div>
          )}

          {/* Attachments List */}
          {attachments.length > 0 && (
            <div className="space-y-1.5 bg-gray-50/50 p-2 border border-gray-100 rounded-xl">
              {attachments.map((att, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2 bg-white px-2.5 py-1.5 rounded-lg border border-gray-200/60 shadow-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    {getAttachmentIcon(att.type)}
                    <span className="text-[11px] font-bold text-gray-700 truncate max-w-[200px]" title={att.name}>
                      {att.name}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(idx)}
                    className="p-1 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors border-none bg-transparent cursor-pointer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </form>

      {/* Footer */}
      <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2.5">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2.5 text-xs font-black text-gray-500 hover:text-gray-900 transition-colors border-none bg-transparent cursor-pointer uppercase tracking-widest"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving}
          className="px-5 py-2.5 text-xs font-black text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-xl shadow-lg shadow-blue-600/10 transition-all cursor-pointer uppercase tracking-widest flex items-center gap-1.5 border-none"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
          Salvar Script
        </button>
      </div>
    </div>
  );
}
