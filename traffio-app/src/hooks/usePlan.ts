import { useMemo } from 'react';
import { useTenant } from '../contexts/TenantContext';
import { PLANS, type PlanFeatures, type PlanId } from '../config/planConfig';
import { subscriptionService } from '../services/subscriptionService';

interface UsePlanReturn {
    planId: PlanId;
    features: PlanFeatures;
    /** Verifica se uma feature está disponível no plano atual */
    can: (feature: keyof PlanFeatures) => boolean;
    /** Verifica se o plano atual permite N profissionais adicionais */
    canAddProfessional: (currentCount: number) => boolean;
    /** Verifica se o plano atual permite N unidades adicionais */
    canAddLocation: (currentCount: number) => boolean;
    isTrialActive: boolean;
    isTrialExpired: boolean;
    trialDaysLeft: number;
    isActive: boolean;
    isSuspended: boolean;
}

export function usePlan(): UsePlanReturn {
    const { tenant } = useTenant();

    return useMemo(() => {
        const planId: PlanId = tenant?.plan ?? 'essencial';
        const planConfig = PLANS[planId];
        const features = planConfig.features;

        const status = tenant?.subscription_status ?? 'trial';
        const trialEndsAt = tenant?.trial_ends_at ?? null;

        const subscription = { subscription_status: status, trial_ends_at: trialEndsAt } as any;
        const trialDaysLeft = subscriptionService.trialDaysLeft(subscription);
        const isTrialExpired = subscriptionService.isTrialExpired(subscription);

        function can(feature: keyof PlanFeatures): boolean {
            const value = features[feature];
            if (typeof value === 'boolean') return value;
            // modulos_especialidade: -1 = ilimitado, 0 = nenhum, N = até N módulos
            if (feature === 'modulos_especialidade') return (value as number) !== 0;
            return false;
        }

        function canAddProfessional(currentCount: number): boolean {
            if (planConfig.maxProfessionals === null) return true;
            return currentCount < planConfig.maxProfessionals;
        }

        function canAddLocation(currentCount: number): boolean {
            if (planConfig.maxLocations === null) return true;
            return currentCount < planConfig.maxLocations;
        }

        return {
            planId,
            features,
            can,
            canAddProfessional,
            canAddLocation,
            isTrialActive: status === 'trial' && !isTrialExpired,
            isTrialExpired,
            trialDaysLeft,
            isActive: status === 'active',
            isSuspended: status === 'suspended',
        };
    }, [tenant]);
}
