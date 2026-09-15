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

// DECISÃO DE PRODUTO (15/09/2026): os planos NÃO bloqueiam recursos de software
// (caixa de entrada, CRM, anúncios, pagamentos, módulos...) — custo marginal
// zero para a plataforma, então bloquear só afasta cliente. O que diferencia os
// planos é o que CUSTA: conversas de IA incluídas, número de WhatsApp (Z-API),
// armazenamento e a capacidade (profissionais/unidades). Ver
// docs/PLANO_MONETIZACAO_IA_2026-09.md § Auditoria de custo marginal.
const all = (v: CompareValue): Record<PlanId, CompareValue> => ({ essencial: v, clinica: v, rede: v });
const aiValue: Record<PlanId, CompareValue> = { essencial: 'pack', clinica: true, rede: true };

export const PLAN_COMPARISON: CompareSection[] = [
    {
        key: 'ai',
        rows: [
            { key: 'aiConversations', values: { essencial: 'pack', clinica: { text: 'ai60' }, rede: { text: 'ai150' } } },
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
            { key: 'waitlist', values: all(true) },
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
            { key: 'inbox', values: all(true) },
            { key: 'media', values: all(true) },
            { key: 'officialApi', values: all(true) },
            { key: 'smsVoice', values: all({ text: 'payPerUse' }) },
        ],
    },
    {
        key: 'records',
        rows: [
            { key: 'records', values: all(true) },
            { key: 'exams', values: all(true) },
            { key: 'prescriptions', values: all(true) },
            { key: 'modules', values: all({ text: 'allModules' }) },
            { key: 'imageViewer', values: all(true) },
            { key: 'storage', values: { essencial: { text: 'gb5' }, clinica: { text: 'gb30' }, rede: { text: 'gb200' } } },
        ],
    },
    {
        key: 'marketing',
        rows: [
            { key: 'patients', values: all(true) },
            { key: 'followup', values: all(true) },
            { key: 'metaAds', values: all(true) },
            { key: 'adsReport', values: all(true) },
            { key: 'recall', values: all(true) },
        ],
    },
    {
        key: 'finance',
        rows: [
            { key: 'cashier', values: all(true) },
            { key: 'paymentLinks', values: all(true) },
            { key: 'proposals', values: all(true) },
            { key: 'financeReport', values: all(true) },
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

export interface CompareRowGroup { sectionKey: string; rows: CompareRow[]; }

function groupBySection(predicate: (row: CompareRow) => boolean): CompareRowGroup[] {
    return PLAN_COMPARISON
        .map(s => ({ sectionKey: s.key, rows: s.rows.filter(predicate) }))
        .filter(g => g.rows.length > 0);
}

/**
 * Tudo que `planId` inclui hoje, agrupado por seção. Usado no pop-up para o
 * plano de entrada (sem "plano anterior" para calcular um ganho contra) — sem
 * isso, o plano de entrada nunca mostrava uma lista positiva, só a de recursos
 * exclusivos dos planos maiores, dando a falsa impressão de que não tem nada.
 */
export function planIncluded(planId: PlanId): CompareRowGroup[] {
    return groupBySection(r => isIncluded(r.values[planId]));
}

/**
 * Recursos que `to` entrega e `from` não, agrupados por seção. Framing
 * POSITIVA ("o que você ganha") — inclui de propósito a transição de 'pack'
 * para incluso (ex.: IA deixa de exigir pacote avulso), porque é um ganho real
 * ao fazer upgrade.
 */
export function planGains(from: PlanId, to: PlanId): CompareRowGroup[] {
    return groupBySection(r => !isIncluded(r.values[from]) && isIncluded(r.values[to]));
}

/**
 * Recursos que só existem em `to`, para a framing NEGATIVA ("fica de fora").
 * Diferente de planGains: um item 'pack' em `from` NÃO conta como "de fora" —
 * quem pode ativá-lo comprando um pacote de IA não está sem o recurso, só não
 * vem incluso de graça (isso já é explicado à parte, no bloco de IA do plano).
 */
export function planExclusiveTo(from: PlanId, to: PlanId): CompareRowGroup[] {
    return groupBySection(r => r.values[from] !== 'pack' && !isIncluded(r.values[from]) && isIncluded(r.values[to]));
}
