export const CLINIC_FACT_LANGUAGES = ['pt-BR', 'en', 'es'] as const;

export type ClinicFactLanguage = (typeof CLINIC_FACT_LANGUAGES)[number];
export type ClinicFactType = 'boolean' | 'short_text' | 'long_text' | 'enum';
export type ClinicFactCategory = 'logistics' | 'amenities' | 'policies' | 'faq' | 'general';
export type ClinicFactSection = 'commercial' | 'logistics' | 'clinical' | 'policies';

export const CLINIC_FACT_VALUE_LIMITS: Readonly<Record<ClinicFactType, number>> = {
    boolean: 5,
    enum: 64,
    short_text: 240,
    long_text: 1_200,
};

export type LocalizedClinicFactText = Record<ClinicFactLanguage, string>;

export interface ClinicFactOption {
    value: string;
    label: LocalizedClinicFactText;
}

export interface ClinicFactDefinition {
    key: string;
    category: ClinicFactCategory;
    section: ClinicFactSection;
    type: ClinicFactType;
    label: LocalizedClinicFactText;
    helpText: LocalizedClinicFactText;
    example: LocalizedClinicFactText;
    options?: readonly ClinicFactOption[];
}

const localized = (ptBR: string, en: string, es: string): LocalizedClinicFactText => ({
    'pt-BR': ptBR,
    en,
    es,
});

const yesNoOptions: readonly ClinicFactOption[] = [
    { value: 'yes', label: localized('Sim', 'Yes', 'Sí') },
    { value: 'no', label: localized('Não', 'No', 'No') },
];

/**
 * Ficha canônica do tenant. As chaves são contrato de dados: não devem ser
 * traduzidas nem reaproveitadas com outro significado.
 */
