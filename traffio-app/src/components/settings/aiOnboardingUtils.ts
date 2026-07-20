interface OnboardingFact {
    key: string;
    type: 'boolean' | 'short_text' | 'long_text' | 'enum';
    options?: readonly { value: string }[];
}

interface ExistingFactValue {
    key: string;
    value: string | null | undefined;
    is_active?: boolean;
}

export function selectEmptyClinicFacts<T extends OnboardingFact>(
    catalog: readonly T[],
    values: readonly ExistingFactValue[],
): T[] {
    const filledKeys = new Set(values
        .filter((item) => item.is_active !== false && Boolean(item.value?.trim()))
        .map((item) => item.key));
    return catalog.filter((fact) => !filledKeys.has(fact.key));
}

export function toExtractionCatalog(facts: readonly OnboardingFact[]) {
    return facts.map((fact) => ({
        key: fact.key,
        type: fact.type,
        ...(fact.options ? { options: fact.options.map((option) => ({ value: option.value })) } : {}),
    }));
}
