import type { PlanId } from './planConfig';

/**
 * Tabela comparativa dos planos exibida na landing (tabela da seção Planos e
 * pop-up de detalhe do plano). Textos em landing.json → compare.*.
 *
 * REGRA EDITORIAL (decisão do dono, 15/09/2026): só entra aqui o que a
 * plataforma ENTREGA E FUNCIONA hoje, verificado no código/banco. Nada de
 * "em breve", nada de serviço humano sem estrutura (SLA, gerente dedicado,
 * suporte por chat) e nenhuma integração simulada. Removidos na auditoria de
 * 15/09/2026 por não funcionarem: Dr. Cash/financiamento (endpoint mockado),
 * Pagar.me (checkout simulado), Asaas (legado em remoção), Google Ads
 * (credenciais vazias), painel da rede, API/webhooks, faturamento
 * consolidado, explicação de termos por IA (sem chave configurada).
 *
 * Valores:
 *   true   → incluso
 *   false  → não incluso
 *   'pack' → disponível comprando pacote de conversas de IA
 *   { text } → valor descritivo (chave em compare.values.<text>)
 *
 * Espelho de src/config/planConfig.ts e da tabela `plans` — ao mudar um,
 * mudar os três.
 */
export type CompareValue = boolean | 'pack' | { text: string };

export interface CompareRow {
    key: string;
    values: Record<PlanId, CompareValue>;
}

export interface CompareSection {
    key: string;
    rows: CompareRow[];
}

const all = (v: CompareValue): Record<PlanId, CompareValue> => ({ essencial: v, clinica: v, rede: v });
const fromClinica: Record<PlanId, CompareValue> = { essencial: false, clinica: true, rede: true };
const aiValue: Record<PlanId, CompareValue> = { essencial: 'pack', clinica: true, rede: true };

export const PLAN_COMPARISON: CompareSection[] = [
    {
        key: 'ai',
        rows: [
            { key: 'aiConversations', values: { essencial: { text: 'aiPack' }, clinica: { text: 'ai60' }, rede: { text: 'ai150' } } },
            { key: 'aiChannels', values: aiValue },
            { key: 'aiScheduling', values: aiValue },
            { key: 'aiMedia', values: aiValue },
            { key: 'aiComments', values: aiValue },
            { key: 'aiCopilot', values: aiValue },
            { key: 'aiKnowledge', values: aiValue },
        ],
    },
    {
        key: 'agenda',
        rows: [
            { key: 'agenda', values: all(true) },
            { key: 'onlineBooking', values: all(true) },
            { key: 'siteWidget', values: all(true) },
            { key: 'checkin', values: all(true) },
            { key: 'waitlist', values: fromClinica },
            { key: 'professionals', values: { essencial: { text: 'upTo2' }, clinica: { text: 'upTo10' }, rede: { text: 'unlimited' } } },
            { key: 'locations', values: { essencial: { text: 'one' }, clinica: { text: 'upTo3' }, rede: { text: 'unlimited' } } },
        ],
    },
    {
        key: 'communication',
        rows: [
            { key: 'whatsappNumbers', values: all({ text: 'oneNumber' }) },
            { key: 'reminders', values: all(true) },
            { key: 'confirmationNps', values: all(true) },
            { key: 'inbox', values: fromClinica },
            { key: 'media', values: fromClinica },
            { key: 'officialApi', values: fromClinica },
            { key: 'smsVoice', values: all({ text: 'payPerUse' }) },
        ],
    },
    {
        key: 'records',
        rows: [
            { key: 'records', values: all(true) },
            { key: 'exams', values: all(true) },
            { key: 'prescriptions', values: all(true) },
            { key: 'modules', values: { essencial: { text: 'oneModule' }, clinica: { text: 'allModules' }, rede: { text: 'allModules' } } },
            { key: 'imageViewer', values: fromClinica },
            { key: 'storage', values: { essencial: { text: 'gb5' }, clinica: { text: 'gb30' }, rede: { text: 'gb200' } } },
        ],
    },
    {
        key: 'marketing',
        rows: [
            { key: 'patients', values: all(true) },
            { key: 'followup', values: fromClinica },
            { key: 'metaAds', values: fromClinica },
            { key: 'adsReport', values: fromClinica },
            { key: 'recall', values: fromClinica },
        ],
    },
    {
        key: 'finance',
        rows: [
            { key: 'cashier', values: all(true) },
            { key: 'paymentLinks', values: fromClinica },
            { key: 'proposals', values: fromClinica },
            { key: 'financeReport', values: fromClinica },
        ],
    },
    {
        key: 'support',
        rows: [
            { key: 'emailSupport', values: all(true) },
        ],
    },
];

/** true se o valor representa algo que o cliente efetivamente tem no plano. */
export function isIncluded(value: CompareValue): boolean {
    return value === true || (typeof value === 'object' && value !== null);
}

/**
 * Recursos que `to` entrega e `from` não. Usado no pop-up: "o que você ganha"
 * / "o que fica de fora".
 */
export function planGains(from: PlanId, to: PlanId): CompareRow[] {
    return PLAN_COMPARISON.flatMap(s => s.rows).filter(
        r => !isIncluded(r.values[from]) && isIncluded(r.values[to]),
    );
}