export const CLINIC_FACTS: readonly ClinicFactDefinition[] = [
    {
        key: 'clinic_differentials', category: 'general', section: 'commercial', type: 'long_text',
        label: localized('Diferenciais da clínica (Pitch de Vendas)', 'Clinic Differentials (Sales Pitch)', 'Diferenciales de la clínica (Argumento de venta)'),
        helpText: localized('Descreva os pontos fortes da clínica (ex: anos de mercado, avaliações, credibilidade) para a IA usar como argumento de venda.', 'Describe the clinic\'s strengths (e.g., years in the market, reviews, credibility) for the AI to use as a sales pitch.', 'Describa los puntos fuertes de la clínica (ej. años en el mercado, reseñas, credibilidad) para que la IA los use como argumento de venta.'),
        example: localized('Mais de 20 anos de mercado e 200 avaliações positivas, levando credibilidade e transformando vidas.', 'Over 20 years in the market and 200 positive reviews, providing credibility and transforming lives.', 'Más de 20 años en el mercado y 200 reseñas positivas, brindando credibilidad y transformando vidas.'),
    },
    {
        key: 'consultation_fee', category: 'policies', section: 'commercial', type: 'enum',
        label: localized('Status da avaliação', 'Consultation status', 'Estado de la consulta'),
        helpText: localized('Informe se a avaliação é gratuita ou paga. Não inclua valores.', 'Say whether the consultation is free or paid. Do not include amounts.', 'Indique si la consulta es gratuita o paga. No incluya importes.'),
        example: localized('Avaliação gratuita', 'Free consultation', 'Consulta gratuita'),
        options: [
            { value: 'free', label: localized('Gratuita', 'Free', 'Gratuita') },
            { value: 'paid', label: localized('Paga', 'Paid', 'Paga') },
            { value: 'first_free', label: localized('Primeira avaliação gratuita', 'First consultation is free', 'Primera consulta gratuita') },
        ],
    },
    {
        key: 'first_consultation_process', category: 'faq', section: 'commercial', type: 'long_text',
        label: localized('Como funciona a primeira consulta?', 'How does the first consultation work?', '¿Cómo funciona la primera consulta?'),
        helpText: localized('Descreva as etapas sem prometer diagnóstico ou resultado.', 'Describe the steps without promising a diagnosis or outcome.', 'Describa las etapas sin prometer diagnóstico ni resultado.'),
        example: localized('Conversa inicial, avaliação clínica e explicação das próximas etapas.', 'Initial conversation, clinical evaluation, and explanation of next steps.', 'Conversación inicial, evaluación clínica y explicación de los próximos pasos.'),
    },
    {
        key: 'payment_methods', category: 'policies', section: 'commercial', type: 'short_text',
        label: localized('Formas de pagamento', 'Payment methods', 'Formas de pago'),
        helpText: localized('Liste apenas os meios aceitos pela clínica.', 'List only the methods accepted by the clinic.', 'Enumere solo los medios aceptados por la clínica.'),
        example: localized('Pix, cartão de crédito e débito.', 'Credit card, debit card, and bank transfer.', 'Tarjeta de crédito, débito y transferencia.'),
    },
    {
        key: 'installment_options', category: 'policies', section: 'commercial', type: 'short_text',
        label: localized('Opções de parcelamento', 'Installment options', 'Opciones de financiación'),
        helpText: localized('Explique a regra sem registrar preço de procedimento.', 'Explain the rule without recording procedure prices.', 'Explique la regla sin registrar precios de procedimientos.'),
        example: localized('Parcelamento sujeito ao plano de tratamento e à análise na clínica.', 'Installments depend on the treatment plan and in-clinic review.', 'Las cuotas dependen del plan de tratamiento y de la revisión en la clínica.'),
    },
    {
        key: 'accepted_insurance', category: 'policies', section: 'commercial', type: 'long_text',
        label: localized('Convênios aceitos', 'Accepted insurance plans', 'Seguros aceptados'),
        helpText: localized('Liste convênios e eventuais limites de atendimento.', 'List plans and any service limitations.', 'Enumere los seguros y las posibles limitaciones de atención.'),
        example: localized('Atendimento particular e convênios X e Y, mediante validação.', 'Private care and plans X and Y, subject to eligibility.', 'Atención privada y seguros X e Y, sujetos a validación.'),
    },
    {
        key: 'written_estimate', category: 'policies', section: 'commercial', type: 'boolean',
        label: localized('Entrega orçamento por escrito?', 'Provides a written estimate?', '¿Entrega presupuesto por escrito?'),
        helpText: localized('Marque sim apenas se este for o processo padrão.', 'Choose yes only if this is the standard process.', 'Marque sí solo si este es el proceso habitual.'),
        example: localized('Sim, após a avaliação.', 'Yes, after the consultation.', 'Sí, después de la consulta.'),
        options: yesNoOptions,
    },
    {
        key: 'address', category: 'logistics', section: 'logistics', type: 'long_text',
        label: localized('Endereço e referência', 'Address and landmark', 'Dirección y referencia'),
        helpText: localized('Inclua unidade, número, bairro e um ponto de referência útil.', 'Include unit, street number, district, and a useful landmark.', 'Incluya sede, número, barrio y una referencia útil.'),
        example: localized('Av. Central, 100, Centro, ao lado da farmácia.', '100 Central Ave., Downtown, next to the pharmacy.', 'Av. Central 100, Centro, junto a la farmacia.'),
    },
    {
        key: 'parking', category: 'logistics', section: 'logistics', type: 'short_text',
        label: localized('Estacionamento', 'Parking', 'Estacionamiento'),
        helpText: localized('Informe disponibilidade, custo ou alternativa próxima.', 'State availability, cost, or a nearby alternative.', 'Indique disponibilidad, costo o una alternativa cercana.'),
        example: localized('Duas vagas gratuitas em frente; estacionamento pago na mesma quadra.', 'Two free spaces in front; paid parking on the same block.', 'Dos plazas gratuitas al frente; estacionamiento pago en la misma cuadra.'),
    },
    {
        key: 'accessibility', category: 'amenities', section: 'logistics', type: 'short_text',
        label: localized('Acessibilidade', 'Accessibility', 'Accesibilidad'),
        helpText: localized('Descreva acesso, elevador, banheiro adaptado ou limitações.', 'Describe access, elevator, accessible restroom, or limitations.', 'Describa acceso, ascensor, baño adaptado o limitaciones.'),
        example: localized('Entrada sem degraus, elevador e banheiro acessível.', 'Step-free entrance, elevator, and accessible restroom.', 'Entrada sin escalones, ascensor y baño accesible.'),
    },
    {
        key: 'public_transport', category: 'logistics', section: 'logistics', type: 'short_text',
        label: localized('Transporte público', 'Public transportation', 'Transporte público'),
        helpText: localized('Informe estações, linhas ou paradas próximas.', 'Mention nearby stations, routes, or stops.', 'Indique estaciones, líneas o paradas cercanas.'),
        example: localized('A 5 minutos da estação Central; linhas 10 e 22.', 'Five minutes from Central Station; routes 10 and 22.', 'A cinco minutos de la estación Central; líneas 10 y 22.'),
    },
    {
        key: 'business_hours', category: 'logistics', section: 'logistics', type: 'long_text',
        label: localized('Horário de funcionamento', 'Business hours', 'Horario de atención'),
        helpText: localized('Registre dias, horários e exceções importantes.', 'Record days, hours, and important exceptions.', 'Registre días, horarios y excepciones importantes.'),
        example: localized('Segunda a sexta, 8h às 18h; sábado, 8h às 12h.', 'Monday to Friday, 8 a.m.–6 p.m.; Saturday, 8 a.m.–noon.', 'Lunes a viernes, 8:00–18:00; sábado, 8:00–12:00.'),
    },
    {
        key: 'languages_spoken', category: 'amenities', section: 'logistics', type: 'short_text',
        label: localized('Idiomas atendidos', 'Languages supported', 'Idiomas de atención'),
        helpText: localized('Liste os idiomas em que a equipe consegue atender.', 'List the languages in which the team can provide service.', 'Enumere los idiomas en los que el equipo puede atender.'),
        example: localized('Português, inglês e espanhol.', 'English, Portuguese, and Spanish.', 'Español, portugués e inglés.'),
    },
    {
        key: 'contact_email', category: 'logistics', section: 'logistics', type: 'short_text',
        label: localized('E-mail de contato', 'Contact email', 'Correo electrónico de contacto'),
        helpText: localized('Informe o e-mail oficial da clínica para dúvidas, encaminhamento de documentos ou suporte.', 'Provide the clinic’s official email for inquiries, documents, or support.', 'Ingrese el correo oficial de la clínica para consultas, documentos o atención.'),
        example: localized('contato@suaclinica.com.br', 'contact@yourclinic.com', 'contacto@suclinica.com'),
    },
    {
        key: 'contact_channels', category: 'logistics', section: 'logistics', type: 'long_text',
        label: localized('Canais e telefones de contato', 'Contact channels and phones', 'Canales y teléfonos de contacto'),
        helpText: localized('Informe todos os canais oficiais (WhatsApp, e-mail, telefone fixo, SMS, Instagram, site) para orientação do paciente.', 'List all official channels (WhatsApp, email, landline, SMS, Instagram, website) for patient guidance.', 'Ingrese todos los canales oficiales (WhatsApp, correo, teléfono fijo, SMS, Instagram, sitio web) para orientación del paciente.'),
        example: localized('E-mail: contato@clinica.com.br | Telefone/SMS: (11) 3333-4444 | WhatsApp: (11) 99999-8888 | Instagram: @clinica', 'Email: contact@clinic.com | Phone/SMS: (11) 3333-4444 | WhatsApp: (11) 99999-8888 | Instagram: @clinic', 'Correo: contacto@clinica.com | Teléfono/SMS: (11) 3333-4444 | WhatsApp: (11) 99999-8888 | Instagram: @clinica'),
    },
    {
        key: 'dental_anxiety_support', category: 'faq', section: 'clinical', type: 'long_text',
        label: localized('Apoio para medo de dentista', 'Support for dental anxiety', 'Apoyo para el miedo al dentista'),
        helpText: localized('Explique como a equipe acolhe pacientes ansiosos, sem prometer ausência de dor.', 'Explain how the team supports anxious patients without promising a pain-free experience.', 'Explique cómo el equipo acompaña a pacientes ansiosos sin prometer ausencia de dolor.'),
        example: localized('A equipe explica cada etapa e adapta o ritmo durante a avaliação.', 'The team explains each step and adapts the pace during the consultation.', 'El equipo explica cada etapa y adapta el ritmo durante la consulta.'),
    },
    {
        key: 'sedation_availability', category: 'faq', section: 'clinical', type: 'enum',
        label: localized('Disponibilidade de sedação', 'Sedation availability', 'Disponibilidad de sedación'),
        helpText: localized('Informe a disponibilidade; indicação clínica sempre cabe ao profissional.', 'State availability; clinical suitability is always decided by the clinician.', 'Indique disponibilidad; la indicación clínica siempre corresponde al profesional.'),
        example: localized('Disponível apenas após avaliação profissional.', 'Available only after professional assessment.', 'Disponible solo después de evaluación profesional.'),
        options: [
            { value: 'not_available', label: localized('Não disponível', 'Not available', 'No disponible') },
            { value: 'available', label: localized('Disponível', 'Available', 'Disponible') },
            { value: 'on_assessment', label: localized('Somente após avaliação', 'Only after assessment', 'Solo después de evaluación') },
        ],
    },
    {
        key: 'children_served', category: 'faq', section: 'clinical', type: 'boolean',
        label: localized('Atende crianças?', 'Treats children?', '¿Atiende a niños?'),
        helpText: localized('Marque conforme o atendimento real da unidade.', 'Choose according to the unit’s actual service.', 'Marque según la atención real de la sede.'),
        example: localized('Sim.', 'Yes.', 'Sí.'),
        options: yesNoOptions,
    },
    {
        key: 'children_minimum_age', category: 'faq', section: 'clinical', type: 'short_text',
        label: localized('Idade mínima para crianças', 'Minimum age for children', 'Edad mínima para niños'),
        helpText: localized('Preencha apenas se houver uma regra de idade.', 'Fill this only if there is an age rule.', 'Complete solo si existe una regla de edad.'),
        example: localized('A partir de 3 anos.', 'Ages 3 and up.', 'A partir de 3 años.'),
    },
    {
        key: 'urgent_appointments', category: 'faq', section: 'clinical', type: 'enum',
        label: localized('Urgência e encaixe', 'Urgent and same-day visits', 'Urgencias y turnos adicionales'),
        helpText: localized('Descreva a capacidade operacional, não orientação médica de emergência.', 'Describe operational availability, not medical emergency advice.', 'Describa la disponibilidad operativa, no orientación para emergencias médicas.'),
        example: localized('Encaixes sujeitos à disponibilidade do dia.', 'Same-day visits are subject to availability.', 'Los turnos adicionales dependen de la disponibilidad.'),
        options: [
            { value: 'yes', label: localized('Aceita encaixe', 'Accepts same-day visits', 'Acepta turnos adicionales') },
            { value: 'no', label: localized('Não aceita encaixe', 'Does not accept same-day visits', 'No acepta turnos adicionales') },
            { value: 'subject_to_availability', label: localized('Sujeito à disponibilidade', 'Subject to availability', 'Sujeto a disponibilidad') },
        ],
    },
    {
        key: 'evaluation_includes_xray', category: 'faq', section: 'clinical', type: 'enum',
        label: localized('A avaliação inclui raio-X?', 'Does the consultation include an X-ray?', '¿La consulta incluye radiografía?'),
        helpText: localized('Diferencie exame incluído de exame indicado conforme o caso.', 'Distinguish an included exam from one ordered when clinically indicated.', 'Distinga un examen incluido de uno indicado según el caso.'),
        example: localized('Quando indicado pelo dentista, pode ser solicitado separadamente.', 'It may be ordered separately when indicated by the dentist.', 'Puede solicitarse por separado cuando lo indique el dentista.'),
        options: [
            { value: 'yes', label: localized('Sim, incluído', 'Yes, included', 'Sí, incluida') },
            { value: 'no', label: localized('Não incluído', 'Not included', 'No incluida') },
            { value: 'when_indicated', label: localized('Somente quando indicado', 'Only when indicated', 'Solo cuando se indique') },
        ],
    },
    {
        key: 'first_visit_documents', category: 'faq', section: 'clinical', type: 'long_text',
        label: localized('O que levar na primeira consulta', 'What to bring to the first visit', 'Qué llevar a la primera consulta'),
        helpText: localized('Liste documentos e exames realmente necessários.', 'List documents and exams that are actually required.', 'Enumere documentos y estudios realmente necesarios.'),
        example: localized('Documento com foto e exames recentes, se houver.', 'Photo ID and recent exams, if available.', 'Documento con foto y estudios recientes, si los tiene.'),
    },
    {
        key: 'cancellation_policy', category: 'policies', section: 'policies', type: 'long_text',
        label: localized('Política de cancelamento', 'Cancellation policy', 'Política de cancelación'),
        helpText: localized('Registre prazo, canal e consequência real. Não invente multa.', 'Record the deadline, channel, and actual consequence. Do not invent a fee.', 'Registre el plazo, canal y consecuencia real. No invente cargos.'),
        example: localized('Avise pelo WhatsApp com pelo menos 24 horas de antecedência.', 'Notify us by WhatsApp at least 24 hours in advance.', 'Avise por WhatsApp con al menos 24 horas de anticipación.'),
    },
    {
        key: 'late_arrival_tolerance', category: 'policies', section: 'policies', type: 'short_text',
        label: localized('Atraso e tolerância', 'Late arrival policy', 'Política de retrasos'),
        helpText: localized('Informe a tolerância e o que acontece depois dela.', 'State the grace period and what happens after it.', 'Indique la tolerancia y qué ocurre después.'),
        example: localized('Tolerância de 10 minutos; após isso, o atendimento depende da agenda.', 'Ten-minute grace period; after that, service depends on the schedule.', 'Tolerancia de 10 minutos; después, la atención depende de la agenda.'),
    },
    {
        key: 'rescheduling_policy', category: 'policies', section: 'policies', type: 'long_text',
        label: localized('Política de reagendamento', 'Rescheduling policy', 'Política de reprogramación'),
        helpText: localized('Explique prazo, limite e canal para reagendar.', 'Explain the deadline, limits, and channel for rescheduling.', 'Explique el plazo, límites y canal para reprogramar.'),
        example: localized('Reagendamento pelo WhatsApp, sujeito à nova disponibilidade.', 'Reschedule via WhatsApp, subject to new availability.', 'Reprogramación por WhatsApp, sujeta a nueva disponibilidad.'),
    },
    {
        key: 'appointment_confirmation', category: 'policies', section: 'policies', type: 'long_text',
        label: localized('Confirmação de consulta', 'Appointment confirmation', 'Confirmación de cita'),
        helpText: localized('Descreva quando a clínica confirma e se espera resposta.', 'Describe when the clinic confirms and whether a reply is expected.', 'Describa cuándo confirma la clínica y si espera respuesta.'),
        example: localized('Enviamos uma mensagem no dia anterior e pedimos confirmação.', 'We send a message the day before and ask for confirmation.', 'Enviamos un mensaje el día anterior y pedimos confirmación.'),
    },
    {
        key: 'companion_policy', category: 'policies', section: 'policies', type: 'short_text',
        label: localized('Acompanhantes', 'Companion policy', 'Acompañantes'),
        helpText: localized('Informe limites da recepção ou exigências para menores.', 'State waiting-room limits or requirements for minors.', 'Indique límites de la sala de espera o requisitos para menores.'),
        example: localized('Menores devem vir com responsável; a sala comporta um acompanhante.', 'Minors must come with a guardian; one companion is allowed.', 'Los menores deben venir con un responsable; se permite un acompañante.'),
    },
] as const;

