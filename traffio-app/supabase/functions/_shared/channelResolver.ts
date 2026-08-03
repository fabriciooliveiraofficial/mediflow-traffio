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
 *
 * E-6 (2026-08-02): Instagram/Facebook NUNCA sustentam automação atrasada
 * (lembrete, NPS, recuperação de no-show) — restrição real da janela de 24h
 * de resposta da Meta. A página Notificações já comunica isso ao tenant (a
 * linha desses dois canais na Matriz de Canais é só um aviso fixo
 * "Indisponível — Restrição da Janela de 24h da Meta", sem nenhum toggle
 * configurável — ver NotificationsPage.tsx, MatrixRowMetaDisabled). Por isso
 * eles NUNCA aparecem em `channel_automations`. O código antigo lia essa
 * AUSÊNCIA como "libere por padrão" (linha do fallback original); hoje ela
 * significa o oposto: bloqueado por design do produto, não por falta de
 * configuração. Quando a preferência do paciente não sobra com nenhum canal
 * automação-viável (por ser Instagram/Facebook, ou por não ter preferência
 * nenhuma — caso do Live Chat, que nunca teve canal de notificação próprio),
 * o fallback vai direto para o e-mail cadastrado — não para o canal padrão
 * genérico do tenant, que normalmente é WhatsApp e seria igualmente
 * inalcançável para quem nunca deu um telefone real.
 */

export type NotificationChannel = "whatsapp" | "instagram" | "facebook" | "sms" | "email" | "mms";

export interface ChannelInfo {
  channel: NotificationChannel;
  recipientId: string;
}

export type AutomationKey = "no_show" | "nps" | "recovery" | "videos";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Canais que a Meta impede de sustentar automação atrasada — nunca configuráveis na matriz, nunca elegíveis aqui. */
const META_DM_CHANNELS = new Set<NotificationChannel>(["instagram", "facebook"]);

/** Canal padrão do tenant — fonte de verdade para fallback quando o paciente não tem preferência elegível. */
export function getDefaultChannel(botConfig: Record<string, any> | null | undefined): NotificationChannel {
  const raw = (botConfig?.default_notification_channel || "whatsapp").toLowerCase();
  return (["whatsapp", "sms", "email", "mms"].includes(raw) ? raw : "whatsapp") as NotificationChannel;
}

/**
 * Filtra candidatos (preferência do paciente, ou canal padrão do tenant caso
 * o paciente não tenha preferência) pela Matriz de Canais do tenant. E-mail
 * sem endereço válido nunca é retornado como elegível. Instagram/Facebook
 * nunca são retornados como elegíveis para automação (ver banner acima).
 */
export function filterChannelsByMatrix(
  channels: ChannelInfo[],
  matrix: Record<string, any>,
  automationKey: AutomationKey,
): ChannelInfo[] {
  return channels.filter((c) => {
    if (c.channel === "email" && !EMAIL_RE.test(c.recipientId || "")) return false;
    if (META_DM_CHANNELS.has(c.channel)) return false;
    const row = matrix?.[c.channel];
    if (row === undefined) return true; // canal fora da matriz mas NÃO é Instagram/Facebook — segue a preferência
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

  // E-6 (2026-08-02): a preferência do paciente não sobrou com NENHUM canal
  // automação-viável — ou porque não há preferência nenhuma (Live Chat), ou
  // porque a única coisa que havia era Instagram/Facebook (sempre filtrados
  // acima). Nesses dois casos específicos, ir direto para o e-mail cadastrado
  // é mais confiável do que o canal padrão genérico do tenant, que
  // tipicamente é WhatsApp — igualmente inalcançável para quem nunca deu um
  // telefone real. Um paciente com preferência explícita para um canal
  // simplesmente DESLIGADO na matriz (ex.: SMS desativado) não cai aqui —
  // seu comportamento (fallback pelo canal padrão do tenant) continua exatamente como já era.
  const noViablePreference = preferredChannels.length === 0
    || preferredChannels.every((c) => META_DM_CHANNELS.has(c.channel));
  if (noViablePreference) {
    const emailRow = matrix?.email;
    const emailEnabledForAutomation = emailRow === undefined ? false : emailRow?.[automationKey] === true;
    if (emailEnabledForAutomation) {
      const email = patientEmail && EMAIL_RE.test(patientEmail) ? patientEmail : null;
      if (email) return [{ channel: "email", recipientId: email }];
    }
    return [];
  }

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
