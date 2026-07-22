/**
 * conversationScenarios — cenários MULTI-TURNO obrigatórios (Onda 4.2).
 * Cada cenário roteiriza os turnos do PACIENTE; o lado CLÍNICA é gerado ao
 * vivo pelo modelo real a cada turno (ver conversation.ts).
 */
import type { CrmStageId } from "../../_shared/journeyStage.ts";
import type { ConsultationStatus } from "../../_shared/copilot.ts";

export interface ConversationScenario {
    name: string;
    /** Mensagens do paciente, na ordem — cada uma dispara um turno REAL do agente */
    patientTurns: string[];
    /** Idioma já detectado ANTES do 1º turno (simula context.language persistido de uma sessão anterior) */
    language?: "pt" | "en" | "es";
    stage?: CrmStageId;
    availabilityFails?: boolean;
    withAppointment?: boolean;
    consultationFee?: ConsultationStatus;
    globalKnowledgePacket?: string;
    intake?: { procedure?: string | null; for_whom?: string | null; preferred_window?: string | null; doctor_pref?: string | null };
    expect: {
        /** Estas ferramentas DEVEM ser chamadas em ALGUM turno da conversa */
        toolsCalledEver?: string[];
        /** Estas ferramentas NÃO podem ser chamadas em NENHUM turno */
        toolsNotCalledEver?: string[];
        /** Nenhum preço/valor monetário pode aparecer em NENHUM turno */
        noPriceEver?: boolean;
        /** Só horários vindos do mock podem aparecer em qualquer turno */
        noInventedTimesEver?: boolean;
        /** Nenhuma resposta pode repetir quase-literalmente uma resposta anterior da mesma conversa */
        noRepeatedQuestion?: boolean;
        /** true = deve transferir em algum turno; false-like via toolsNotCalledEver não aplicável aqui */
        transferExpected?: boolean;
        /** Não pode transferir em NENHUM turno da conversa */
        transferNotExpected?: boolean;
        /** Idioma resolvido do ÚLTIMO turno deve ser este */
        finalLanguage?: "pt" | "en" | "es";
        /** O texto do ÚLTIMO turno deve conter ao menos UMA destas substrings */
        finalTextIncludesAny?: string[];
        /** O texto do ÚLTIMO turno NÃO pode conter nenhuma destas substrings */
        finalTextExcludesAll?: string[];
        /** Nenhum turno da conversa (não só o último) pode conter estas substrings */
        textExcludesAllEver?: string[];
        /** O input de alguma chamada de `agendar` na conversa deve conter esta substring
         *  (use só para TERCEIRO — nome de quem não é o dono do telefone) */
        agendarInputIncludes?: string;
        /** O nome deve ter sido capturado por ALGUMA ferramenta (cadastro OU agendar).
         *  Para o DONO do telefone o nome vai em atualizar_cadastro_paciente, não em
         *  agendar — usar este check, nunca agendarInputIncludes. */
        patientNameCapturedInAnyTool?: string;
    };
}

const IMPLANT_KNOWLEDGE = "CONHECIMENTO GERAL DE ODONTOLOGIA:\n## Dental Implants\nA dental implant is essentially a titanium support placed into the jawbone to replace the root of a missing tooth, later supporting a crown. The exact plan, number of visits, and healing time depend on your specific case.";

export const CONVERSATION_SCENARIOS: ConversationScenario[] = [
    {
        name: "en_full_booking — 4 perguntas em inglês, depois escolhe horário por texto e fecha 100% em inglês",
        language: "en",
        consultationFee: "free",
        globalKnowledgePacket: IMPLANT_KNOWLEDGE,
        patientTurns: [
            "Hi! Do you offer dental implants?",
            "Is there a fee for the evaluation?",
            "Where are you located?",
            "Great, I'd like to book — what times do you have this week?",
            "the 9am one works for me, my name is Jordan Miller",
        ],
        expect: {
            toolsCalledEver: ["ver_disponibilidade", "agendar"],
            transferNotExpected: true,
            noPriceEver: true,
            noInventedTimesEver: true,
            finalLanguage: "en",
            patientNameCapturedInAnyTool: "Jordan",
        },
    },
    {
        name: "troca_idioma_turno3 — paciente muda de inglês para espanhol no turno 3 e o agente acompanha",
        language: "en",
        patientTurns: [
            "Hi! I need a dental cleaning, do you have availability this week?",
            "morning would be better for me",
            "perdón, prefiero seguir en español a partir de ahora, ¿tienen horarios en la mañana?",
        ],
        expect: {
            toolsCalledEver: ["ver_disponibilidade"],
            noInventedTimesEver: true,
            finalLanguage: "es",
        },
    },
    {
        name: "objecao_preco_duas_vezes — pergunta preço 2x e depois concorda em agendar sem nunca receber valor",
        patientTurns: [
            "Oi! Quanto custa a limpeza dental?",
            "entendi, mas me dá uma ideia, é mais de 300 reais?",
            "tudo bem, pode ver os horários pra essa semana então",
            "pode marcar o das 10:30, meu nome é Camila Duarte",
        ],
        expect: {
            noPriceEver: true,
            toolsCalledEver: ["ver_disponibilidade", "agendar"],
            patientNameCapturedInAnyTool: "Camila",
        },
    },
    {
        name: "conversa_12_turnos_sem_repetir — ficha extensa não repete pergunta já respondida em 12 turnos",
        patientTurns: [
            "Oi! Queria fazer uma limpeza dental.",
            "de preferência de manhã, se tiver horário",
            "vocês têm estacionamento?",
            "e o endereço de vocês, onde fica?",
            "ah entendi, e funcionam todo dia da semana?",
            "certo, e o clareamento vocês fazem também, separado?",
            "quanto tempo dura a limpeza mais ou menos?",
            "preciso levar algum documento no dia?",
            "posso ir em qualquer unidade de vocês?",
            "ok, então pode ver os horários de manhã pra essa semana",
            "prefiro o mais cedo possível entre esses",
            "pode marcar, meu nome é Diego Ramos",
        ],
        expect: {
            toolsCalledEver: ["ver_disponibilidade", "agendar"],
            patientNameCapturedInAnyTool: "Diego",
            noRepeatedQuestion: true,
            textExcludesAllEver: ["qual procedimento", "qual tratamento", "o que você gostaria de agendar", "manhã ou tarde você prefere"],
        },
    },
    {
        name: "retomada_agendamento_existente — confirma consulta real, pede trocar horário, sem alucinar estado",
        withAppointment: true,
        patientTurns: [
            "Oi! Pode confirmar minha consulta, por favor?",
            "hmm, na verdade eu queria trocar esse horário, tem algo mais cedo nesse mesmo dia?",
            "certo, pode deixar assim mesmo então, obrigado",
        ],
        expect: {
            textExcludesAllEver: ["indisponível", "não consegui", "falhou", "ficou ocupado"],
        },
    },
];
