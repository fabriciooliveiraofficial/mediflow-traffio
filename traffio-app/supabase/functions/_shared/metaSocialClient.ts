/**
 * MetaSocialClient — Dispatcher para Instagram DM e Facebook Messenger
 *
 * Usa a Meta Graph API v21.0 para enviar mensagens proativas via:
 *   - Instagram Direct Messages (usando IGSID do paciente)
 *   - Facebook Messenger (usando PSID do paciente)
 *
 * Requer: Page Access Token salvo em tenant_meta_pages
 *
 * IMPORTANTE: A Meta só permite enviar mensagens proativas dentro de
 * 24 horas após o último contato do paciente (janela de mensagem).
 * Fora dessa janela, o envio falha com código 10.
 */

const GRAPH_API = "https://graph.facebook.com/v21.0";

export interface MetaSendResult {
  messageId: string;
  recipientId: string;
}

export class MetaSocialClient {

  /**
   * Envia mensagem via Facebook Messenger.
   * @param pageToken  Page Access Token da página do Facebook
   * @param psid       Page-Scoped User ID do destinatário (capturado do webhook)
   * @param text       Texto da mensagem (sem markdown, sem emojis complexos)
   */
  static async sendFacebookMessage(
    pageToken: string,
    psid: string,
    text: string
  ): Promise<MetaSendResult> {
    const res = await fetch(`${GRAPH_API}/me/messages?access_token=${pageToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: psid },
        message:   { text },
        messaging_type: "MESSAGE_TAG",
        tag: "CONFIRMED_EVENT_UPDATE",  // Tag válida para lembretes de agendamento
      }),
    });

    const data = await res.json();
    if (data.error) {
      throw new MetaSocialError(data.error.code, data.error.message, "facebook");
    }

    return { messageId: data.message_id, recipientId: data.recipient_id };
  }

  /**
   * Envia mensagem via Instagram Direct Message.
   * @param pageToken     Page Access Token da página FB conectada ao Instagram
   * @param igAccountId   ID numérico da conta Instagram Business do tenant
   * @param igsid         Instagram-Scoped User ID do destinatário (capturado do webhook)
   * @param text          Texto da mensagem
   */
  static async sendInstagramMessage(
    pageToken: string,
    igAccountId: string,
    igsid: string,
    text: string
  ): Promise<MetaSendResult> {
    // Para Instagram Direct, enviamos para /me/messages (vinculado à página FB) com o IGSID no recipient.id
    const res = await fetch(`${GRAPH_API}/me/messages?access_token=${pageToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: igsid },
        message:   { text },
      }),
    });

    const data = await res.json();
    if (data.error) {
      throw new MetaSocialError(data.error.code, data.error.message, "instagram");
    }

    return { messageId: data.message_id, recipientId: data.recipient_id };
  }

  /**
   * Verifica se um token de página ainda é válido.
   * Retorna true se válido, false se revogado.
   */
  static async validatePageToken(pageToken: string): Promise<boolean> {
    try {
      const res  = await fetch(`${GRAPH_API}/me?fields=id&access_token=${pageToken}`);
      const data = await res.json();
      return !data.error;
    } catch {
      return false;
    }
  }
}

/**
 * Erro específico da Meta API com tratamento de casos comuns.
 */
export class MetaSocialError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly channel: "facebook" | "instagram"
  ) {
    super(`[Meta ${channel}] Code ${code}: ${message}`);
    this.name = "MetaSocialError";
  }

  /** Janela de 24h expirada — o paciente não enviou mensagem nas últimas 24h */
  get isWindowExpired(): boolean {
    return this.code === 10 || this.code === 200 || this.message.includes("24-hour");
  }

  /** Token de página inválido ou revogado */
  get isTokenInvalid(): boolean {
    return this.code === 190 || this.code === 102;
  }

  /** Usuário bloqueou a página */
  get isUserBlocked(): boolean {
    return this.code === 551 || this.code === 200;
  }
}
