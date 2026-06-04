/**
 * telnyxSmsClient — Dispatcher minimal para SMS via Telnyx
 *
 * Versão MVP: apenas envio de SMS de texto.
 * Será expandido no Bloco F com voz, números e credenciais de agente.
 */

const TELNYX_API = "https://api.telnyx.com/v2";

export interface TelnyxSmsResult {
  messageId: string;
  to: string;
  status: string;
}

export class TelnyxSmsClient {
  constructor(private readonly apiKey: string) {}

  /**
   * Envia SMS via Telnyx.
   * @param from  Número remetente no formato E.164 (ex: "+5511400311111")
   * @param to    Número destinatário no formato E.164 (ex: "+5511999999999")
   * @param text  Texto da mensagem — máx 155 chars para 1 segmento, sem emojis
   */
  async sendSms(from: string, to: string, text: string): Promise<TelnyxSmsResult> {
    const res = await fetch(`${TELNYX_API}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, text }),
    });

    const data = await res.json();

    if (!res.ok || data.errors) {
      const errMsg = data.errors?.[0]?.detail ?? data.title ?? "Telnyx SMS error";
      throw new Error(`[Telnyx SMS] ${errMsg}`);
    }

    return {
      messageId: data.data.id,
      to:        data.data.to?.[0]?.phone_number ?? to,
      status:    data.data.to?.[0]?.status ?? "queued",
    };
  }
}
