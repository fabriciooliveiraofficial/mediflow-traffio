import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
    Headphones, CalendarCheck, UserX, AlarmClock, ListPlus, CalendarDays,
    RefreshCw, Loader2,
} from 'lucide-react';
import { useTenant } from '../contexts/TenantContext';
import { useLocaleFormat } from '../hooks/useLocaleFormat';
import { useTenantMoney } from '../hooks/useTenantMoney';
import { useTodaySnapshot } from '../hooks/useTodaySnapshot';
import { getLocalHour } from '../lib/timezoneUtils';
import { QueueCard, type QueueCardItem } from '../components/today/QueueCard';
import { GoalsStrip } from '../components/today/GoalsStrip';
import { PulseRow } from '../components/today/PulseRow';
import type { QueuePreviewItem } from '../services/todayService';

/**
 * Tela "Hoje" — centro de comando do atendente (docs/SPEC_TELA_HOJE.md).
 * Agregador acionável: conta, prioriza e roteia para as superfícies operáveis
 * que já existem (Inbox, Agenda, Follow-up, Recepção). Zerar as filas = dia bem feito.
 */
export function TodayPage() {
    const { t } = useTranslation('today');
    const { tenant, userProfile } = useTenant();
    const { formatDate, formatDateTime } = useLocaleFormat();
    const { formatCentsIn } = useTenantMoney();
    const { snapshot, loading, refreshing, refresh } = useTodaySnapshot();
    const navigate = useNavigate();

    const tz = tenant?.timezone;
    const go = (screen: string) => navigate('/dashboard/' + screen);

    // Saudação e data no fuso do TENANT (nunca no do navegador)
    const greetingKey = useMemo(() => {
        const hour = getLocalHour(new Date(), tz || 'America/Sao_Paulo');
        return hour < 12 ? 'greeting.morning' : hour < 18 ? 'greeting.afternoon' : 'greeting.evening';
    }, [tz]);
    // Nome do perfil; sem perfil, sauda com o nome da clínica (nunca vírgula solta)
    const firstName = (userProfile?.full_name || tenant?.name || '').trim().split(' ')[0] || '';
    const todayLabel = formatDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' });

    // Tempo de espera relativo (F1) com semáforo de SLA: <5min ok, 5–15 atenção, >15 crítico
    const waitMeta = (referenceAt?: string): Pick<QueueCardItem, 'meta' | 'metaTone'> => {
        if (!referenceAt) return {};
        const minutes = Math.max(0, Math.floor((Date.now() - new Date(referenceAt).getTime()) / 60000));
        const meta = minutes < 60
            ? t('time.minutes', { count: minutes })
            : t('time.hours', { count: Math.floor(minutes / 60) });
        return { meta, metaTone: minutes > 15 ? 'danger' : minutes >= 5 ? 'warn' : 'neutral' };
    };

    // Dias parado (F4: orçamento sem resposta) — já é "parado" a partir de 96h (ver todayService),
    // então qualquer item aqui é pelo menos "warn"; passa a "danger" acima de 7 dias.
    const staleDaysMeta = (referenceAt?: string): Pick<QueueCardItem, 'meta' | 'metaTone'> => {
        if (!referenceAt) return {};
        const days = Math.max(0, Math.floor((Date.now() - new Date(referenceAt).getTime()) / 86400000));
        return { meta: t('time.days', { count: days }), metaTone: days > 7 ? 'danger' : 'warn' };
    };

    const q = snapshot?.queues;

    const humanItems: QueueCardItem[] = (q?.humanQueue.items || []).map(i => ({
        id: i.id,
        title: i.title,
        subtitle: t(`channels.${i.subtitle}`, { defaultValue: i.subtitle }),
        ...waitMeta(i.referenceAt),
    }));

    const apptToItem = (i: QueuePreviewItem): QueueCardItem => ({
        id: i.id,
        title: i.title || t('queues.agenda.patientFallback'),
        subtitle: i.referenceAt ? formatDateTime(i.referenceAt) : undefined,
    });

    const recoveryItems: QueueCardItem[] = (q?.recovery.items || []).map(i => ({
        id: i.id,
        title: i.title,
        subtitle: t('queues.recovery.reason', { count: Number(i.subtitle) || 1 }),
    }));

    const followUpItems: QueueCardItem[] = (q?.followUps.items || []).map(i => {
        if (i.kind === 'proposal') {
            return {
                id: i.id,
                title: i.title,
                subtitle: t('queues.followUps.stale', { amount: formatCentsIn(i.amountCents || 0, i.currency) }),
                ...staleDaysMeta(i.referenceAt),
            };
        }
        return {
            id: i.id,
            title: i.title,
            subtitle: t('queues.followUps.score', { score: i.subtitle }),
        };
    });

    const waitlistItems: QueueCardItem[] = (q?.waitlist.items || []).map(i => ({
        id: i.id,
        title: i.title,
        subtitle: i.subtitle || t('queues.waitlist.noDoctor'),
    }));

    if (loading || !snapshot) {
        return (
            <div className="flex items-center justify-center h-full min-h-[300px]">
                <Loader2 className="animate-spin text-brand-primary" size={32} />
            </div>
        );
    }

    return (
        <div className="px-6 lg:px-12 py-8 space-y-6 max-w-6xl">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-black text-graphite-900 tracking-tight">
                        {t(greetingKey, { name: firstName })}
                    </h1>
                    <p className="text-sm font-medium text-graphite-400 mt-1 first-letter:uppercase">{todayLabel}</p>
                </div>
                <button
                    onClick={refresh}
                    disabled={refreshing}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white border border-ice-100 shadow-sm text-xs font-black text-graphite-600 hover:border-brand-primary/40 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                >
                    <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                    {t('refresh')}
                </button>
            </div>

            {/* Metas do mês */}
            <GoalsStrip
                appointmentsCurrent={snapshot.goals.appointments?.current ?? 0}
                showRateCurrent={snapshot.goals.showRate?.current ?? 0}
                revenueCurrent={snapshot.goals.revenue?.current ?? 0}
            />

            {/* Filas — ordem fixa F1→F6 (previsibilidade espacial > ranking) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
                <QueueCard
                    icon={Headphones}
                    title={t('queues.humanQueue.title')}
                    count={q!.humanQueue.count}
                    items={humanItems}
                    viewAllLabel={t('viewAll', { count: q!.humanQueue.count })}
                    onViewAll={() => go('inbox')}
                    onItemClick={() => go('inbox')}
                    allClearLabel={t('allClear')}
                    urgent
                />
                <QueueCard
                    icon={CalendarCheck}
                    title={t('queues.confirmations.title')}
                    count={q!.confirmations.count}
                    items={(q!.confirmations.items || []).map(apptToItem)}
                    viewAllLabel={t('viewAll', { count: q!.confirmations.count })}
                    onViewAll={() => go('agenda')}
                    onItemClick={() => go('agenda')}
                    allClearLabel={t('allClear')}
                />
                <QueueCard
                    icon={UserX}
                    title={t('queues.recovery.title')}
                    count={q!.recovery.count}
                    items={recoveryItems}
                    viewAllLabel={t('viewAll', { count: q!.recovery.count })}
                    onViewAll={() => go('followup')}
                    onItemClick={() => go('followup')}
                    allClearLabel={t('allClear')}
                    urgent
                />
                <QueueCard
                    icon={AlarmClock}
                    title={t('queues.followUps.title')}
                    count={q!.followUps.count}
                    items={followUpItems}
                    viewAllLabel={t('viewAll', { count: q!.followUps.count })}
                    onViewAll={() => go('followup')}
                    onItemClick={() => go('followup')}
                    allClearLabel={t('allClear')}
                />
                <QueueCard
                    icon={ListPlus}
                    title={t('queues.waitlist.title')}
                    count={q!.waitlist.count}
                    items={waitlistItems}
                    viewAllLabel={t('viewAll', { count: q!.waitlist.count })}
                    onViewAll={() => go('agenda')}
                    onItemClick={() => go('agenda')}
                    allClearLabel={t('allClear')}
                />
                <QueueCard
                    icon={CalendarDays}
                    title={t('queues.agenda.title')}
                    count={snapshot.todayAgenda.total}
                    items={(snapshot.todayAgenda.next || []).map(apptToItem)}
                    viewAllLabel={t('queues.agenda.progress', {
                        done: snapshot.todayAgenda.done,
                        total: snapshot.todayAgenda.total,
                    })}
                    onViewAll={() => go('reception')}
                    onItemClick={() => go('reception')}
                    allClearLabel={t('queues.agenda.empty')}
                />
            </div>

            {/* Pulso do dia */}
            <PulseRow pulse={snapshot.pulse} />
        </div>
    );
}
