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

    'nps_survey': (v) =>
        `Olá ${v.patient_name}! Como foi sua experiência na ${v.clinic_name} hoje? De 0 a 10, o quanto você nos recomendaria? ⭐`,

    'post_treatment_followup': (v) =>
        `Oi! Como você está se sentindo após o atendimento de hoje? Qualquer dúvida sobre a prescrição, é só me chamar! 😉`,
};

export function getRenderedMessage(key: string, vars: any): string {
    const template = MESSAGE_TEMPLATES[key];
    if (!template) return `[Template ${key} não encontrado]`;
    return template(vars);
}
