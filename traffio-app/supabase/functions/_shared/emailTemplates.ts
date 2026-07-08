/**
 * emailTemplates — assunto, layout HTML e anexo .ics para as automações
 * enviadas por e-mail (lembretes, confirmações, NPS, recuperação de faltas).
 *
 * O corpo textual continua vindo dos templates/captions existentes
 * (messageTemplates.ts / bot_config) — aqui apenas embrulhamos esse texto
 * em um layout de e-mail consistente e resolvemos o assunto por idioma.
 */

type EmailLocale = "pt" | "en" | "es";

function normalizeLocale(locale: string | null | undefined): EmailLocale {
  const l = (locale || "pt").toLowerCase();
  if (l.startsWith("en")) return "en";
  if (l.startsWith("es")) return "es";
  return "pt";
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Assunto por template_key ─────────────────────────────────────────────────
const SUBJECTS: Record<string, Record<EmailLocale, string>> = {
  reminder: {
    pt: "Lembrete de consulta — {date} às {time} | {clinic}",
    en: "Appointment reminder — {date} at {time} | {clinic}",
    es: "Recordatorio de cita — {date} a las {time} | {clinic}",
  },
  nps_survey: {
    pt: "Como foi sua experiência na {clinic}?",
    en: "How was your experience at {clinic}?",
    es: "¿Cómo fue su experiencia en {clinic}?",
  },
  confirmation: {
    pt: "Confirmação de Agendamento — {clinic}",
    en: "Booking Confirmation — {clinic}",
    es: "Confirmación de Cita — {clinic}",
  },
  recovery: {
    pt: "Sentimos sua falta — {clinic}",
    en: "We missed you — {clinic}",
    es: "Le extrañamos — {clinic}",
  },
  recall: {
    pt: "Hora do seu retorno — {clinic}",
    en: "Time for your check-up — {clinic}",
    es: "Hora de su control — {clinic}",
  },
  default: {
    pt: "Mensagem de {clinic}",
    en: "Message from {clinic}",
    es: "Mensaje de {clinic}",
  },
};

export function getEmailSubject(templateKey: string, vars: any, locale?: string): string {
  const lang = normalizeLocale(locale ?? vars?.locale);
  let group = "default";
  if (templateKey?.startsWith("appointment_reminder")) group = "reminder";
  else if (templateKey === "nps_survey") group = "nps_survey";
  else if (templateKey === "booking_confirmed") group = "confirmation";
  else if (templateKey?.startsWith("recovery_")) group = "recovery";
  else if (templateKey === "recall_immediate") group = "recall";

  return (SUBJECTS[group][lang] || SUBJECTS.default[lang])
    .replace("{date}", vars?.date || "")
    .replace("{time}", vars?.time || "")
    .replace("{clinic}", vars?.clinic_name || "")
    .replace(/\s+[—|]\s*$/, "")
    .trim();
}

// ── Layout HTML ──────────────────────────────────────────────────────────────
const FOOTER_TEXT: Record<EmailLocale, string> = {
  pt: "Este é um e-mail automático enviado em nome de {clinic}.",
  en: "This is an automated e-mail sent on behalf of {clinic}.",
  es: "Este es un correo automático enviado en nombre de {clinic}.",
};

export interface EmailHtmlOptions {
  clinicName: string;
  bodyText: string;
  locale?: string;
  ctaUrl?: string | null;
  ctaLabel?: string | null;
}

export function renderEmailHtml(opts: EmailHtmlOptions): string {
  const lang = normalizeLocale(opts.locale);
  const clinic = escapeHtml(opts.clinicName);
  const body = escapeHtml(opts.bodyText);
  const footer = escapeHtml(FOOTER_TEXT[lang].replace("{clinic}", opts.clinicName));

  const ctaBlock = (opts.ctaUrl && opts.ctaLabel)
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin: 24px auto 8px auto;">
        <tr>
          <td style="border-radius: 10px; background: #0E7C7B;">
            <a href="${escapeHtml(opts.ctaUrl)}" target="_blank"
               style="display: inline-block; padding: 12px 28px; font-size: 14px; font-weight: bold; color: #ffffff; text-decoration: none; border-radius: 10px;">
              ${escapeHtml(opts.ctaLabel)}
            </a>
          </td>
        </tr>
      </table>`
    : "";

  return `
  <div style="background: #f4f6f8; padding: 24px 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background: #0E7C7B; padding: 18px 24px;">
        <h2 style="margin: 0; color: #ffffff; font-size: 18px;">${clinic}</h2>
      </div>
      <div style="padding: 24px;">
        <p style="white-space: pre-wrap; line-height: 1.65; font-size: 14px; color: #1a202c; margin: 0;">${body}</p>
        ${ctaBlock}
      </div>
      <div style="padding: 14px 24px; border-top: 1px solid #e2e8f0;">
        <p style="font-size: 11px; color: #718096; margin: 0;">${footer}</p>
      </div>
    </div>
  </div>`;
}

// ── Anexo .ics (convite de calendário para lembretes/confirmações) ───────────
function getUTCOffsetMinutes(date: Date, timezone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
    const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
    const asUTC = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
    );
    return (asUTC - date.getTime()) / 60000;
  } catch {
    return 0;
  }
}

function toIcsUtcString(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export interface IcsOptions {
  uid: string;
  /** Data do agendamento no formato YYYY-MM-DD */
  date: string;
  /** Hora local do agendamento HH:MM ou HH:MM:SS */
  startTime: string;
  timezone: string;
  durationMinutes?: number;
  summary: string;
  description?: string;
  location?: string;
}

export function buildIcsAttachment(opts: IcsOptions): { filename: string; content: string; contentType: string } | null {
  try {
    const timePart = opts.startTime.length <= 5 ? `${opts.startTime}:00` : opts.startTime;
    // Interpreta a hora local do tenant e converte para UTC
    const naive = new Date(`${opts.date}T${timePart}Z`);
    if (isNaN(naive.getTime())) return null;
    const offsetMin = getUTCOffsetMinutes(naive, opts.timezone);
    const startUtc = new Date(naive.getTime() - offsetMin * 60000);
    const endUtc = new Date(startUtc.getTime() + (opts.durationMinutes ?? 30) * 60000);

    const esc = (s: string) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Traffio//Appointments//PT",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${esc(opts.uid)}@traffio`,
      `DTSTAMP:${toIcsUtcString(new Date())}`,
      `DTSTART:${toIcsUtcString(startUtc)}`,
      `DTEND:${toIcsUtcString(endUtc)}`,
      `SUMMARY:${esc(opts.summary)}`,
      opts.description ? `DESCRIPTION:${esc(opts.description)}` : null,
      opts.location ? `LOCATION:${esc(opts.location)}` : null,
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "END:VCALENDAR",
    ].filter(Boolean);

    return {
      filename: "agendamento.ics",
      content: lines.join("\r\n"),
      contentType: "text/calendar",
    };
  } catch {
    return null;
  }
}
