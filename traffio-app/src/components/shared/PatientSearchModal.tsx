import React, { useState, useEffect } from 'react';
import { Search, X, User, ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface PatientSearchModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (patient: any) => void;
    title: string;
    specialty?: 'dental' | 'nutrition' | 'general';
}

export const PatientSearchModal: React.FC<PatientSearchModalProps> = ({ 
    isOpen, 
    onClose, 
    onSelect,
    title,
    specialty
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [patients, setPatients] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        
        const searchPatients = async () => {
            setLoading(true);
            const { data, error } = await supabase
                .from('patients')
                .select('*')
                .ilike('full_name', `%${searchTerm}%`)
                .limit(5);
            
            if (!error) setPatients(data || []);
            setLoading(false);
        };

        const timer = setTimeout(searchPatients, 300);
        return () => clearTimeout(timer);
    }, [searchTerm, isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-graphite-900/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-md rounded-[32px] shadow-2xl overflow-hidden border border-ice-100 animate-in zoom-in-95 duration-300">
                <div className="p-6 border-b border-ice-100 flex items-center justify-between bg-ice-50/30">
                    <div>
                        <h3 className="text-lg font-black text-graphite-900 tracking-tight">{title}</h3>
                        {specialty && (
                            <p className="text-[10px] text-brand-primary font-black uppercase tracking-widest">Procedimento: {specialty}</p>
                        )}
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-ice-100 rounded-xl transition-all border-none bg-transparent cursor-pointer">
                        <X size={20} className="text-graphite-400" />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-graphite-400" size={18} />
                        <input 
                            autoFocus
                            type="text"
                            placeholder="Buscar paciente pelo nome..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-ice-50 border border-ice-200 rounded-2xl py-4 pl-12 pr-4 text-sm font-bold text-graphite-900 focus:border-brand-primary outline-none transition-all"
                        />
                    </div>

                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                        {loading ? (
                            <div className="py-8 text-center text-xs font-bold text-graphite-400 uppercase tracking-widest">Buscando...</div>
                        ) : patients.length > 0 ? (
                            patients.map((patient) => (
                                <button 
                                    key={patient.id}
                                    onClick={() => onSelect(patient)}
                                    className="w-full flex items-center justify-between p-4 bg-white border border-ice-100 rounded-2xl hover:border-brand-primary/30 hover:bg-brand-primary/5 transition-all text-left group border-none cursor-pointer"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-ice-100 rounded-xl flex items-center justify-center text-graphite-500 group-hover:bg-brand-primary group-hover:text-white transition-all">
                                            <User size={18} />
                                        </div>
                                        <div>
                                            <p className="font-black text-sm text-graphite-900">{patient.full_name}</p>
                                            <p className="text-[10px] text-graphite-400 font-bold uppercase tracking-widest">ID: #{patient.id.slice(0, 8)}</p>
                                        </div>
                                    </div>
                                    <ChevronRight size={18} className="text-graphite-300 group-hover:text-brand-primary transition-all" />
                                </button>
                            ))
                        ) : searchTerm ? (
                            <p className="py-8 text-center text-xs font-bold text-graphite-400 italic">Nenhum paciente encontrado.</p>
                        ) : (
                            <p className="py-8 text-center text-xs font-bold text-graphite-400 italic">Digite para buscar pacientes.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
