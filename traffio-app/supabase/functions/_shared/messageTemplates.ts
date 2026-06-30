/**
 * SPRINT 5 — Message Templates
 * Centraliza o conteúdo de todas as automações para fácil edição.
 */

export const MESSAGE_TEMPLATES: Record<string, (vars: any) => string> = {
    // --- FOLLOW-UP SEQUENCES (PACIENTES QUE NÃO AGENDADOS) ---
    
    'follow_up_1': (v) => 
        `Olá ${v.patient_name || 'tudo bem'}! Aqui é a ${v.agent_name || 'Amanda'} da ${v.clinic_name}. Percebi que não conseguimos concluir seu agendamento. Ficou alguma dúvida sobre os horários ou valores? 🤔`,
    
    'follow_up_2': (v) => 
        `Oi! Passando para lembrar que ainda tenho algumas vagas para esta semana na ${v.clinic_name}. Quer que eu reserve uma para você? ✨`,
    
    'follow_up_3': (v) => 
        `Tudo bem? Notei que você ainda não agendou. Se preferir, posso pedir para alguém da nossa equipe te ligar para ajudar! O que acha? 📞`,
    
    'follow_up_4': (v) => 
        `Oi! Ainda por aqui? Só queria avisar que a agenda da ${v.clinic_name} está ficando bem cheia. Se ainda tiver interesse, me avisa logo para eu garantir sua vaga! 😊`,
    
    'follow_up_5': (v) => 
        `Olá! Entendo que as rotinas são corridas. Vou encerrar seu atendimento por agora para não te incomodar, mas se precisar de qualquer coisa no futuro, estarei aqui! Um abraço. 👋`,

    // --- BOOKING CONFIRMATION (tracking record — already sent by agent) ---

    'booking_confirmed': (v) =>
        `✅ Agendamento confirmado! ${v.patient_name}, sua consulta com ${v.doctor_name} está marcada para ${v.date} às ${v.time}${v.location_name ? ` na ${v.location_name}` : ''}. A equipe aguarda você! 😊`,

    // --- REMINDERS (NO-SHOW PREVENTION) ---

    'appointment_reminder_48h': (v) =>
        `Olá ${v.patient_name}! 😊 Passando para lembrar da sua consulta com ${v.doctor_name}!\n\n📅 ${v.date} às ⏰ ${v.time}${v.location_name ? `\n📍 ${v.location_name}` : ''}\n\nPodemos confirmar sua presença? Responda:\n✅ *SIM* — Confirmado!\n🔄 *REAGENDAR* — Preciso mudar a data\n❌ *CANCELAR* — Não vou poder ir\n\nAguardo seu retorno! 🙏`,

    'appointment_reminder_24h': (v) =>
        `Oi ${v.patient_name}! 🌟 Amanhã é o dia da sua consulta com ${v.doctor_name}!\n\n📅 Amanhã às ⏰ ${v.time}${v.location_name ? `\n📍 ${v.location_name}` : ''}\n\nSe ainda não confirmou, responda *SIM* para confirmar! 😊`,

    'appointment_confirmed_links': (v) =>
        `✅ Presença confirmada, ${v.patient_name}! 🎉\n\n📅 ${v.date} às ⏰ ${v.time}${v.location_name ? `\n📍 ${v.location_name}` : ''}\n\nPara facilitar no dia da sua consulta, aqui estão seus acessos rápidos:\n\n🏥 *Sala de Espera Virtual*\n${v.waiting_room_link}\n\n⚡ *Check-in Express*\n${v.checkin_link}\n\nEsses links não precisam de login! Basta clicar quando chegar. 😊`,

    'appointment_reminder_2h': (v) =>
        `${v.patient_name}, sua consulta é daqui a pouco! ⏰ ${v.time}${v.location_name ? ` na ${v.location_name}` : ''}. Estamos te esperando! 🏥\n\n🏥 *Sala de Espera Virtual*\n${v.waiting_room_link}\n\n⚡ *Check-in Express*\n${v.checkin_link}`,

    'appointment_reminder_15m': (v) =>
        `🚨 *MODO TESTE (5 min)* 🚨\n\nOi ${v.patient_name}! Só confirmando: sua consulta é em 5 minutos! 🕒\n\n📍 ${v.location_name}\n👩‍⚕️ ${v.doctor_name}\n\nAté logo! 👋`,

    // --- POST-CONSULTATION ---

    'nps_survey': (v) => {
        const locale = (v.locale || 'pt').toLowerCase();
        if (locale.startsWith('en'))
            return `Hi ${v.patient_name || 'there'}! 😊 How was your experience at ${v.clinic_name} today? On a scale of 0 to 10, how likely are you to recommend us? ⭐\n\nJust reply with a number — it only takes 5 seconds!`;
        if (locale.startsWith('es'))
            return `¡Hola ${v.patient_name || 'tú'}! 😊 ¿Cómo fue tu experiencia en ${v.clinic_name} hoy? Del 0 al 10, ¿cuánto nos recomendarías? ⭐\n\nSolo responde con un número — ¡solo tarda 5 segundos!`;
        return `Olá ${v.patient_name}! 😊 Como foi sua experiência na ${v.clinic_name} hoje?\n\nDe *0 a 10*, o quanto você nos recomendaria? ⭐\n\nSó responda com um número — leva 5 segundos!`;
    },

    'post_treatment_followup': (v) =>
        `Oi! Como você está se sentindo após o atendimento de hoje? Qualquer dúvida sobre a prescrição, é só me chamar! 😉`,

    // --- REATIVAÇÃO (RECALL) ---

    'recall': (v) => {
        const locale = (v.locale || 'pt').toLowerCase();
        if (locale.startsWith('en'))
            return `Hi ${v.patient_name || 'there'}! 😊 This is the team at ${v.clinic_name}. It's been a while since your last visit!\n\nWould you like to schedule a check-up? We have openings this week. 📅\n\nReply *SCHEDULE* to book or *NO THANKS* to opt out.`;
        if (locale.startsWith('es'))
            return `¡Hola ${v.patient_name || 'tú'}! 😊 Somos el equipo de ${v.clinic_name}. ¡Te echamos de menos!\n\n¿Te gustaría agendar una consulta de seguimiento? Tenemos horarios disponibles esta semana. 📅\n\nResponde *AGENDAR* para reservar o *NO GRACIAS* para no recibir más mensajes.`;
        return `Olá ${v.patient_name}! 😊 Aqui é a equipe da ${v.clinic_name}. Faz um tempo que não te vemos por aqui!\n\nQue tal agendar uma consulta de acompanhamento? Temos horários disponíveis essa semana. 📅\n\nResponda *AGENDAR* para marcar sua consulta ou *NÃO, OBRIGADO* para encerrar.`;
    },
};

