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
 * Reposiciona um horário-alvo para fora da janela de silêncio (22h–8h no
 * timezone do tenant), preservando o espaçamento relativo entre lembretes
 * quando o tipo é "reminder" (distribuição proporcional na tarde/noite
 * anterior em vez de empurrar tudo para as 8h).
 */
export function getSafeScheduledTime(target: Date, type: string, timezone: string): string {
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
  return new Date(shiftedDate.getTime() + offsetMs).toISOString();
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
