/**
 * tenantTime — fonte única de "hora local do tenant" para as 3 Edge Functions
 * de automação (schedule-reminders, process-outbound, check-recall).
 *
 * Antes desta consolidação, cada função reimplementava getLocalHour /
 * quiet-hours / "empurrar para horário seguro" de forma ligeiramente
 * diferente — risco real de divergência e de reintroduzir o bug de
 * "double-shift" (reformatar uma Date já deslocada usando timeZone de novo).
 * timezone do tenant é a fonte de verdade única para todo scheduled_at.
 */

export function getLocalTime(date: Date, timezone: string): { hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    return {
      hour: parseInt(parts.find((p) => p.type === "hour")!.value, 10),
      minute: parseInt(parts.find((p) => p.type === "minute")!.value, 10),
    };
  } catch {
    return { hour: date.getUTCHours(), minute: date.getUTCMinutes() };
  }
}

export function getLocalHour(date: Date, timezone: string): number {
  return getLocalTime(date, timezone).hour;
}

export function getUTCOffsetString(timezone: string, refDate: Date): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    }).formatToParts(refDate);
    const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
    const match = tzName.match(/GMT([+-]\d+(?::\d+)?)?/);
    if (!match || !match[1]) return "+00:00";
    const raw = match[1];
    const [hourPart, minPart = "00"] = raw.split(":");
    const sign = hourPart[0];
    const absHours = Math.abs(parseInt(hourPart, 10));
    return `${sign}${String(absHours).padStart(2, "0")}:${minPart.padStart(2, "0")}`;
  } catch {
    return "+00:00";
  }
}

/**
 * Quiet hours com grace window: mensagens já vencidas (scheduled_at <= now)
 * que caem nos primeiros 30min do silêncio ainda são liberadas — evita que um
 * backlog momentâneo empurre o envio para as 8h do dia seguinte, quando o
 * evento (consulta, etc.) já teria passado. Fora dessa margem, respeita o
 * silêncio (22h–8h) normalmente.
 */
export function isBlockedByQuietHours(date: Date, timezone: string): boolean {
  const { hour, minute } = getLocalTime(date, timezone);
  if (hour < 8) return true;
  if (hour > 22) return true;
  if (hour === 22 && minute >= 30) return true;
  return false;
}

/**
 * Tolerância para o guard "o alvo já passou, não cria o lembrete" em
 * schedule-reminders. Capturado ao vivo em produção (13/08/2026): consulta às
 * 10:00, lembrete de -30min tem alvo exatamente 09:30:00; o cron dispara às
 * 09:30:00 mas a invocação (rede + várias consultas ao banco antes de chegar
 * neste agendamento) leva alguns segundos — o "agora" capturado no código já
 * era 09:30:0x quando comparado ao alvo. Sem tolerância, o guard descartava o
 * lembrete permanentemente: a mesma comparação dá o mesmo resultado em todo
 * tick seguinte, então a linha nunca era criada, nunca dava erro, nunca
 * deixava rastro — reminders com offset alinhado ao segundo exato de um tick
 * do cron perdiam a corrida por uma questão de milissegundos.
 *
 * 5 minutos cobre folgadamente qualquer latência de invocação real (segundos,
 * não minutos) sem reviver lembretes GENUINAMENTE obsoletos — esses ficam
 * dezenas de minutos ou horas no passado, muito acima desta janela.
 */
export const REMINDER_LATE_GRACE_MS = 5 * 60 * 1000;

export function isReminderTargetStillEligible(targetAtMs: number, nowMs: number): boolean {
  return targetAtMs >= nowMs - REMINDER_LATE_GRACE_MS;
}

/**
 * Decide se um envio deve ser adiado pela janela de silêncio.
 *
 * A regra NÃO é "estamos no silêncio → adia". O silêncio existe para impedir
 * envio em hora imprópria por ATRASO de processamento. Quando o próprio
 * `scheduled_at` já cai dentro da janela, foi o produtor que escolheu aquele
 * horário de propósito (lembrete ancorado à consulta: consulta às 08:30 →
 * lembrete de 1h antes às 07:30) e adiá-lo destrói exatamente o lembrete que a
 * clínica configurou.
 */
export function shouldDeferForQuietHours(
  scheduledAt: Date | string | null | undefined,
  now: Date,
  timezone: string,
): boolean {
  if (!isBlockedByQuietHours(now, timezone)) return false;
  if (!scheduledAt) return true;
  const planned = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  if (Number.isNaN(planned.getTime())) return true;
  return !isBlockedByQuietHours(planned, timezone);
}

