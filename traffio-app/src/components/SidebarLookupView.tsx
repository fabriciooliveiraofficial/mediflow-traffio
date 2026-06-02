import React, { useState } from 'react';
import { Search, ChevronLeft, User, Loader2, Link } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';

interface SidebarLookupViewProps {
  onBack: () => void;
  onSelect: (patient: any) => void;
}

export function SidebarLookupView({ onBack, onSelect }: SidebarLookupViewProps) {
  const { tenant } = useTenant();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (query.length < 3) return;
    if (!tenant?.id) return;

    setSearching(true);
    try {
      const { data } = await supabase
        .from('patients')
        .select('*')
        .eq('tenant_id', tenant.id)
        .or(`full_name.ilike.%${query}%,cpf.ilike.%${query}%,phone.ilike.%${query}%`)
        .limit(10);
      setResults(data || []);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 bg-gray-50/50">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-white text-gray-500 transition-colors shadow-sm">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-bold text-gray-700">Vincular Paciente</span>
      </div>

      <div className="p-4 border-b border-gray-100">
        <form onSubmit={handleSearch} className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
          <input
            autoFocus
            className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            placeholder="Nome, CPF ou Telefone..."
            value={query}
            onChange={e => {
                setQuery(e.target.value);
                if (e.target.value.length > 3) handleSearch();
            }}
          />
        </form>
        <p className="text-[10px] text-gray-400 mt-2 ml-1">Digite pelo menos 3 caracteres para buscar.</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {searching && (
          <div className="p-8 flex flex-col items-center justify-center text-gray-400 gap-2">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-xs">Buscando na base...</span>
          </div>
        )}

        {!searching && results.length === 0 && query.length >= 3 && (
          <div className="p-8 text-center">
            <User className="w-8 h-8 text-gray-200 mx-auto mb-2" />
            <p className="text-xs text-gray-500 font-medium">Nenhum paciente encontrado.</p>
            <p className="text-[10px] text-gray-400 mt-1">Verifique os dados ou cadastre um novo.</p>
          </div>
        )}

        <div className="divide-y divide-gray-50">
          {results.map(p => (
            <button
              key={p.id}
              onClick={() => onSelect(p)}
              className="w-full p-4 text-left hover:bg-blue-50/50 transition-colors group flex items-start gap-3"
            >
              <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                <User className="w-4 h-4 text-gray-500 group-hover:text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-gray-900 truncate">{p.full_name}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{p.cpf || 'Sem CPF'}</p>
                <div className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10px] text-blue-600 font-bold uppercase tracking-wider">
                  <Link size={10} /> Vincular Agora
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
