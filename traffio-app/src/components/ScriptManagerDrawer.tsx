import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Search, Plus, Pencil, Trash2, X, Zap, 
  Globe, FileText, Image as ImageIcon, Music, Loader2
} from 'lucide-react';
import { salesScriptService } from '../services/salesScriptService';
import type { SalesScript } from '../services/salesScriptService';
import { ScriptEditorForm } from './ScriptEditorForm';
import { useToast } from '../contexts/ToastContext';
import { clsx } from 'clsx';

interface ScriptManagerDrawerProps {
  tenantId: string;
  isOpen: boolean;
  initialEditingId?: string | null;
  onClose: () => void;
  onScriptsUpdated: (scripts: SalesScript[]) => void;
}

export function ScriptManagerDrawer({ 
  tenantId, 
  isOpen, 
  initialEditingId,
  onClose, 
  onScriptsUpdated 
}: ScriptManagerDrawerProps) {
  const { t } = useTranslation('communications');
  const { showToast, showConfirm } = useToast();
  
  const [scripts, setScripts] = useState<SalesScript[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Todos');
  
  // Navigation State
  const [currentView, setCurrentView] = useState<'list' | 'create' | 'edit'>('list');
  const [editingScript, setEditingScript] = useState<SalesScript | null>(null);

  const loadScripts = async () => {
    setLoading(true);
    try {
      const data = await salesScriptService.getAll(tenantId);
      setScripts(data);
      onScriptsUpdated(data);
      return data;
    } catch (err: any) {
      showToast('error', t('scriptManagerDrawer.toasts.loadErrorPrefix') + err.message);
      return [];
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && tenantId) {
      loadScripts().then((loadedData) => {
        if (initialEditingId) {
          const found = loadedData.find(s => s.id === initialEditingId);
          if (found) {
            setEditingScript(found);
            setCurrentView('edit');
          }
        } else {
          setCurrentView('list');
          setEditingScript(null);
        }
      });
    }
  }, [isOpen, tenantId, initialEditingId]);

  // Handle outside initialization when scripts are already loaded
  useEffect(() => {
    if (initialEditingId && scripts.length > 0) {
      const found = scripts.find(s => s.id === initialEditingId);
      if (found) {
        setEditingScript(found);
        setCurrentView('edit');
      }
    }
  }, [initialEditingId, scripts]);

  const handleDelete = async (e: React.MouseEvent, id: string, title: string) => {
    e.stopPropagation();
    
    const confirm = await showConfirm(t('scriptManagerDrawer.deleteConfirm', { title }));
    if (!confirm) return;

    try {
      await salesScriptService.delete(id);
      showToast('success', t('scriptManagerDrawer.toasts.deleted'));
      loadScripts();
    } catch (err: any) {
      showToast('error', t('scriptManagerDrawer.toasts.deleteErrorPrefix') + err.message);
    }
  };

  const handleSave = async (scriptData: Partial<SalesScript>) => {
    if (currentView === 'edit' && editingScript) {
      const isSuggested = !editingScript.tenant_id || editingScript.tenant_id === 'null';
      if (isSuggested) {
        // It's a platform suggested template. Clone it under the active tenant instead of updating it!
        await salesScriptService.create({
          ...scriptData,
          id: undefined, // Let DB generate a new UUID
          tenant_id: tenantId
        });
        showToast('success', t('scriptManagerDrawer.toasts.suggestedSavedAsNew'));
      } else {
        await salesScriptService.update(editingScript.id, scriptData);
      }
    } else {
      await salesScriptService.create(scriptData);
    }
    setCurrentView('list');
    setEditingScript(null);
    loadScripts();
  };

  // Get categories dynamically
  const categories = ['Todos', ...Array.from(new Set(scripts.map(s => s.category || 'Geral')))];

  // Filter scripts
  const filteredScripts = scripts.filter(s => {
    const matchesSearch = 
      s.shortcut.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.content.toLowerCase().includes(searchQuery.toLowerCase());
      
    const matchesCategory = 
      selectedCategory === 'Todos' || 
      (s.category || 'Geral') === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  const getAttachmentIndicator = (attachments: any[]) => {
    if (!attachments || attachments.length === 0) return null;
    
    const counts = { image: 0, audio: 0, video: 0, document: 0, link: 0 };
    attachments.forEach(att => {
      if (att.type in counts) {
        counts[att.type as keyof typeof counts]++;
      }
    });

    return (
      <div className="flex items-center gap-1.5 mt-1 text-[10px] text-gray-400">
        {attachments.map((att, index) => {
          let icon = <FileText size={10} />;
          if (att.type === 'image') icon = <ImageIcon size={10} className="text-emerald-500" />;
          else if (att.type === 'audio') icon = <Music size={10} className="text-indigo-500" />;
          else if (att.type === 'link') icon = <Globe size={10} className="text-sky-500" />;
          
          return (
            <span key={index} className="inline-flex items-center gap-0.5 bg-gray-50 border border-gray-100 rounded px-1 py-0.5 text-gray-500 font-medium" title={att.name}>
              {icon}
              <span className="truncate max-w-[60px] text-[9px]">{att.name}</span>
            </span>
          );
        })}
      </div>
    );
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-y-0 right-0 z-[100] w-96 bg-white border-l border-gray-200 shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-250">
      {currentView === 'list' ? (
        <div className="flex flex-col h-full bg-white">
          {/* Header */}
          <div className="px-4 py-3.5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-blue-50/50 to-white">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-200">
                <Zap size={14} fill="currentColor" />
              </div>
              <span className="text-sm font-bold text-gray-800">{t('scriptManagerDrawer.header')}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setEditingScript(null);
                  setCurrentView('create');
                }}
                className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 border-none bg-transparent cursor-pointer flex items-center gap-1 text-xs font-black uppercase tracking-wider"
                title={t('scriptManagerDrawer.createTitle')}
              >
                <Plus className="w-4 h-4" />
                {t('scriptManagerDrawer.new')}
              </button>
              <button 
                onClick={onClose} 
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 border-none bg-transparent cursor-pointer"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>

          {/* Search bar */}
          <div className="p-3 border-b border-gray-100 bg-gray-50/50">
            <div className="relative flex items-center bg-white border border-gray-200 rounded-xl px-3 py-1.5 shadow-sm">
              <Search className="w-4 h-4 text-gray-400 shrink-0 mr-2" />
              <input
                type="text"
                placeholder={t('scriptManagerDrawer.searchPlaceholder')}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full text-xs outline-none bg-transparent placeholder:text-gray-300 font-medium"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="p-0.5 hover:bg-gray-100 rounded-full border-none bg-transparent cursor-pointer">
                  <X className="w-3 h-3 text-gray-400" />
                </button>
              )}
            </div>
          </div>

          {/* Category Tabs */}
          {categories.length > 2 && (
            <div className="px-3 py-2 border-b border-gray-100 flex gap-1.5 overflow-x-auto no-scrollbar bg-gray-50/20 shrink-0">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={clsx(
                    "px-3 py-1 rounded-lg text-[10px] font-bold transition-all border-none cursor-pointer tracking-wider shrink-0 uppercase",
                    selectedCategory === cat
                      ? "bg-blue-600 text-white shadow-sm"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200/60"
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          {/* Scripts List */}
          <div className="flex-1 overflow-y-auto custom-scrollbar divide-y divide-gray-100">
            {loading ? (
              <div className="p-12 flex flex-col items-center justify-center text-gray-400 gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                <span className="text-xs">{t('scriptManagerDrawer.loading')}</span>
              </div>
            ) : filteredScripts.length === 0 ? (
              <div className="p-12 text-center flex flex-col items-center justify-center">
                <Zap className="w-8 h-8 text-gray-200 mb-2" />
                <p className="text-xs text-gray-500 font-bold">{t('scriptManagerDrawer.empty.title')}</p>
                <p className="text-[10px] text-gray-400 mt-1 max-w-[200px] leading-relaxed">{t('scriptManagerDrawer.empty.subtitle')}</p>
                <button
                  onClick={() => {
                    setEditingScript(null);
                    setCurrentView('create');
                  }}
                  className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-black uppercase tracking-widest border-none cursor-pointer hover:bg-blue-700 shadow-lg shadow-blue-600/10 flex items-center gap-1"
                >
                  <Plus size={14} />
                  {t('scriptManagerDrawer.empty.createFirst')}
                </button>
              </div>
            ) : (
              filteredScripts.map(script => {
                const isGlobal = !script.tenant_id || script.tenant_id === 'null';
                return (
                  <div 
                    key={script.id}
                    onClick={() => {
                      setEditingScript(script);
                      setCurrentView('edit');
                    }}
                    className="p-4 text-left transition-colors flex items-start gap-3 relative group hover:bg-blue-50/20 cursor-pointer"
                  >
                    <div className="w-9 h-9 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 text-base shadow-sm">
                      {script.icon || '💬'}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-extrabold text-[10px] text-blue-600 bg-blue-50 border border-blue-100/50 rounded-md px-1.5 py-0.5 tracking-tight shrink-0">
                            /{script.shortcut}
                          </span>
                          <span className="text-xs font-bold text-gray-900 truncate">
                            {script.title}
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isGlobal && (
                            <span className="text-[8px] font-black text-slate-400 bg-slate-200/60 px-1.5 py-0.5 rounded uppercase tracking-wider">
                              {t('scriptManagerDrawer.suggestedBadge')}
                            </span>
                          )}
                           <div className="flex items-center gap-1.5 bg-transparent shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingScript(script);
                                setCurrentView('edit');
                              }}
                              className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-blue-50 text-slate-700 hover:text-blue-600 hover:border-blue-200 transition-all cursor-pointer shadow-sm flex items-center justify-center shrink-0"
                              title={isGlobal ? t('scriptManagerDrawer.customizeEditTitle') : t('scriptManagerDrawer.editTitle')}
                            >
                              <Pencil size={13} />
                            </button>
                            {!isGlobal && (
                              <button
                                onClick={(e) => handleDelete(e, script.id, script.title)}
                                className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-red-50 text-slate-500 hover:text-red-600 hover:border-red-200 transition-all cursor-pointer shadow-sm flex items-center justify-center shrink-0"
                                title={t('scriptManagerDrawer.deleteTitle')}
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      <p className="text-[11px] text-gray-500 mt-1 line-clamp-2 leading-relaxed" title={script.content}>
                        {script.content}
                      </p>

                      {script.category && (
                        <span className="inline-block text-[8px] font-bold text-gray-400 bg-gray-100 border border-gray-200/40 px-1.5 py-0.5 rounded-full mt-1.5 uppercase tracking-wide">
                          {script.category}
                        </span>
                      )}

                      {getAttachmentIndicator(script.attachments)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <ScriptEditorForm
          tenantId={tenantId}
          script={editingScript}
          onSave={handleSave}
          onCancel={() => {
            setCurrentView('list');
            setEditingScript(null);
          }}
        />
      )}
    </div>,
    document.body
  );
}