/**
 * Offset máximo (em minutos) para um lembrete ser considerado "ancorado à
 * consulta". Lembretes de 1h/15min antes existem em função de um horário que
 * o paciente já se comprometeu a cumprir; lembretes de 24h/48h antes são
 * avisos genéricos e podem ser reposicionados livremente.
 */
export const APPOINTMENT_ANCHORED_MAX_OFFSET_MIN = 120;

export function isAppointmentAnchoredOffset(offsetMinutes: number): boolean {
  return Math.abs(offsetMinutes) <= APPOINTMENT_ANCHORED_MAX_OFFSET_MIN;
}

/**
 * Reposiciona um horário-alvo para fora da janela de silêncio (22h–8h no
 * timezone do tenant), preservando o espaçamento relativo entre lembretes
 * quando o tipo é "reminder" (distribuição proporcional na tarde/noite
 * anterior em vez de empurrar tudo para as 8h).
 *
 * `anchoredToAppointment` desliga o remapeamento: se a consulta é às 08:30, o
 * lembrete de "1h antes" (07:30) cai dentro da janela de silêncio genérica,
 * mas é exatamente o que a clínica configurou — a própria consulta prova que o
 * paciente está disponível naquele horário. Antes desta exceção o lembrete era
 * jogado para a "noite anterior" (dayOffset -1), frequentemente já no passado,
 * e morria sem nunca ser enviado.
 */
export function getSafeScheduledTime(
  target: Date,
  type: string,
  timezone: string,
  opts?: { anchoredToAppointment?: boolean },
): string {
  if (opts?.anchoredToAppointment) return target.toISOString();

  const { hour: localHour, minute: localMinute } = getLocalTime(target, timezone);
  const isQuiet = localHour >= 22 || localHour < 8;
  if (!isQuiet) return target.toISOString();

  const localParts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(target);
  const localYear = parseInt(localParts.find((p) => p.type === "year")!.value, 10);
  const localMonth = parseInt(localParts.find((p) => p.type === "month")!.value, 10) - 1;
  const localDay = parseInt(localParts.find((p) => p.type === "day")!.value, 10);

  let targetHour = 8;
  let targetMinute = 0;
  let dayOffset = 0;

  if (type.startsWith("reminder")) {
    if (localHour < 8) {
      const minutesBefore8 = (8 * 60) - (localHour * 60 + localMinute);
      const remappedTotalMins = Math.max(8 * 60, 21 * 60 - minutesBefore8);
      targetHour = Math.floor(remappedTotalMins / 60);
      targetMinute = remappedTotalMins % 60;
      dayOffset = -1;
    } else {
      targetHour = 21;
      targetMinute = 0;
      dayOffset = 0;
    }
  } else {
    targetHour = 8;
    targetMinute = 0;
    dayOffset = localHour >= 22 ? 1 : 0;
  }

  const shiftedDate = new Date(Date.UTC(localYear, localMonth, localDay + dayOffset, targetHour, targetMinute, 0));
  const offset = getUTCOffsetString(timezone, shiftedDate);
  const sign = offset[0] === "-" ? 1 : -1;
  const [offH, offM] = offset.slice(1).split(":").map(Number);
  const offsetMs = sign * (offH * 60 + offM) * 60 * 1000;
  const shifted = new Date(shiftedDate.getTime() + offsetMs);

  // O remapeamento com dayOffset -1 anda para TRÁS e pode cair no passado
  // (ex.: agendamento criado de madrugada para o mesmo dia — a "noite anterior"
  // já passou). Uma linha nascida no passado nunca é entregue no horário certo
  // e é justamente a que a limpeza de fila apagava. Nesse caso vale mais o
  // horário original — o chamador já garantiu que ele está no futuro.
  if (shifted.getTime() < Date.now()) return target.toISOString();

  return shifted.toISOString();
}

/** Próxima ocorrência das 9h locais do tenant (usado pelo check-recall). */
export function getNextLocalNineAM(timezone: string): string {
  const now = new Date();
  const localHour = getLocalHour(now, timezone);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const offset = getUTCOffsetString(timezone, now);
  const sign = offset[0] === "-" ? 1 : -1;
  const [offH, offM] = offset.slice(1).split(":").map(Number);
  const offsetMs = sign * (offH * 60 + offM) * 60 * 1000;

  const nineAmUtcMs = Date.UTC(
    today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 9, 0, 0,
  ) + offsetMs;

  const targetMs = nineAmUtcMs + (localHour >= 9 ? 24 * 60 * 60 * 1000 : 0);
  return new Date(targetMs).toISOString();
}
