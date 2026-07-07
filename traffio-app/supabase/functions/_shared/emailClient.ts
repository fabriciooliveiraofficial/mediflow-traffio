/**
 * emailClient — envio de e-mail transacional por tenant.
 *
 * Usa o SMTP próprio do tenant (tenants.smtp_*) com fallback para o SMTP
 * global do sistema (secrets SMTP_*). Mesma infraestrutura já provada em
 * produção no send-human-message, extraída para reuso pelo pipeline de
 * automações (process-outbound).
 */

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

export interface TenantSmtpDetails {
  name?: string | null;
  smtp_host?: string | null;
  smtp_port?: number | string | null;
  smtp_user?: string | null;
  smtp_pass?: string | null;
  smtp_from?: string | null;
}

export interface EmailAttachment {
  filename: string;
  content: string;
  contentType: string;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}

export function isValidEmail(value: string | null | undefined): boolean {
  return !!value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export async function sendTenantEmail(
  tenant: TenantSmtpDetails | null | undefined,
  opts: SendEmailOptions,
): Promise<void> {
  let hostname = tenant?.smtp_host ?? "";
  let port = tenant?.smtp_port ? Number(tenant.smtp_port) : 465;
  let username = tenant?.smtp_user ?? "";
  let password = tenant?.smtp_pass ?? "";
  let from = tenant?.smtp_from || username;
  const senderName = tenant?.name || "Traffio";

  const hasTenantSMTP = hostname && username && password;
  if (!hasTenantSMTP) {
    hostname = Deno.env.get("SMTP_HOST") ?? "";
    port = Number(Deno.env.get("SMTP_PORT") ?? "465");
    username = Deno.env.get("SMTP_USER") ?? "";
    password = Deno.env.get("SMTP_PASS") ?? "";
    from = Deno.env.get("SMTP_FROM") ?? username;
  }

  if (!hostname || !username || !password) {
    throw new Error("SMTP não configurado para este tenant (e sem SMTP global disponível).");
  }

  if (!isValidEmail(opts.to)) {
    throw new Error(`Endereço de e-mail inválido: '${opts.to}'`);
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
      from: `${senderName} <${from}>`,
      to: opts.to.trim(),
      subject: opts.subject,
      content: opts.text,
      html: opts.html,
      attachments: opts.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
        encoding: "text" as const,
      })),
    });
  } finally {
    await client.close();
  }
}
