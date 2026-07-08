/**
 * channelResolver — decisão única de canal de notificação, compartilhada por
 * schedule-reminders, check-recall e process-outbound.
 *
 * Espelha exatamente o algoritmo de public.resolve_notification_channel() no
 * Postgres (usado pelo trigger síncrono enqueue_nps_on_completion) — mesma
 * prioridade, mesmo runtime de decisão, dois lugares porque o lado Deno
 * trabalha em lote (batch-fetch, sem N+1 de RPC por paciente) enquanto o
 * trigger SQL decide linha a linha de forma síncrona.
 *
 * Prioridade: preferência do paciente ∩ matriz do tenant → canal padrão do
 * tenant (bot_config.default_notification_channel) ∩ matriz → nenhum canal
 * elegível (o chamador NUNCA cai silenciosamente para WhatsApp).
 */

export type NotificationChannel = "whatsapp" | "instagram" | "facebook" | "sms" | "email" | "mms";

export interface ChannelInfo {
  channel: NotificationChannel;
  recipientId: string;
}

export type AutomationKey = "no_show" | "nps" | "recovery" | "videos";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Canal padrão do tenant — fonte de verdade para fallback quando o paciente não tem preferência elegível. */
export function getDefaultChannel(botConfig: Record<string, any> | null | undefined): NotificationChannel {
  const raw = (botConfig?.default_notification_channel || "whatsapp").toLowerCase();
  return (["whatsapp", "sms", "email", "mms"].includes(raw) ? raw : "whatsapp") as NotificationChannel;
}

/**
 * Filtra candidatos (preferência do paciente, ou canal padrão do tenant caso
 * o paciente não tenha preferência) pela Matriz de Canais do tenant. E-mail
 * sem endereço válido nunca é retornado como elegível.
 */
export function filterChannelsByMatrix(
  channels: ChannelInfo[],
  matrix: Record<string, any>,
  automationKey: AutomationKey,
): ChannelInfo[] {
  return channels.filter((c) => {
    if (c.channel === "email" && !EMAIL_RE.test(c.recipientId || "")) return false;
    const row = matrix?.[c.channel];
    if (row === undefined) return true; // canais fora da matriz (instagram/facebook) seguem a preferência
    // Retrocompatibilidade: configs anteriores à automação de Recuperação não
    // têm a chave 'recovery' em channel_automations.whatsapp — tratar como
    // ligado por padrão (mesma regra histórica de check-recall/process-outbound).
    if (c.channel === "whatsapp" && automationKey === "recovery" && row?.recovery === undefined) return true;
    return row?.[automationKey] === true;
  });
}

/**
 * Resolve os canais elegíveis para uma automação, com fallback para o canal
 * padrão do tenant quando a preferência do paciente não produz nenhum canal
 * elegível (nunca assume WhatsApp por padrão).
 *
 * `preferredChannels` já deve vir resolvido (preferência explícita salva, ou
 * auto-detect por sessão) — esta função só aplica a matriz + o fallback final.
 */
export function resolveEligibleChannels(opts: {
  preferredChannels: ChannelInfo[];
  matrix: Record<string, any>;
  automationKey: AutomationKey;
  botConfig: Record<string, any> | null | undefined;
  patientPhone: string;
  patientEmail?: string | null;
}): ChannelInfo[] {
  const { preferredChannels, matrix, automationKey, botConfig, patientPhone, patientEmail } = opts;

  const eligible = filterChannelsByMatrix(preferredChannels, matrix, automationKey);
  if (eligible.length > 0) return eligible;

  // Sem canal elegível na preferência do paciente: tenta o canal padrão do
  // tenant, desde que habilitado na matriz para esta automação.
  const defaultChannel = getDefaultChannel(botConfig);
  if (preferredChannels.some((c) => c.channel === defaultChannel)) return []; // já tentado acima, sem repetir

  const row = matrix?.[defaultChannel];
  const enabledForDefault = row === undefined ? false : row?.[automationKey] === true;
  if (!enabledForDefault) return [];

  if (defaultChannel === "email") {
    const email = patientEmail && EMAIL_RE.test(patientEmail) ? patientEmail : null;
    return email ? [{ channel: "email", recipientId: email }] : [];
  }

  return [{ channel: defaultChannel, recipientId: patientPhone }];
}
