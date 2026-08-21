import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
    BarChart3,
    ChevronDown,
    Filter,
    Eye,
    Target,
    DollarSign,
    TrendingUp,
    FileText,
    FileSpreadsheet,
    ArrowUpDown,
    Zap,
    Users,
    Calendar as CalendarIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { useTenant } from '../../contexts/TenantContext';
import { useLocaleFormat } from '../../hooks/useLocaleFormat';
import { useTenantCurrency } from '../../hooks/useTenantCurrency';
import { AnimatePresence, motion } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { getTenantTodayString } from '../../lib/timezoneUtils';
import { KpiCard } from '../ui';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';

/**
 * MarketingReport — aba "Marketing" de Relatórios (roadmap item 7, 16/07/2026).
 * Extraído de Dashboard.tsx (que agora só cuida da gestão de integração OAuth
 * Meta/Google Ads) — mesma query/lógica de moeda, só relocado.
 */

type Period = 'today' | '7d' | '30d' | 'custom';
type Platform = 'all' | 'meta' | 'google';
type ChartMetric = 'leads' | 'spend' | 'impressions' | 'clicks' | 'conversions' | 'ctr' | 'cpc' | 'cpm';
type CampaignSortKey = 'campaign_name' | 'platform' | 'spend' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'cpm' | 'conversions' | 'cpa' | 'roas';

type PlatformBucket = { spend: number; impressions: number; clicks: number; leads: number; conversions: number };

type CampaignRow = {
    campaign_name: string;
    platform: 'meta' | 'google';
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    leads: number;
    revenue: number;
    ctr: number;
    cpc: number;
    cpm: number;
    cpa: number;
    roas: number;
};

