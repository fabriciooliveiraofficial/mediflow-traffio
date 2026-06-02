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
        monthlyPrice: 197,
        annualMonthlyPrice: 158,
        maxProfessionals: 2,
        maxLocations: 1,
        maxWhatsappNumbers: 1,
        maxStorageGb: 5,
        features: {
            agenda: true,
            prontuario: true,
            portal_paciente: true,
            whatsapp_lembretes: true,
            whatsapp_inbox: false,
            whatsapp_midia: false,
            crm_kanban: false,
            marketing_ads: false,
            financeiro_completo: false,
            modulos_especialidade: 1,
            dicom: false,
            ia_termos_clinicos: false,
            master_dashboard: false,
            api_access: false,
            onboarding_assistido: false,
        },
        highlightFeatures: [
            'Até 2 profissionais',
            '1 unidade',
            'Agenda inteligente com portal online',
            'Prontuário eletrônico completo',
            'Lembretes automáticos por WhatsApp',
            'Confirmação e NPS automáticos',
            '1 módulo de especialidade',
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
        monthlyPrice: 397,
        annualMonthlyPrice: 318,
        maxProfessionals: 10,
        maxLocations: 3,
        maxWhatsappNumbers: 1,
        maxStorageGb: 30,
        features: {
            agenda: true,
            prontuario: true,
            portal_paciente: true,
            whatsapp_lembretes: true,
            whatsapp_inbox: true,
            whatsapp_midia: true,
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
            'Até 10 profissionais',
            'Até 3 unidades',
            'Inbox WhatsApp com atendimento humano',
            'CRM com kanban de follow-up',
            'Integração Meta Ads + Google Ads',
            'Hub financeiro (Asaas, Pagar.me, Dr. Cash)',
            'Todos os módulos de especialidade',
            'DICOM viewer (radiografias)',
            'Suporte prioritário por chat',
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
        monthlyPrice: 897,
        annualMonthlyPrice: 718,
        maxProfessionals: null,
        maxLocations: null,
        maxWhatsappNumbers: 3,
        maxStorageGb: 200,
        features: {
            agenda: true,
            prontuario: true,
            portal_paciente: true,
            whatsapp_lembretes: true,
            whatsapp_inbox: true,
            whatsapp_midia: true,
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
            'Profissionais ilimitados',
            'Unidades ilimitadas',
            '3 números WhatsApp inclusos',
            'Master Dashboard (visão da rede)',
            'Analytics cross-unidade',
            'Faturamento consolidado',
            'API dedicada e webhooks',
            'Onboarding assistido e migração',
            'Gerente de sucesso dedicado',
            'SLA de uptime 99.9%',
        ],
        icon: Crown,
        colorClass: 'text-amber-500',
        badgeClass: 'bg-amber-50 text-amber-500',
        ctaLabel: 'Falar com vendas',
    },
};

export const PLAN_ORDER: PlanId[] = ['essencial', 'clinica', 'rede'];

export const WHATSAPP_EXTRA_NUMBER_PRICE = 129;

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
