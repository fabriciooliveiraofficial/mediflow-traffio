// Removed local import to src to avoid Edge Function crash
// import type { BotConfig } from '../../../src/services/aiConfigService';

export interface BotConfig {
    enabled: boolean;
    personality: 'formal' | 'acolhedor' | 'objetivo';
    global_instructions: string;
    interactive_mode: boolean;
    active_agent: 'human' | 'ai_assistant' | 'flow_bot';
}

export interface TimeSlot {
    time: string;
    isAvailable: boolean;
}

export interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface InteractiveComponent {
    type: 'button' | 'list';
    title?: string;
    buttonLabel?: string;
    items: { id: string, label: string }[];
}

export interface AgentResponse {
    text: string;
    interactive?: InteractiveComponent;
}

export interface AgentContext {
    specialty?: string;
    doctorId?: string;
    patientId?: string;
    tenantId?: string;
    date?: string;
    selectedSlot?: string;
    availableSlots?: TimeSlot[];
    doctorsFound?: { id: string, full_name: string }[];
}

export interface AgentState {
    step: 'idle' | 'triage' | 'selecting_specialty' | 'browsing' | 'negotiating' | 'auditing' | 'confirmed';
    messages: Message[];
    context: AgentContext;
}

export interface ISchedulingProvider {
    getSpecialties(tenantId: string): Promise<string[]>;
    getDoctorsBySpecialty(tenantId: string, specialty: string): Promise<{ id: string, full_name: string }[]>;
    getAvailableSlots(doctorId: string, date: string, tenantId: string): Promise<TimeSlot[]>;
    createAppointment(data: any): Promise<any>;
}

const ORDINALS: Record<string, number> = {
    'primeiro': 0, 'primeira': 0, '1°': 0, '1º': 0, '1ª': 0,
    'segundo': 1, 'segunda': 1, '2°': 1, '2º': 1, '2ª': 1,
    'terceiro': 2, 'terceira': 2, '3°': 2, '3º': 2, '3ª': 2,
    'último': -1, 'ultima': -1, 'último horário': -1,
};

