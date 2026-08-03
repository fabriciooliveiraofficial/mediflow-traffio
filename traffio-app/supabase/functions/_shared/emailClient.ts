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

/**
 * E-6 (2026-08-02, teste de estresse): o denomailer (SMTPClient, dependência
 * de terceiros) tem um bug real de codificação de cabeçalho — confirmado no
 * código-fonte dele (config/mail/encoding.ts, quotedPrintableEncodeInline):
 * qualquer texto não-ASCII em Subject/From vira RFC 2047 (=?utf-8?Q?...?=)
 * reaproveitando a quebra de linha de CORPO de e-mail (74 caracteres, estilo
 * quoted-printable) — sem as regras de dobra de cabeçalho do RFC 2822 (linha
 * de continuação precisa começar com espaço). Assunto/remetente um pouco mais
 * longos com acento (nome de idioma pt/es, nome de clínica) quebram no meio
 * da palavra, sem continuação válida — e o e-mail inteiro chega ilegível,
 * com o próprio corpo MIME aparecendo como texto cru (visto em produção).
 *
 * Não existe como contornar isso passando o texto já codificado: a mesma
 * função re-codifica QUALQUER string que comece com "=?", então isso
 * pioraria (dupla codificação). A única forma segura, sem depender de uma
 * correção do denomailer, é nunca deixar caractere não-ASCII chegar a um
 * cabeçalho — a função só pula a codificação (bug incluso) quando a string
 * já é 100% ASCII.
 *
 * Decompõe acentos (á → a) e remove qualquer caractere remanescente fora do
 * intervalo ASCII — cobre os acentos dos nossos próprios templates E
 * qualquer caractere no nome da clínica (dado do tenant, fora do nosso controle).
 */
export function asciiSafeHeaderText(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // remove marcas diacríticas combinantes (á -> a)
    .replace(/[–—]/g, "-")   // travessão/meia-risca -> hífen simples
    .replace(/[^\x00-\x7f]/g, "")      // rede de segurança: qualquer não-ASCII remanescente
    .replace(/\s+/g, " ")
    .trim();
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
  // E-6: nome da clínica é dado do tenant, fora do nosso controle — pode ter
  // acento (ex.: "Clínica São Paulo") e disparar o mesmo bug de cabeçalho.
  const senderName = asciiSafeHeaderText(tenant?.name || "Traffio") || "Traffio";

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
      // E-6: ponto único de proteção — protege qualquer chamador de
      // sendTenantEmail, mesmo que esqueça de sanitizar o assunto antes.
      // Nunca cai de volta no assunto original (poderia reintroduzir o bug).
      subject: asciiSafeHeaderText(opts.subject) || "Notification",
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