export function getRenderedMessage(key: string, vars: any): string {
    const template = MESSAGE_TEMPLATES[key];
    if (template) return template(vars);
    // Fallback genérico para lembretes com offset personalizado (ex: appointment_reminder_custom_360m)
    if (key.startsWith("appointment_reminder_custom_")) {
        const mins = parseInt(key.replace("appointment_reminder_custom_", "").replace("m", ""), 10);
        const label = mins >= 1440
            ? `${Math.round(mins / 1440)} dia(s)`
            : mins >= 60
                ? `${Math.round(mins / 60)} hora(s)`
                : `${mins} minuto(s)`;
        return `Olá ${vars.patient_name || ""}! 😊 Lembrete: sua consulta com ${vars.doctor_name || "nosso especialista"} é ${label.includes("dia") ? `em ${label}` : `em ${label}`} — ${vars.date} às ${vars.time}${vars.location_name ? ` na ${vars.location_name}` : ""}.\n\nAté logo! 🙏`;
    }
    return `[Template ${key} não encontrado]`;
}

// ─── SMS TEMPLATES ──────────────────────────────────────────────────────────
// Versão compacta: sem emojis, sem markdown, máx ~155 chars para 1 segmento.
// Emojis em SMS usam UCS-2 (70 chars/segmento) — EVITAR.