function fuzzyMatchSlot(input: string, slots: TimeSlot[]): TimeSlot | TimeSlot[] | null {
    const cleaned = input.trim().toLowerCase()
        .replace(/às\s*/g, '')
        .replace(/horas?/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    for (const [word, idx] of Object.entries(ORDINALS)) {
        if (cleaned.includes(word)) {
            const target = idx === -1 ? slots[slots.length - 1] : slots[idx];
            return target || null;
        }
    }

    const pureNumber = cleaned.match(/^(\d{1,2})$/);
    if (pureNumber) {
        const num = parseInt(pureNumber[1], 10);
        if (num >= 1 && num <= slots.length) {
            const hourMatches = slots.filter(s => parseInt(s.time.split(':')[0], 10) === num);
            if (num >= 7 && hourMatches.length > 0) {
                return hourMatches.length === 1 ? hourMatches[0] : hourMatches;
            }
            return slots[num - 1] || null;
        }
    }

    const timePattern = cleaned.match(/(\d{1,2})[h:]?(\d{2})?/);
    if (timePattern) {
        const hour = parseInt(timePattern[1], 10);
        const minute = timePattern[2] ? parseInt(timePattern[2], 10) : null;
        if (minute !== null) {
            const target = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
            return slots.find(s => s.time === target) || null;
        } else {
            const hourMatches = slots.filter(s => parseInt(s.time.split(':')[0], 10) === hour);
            if (hourMatches.length === 1) return hourMatches[0];
            if (hourMatches.length > 1) return hourMatches;
        }
    }

    return slots.find(s => cleaned.includes(s.time)) || null;
}

function humanizeTime(time: string): string {
    const [h, m] = time.split(':').map(Number);
    return m === 0 ? `${h}h` : `${h}h${m.toString().padStart(2, '0')}`;
}

export class ChatAgent {
    private state: AgentState;
    private provider: ISchedulingProvider;
    private config?: BotConfig;

    constructor(
        patientId: string,
        tenantId: string,
        provider: ISchedulingProvider,
        config?: BotConfig,
        initialState?: AgentState
    ) {
        this.provider = provider;
        this.config = config;
        this.state = initialState || {
            step: 'idle',
            messages: [],
            context: { patientId, tenantId }
        };
    }

    /**
     * Builds the high-intelligence System Prompt based on Tenant Config.
     */
    private buildSystemPrompt(): string {
        const personality = this.config?.personality || 'formal';
        const instructions = this.config?.global_instructions || 'Seja prestativo e educado.';
        const now = new Date();
        const dateStr = now.toLocaleDateString('pt-BR');

        return `
            # PERSONA
            Você é o assistente virtual inteligente da clínica.
            Seu tom de voz deve ser: **${personality.toUpperCase()}**.

            # INSTRUÇÕES DO ESTABELECIMENTO (P0 - Siga à risca)
            ${instructions}

            # CONTEXTO ATUAL
            - Data de hoje: ${dateStr}
            - Horário agora: ${now.toLocaleTimeString('pt-BR')}
            - Objetivo Principal: Auxiliar o paciente a agendar consultas ou tirar dúvidas.

            # REGRAS DE COMPORTAMENTO
            1. Se o paciente quiser agendar, use as ferramentas disponíveis para listar especialidades, médicos e horários.
            2. Sempre priorize respostas curtas e objetivas (máximo 3 parágrafos).
            3. Use emojis para tornar a conversa acolhedora (se a personalidade não for estritamente formal).
            4. Se não souber a resposta para algo específico da clínica, peça para o paciente aguardar um atendente humano.
        `.trim();
    }

    async processMessage(userContent: string, isButton: boolean = false): Promise<AgentResponse> {
        this.state.messages.push({ role: 'user', content: userContent });

        // Build prompt (for logging/generative readiness)
        const systemPrompt = this.buildSystemPrompt();
        console.log(`[AGENT] System Prompt Built: \n${systemPrompt.substring(0, 100)}...`);

        // Logic check: Is this a "deterministic" match for scheduling?
        const lower = userContent.toLowerCase();
        const isSchedulingIntent = lower.includes('marcar') || lower.includes('agendar') || lower.includes('consulta') || lower.includes('horário');

        if (isButton) {
            return await this.handleInteraction(userContent);
        }

        if (this.state.step === 'negotiating') {
            const res = await this.handleNegotiation(userContent);
            return typeof res === 'string' ? { text: res } : res;
        }

        if (isSchedulingIntent) {
            return await this.startTriage();
        }

        // GENERATIVE FALLBACK (Autonomous Brain)
        // Here we would call Gemini/Claude with the system prompt and conversation history
        return {
            text: `Olá! 👋 Sou o assistente da sua clínica. Como posso ajudar hoje? (Personalidade: ${this.config?.personality || 'Formal'})`,
            interactive: this.config?.interactive_mode ? {
                type: 'button',
                items: [
                    { id: 'intent_book', label: '📅 Agendar Consulta' },
                    { id: 'intent_info', label: 'ℹ️ Informações' },
                    { id: 'intent_human', label: '👤 Falar com Humano' }
                ]
            } : undefined
        };
    }

    private async handleInteraction(choiceId: string): Promise<AgentResponse> {
        if (choiceId === 'intent_book') return await this.startTriage();

        if (this.state.step === 'selecting_specialty') {
            this.state.context.specialty = choiceId;
            return await this.listDoctorsForSpecialty(choiceId);
        }

        if (this.state.step === 'browsing') {
            this.state.context.doctorId = choiceId;
            return await this.showAvailabilityForDoctor(choiceId);
        }

        if (this.state.step === 'negotiating') {
            return await this.confirmBooking({ time: choiceId, isAvailable: true });
        }

        return { text: "Opção recebida! Como posso ajudar agora?" };
    }

    private async startTriage(): Promise<AgentResponse> {
        const specialties = await this.provider.getSpecialties(this.state.context.tenantId!);

        if (specialties.length === 0) {
            return { text: "No momento não temos especialidades cadastradas para agendamento online." };
        }

        this.state.step = 'selecting_specialty';
        return {
            text: "Perfeito! Qual especialidade você está buscando?",
            interactive: this.config?.interactive_mode ? {
                type: 'list',
                title: 'Especialidades',
                buttonLabel: 'Ver Especialidades',
                items: specialties.map(s => ({ id: s, label: s }))
            } : undefined
        };
    }

    private async listDoctorsForSpecialty(specialty: string): Promise<AgentResponse> {
        const doctors = await this.provider.getDoctorsBySpecialty(this.state.context.tenantId!, specialty);

        if (doctors.length === 0) {
            return { text: `Desculpe, não encontrei médicos disponíveis para ${specialty} no momento.` };
        }

        this.state.step = 'browsing';
        this.state.context.doctorsFound = doctors;

        return {
            text: `Ótimo! Temos estes profissionais em ${specialty}. Com quem prefere agendar?`,
            interactive: this.config?.interactive_mode ? {
                type: 'button',
                items: doctors.map(d => ({ id: d.id, label: d.full_name }))
            } : undefined
        };
    }

    private async showAvailabilityForDoctor(doctorId: string): Promise<AgentResponse> {
        this.state.context.date = new Date().toISOString().split('T')[0];
        const slots = await this.provider.getAvailableSlots(
            doctorId,
            this.state.context.date,
            this.state.context.tenantId!
        );

        const available = slots.filter(s => s.isAvailable).slice(0, 10);
        this.state.context.availableSlots = available;
        this.state.step = 'negotiating';

        if (available.length === 0) {
            return { text: "Poxa, este médico não tem horários disponíveis para hoje. Gostaria de tentar outra data?" };
        }

        return {
            text: "Qual destes horários fica melhor para você?",
            interactive: this.config?.interactive_mode ? {
                type: 'list',
                title: 'Horários Disponíveis',
                buttonLabel: 'Escolher Horário',
                items: available.map(s => ({ id: s.time, label: humanizeTime(s.time) }))
            } : undefined
        };
    }

    private async handleNegotiation(userChoice: string): Promise<AgentResponse | string> {
        const available = this.state.context.availableSlots;
        if (!available) return "Vamos recomeçar o agendamento?";

        const result = fuzzyMatchSlot(userChoice, available);

        if (!result) return "Não entendi o horário. Pode escolher um na lista acima?";
        if (Array.isArray(result)) return "Encontrei mais de um horário parecido. Qual destes você prefere?";

        return await this.confirmBooking(result);
    }

    private async confirmBooking(slot: TimeSlot): Promise<AgentResponse> {
        this.state.context.selectedSlot = slot.time;
        this.state.step = 'auditing';

        try {
            await this.provider.createAppointment({
                tenant_id: this.state.context.tenantId!,
                patient_id: this.state.context.patientId!,
                doctor_id: this.state.context.doctorId!,
                date: this.state.context.date!,
                time: slot.time,
                notes: 'Agendado via Concierge IA'
            });

            this.state.step = 'confirmed';
            return { text: `✅ Confirmado! Sua consulta está marcada para hoje às **${humanizeTime(slot.time)}**. Até logo! 👋` };
        } catch (e: any) {
            this.state.step = 'negotiating';
            return { text: `Oops, esse horário acabou de ser ocupado. Que tal outro?` };
        }
    }

    getState() {
        return this.state;
    }
}
