import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

/**
 * Envia um e-mail usando a caixa SMTP configurada nos secrets
 * (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM).
 * Lança erro se a configuração estiver incompleta ou o envio falhar —
 * quem chamar deve tratar como best-effort quando aplicável.
 */
export async function sendEmail({ to, subject, html }: SendEmailParams): Promise<void> {
  const hostname = Deno.env.get("SMTP_HOST") ?? "";
  const port = Number(Deno.env.get("SMTP_PORT") ?? "465");
  const username = Deno.env.get("SMTP_USER") ?? "";
  const password = Deno.env.get("SMTP_PASS") ?? "";
  const from = Deno.env.get("SMTP_FROM") ?? username;

  if (!hostname || !username || !password) {
    throw new Error("SMTP não configurado (SMTP_HOST/SMTP_USER/SMTP_PASS ausentes)");
  }

  const client = new SMTPClient({
    connection: {
      hostname,
      port,
      tls: port === 465,
      auth: { username, password },
    },
  });

  try {
    await client.send({
      from: `Traffio <${from}>`,
      to,
      subject,
      content: stripHtml(html),
      html,
    });
  } finally {
    await client.close();
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