export const SMS_TEMPLATES: Record<string, (vars: any) => string> = {

    'appointment_reminder_48h': (v) =>
        `Ola ${v.patient_name}! Lembrete: consulta com ${v.doctor_name} em ${v.date} as ${v.time}` +
        `${v.location_name ? ` - ${v.location_name}` : ''}. Confirme respondendo SIM ou REAGENDAR.`,

    'appointment_reminder_24h': (v) =>
        `Ola ${v.patient_name}! Amanha: consulta com ${v.doctor_name} as ${v.time}` +
        `${v.location_name ? ` em ${v.location_name}` : ''}. Responda SIM para confirmar ou REAGENDAR.`,

    'appointment_reminder_2h': (v) =>
        `${v.patient_name}, sua consulta e em 2h (${v.time})` +
        `${v.location_name ? ` - ${v.location_name}` : ''}. Ate logo!`,

    'appointment_reminder_15m': (v) =>
        `${v.patient_name}, sua consulta e em 15 minutos (${v.time})` +
        `${v.location_name ? ` - ${v.location_name}` : ''}. Ate logo!`,

    'booking_confirmed': (v) =>
        `Agendado! ${v.patient_name}, consulta com ${v.doctor_name} em ${v.date} as ${v.time}` +
        `${v.location_name ? ` - ${v.location_name}` : ''}. ${v.clinic_name}`,

    'nps_survey': (v) =>
        `Ola ${v.patient_name}! Como foi sua consulta na ${v.clinic_name} hoje? ` +
        `Responda com nota de 0 a 10. Sua opiniao e muito importante!`,

    'recall': (v) =>
        `Ola ${v.patient_name}! Aqui e a ${v.clinic_name}. Sentimos sua falta! ` +
        `Que tal agendar uma consulta? Responda AGENDAR ou NAO OBRIGADO.`,

    'post_treatment_followup': (v) =>
        `Ola! Como voce esta se sentindo apos o atendimento? Qualquer duvida, responda esta mensagem.`,

    'follow_up_1': (v) =>
        `Ola ${v.patient_name}! Aqui e a ${v.clinic_name}. Notamos que nao concluiu ` +
        `seu agendamento. Posso ajudar? Responda esta mensagem.`,

    'follow_up_2': (v) =>
        `Oi! Ainda tenho vagas esta semana na ${v.clinic_name}. Quer que eu reserve uma para voce?`,

    'follow_up_3': (v) =>
        `Tudo bem? Notei que voce ainda nao agendou. Prefere que alguem te ligue para ajudar?`,

    'follow_up_4': (v) =>
        `Oi! A agenda da ${v.clinic_name} esta ficando cheia. Se tiver interesse, me avisa logo!`,

    'follow_up_5': (v) =>
        `Ola! Encerraremos o atendimento por agora. Se precisar no futuro, estamos aqui. Abs!`,
};

export function getSmsTemplate(key: string, vars: any): string {
    // Procura template SMS específico; fallback para versão WhatsApp sem emojis
    const smsTemplate = SMS_TEMPLATES[key];
    if (smsTemplate) return smsTemplate(vars);

    // Fallback SMS para offsets custom
    if (key.startsWith("appointment_reminder_custom_")) {
        const mins = parseInt(key.replace("appointment_reminder_custom_", "").replace("m", ""), 10);
        const label = mins >= 1440
            ? `em ${Math.round(mins / 1440)} dia(s)`
            : mins >= 60
                ? `em ${Math.round(mins / 60)}h`
                : `em ${mins}min`;
        return `Ola ${vars.patient_name || ""}! Lembrete: consulta com ${vars.doctor_name || "especialista"} ${label} (${vars.date} as ${vars.time})${vars.location_name ? ` - ${vars.location_name}` : ""}. Ate logo!`;
    }

    // Fallback: usa template WhatsApp mas remove markdown e emojis
    const waTemplate = MESSAGE_TEMPLATES[key];
    if (!waTemplate) return `[Template ${key} nao encontrado]`;
    return waTemplate(vars)
        .replace(/\*/g, '')          // remove *negrito*
        .replace(/_/g, '')           // remove _italico_
        .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')  // remove emojis
        .replace(/\n{2,}/g, '\n')    // compacta quebras de linha
        .trim();
}
