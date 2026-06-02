import { Bell, Volume2, MessageSquare, Monitor, Shield } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { useNotifications } from '../contexts/NotificationContext';

export const NotificationsPage = () => {
    const { showToast } = useToast();
    const { settings, updateSettings, requestPermission } = useNotifications();

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-black text-graphite-900 tracking-tight">Notificações</h1>
                <p className="text-graphite-500 font-medium">Escolha como deseja ser avisado sobre novas mensagens e eventos.</p>
            </div>

            {/* Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Sound Alert */}
                <div
                    className={`group p-8 rounded-[32px] border-2 transition-all cursor-pointer hover:shadow-xl ${settings?.whatsapp_sound !== false ? 'border-brand-primary bg-brand-primary/5 shadow-brand-primary/10' : 'border-ice-100 bg-white hover:border-ice-200'}`}
                    onClick={() => updateSettings({ whatsapp_sound: settings?.whatsapp_sound === false })}
                >
                    <div className="flex justify-between items-start mb-6">
                        <div className={`p-4 rounded-2xl ${settings?.whatsapp_sound !== false ? 'bg-brand-primary text-white shadow-lg shadow-brand-primary/20' : 'bg-ice-50 text-graphite-400'}`}>
                            <Volume2 size={32} />
                        </div>
                        <div className={`w-14 h-7 rounded-full relative transition-colors ${settings?.whatsapp_sound !== false ? 'bg-brand-primary' : 'bg-ice-200'}`}>
                            <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${settings?.whatsapp_sound !== false ? 'left-8' : 'left-1'}`}></div>
                        </div>
                    </div>
                    <h4 className="text-lg font-black text-graphite-900 mb-2">Aviso Sonoro</h4>
                    <p className="text-sm text-graphite-500 font-medium leading-relaxed">Tocar um som de prioridade máxima a cada nova mensagem recebida (Recomendado).</p>
                </div>

                {/* Toast Notification */}
                <div
                    className={`group p-8 rounded-[32px] border-2 transition-all cursor-pointer hover:shadow-xl ${settings?.whatsapp_toast !== false ? 'border-blue-500 bg-blue-50/50 shadow-blue-500/10' : 'border-ice-100 bg-white hover:border-ice-200'}`}
                    onClick={() => updateSettings({ whatsapp_toast: settings?.whatsapp_toast === false })}
                >
                    <div className="flex justify-between items-start mb-6">
                        <div className={`p-4 rounded-2xl ${settings?.whatsapp_toast !== false ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20' : 'bg-ice-50 text-graphite-400'}`}>
                            <MessageSquare size={32} />
                        </div>
                        <div className={`w-14 h-7 rounded-full relative transition-colors ${settings?.whatsapp_toast !== false ? 'bg-blue-500' : 'bg-ice-200'}`}>
                            <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${settings?.whatsapp_toast !== false ? 'left-8' : 'left-1'}`}></div>
                        </div>
                    </div>
                    <h4 className="text-lg font-black text-graphite-900 mb-2">Aviso Flutuante</h4>
                    <p className="text-sm text-graphite-500 font-medium leading-relaxed">Exibir um balão de notificação no canto da tela enquanto você navega pela plataforma.</p>
                </div>

                {/* Web Push Notification */}
                <div
                    className={`group p-8 rounded-[32px] border-2 transition-all cursor-pointer hover:shadow-xl ${settings?.whatsapp_push ? 'border-indigo-500 bg-indigo-50/50 shadow-indigo-500/10' : 'border-ice-100 bg-white hover:border-ice-200'}`}
                    onClick={async () => {
                        if (!settings?.whatsapp_push) {
                            const granted = await requestPermission();
                            if (granted) updateSettings({ whatsapp_push: true });
                            else showToast('error', 'Permissão de notificação negada no navegador.');
                        } else {
                            updateSettings({ whatsapp_push: false });
                        }
                    }}
                >
                    <div className="flex justify-between items-start mb-6">
                        <div className={`p-4 rounded-2xl ${settings?.whatsapp_push ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-ice-50 text-graphite-400'}`}>
                            <Monitor size={32} />
                        </div>
                        <div className={`w-14 h-7 rounded-full relative transition-colors ${settings?.whatsapp_push ? 'bg-indigo-500' : 'bg-ice-200'}`}>
                            <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${settings?.whatsapp_push ? 'left-8' : 'left-1'}`}></div>
                        </div>
                    </div>
                    <h4 className="text-lg font-black text-graphite-900 mb-2">Web Push Nativo</h4>
                    <p className="text-sm text-graphite-500 font-medium leading-relaxed">Receber avisos do sistema mesmo com a aba fechada ou em segundo plano.</p>
                </div>
            </div>

            {/* Info Banner */}
            <div className="bg-ice-50 p-8 rounded-[32px] border border-ice-100 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                    <Shield size={80} className="text-brand-primary" />
                </div>
                <div className="relative z-10 flex flex-col gap-4">
                    <h5 className="text-base font-black text-graphite-900 flex items-center gap-2">
                        <Shield size={20} className="text-brand-primary" />
                        Importante: Disponibilidade dos Alertas
                    </h5>
                    <p className="text-sm text-graphite-500 leading-relaxed font-medium max-w-2xl">
                        Para garantir que você nunca perca o contato de um paciente, recomendamos manter o <strong>Aviso Sonoro</strong> e o <strong>Web Push</strong> ativos.
                        Nosso sistema de som foi otimizado para superar silenciamentos automáticos de navegadores em abas inativas.
                    </p>
                </div>
            </div>
        </div>
    );
};
