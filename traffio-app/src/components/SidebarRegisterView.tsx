import React, { useState } from 'react';
import { User, CreditCard, Mail, Phone, ChevronLeft, Loader2, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';
import { useToast } from '../contexts/ToastContext';

interface SidebarRegisterViewProps {
  onBack: () => void;
  onSuccess: (patient: any) => void;
  initialPhone?: string;
}

export function SidebarRegisterView({ onBack, onSuccess, initialPhone }: SidebarRegisterViewProps) {
  const { tenant } = useTenant();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '',
    cpf: '',
    phone: initialPhone || '',
    email: '',
    type: 'particular' as 'particular' | 'convenio'
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenant?.id) return;
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from('patients')
        .insert({
          tenant_id: tenant.id,
          ...formData
        })
        .select()
        .single();

      if (error) throw error;
      showToast('success', 'Paciente cadastrado com sucesso!');
      onSuccess(data);
    } catch (err: any) {
      showToast('error', err.message || 'Falha ao cadastrar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 bg-blue-50/50">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-white text-gray-500 transition-colors shadow-sm">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-bold text-blue-700">Novo Cadastro</span>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ml-1">Nome Completo</label>
          <div className="relative">
            <User className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              required
              className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              placeholder="Ex: Ricardo Albeniz"
              value={formData.full_name}
              onChange={e => setFormData({ ...formData, full_name: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ml-1">CPF</label>
          <div className="relative">
            <CreditCard className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              placeholder="000.000.000-00"
              value={formData.cpf}
              onChange={e => setFormData({ ...formData, cpf: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ml-1">Whatsapp</label>
          <div className="relative">
            <Phone className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              disabled={!!initialPhone}
              className={`w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl transition-all ${
                initialPhone 
                  ? 'bg-gray-100 cursor-not-allowed opacity-70' 
                  : 'bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500'
              }`}
              value={formData.phone}
              onChange={e => setFormData({ ...formData, phone: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ml-1">Email</label>
          <div className="relative">
            <Mail className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              type="email"
              className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              placeholder="paciente@exemplo.com"
              value={formData.email}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-1.5 pb-4">
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wider ml-1">Tipo de Atendimento</label>
          <div className="flex p-1 bg-gray-100 rounded-xl">
            <button
              type="button"
              onClick={() => setFormData({ ...formData, type: 'particular' })}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                formData.type === 'particular'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Particular
            </button>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, type: 'convenio' })}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                formData.type === 'convenio'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Convênio
            </button>
          </div>
        </div>
      </form>

      <div className="p-4 border-t border-gray-100 bg-gray-50">
        <button
          onClick={handleSubmit}
          disabled={loading || !formData.full_name}
          className="w-full bg-blue-600 text-white rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-md shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <><UserPlus size={16} /> Cadastrar Paciente</>
          )}
        </button>
      </div>
    </div>
  );
}