export function MarketingReport() {
    const { t } = useTranslation('dashboard');
    const { tenant } = useTenant();
    const { locale, formatDate, formatDateTime } = useLocaleFormat();
    const { formatDual, rateFetchedAt } = useTenantCurrency();

    // Texto "valor convertido (valor BRL original)" para PDF/Excel (células de texto simples).
    const dualText = useCallback((brlValue: number) => {
        const d = formatDual(brlValue);
        return d.secondary ? `${d.primary} (${d.secondary})` : d.primary;
    }, [formatDual]);

    // Composição visual "valor convertido grande / valor BRL pequeno abaixo" para cards/tabela.
    const dualNode = useCallback((brlValue: number): React.ReactNode => {
        const d = formatDual(brlValue);
        if (!d.secondary) return d.primary;
        return (
            <span>
                {d.primary}
                <span
                    className="block text-[10px] font-medium text-graphite-400"
                    title={rateFetchedAt ? `Cotação de ${formatDateTime(rateFetchedAt)}` : undefined}
                >
                    ({d.secondary})
                </span>
            </span>
        );
    }, [formatDual, rateFetchedAt, formatDateTime]);

    const PERIOD_LABELS: Record<Period, string> = {
        today: t('periodLabels.today'),
        '7d': t('periodLabels.7d'),
        '30d': t('periodLabels.30d'),
        custom: t('periodLabels.custom'),
    };

    const CHART_METRICS: { key: ChartMetric; label: string }[] = [
        { key: 'leads', label: t('chartMetrics.leads') },
        { key: 'spend', label: t('chartMetrics.spend') },
        { key: 'impressions', label: t('chartMetrics.impressions') },
        { key: 'clicks', label: t('chartMetrics.clicks') },
        { key: 'conversions', label: t('chartMetrics.conversions') },
        { key: 'ctr', label: t('chartMetrics.ctr') },
        { key: 'cpc', label: t('chartMetrics.cpc') },
        { key: 'cpm', label: t('chartMetrics.cpm') },
    ];

    const CAMPAIGN_COLUMNS: { key: CampaignSortKey; label: string }[] = [
        { key: 'campaign_name', label: t('campaignColumns.campaignName') },
        { key: 'platform', label: t('campaignColumns.platform') },
        { key: 'spend', label: t('campaignColumns.spend') },
        { key: 'impressions', label: t('campaignColumns.impressions') },
        { key: 'clicks', label: t('campaignColumns.clicks') },
        { key: 'ctr', label: t('campaignColumns.ctr') },
        { key: 'cpc', label: t('campaignColumns.cpc') },
        { key: 'cpm', label: t('campaignColumns.cpm') },
        { key: 'conversions', label: t('campaignColumns.conversions') },
        { key: 'cpa', label: t('campaignColumns.cpa') },
        { key: 'roas', label: t('campaignColumns.roas') },
    ];

    const [period, setPeriod] = useState<Period>('30d');
    const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
    const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);
    const [activeTab, setActiveTab] = useState<Platform>('all');
    const [selectedCampaign, setSelectedCampaign] = useState<string>('all');
    const [chartMetric, setChartMetric] = useState<ChartMetric>('leads');
    const [sortKey, setSortKey] = useState<CampaignSortKey>('spend');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    const [integrations, setIntegrations] = useState<{ meta: boolean; google: boolean }>({ meta: false, google: false });
    const [rawPerformanceData, setRawPerformanceData] = useState<any[]>([]);

    const fetchPerformanceData = useCallback(async () => {
        if (!tenant?.id) return;
        try {
            // 1. Verificar quais plataformas de anúncios estão ativamente conectadas
            const { data: intData } = await supabase
                .from('ad_integrations')
                .select('platform, status')
                .eq('tenant_id', tenant.id);

            const activeMeta = intData?.some((i: any) => i.platform === 'meta' && i.status === 'active') ?? false;
            const activeGoogle = intData?.some((i: any) => i.platform === 'google' && i.status === 'active') ?? false;
            const currentIntegrations = { meta: activeMeta, google: activeGoogle };
            setIntegrations(currentIntegrations);

            // Se nenhuma plataforma estiver conectada, não exibe nenhum resultado
            if (!activeMeta && !activeGoogle) {
                setRawPerformanceData([]);
                return;
            }

            const activePlatformList: string[] = [];
            if (activeMeta) activePlatformList.push('meta');
            if (activeGoogle) activePlatformList.push('google');

            const tz = tenant?.timezone || 'America/Sao_Paulo';
            const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz });

            // Últimos 90 dias — cobre os filtros today/7d/30d
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
            const ninetyDaysAgoStr = formatter.format(ninetyDaysAgo);

            const { data: perfData } = await supabase
                .from('ad_performance_daily')
                .select('*')
                .eq('tenant_id', tenant.id)
                .in('platform', activePlatformList)
                .gte('date', ninetyDaysAgoStr)
                .order('date', { ascending: true });

            setRawPerformanceData(perfData || []);
        } catch (error) {
            console.error('Error fetching marketing report data:', error);
        }
    }, [tenant?.id, tenant?.timezone]);

    useEffect(() => {
        fetchPerformanceData();
    }, [fetchPerformanceData]);

    // Fetch adicional sob-demanda quando o período personalizado ultrapassa a janela padrão de 90 dias
    useEffect(() => {
        if (!tenant?.id || period !== 'custom' || !customRange?.from) return;
        if (!integrations.meta && !integrations.google) return;

        const tz = tenant?.timezone || 'America/Sao_Paulo';
        const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz });

        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        const ninetyDaysAgoStr = formatter.format(ninetyDaysAgo);

        if (customRange.from >= ninetyDaysAgoStr) return;

        const activePlatformList: string[] = [];
        if (integrations.meta) activePlatformList.push('meta');
        if (integrations.google) activePlatformList.push('google');

        (async () => {
            const { data: extraData } = await supabase
                .from('ad_performance_daily')
                .select('*')
                .eq('tenant_id', tenant.id)
                .in('platform', activePlatformList)
                .gte('date', customRange.from)
                .lt('date', ninetyDaysAgoStr)
                .order('date', { ascending: true });

            if (extraData && extraData.length > 0) {
                setRawPerformanceData(prev => {
                    const existingKeys = new Set(prev.map((r: any) => `${r.platform}::${r.date}::${r.campaign_id}`));
                    const merged = [
                        ...extraData.filter((r: any) => !existingKeys.has(`${r.platform}::${r.date}::${r.campaign_id}`)),
                        ...prev,
                    ];
                    return merged.sort((a: any, b: any) => a.date.localeCompare(b.date));
                });
            }
        })();
    }, [tenant?.id, tenant?.timezone, period, customRange?.from, integrations]);

    // ── Período selecionado → range de datas (YYYY-MM-DD) ──────────────────
    const dateRange = useMemo(() => {
        const tz = tenant?.timezone || 'America/Sao_Paulo';
        const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
        const todayStr = formatter.format(new Date());

        if (period === 'today') {
            return { from: todayStr, to: todayStr };
        }
        if (period === '7d') {
            const today = new Date();
            const from = new Date(today);
            from.setDate(from.getDate() - 6);
            return { from: formatter.format(from), to: todayStr };
        }
        if (period === 'custom' && customRange?.from && customRange?.to) {
            return customRange;
        }
        const today = new Date();
        const from = new Date(today);
        from.setDate(from.getDate() - 29);
        return { from: formatter.format(from), to: todayStr };
    }, [period, customRange, tenant?.timezone]);

    // ── Dados filtrados por período + plataforma + campanha ─────────────────
    const filteredData = useMemo(() => {
        if (!integrations.meta && !integrations.google) return [];
        return rawPerformanceData.filter((row: any) => {
            // Só aceita registros de plataformas conectadas
            if (row.platform === 'meta' && !integrations.meta) return false;
            if (row.platform === 'google' && !integrations.google) return false;
            if (row.platform !== 'meta' && row.platform !== 'google') return false;

            if (row.date < dateRange.from || row.date > dateRange.to) return false;
            if (activeTab !== 'all' && row.platform !== activeTab) return false;
            if (selectedCampaign !== 'all' && (row.campaign_name || 'Sem nome') !== selectedCampaign) return false;
            return true;
        });
    }, [rawPerformanceData, dateRange, activeTab, selectedCampaign, integrations]);

    // ── Opções do filtro de campanha (respeita período + plataforma) ────────
    const campaignOptions = useMemo(() => {
        if (!integrations.meta && !integrations.google) return [];
        const names = new Set<string>();
        rawPerformanceData.forEach((row: any) => {
            if (row.platform === 'meta' && !integrations.meta) return;
            if (row.platform === 'google' && !integrations.google) return;
            if (row.platform !== 'meta' && row.platform !== 'google') return;
            if (row.date < dateRange.from || row.date > dateRange.to) return;
            if (activeTab !== 'all' && row.platform !== activeTab) return;
            names.add(row.campaign_name || 'Sem nome');
        });
        return Array.from(names).sort();
    }, [rawPerformanceData, dateRange, activeTab, integrations]);

    // Reseta o filtro de campanha se a opção selecionada deixar de existir (ex: troca de plataforma)
    useEffect(() => {
        if (selectedCampaign !== 'all' && !campaignOptions.includes(selectedCampaign)) {
            setSelectedCampaign('all');
        }
    }, [campaignOptions, selectedCampaign]);

    // ── KPIs agregados (linha 1 e 2 dos cards) ──────────────────────────────
    const kpis = useMemo(() => {
        const totSpent = filteredData.reduce((sum: number, d: any) => sum + Number(d.spend_cents || 0), 0) / 100;
        const totRev = filteredData.reduce((sum: number, d: any) => sum + Number(d.revenue_cents || 0), 0) / 100;
        const totLeads = filteredData.reduce((sum: number, d: any) => sum + Number(d.leads_count || 0), 0);
        const totConversions = filteredData.reduce((sum: number, d: any) => sum + Number(d.conversion_count || 0), 0);
        const totImpressions = filteredData.reduce((sum: number, d: any) => sum + Number(d.impressions || 0), 0);
        const totClicks = filteredData.reduce((sum: number, d: any) => sum + Number(d.clicks || 0), 0);

        const conversionRate = totLeads > 0 ? (totConversions / totLeads) * 100 : 0;
        const roas = totSpent > 0 ? totRev / totSpent : 0;
        const ctr = totImpressions > 0 ? (totClicks / totImpressions) * 100 : 0;
        const cpc = totClicks > 0 ? totSpent / totClicks : 0;
        const cpm = totImpressions > 0 ? (totSpent / totImpressions) * 1000 : 0;
        const cpa = totConversions > 0 ? totSpent / totConversions : 0;

        return {
            totalLeads: totLeads.toString(),
            conversion: `${conversionRate.toFixed(1)}%`,
            spent: totSpent, // BRL bruto — formatado na renderização via dualText/dualNode
            roas: `${roas.toFixed(1)}x`,
            impressions: totImpressions.toLocaleString('pt-BR'),
            clicks: totClicks.toLocaleString('pt-BR'),
            ctr: `${ctr.toFixed(2)}%`,
            cpc, // BRL bruto
            cpm, // BRL bruto
            cpa, // BRL bruto
        };
    }, [filteredData]);

    // ── Série do gráfico (Meta x Google) de acordo com a métrica escolhida ──
    const chartData = useMemo(() => {
        const byDate: Record<string, { meta: PlatformBucket; google: PlatformBucket }> = {};

        filteredData.forEach((row: any) => {
            const date = row.date;
            if (!byDate[date]) {
                byDate[date] = {
                    meta: { spend: 0, impressions: 0, clicks: 0, leads: 0, conversions: 0 },
                    google: { spend: 0, impressions: 0, clicks: 0, leads: 0, conversions: 0 },
                };
            }
            const bucket = row.platform === 'meta' ? byDate[date].meta : row.platform === 'google' ? byDate[date].google : null;
            if (!bucket) return;
            bucket.spend += Number(row.spend_cents || 0) / 100;
            bucket.impressions += Number(row.impressions || 0);
            bucket.clicks += Number(row.clicks || 0);
            bucket.leads += Number(row.leads_count || 0);
            bucket.conversions += Number(row.conversion_count || 0);
        });

        const metricValue = (b: PlatformBucket) => {
            switch (chartMetric) {
                case 'spend': return b.spend;
                case 'impressions': return b.impressions;
                case 'clicks': return b.clicks;
                case 'conversions': return b.conversions;
                case 'ctr': return b.impressions > 0 ? (b.clicks / b.impressions) * 100 : 0;
                case 'cpc': return b.clicks > 0 ? b.spend / b.clicks : 0;
                case 'cpm': return b.impressions > 0 ? (b.spend / b.impressions) * 1000 : 0;
                default: return b.leads;
            }
        };

        return Object.keys(byDate).sort().map((date) => ({
            name: new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(new Date(`${date}T00:00:00`)),
            meta: Number(metricValue(byDate[date].meta).toFixed(2)),
            google: Number(metricValue(byDate[date].google).toFixed(2)),
        }));
    }, [filteredData, chartMetric, locale]);

    // ── Tabela de performance por campanha ──────────────────────────────────
    const campaignTable = useMemo<CampaignRow[]>(() => {
        const byCampaign: Record<string, CampaignRow> = {};

        filteredData.forEach((row: any) => {
            const name = row.campaign_name || 'Sem nome';
            const key = `${row.platform}::${name}`;
            if (!byCampaign[key]) {
                byCampaign[key] = {
                    campaign_name: name,
                    platform: row.platform,
                    spend: 0, impressions: 0, clicks: 0, conversions: 0, leads: 0, revenue: 0,
                    ctr: 0, cpc: 0, cpm: 0, cpa: 0, roas: 0,
                };
            }
            const c = byCampaign[key];
            c.spend += Number(row.spend_cents || 0) / 100;
            c.impressions += Number(row.impressions || 0);
            c.clicks += Number(row.clicks || 0);
            c.conversions += Number(row.conversion_count || 0);
            c.leads += Number(row.leads_count || 0);
            c.revenue += Number(row.revenue_cents || 0) / 100;
        });

        const rows = Object.values(byCampaign).map((c) => ({
            ...c,
            ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
            cpc: c.clicks > 0 ? c.spend / c.clicks : 0,
            cpm: c.impressions > 0 ? (c.spend / c.impressions) * 1000 : 0,
            cpa: c.conversions > 0 ? c.spend / c.conversions : 0,
            roas: c.spend > 0 ? c.revenue / c.spend : 0,
        }));

        rows.sort((a, b) => {
            const av = a[sortKey];
            const bv = b[sortKey];
            if (typeof av === 'string' && typeof bv === 'string') {
                return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
            }
            return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
        });

        return rows;
    }, [filteredData, sortKey, sortDir]);

    const handleSort = (key: CampaignSortKey) => {
        if (sortKey === key) {
            setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
    };

    // ── Exportação PDF ───────────────────────────────────────────────────────
    const handleExportPDF = () => {
        const doc = new jsPDF();
        const clinicName = tenant?.name || t('pdfReport.clinicNameFallback');
        const periodLabel = period === 'custom' && customRange
            ? `${formatDate(customRange.from)} a ${formatDate(customRange.to)}`
            : PERIOD_LABELS[period];

        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text(t('pdfReport.documentTitle'), 14, 18);

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(t('pdfReport.clinicLabel', { clinicName }), 14, 26);
        doc.text(t('pdfReport.periodLabel', { periodLabel }), 14, 32);
        doc.text(t('pdfReport.generatedAtLabel', { generatedAt: formatDateTime(new Date()) }), 14, 38);

        autoTable(doc, {
            startY: 45,
            head: [[t('pdfReport.summaryHeaderIndicator'), t('pdfReport.summaryHeaderValue')]],
            body: [
                [t('pdfReport.totalLeads'), kpis.totalLeads],
                [t('pdfReport.crmConversion'), kpis.conversion],
                [t('pdfReport.adSpend'), dualText(kpis.spent)],
                [t('pdfReport.avgRoas'), kpis.roas],
                [t('pdfReport.impressions'), kpis.impressions],
                [t('pdfReport.clicks'), kpis.clicks],
                [t('pdfReport.ctr'), kpis.ctr],
                [t('pdfReport.cpc'), dualText(kpis.cpc)],
                [t('pdfReport.cpm'), dualText(kpis.cpm)],
                [t('pdfReport.cpa'), dualText(kpis.cpa)],
            ],
            theme: 'grid',
            headStyles: { fillColor: [0, 129, 251] },
        });

        const afterSummaryY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 10 : 90;

        autoTable(doc, {
            startY: afterSummaryY,
            head: [[
                t('pdfReport.campaignColumn'), t('pdfReport.platformColumn'), t('pdfReport.spendColumn'),
                t('pdfReport.impressionsColumn'), t('pdfReport.clicksColumn'), t('pdfReport.ctr'),
                t('pdfReport.cpc'), t('pdfReport.cpm'), t('pdfReport.conversionsColumn'),
                t('pdfReport.cpaColumn'), t('pdfReport.roasColumn'),
            ]],
            body: campaignTable.map(c => [
                c.campaign_name,
                c.platform === 'meta' ? t('pdfReport.platformMeta') : t('pdfReport.platformGoogle'),
                dualText(c.spend),
                c.impressions.toLocaleString('pt-BR'),
                c.clicks.toLocaleString('pt-BR'),
                `${c.ctr.toFixed(2)}%`,
                dualText(c.cpc),
                dualText(c.cpm),
                c.conversions.toString(),
                dualText(c.cpa),
                `${c.roas.toFixed(1)}x`,
            ]),
            theme: 'striped',
            headStyles: { fillColor: [15, 23, 42] },
            styles: { fontSize: 8 },
        });

        doc.save(`analytics-pro-${getTenantTodayString(tenant?.timezone)}.pdf`);
    };

    // ── Exportação Excel ─────────────────────────────────────────────────────
    const handleExportExcel = () => {
        const summarySheet = XLSX.utils.json_to_sheet([
            { [t('excelReport.indicatorColumn')]: t('excelReport.totalLeads'), [t('excelReport.valueColumn')]: kpis.totalLeads },
            { [t('excelReport.indicatorColumn')]: t('excelReport.crmConversion'), [t('excelReport.valueColumn')]: kpis.conversion },
            { [t('excelReport.indicatorColumn')]: t('excelReport.adSpend'), [t('excelReport.valueColumn')]: dualText(kpis.spent) },
            { [t('excelReport.indicatorColumn')]: t('excelReport.avgRoas'), [t('excelReport.valueColumn')]: kpis.roas },
            { [t('excelReport.indicatorColumn')]: t('excelReport.impressions'), [t('excelReport.valueColumn')]: kpis.impressions },
            { [t('excelReport.indicatorColumn')]: t('excelReport.clicks'), [t('excelReport.valueColumn')]: kpis.clicks },
            { [t('excelReport.indicatorColumn')]: t('excelReport.ctr'), [t('excelReport.valueColumn')]: kpis.ctr },
            { [t('excelReport.indicatorColumn')]: t('excelReport.cpc'), [t('excelReport.valueColumn')]: dualText(kpis.cpc) },
            { [t('excelReport.indicatorColumn')]: t('excelReport.cpm'), [t('excelReport.valueColumn')]: dualText(kpis.cpm) },
            { [t('excelReport.indicatorColumn')]: t('excelReport.cpa'), [t('excelReport.valueColumn')]: dualText(kpis.cpa) },
        ]);

        // Colunas BRL brutas (Number) ficam intactas para cálculo no Excel.
        // Colunas "(Moeda Local)" são texto formatado só para leitura — adicionadas
        // apenas quando há cotação disponível (tenant não-BRL), para não duplicar
        // a mesma informação em BRL sem necessidade.
        const hasConversion = formatDual(1).secondary !== null;
        const campaignSheet = XLSX.utils.json_to_sheet(campaignTable.map(c => ({
            [t('excelReport.campaignColumn')]: c.campaign_name,
            [t('excelReport.platformColumn')]: c.platform === 'meta' ? t('excelReport.platformMeta') : t('excelReport.platformGoogle'),
            [t('excelReport.spendColumn')]: Number(c.spend.toFixed(2)),
            ...(hasConversion ? { [t('excelReport.spendLocalColumn')]: dualText(c.spend) } : {}),
            [t('excelReport.impressionsColumn')]: c.impressions,
            [t('excelReport.clicksColumn')]: c.clicks,
            [t('excelReport.ctrColumn')]: Number(c.ctr.toFixed(2)),
            [t('excelReport.cpcColumn')]: Number(c.cpc.toFixed(2)),
            ...(hasConversion ? { [t('excelReport.cpcLocalColumn')]: dualText(c.cpc) } : {}),
            [t('excelReport.cpmColumn')]: Number(c.cpm.toFixed(2)),
            ...(hasConversion ? { [t('excelReport.cpmLocalColumn')]: dualText(c.cpm) } : {}),
            [t('excelReport.conversionsColumn')]: c.conversions,
            [t('excelReport.cpaColumn')]: Number(c.cpa.toFixed(2)),
            ...(hasConversion ? { [t('excelReport.cpaLocalColumn')]: dualText(c.cpa) } : {}),
            [t('excelReport.roasColumn')]: Number(c.roas.toFixed(2)),
        })));

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, summarySheet, t('excelReport.summarySheetName'));
        XLSX.utils.book_append_sheet(wb, campaignSheet, t('excelReport.campaignSheetName'));
        XLSX.writeFile(wb, `analytics-pro-${getTenantTodayString(tenant?.timezone)}.xlsx`);
    };

    const hasAnyIntegration = integrations.meta || integrations.google;
    const isLiveWithoutData = !hasAnyIntegration || rawPerformanceData.length === 0;
    const hasFilteredData = chartData.length > 0;
    const selectedChartMetricLabel = CHART_METRICS.find(m => m.key === chartMetric)?.label || t('chartMetrics.leads');

    return (
        <div className="space-y-8">
            {/* ── FILTROS + EXPORT ─────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                    <button
                        onClick={() => setShowPeriodDropdown(!showPeriodDropdown)}
                        className="px-6 py-4 bg-white border border-ice-100 text-graphite-900 rounded-[24px] text-sm font-black shadow-xl shadow-ice-100/30 hover:bg-ice-50 transition-all flex items-center gap-3 border-none cursor-pointer"
                    >
                        <CalendarIcon size={18} className="text-brand-primary" />
                        {period === 'custom' && customRange ? `${formatDate(customRange.from)} - ${formatDate(customRange.to)}` : PERIOD_LABELS[period]}
                        <ChevronDown size={14} className={clsx("text-graphite-400 transition-transform", showPeriodDropdown && "rotate-180")} />
                    </button>

                    <AnimatePresence>
                        {showPeriodDropdown && (
                            <motion.div
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="absolute right-0 mt-2 w-72 bg-white rounded-[24px] border border-ice-100 shadow-2xl p-3 z-50 space-y-1"
                            >
                                {(['today', '7d', '30d', 'custom'] as const).map((p) => (
                                    <button
                                        key={p}
                                        onClick={() => {
                                            setPeriod(p);
                                            if (p !== 'custom') setShowPeriodDropdown(false);
                                        }}
                                        className={clsx(
                                            "w-full text-left px-4 py-3 rounded-2xl text-xs font-black transition-all border-none cursor-pointer",
                                            period === p ? "bg-brand-primary text-white" : "text-graphite-600 hover:bg-ice-50"
                                        )}
                                    >
                                        {PERIOD_LABELS[p]}
                                    </button>
                                ))}

                                {period === 'custom' && (
                                    <div className="pt-2 space-y-2 px-1">
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="date"
                                                value={customRange?.from || ''}
                                                onChange={(e) => setCustomRange(prev => ({ from: e.target.value, to: prev?.to || e.target.value }))}
                                                className="flex-1 px-3 py-2 bg-ice-50 rounded-xl text-xs font-bold text-graphite-900 border-none"
                                            />
                                            <span className="text-graphite-400 text-xs font-black">{t('header.rangeSeparator')}</span>
                                            <input
                                                type="date"
                                                value={customRange?.to || ''}
                                                onChange={(e) => setCustomRange(prev => ({ from: prev?.from || e.target.value, to: e.target.value }))}
                                                className="flex-1 px-3 py-2 bg-ice-50 rounded-xl text-xs font-bold text-graphite-900 border-none"
                                            />
                                        </div>
                                        <button
                                            onClick={() => setShowPeriodDropdown(false)}
                                            disabled={!customRange?.from || !customRange?.to}
                                            className="w-full py-2 bg-brand-primary text-white rounded-xl text-[10px] font-black uppercase tracking-widest border-none cursor-pointer disabled:opacity-40"
                                        >
                                            {t('header.applyButton')}
                                        </button>
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <button
                    onClick={handleExportPDF}
                    className="px-5 py-4 bg-white border border-ice-100 text-graphite-900 rounded-[24px] text-xs font-black shadow-xl shadow-ice-100/30 hover:bg-ice-50 transition-all flex items-center gap-2 border-none cursor-pointer"
                >
                    <FileText size={16} className="text-red-500" />
                    {t('header.pdfButton')}
                </button>

                <button
                    onClick={handleExportExcel}
                    className="px-5 py-4 bg-white border border-ice-100 text-graphite-900 rounded-[24px] text-xs font-black shadow-xl shadow-ice-100/30 hover:bg-ice-50 transition-all flex items-center gap-2 border-none cursor-pointer"
                >
                    <FileSpreadsheet size={16} className="text-green-600" />
                    {t('header.excelButton')}
                </button>

                <div className="flex bg-ice-100/50 p-1 rounded-2xl">
                    {(['all', 'meta', 'google'] as const).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={clsx(
                                "px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all border-none cursor-pointer",
                                activeTab === tab ? "bg-white text-graphite-900 shadow-sm" : "text-graphite-400 hover:text-graphite-600"
                            )}
                        >
                            {tab === 'all' ? t('filters.allPlatforms') : tab === 'meta' ? t('filters.metaAds') : t('filters.googleAds')}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-2 bg-white border border-ice-100 rounded-2xl px-4 py-2.5 shadow-sm">
                    <Filter size={14} className="text-graphite-400" />
                    <select
                        value={selectedCampaign}
                        onChange={(e) => setSelectedCampaign(e.target.value)}
                        className="bg-transparent border-none text-[11px] font-black text-graphite-900 cursor-pointer focus:outline-none max-w-[220px]"
                    >
                        <option value="all">{t('filters.allCampaigns')}</option>
                        {campaignOptions.map((name) => (
                            <option key={name} value={name}>{name}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* ── KPI GRID (PRINCIPAL) ──────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <KpiCard label={t('kpis.totalLeads')} value={kpis.totalLeads} subValue={t('kpis.totalLeadsSubtext')} icon={Users} accent="brand" />
                <KpiCard label={t('kpis.crmConversion')} value={kpis.conversion} subValue={t('kpis.crmConversionSubtext')} icon={Target} accent="info" />
                <KpiCard label={t('kpis.adSpend')} value={dualNode(kpis.spent)} subValue={PERIOD_LABELS[period]} icon={DollarSign} accent="warning" />
                <KpiCard label={t('kpis.avgRoas')} value={kpis.roas} subValue={t('kpis.avgRoasSubtext')} icon={TrendingUp} accent="neutral" />
            </div>

            {/* ── KPI GRID (MÍDIA — métricas nativas das plataformas) ────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                <KpiCard label={t('kpis.impressions')} value={kpis.impressions} subValue={t('kpis.impressionsSubtext')} icon={Eye} accent="purple" />
                <KpiCard label={t('kpis.clicks')} value={kpis.clicks} subValue={t('kpis.clicksSubtext')} icon={TrendingUp} accent="info" />
                <KpiCard label={t('kpis.ctr')} value={kpis.ctr} subValue={t('kpis.ctrSubtext')} icon={Target} accent="purple" />
                <KpiCard label={t('kpis.cpc')} value={dualNode(kpis.cpc)} subValue={t('kpis.cpcSubtext')} icon={DollarSign} accent="warning" />
                <KpiCard label={t('kpis.cpm')} value={dualNode(kpis.cpm)} subValue={t('kpis.cpmSubtext')} icon={TrendingUp} accent="indigo" />
                <KpiCard label={t('kpis.cpa')} value={dualNode(kpis.cpa)} subValue={t('kpis.cpaSubtext')} icon={Zap} accent="error" />
            </div>

            {/* ── TRAFFIC VOLUME CHART (RECHARTS) ───────────────────────────────── */}
            <div className="space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <h4 className="text-2xl font-black tracking-tight flex items-center gap-3">
                        <BarChart3 className="text-brand-primary" />
                        {t('charts.trafficEvolutionTitle')}
                    </h4>
                    <select
                        value={chartMetric}
                        onChange={(e) => setChartMetric(e.target.value as ChartMetric)}
                        className="px-4 py-2 bg-ice-100/50 rounded-2xl text-[10px] font-black uppercase text-graphite-600 border-none cursor-pointer focus:outline-none"
                    >
                        {CHART_METRICS.map((m) => (
                            <option key={m.key} value={m.key}>{m.label}</option>
                        ))}
                    </select>
                </div>

                <div className="glass p-8 rounded-[40px] h-[400px] border-none shadow-2xl shadow-ice-100/20 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-full opacity-[0.03] pointer-events-none">
                        <div className="absolute inset-0 bg-gradient-to-br from-brand-primary to-transparent"></div>
                    </div>

                    {isLiveWithoutData ? (
                        <div className="w-full h-full flex flex-col items-center justify-center space-y-4">
                            <div className="p-6 bg-white rounded-full shadow-xl shadow-ice-100/30">
                                <BarChart3 size={40} className="text-ice-100" />
                            </div>
                            <p className="text-xs font-black text-graphite-400 uppercase tracking-widest text-center px-20">
                                {t('charts.awaitingIntegration')}
                            </p>
                        </div>
                    ) : !hasFilteredData ? (
                        <div className="w-full h-full flex flex-col items-center justify-center space-y-4">
                            <div className="p-6 bg-white rounded-full shadow-xl shadow-ice-100/30">
                                <Filter size={40} className="text-ice-100" />
                            </div>
                            <p className="text-xs font-black text-graphite-400 uppercase tracking-widest text-center px-20">
                                {t('charts.noDataForFilters')}
                            </p>
                        </div>
                    ) : (
                        <ResponsiveContainer width="99%" minHeight={300}>
                            <AreaChart data={chartData}>
                                <defs>
                                    <linearGradient id="colorMeta" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#0081FB" stopOpacity={0.8}/>
                                        <stop offset="95%" stopColor="#0081FB" stopOpacity={0}/>
                                    </linearGradient>
                                    <linearGradient id="colorGoogle" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#34A853" stopOpacity={0.8}/>
                                        <stop offset="95%" stopColor="#34A853" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <XAxis
                                    dataKey="name"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 900 }}
                                />
                                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                                <CartesianGrid vertical={false} stroke="#f1f5f9" strokeDasharray="3 3" />
                                <Tooltip
                                    contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                                    itemStyle={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase' }}
                                    formatter={(value: any, name: any) => [value, name === 'meta' ? t('charts.tooltipMeta', { metricLabel: selectedChartMetricLabel }) : t('charts.tooltipGoogle', { metricLabel: selectedChartMetricLabel })]}
                                />
                                {(activeTab === 'all' || activeTab === 'meta') && (
                                    <Area
                                        type="monotone"
                                        dataKey="meta"
                                        stroke="#0081FB"
                                        strokeWidth={4}
                                        fillOpacity={1}
                                        fill="url(#colorMeta)"
                                    />
                                )}
                                {(activeTab === 'all' || activeTab === 'google') && (
                                    <Area
                                        type="monotone"
                                        dataKey="google"
                                        stroke="#34A853"
                                        strokeWidth={4}
                                        fillOpacity={1}
                                        fill="url(#colorGoogle)"
                                    />
                                )}
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>

            {/* ── PERFORMANCE POR CAMPANHA ──────────────────────────────────────── */}
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <h4 className="text-2xl font-black tracking-tight flex items-center gap-3">
                        <BarChart3 className="text-brand-primary" />
                        {t('campaignTable.title')}
                    </h4>
                    <span className="text-[10px] font-black text-graphite-400 uppercase tracking-widest">
                        {campaignTable.length === 1 ? t('campaignTable.countLabel_one', { count: campaignTable.length }) : t('campaignTable.countLabel_other', { count: campaignTable.length })}
                    </span>
                </div>

                <div className="glass rounded-[32px] border-none shadow-2xl shadow-ice-100/20 overflow-hidden">
                    {campaignTable.length === 0 ? (
                        <div className="py-16 text-center">
                            <p className="text-xs font-black text-graphite-400 uppercase tracking-widest">
                                {t('campaignTable.noDataForFilters')}
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-ice-100">
                                        {CAMPAIGN_COLUMNS.map((col) => (
                                            <th
                                                key={col.key}
                                                onClick={() => handleSort(col.key)}
                                                className="px-4 py-4 text-left text-[10px] font-black uppercase tracking-widest text-graphite-400 cursor-pointer hover:text-graphite-900 transition-colors whitespace-nowrap select-none"
                                            >
                                                <div className="flex items-center gap-1">
                                                    {col.label}
                                                    <ArrowUpDown size={10} className={sortKey === col.key ? "text-brand-primary" : "text-ice-200"} />
                                                </div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {campaignTable.map((c, i) => (
                                        <tr key={`${c.platform}-${c.campaign_name}-${i}`} className="border-b border-ice-50 last:border-none hover:bg-ice-50/50 transition-colors">
                                            <td className="px-4 py-4 font-black text-graphite-900 text-xs whitespace-nowrap">{c.campaign_name}</td>
                                            <td className="px-4 py-4">
                                                <span className={clsx("text-[9px] font-black uppercase px-2.5 py-1 rounded-full", c.platform === 'meta' ? "bg-blue-100 text-blue-600" : "bg-green-100 text-green-600")}>
                                                    {c.platform === 'meta' ? t('campaignTable.platformMeta') : t('campaignTable.platformGoogle')}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4 text-xs font-bold text-graphite-900 tabular-nums whitespace-nowrap">{dualNode(c.spend)}</td>
                                            <td className="px-4 py-4 text-xs font-bold text-graphite-900 tabular-nums">{c.impressions.toLocaleString('pt-BR')}</td>
                                            <td className="px-4 py-4 text-xs font-bold text-graphite-900 tabular-nums">{c.clicks.toLocaleString('pt-BR')}</td>
                                            <td className="px-4 py-4 text-xs font-bold text-graphite-900 tabular-nums">{c.ctr.toFixed(2)}%</td>
                                            <td className="px-4 py-4 text-xs font-bold text-graphite-900 tabular-nums whitespace-nowrap">{dualNode(c.cpc)}</td>
                                            <td className="px-4 py-4 text-xs font-bold text-graphite-900 tabular-nums whitespace-nowrap">{dualNode(c.cpm)}</td>
                                            <td className="px-4 py-4 text-xs font-bold text-graphite-900 tabular-nums">{c.conversions}</td>
                                            <td className="px-4 py-4 text-xs font-bold text-graphite-900 tabular-nums whitespace-nowrap">{dualNode(c.cpa)}</td>
                                            <td className="px-4 py-4 text-xs font-bold text-graphite-900 tabular-nums">{c.roas.toFixed(1)}x</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
