import { Star, Zap, Crown } from 'lucide-react';

// IDs dos planos — devem coincidir com a tabela `plans` no banco
export type PlanId = 'essencial' | 'clinica' | 'rede';

export type SubscriptionStatus = 'trial' | 'active' | 'suspended' | 'canceled';

export type BillingCycle = 'monthly' | 'annual';

// Chaves de feature usadas no feature gate (usePlan)
export interface PlanFeatures {
    agenda: boolean;
    prontuario: boolean;
    portal_paciente: boolean;
    whatsapp_lembretes: boolean;
    whatsapp_inbox: boolean;
    whatsapp_midia: boolean;
    /** Upgrade de canal para WhatsApp Cloud API (Meta) — botões garantidos, tier Pro */
    cloud_api: boolean;
    crm_kanban: boolean;
    marketing_ads: boolean;
    financeiro_completo: boolean;
    /** número de módulos de especialidade; -1 = ilimitado */
    modulos_especialidade: number;
    dicom: boolean;
    ia_termos_clinicos: boolean;
    master_dashboard: boolean;
    api_access: boolean;
    onboarding_assistido: boolean;
}

export interface PlanConfig {
    id: PlanId;
    name: string;
    description: string;
    monthlyPrice: number;
    annualMonthlyPrice: number;
    /** null = ilimitado */
    maxProfessionals: number | null;
    /** null = ilimitado */
    maxLocations: number | null;
    maxWhatsappNumbers: number;
    maxStorageGb: number;
    /**
     * Conversas de IA incluídas por mês (docs/PLANO_MONETIZACAO_IA_2026-09.md).
     * 1 conversa = R$1,55 de custo real de IA; acima disso, pacotes (AI_PACKAGES).
     * Espelho de plans.ai_conversations_included no banco.
     */
    aiConversationsIncluded: number;
    features: PlanFeatures;
    highlightFeatures: string[];
    icon: typeof Star;
    colorClass: string;
    badgeClass: string;
    ctaLabel: string;
}

export const PLANS: Record<PlanId, PlanConfig> = {
    essencial: {
        id: 'essencial',
        name: 'Essencial',
        description: 'Ideal para profissional autônomo e consultório solo.',
        monthlyPrice: 297,
        annualMonthlyPrice: 272,
        maxProfessionals: 2,
        maxLocations: 1,
        maxWhatsappNumbers: 1,
        maxStorageGb: 5,
        aiConversationsIncluded: 0,
        // Decisão 15/09/2026: nenhum recurso de software é bloqueado por plano
        // (custo marginal zero). Os planos diferem em conversas de IA,
        // profissionais/unidades, armazenamento e números de WhatsApp.
        features: {
            agenda: true,
            prontuario: true,
            portal_paciente: true,
            whatsapp_lembretes: true,
            whatsapp_inbox: true,
            whatsapp_midia: true,
            cloud_api: true,
            crm_kanban: true,
            marketing_ads: true,
            financeiro_completo: true,
            modulos_especialidade: -1,
            dicom: true,
            ia_termos_clinicos: true,
            master_dashboard: false,
            api_access: false,
            onboarding_assistido: false,
        },
        highlightFeatures: [
            'Plataforma completa: agenda, caixa de entrada, prontuário, CRM e cobranças',
            'Até 2 profissionais em 1 unidade',
            'Lembretes e confirmações automáticas no WhatsApp',
            'IA de atendimento por pacote avulso',
            '5 GB para arquivos',
            'Suporte por e-mail',
        ],
        icon: Star,
        colorClass: 'text-brand-primary',
        badgeClass: 'bg-brand-primary/10 text-brand-primary',
        ctaLabel: 'Começar trial de 14 dias',
    },
    clinica: {
        id: 'clinica',
        name: 'Clínica',
        description: 'Para clínicas em crescimento com múltiplos profissionais.',
        monthlyPrice: 547,
        annualMonthlyPrice: 497,
        maxProfessionals: 10,
        maxLocations: 3,
        maxWhatsappNumbers: 1,
        maxStorageGb: 30,
        aiConversationsIncluded: 60,
        features: {
            agenda: true,
            prontuario: true,
            portal_paciente: true,
            whatsapp_lembretes: true,
            whatsapp_inbox: true,
            whatsapp_midia: true,
            cloud_api: true,
            crm_kanban: true,
            marketing_ads: true,
            financeiro_completo: true,
            modulos_especialidade: -1,
            dicom: true,
            ia_termos_clinicos: true,
            master_dashboard: false,
            api_access: false,
            onboarding_assistido: false,
        },
        highlightFeatures: [
            'Tudo do Essencial',
            '60 conversas de IA por mês incluídas',
            'Até 10 profissionais',
            'Até 3 unidades',
            '30 GB para arquivos',
        ],
        icon: Zap,
        colorClass: 'text-indigo-500',
        badgeClass: 'bg-indigo-50 text-indigo-500',
        ctaLabel: 'Fazer upgrade',
    },
    rede: {
        id: 'rede',
        name: 'Rede',
        description: 'Para redes e franquias com múltiplas unidades.',
        monthlyPrice: 997,
        annualMonthlyPrice: 917,
        maxProfessionals: null,
        maxLocations: null,
        maxWhatsappNumbers: 1,
        maxStorageGb: 200,
        aiConversationsIncluded: 150,
        features: {
            agenda: true,
            prontuario: true,
            portal_paciente: true,
            whatsapp_lembretes: true,
            whatsapp_inbox: true,
            whatsapp_midia: true,
            cloud_api: true,
            crm_kanban: true,
            marketing_ads: true,
            financeiro_completo: true,
            modulos_especialidade: -1,
            dicom: true,
            ia_termos_clinicos: true,
            master_dashboard: true,
            api_access: true,
            onboarding_assistido: true,
        },
        highlightFeatures: [
            'Tudo do Clínica',
            '150 conversas de IA por mês incluídas',
            'Profissionais ilimitados',
            'Unidades ilimitadas',
            '200 GB para arquivos',
        ],
        icon: Crown,
        colorClass: 'text-amber-500',
        badgeClass: 'bg-amber-50 text-amber-500',
        ctaLabel: 'Falar com vendas',
    },
};

export const PLAN_ORDER: PlanId[] = ['essencial', 'clinica', 'rede'];

// Cada número WhatsApp além do 1º incluso = 1 instância Z-API paga pela Traffio
// (R$ ~100/mês). R$ 229 = 35% de margem após Stripe + imposto. Espelho de
// plans.extra_whatsapp_number_price.
export const WHATSAPP_EXTRA_NUMBER_PRICE = 229;

/** Conversas de IA por mês durante o trial (master_config AI_TRIAL_CONVERSATIONS). */
export const AI_TRIAL_CONVERSATIONS = 20;

/**
 * Pacotes avulsos de conversas de IA — espelho da tabela ai_packages (o preço
 * cobrado vem SEMPRE do banco, isto é só para exibição). Piso de R$3,50/conversa.
 */
export interface AiPackage { id: string; units: number; priceBrl: number; }
export const AI_PACKAGES: AiPackage[] = [
    { id: 'ai_50',  units: 50,  priceBrl: 199 },
    { id: 'ai_150', units: 150, priceBrl: 549 },
    { id: 'ai_500', units: 500, priceBrl: 1790 },
];

/** Retorna se planA é superior a planB */
export function isPlanUpgrade(from: PlanId, to: PlanId): boolean {
    return PLAN_ORDER.indexOf(to) > PLAN_ORDER.indexOf(from);
}

/** Formata preço em BRL */
export function formatPrice(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 0,
    }).format(value);
}
