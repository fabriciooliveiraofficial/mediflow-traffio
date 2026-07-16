import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import { useTenant } from '../contexts/TenantContext';
import { useFollowUpMetrics } from '../hooks/useFollowUpMetrics';
import { PageHeader, Badge } from '../components/ui';
import { MarketingReport } from '../components/reports/MarketingReport';
import { FinanceiroReport } from '../components/reports/FinanceiroReport';
import { PerformanceStats } from '../components/followup/PerformanceStats';

/**
 * ReportsPage — "Relatórios" (roadmap item 7, 16/07/2026): hub de leitura que
 * consolida os KPIs/gráficos que estavam espalhados em Dashboard.tsx
 * (Marketing/ads) e FinancialDashboard.tsx (Financeiro), mais o desempenho
 * comercial/CRM (já existia como componente dentro do quadro de Follow-up —
 * reusado aqui verbatim, sem tirar de lá).
 *
 * A parte OPERACIONAL (conectar integrações de ads, lista de transações/
 * cobranças) continua nas telas originais — este hub é só leitura.
 */

type ReportTab = 'marketing' | 'financeiro' | 'comercial';

interface ReportsPageProps {
    initialTab?: ReportTab;
}

export function ReportsPage({ initialTab = 'marketing' }: ReportsPageProps) {
    const { t } = useTranslation('tenantAdmin');
    const { tenant } = useTenant();
    const [tab, setTab] = useState<ReportTab>(initialTab);
    const { metrics, isLoading } = useFollowUpMetrics({
        tenantId: tenant?.id || '',
        days: 30,
        timezone: tenant?.timezone,
    });

    const tabs: ReportTab[] = ['marketing', 'financeiro', 'comercial'];

    return (
        <div className="px-6 lg:px-12 py-8 space-y-6 max-w-7xl mx-auto">
            <PageHeader icon={TrendingUp} title={t('reports.title')} subtitle={t('reports.subtitle')} />

            <div className="flex flex-wrap items-center gap-2">
                {tabs.map(id => (
                    <Badge
                        key={id}
                        accent={tab === id ? 'brand' : 'neutral'}
                        onClick={() => setTab(id)}
                        className="cursor-pointer"
                    >
                        {t(`reports.tabs.${id}`)}
                    </Badge>
                ))}
            </div>

            {tab === 'marketing' && <MarketingReport />}
            {tab === 'financeiro' && <FinanceiroReport />}
            {tab === 'comercial' && <PerformanceStats metrics={metrics} isLoading={isLoading} />}
        </div>
    );
}