const canonicalKeys = new Set(CLINIC_FACTS.map((fact) => fact.key));

export function isCanonicalClinicFactKey(key: string): boolean {
    return canonicalKeys.has(key);
}

export function normalizeClinicFactLanguage(language?: string | null): ClinicFactLanguage {
    if (language?.toLowerCase().startsWith('en')) return 'en';
    if (language?.toLowerCase().startsWith('es')) return 'es';
    return 'pt-BR';
}

export function getClinicFactValueLimit(fact: Pick<ClinicFactDefinition, 'type'>): number {
    return CLINIC_FACT_VALUE_LIMITS[fact.type];
}

export interface ClinicFactValueLike {
    key: string;
    value: string | null | undefined;
    is_active?: boolean;
}

export interface ClinicFactsCompletion {
    completed: number;
    total: number;
    percentage: number;
}

export function calculateClinicFactsCompletion(
    values: readonly ClinicFactValueLike[],
    catalog: readonly Pick<ClinicFactDefinition, 'key'>[] = CLINIC_FACTS,
): ClinicFactsCompletion {
    const filled = new Set(
        values
            .filter((entry) => entry.is_active !== false && typeof entry.value === 'string' && entry.value.trim().length > 0)
            .map((entry) => entry.key),
    );
    const completed = catalog.reduce((count, fact) => count + (filled.has(fact.key) ? 1 : 0), 0);
    const total = catalog.length;
    return {
        completed,
        total,
        percentage: total === 0 ? 0 : Math.round((completed / total) * 100),
    };
}
