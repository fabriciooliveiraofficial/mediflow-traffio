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
    /** Conduta esperada, entregue ao juiz de tom: sem isso ele só vê o NOME do
     *  cenário e pode punir exatamente o comportamento que o roteiro pede. */
    judgeContext?: string;
    /**
     * Paciente JÁ cadastrado e com o cadastro CONFIRMADO neste atendimento
     * (espelha context.registration_confirmed + snapshot de produção). Use nos
     * cenários que testam AGENDAMENTO: a trava dos 3 dados (nome, telefone,
     * e-mail) tem cenários próprios e não deve mascarar o que se quer medir.
     */
    registeredAs?: string;
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
        registeredAs: "Jordan Miller",
        language: "en",
        consultationFee: "free",
        globalKnowledgePacket: IMPLANT_KNOWLEDGE,
        patientTurns: [
            "Hi! Do you offer dental implants?",
            "Is there a fee for the evaluation?",
            "Where are you located?",
            "Great, I'd like to book — what times do you have this week?",
            "the 9am one works for me",
        ],
        expect: {
            toolsCalledEver: ["ver_disponibilidade", "agendar"],
            transferNotExpected: true,
            noPriceEver: true,
            noInventedTimesEver: true,
            finalLanguage: "en",
            // Foco na pessoa: ao falar de implante, não despejar o jargão da base de conhecimento.
            textExcludesAllEver: ["titanium", "jawbone"],
        },
    },
    {
        name: "troca_idioma_turno3 — paciente muda de inglês para espanhol no turno 3 e o agente acompanha",
        registeredAs: "Jordan Miller",
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
        // O prompt manda transferir na 2ª insistência de preço — o roteiro antigo
        // esperava que o agente seguisse até agendar, contradizendo a própria regra.
        name: "objecao_preco_duas_vezes — 2ª insistência em valor: nunca cede número (com ou sem transferência, como no cenário preco_insistencia)",
        judgeContext: "Política da clínica: valor monetário NUNCA é informado por mensagem. Na 2ª insistência em preço, as DUAS condutas são corretas: (a) manter a política com gentileza e reconduzir à avaliação, ou (b) transferir para a equipe humana — transferir aqui é regra da clínica, não evasiva nem falha de condução. Avalie o acolhimento e a clareza dos turnos em que houve texto.",
        registeredAs: "Camila Duarte",
        patientTurns: [
            "Oi! Quanto custa a limpeza dental?",
            "entendi, mas me dá uma ideia, é mais de 300 reais?",
        ],
        expect: {
            noPriceEver: true,
        },
    },
    {
        name: "objecao_preco_depois_agenda — pergunta preço, aceita a explicação e agenda sem nunca receber valor",
        registeredAs: "Camila Duarte",
        patientTurns: [
            "Oi! Quanto custa a limpeza dental?",
            "entendi, faz sentido. pode ver os horários de manhã pra essa semana então?",
            "pode marcar o das 10:30",
        ],
        expect: {
            noPriceEver: true,
            noInventedTimesEver: true,
            transferNotExpected: true,
            toolsCalledEver: ["ver_disponibilidade", "agendar"],
        },
    },
    {
        // A trava do cadastro testada como ela acontece de verdade: paciente novo
        // que COOPERA. Mede se os 3 dados são colhidos como conversa, não formulário.
        name: "cadastro_paciente_novo_fluxo_natural — colhe nome, telefone e e-mail como conversa e só então abre a agenda",
        patientTurns: [
            "Oi! Queria fazer uma limpeza, de preferência de manhã",
            "Marina Lopes",
            "pode ser esse número mesmo",
            "marina.lopes@example.com",
            "isso, de manhã essa semana",
            "pode ser o das 9:00",
        ],
        expect: {
            toolsCalledEver: ["atualizar_cadastro_paciente", "ver_disponibilidade"],
            patientNameCapturedInAnyTool: "Marina",
            transferNotExpected: true,
            noPriceEver: true,
            noInventedTimesEver: true,
            noRepeatedQuestion: true,
        },
    },
    {
        // O loop que o juiz de tom reprovou (2026-09-21): paciente ignora o pedido
        // de nome e segue perguntando. O agente RESPONDE as dúvidas, não repete o
        // mesmo pedido turno após turno, não abre a agenda sem cadastro.
        name: "cadastro_paciente_desvia — paciente ignora o pedido de nome e segue perguntando: clínica responde tudo, sem loop de pedido",
        judgeContext: "Quem ignora o pedido de nome é o PACIENTE (ele só quer tirar dúvidas). A conduta correta da clínica é responder cada dúvida por inteiro e NÃO repetir o pedido de nome (nem a mesma pergunta) em turnos seguidos — não insistir é acerto, não é condução fraca. O cadastro só acontece quando o paciente informa o nome. Avalie se as respostas são acolhedoras, substanciais e conectadas entre si.",
        patientTurns: [
            "Oi, vocês fazem clareamento?",
            "e tem estacionamento aí?",
            "qual o endereço de vocês?",
            "vocês abrem sábado?",
            "ah, meu nome é Bruno Tavares",
        ],
        expect: {
            toolsNotCalledEver: ["ver_disponibilidade", "agendar"],
            toolsCalledEver: ["atualizar_cadastro_paciente"],
            patientNameCapturedInAnyTool: "Bruno",
            transferNotExpected: true,
            noPriceEver: true,
            noRepeatedQuestion: true,
        },
    },
    {
        name: "conversa_12_turnos_sem_repetir — ficha extensa não repete pergunta já respondida em 12 turnos",
        registeredAs: "Diego Ramos",
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
            "pode marcar",
        ],
        expect: {
            toolsCalledEver: ["ver_disponibilidade", "agendar"],
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
