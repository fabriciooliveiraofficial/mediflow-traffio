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

/** Mapeia o media_type interno do app para o `attachment.type` aceito pelo Send API da Meta. */
function toMetaAttachmentType(mediaType: string): "image" | "video" | "audio" | "file" {
  switch (mediaType) {
    case "image":
    case "sticker":
    case "gif":
      return "image";
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "document":
    default:
      return "file";
  }
}

export interface MetaSendResult {
  messageId: string;
  recipientId: string;
}

export class MetaSocialClient {

  private static isWindowExpiredError(error: any): boolean {
    if (!error) return false;
    const code = error.code;
    const subcode = error.error_subcode;
    const message = String(error.message || "");

    return (
      code === 10 ||
      code === 200 ||
      code === 100 ||
      subcode === 2018278 ||
      subcode === 2018153 ||
      message.includes("24-hour") ||
      message.includes("outside of allowed window") ||
      message.includes("outside the allowed window")
    );
  }

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
    const payload = {
      recipient: { id: psid },
      message:   { text },
      messaging_type: "RESPONSE",
    };

    let res = await fetch(`${GRAPH_API}/me/messages?access_token=${pageToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data = await res.json();

    // Fallback: Se estiver fora da janela de 24h, tenta novamente com HUMAN_AGENT
    if (data.error && MetaSocialClient.isWindowExpiredError(data.error)) {
      const fallbackPayload = { ...payload, messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" };
      res = await fetch(`${GRAPH_API}/me/messages?access_token=${pageToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fallbackPayload),
      });
      data = await res.json();
    }

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
    const payload = {
      recipient: { id: igsid },
      message:   { text },
      messaging_type: "RESPONSE",
    };

    let res = await fetch(`${GRAPH_API}/me/messages?access_token=${pageToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data = await res.json();

    if (data.error && MetaSocialClient.isWindowExpiredError(data.error)) {
      const fallbackPayload = { ...payload, messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" };
      res = await fetch(`${GRAPH_API}/me/messages?access_token=${pageToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fallbackPayload),
      });
      data = await res.json();
    }

    if (data.error) {
      throw new MetaSocialError(data.error.code, data.error.message, "instagram");
    }

    return { messageId: data.message_id, recipientId: data.recipient_id };
  }

  /**
   * Envia botões (Quick Replies) via Facebook Messenger.
   */
  static async sendFacebookQuickReplies(
    pageToken: string,
    psid: string,
    text: string,
    buttons: Array<{ id: string; title: string }>
  ): Promise<MetaSendResult> {
    const quickReplies = buttons.slice(0, 13).map(btn => ({
      content_type: "text",
      title: btn.title.substring(0, 20),
      payload: btn.id
    }));

    const payload = {
      recipient: { id: psid },
      message: {
        text,
        quick_replies: quickReplies
      },
      messaging_type: "RESPONSE",
    };

    let res = await fetch(`${GRAPH_API}/me/messages?access_token=${pageToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data = await res.json();

    if (data.error && MetaSocialClient.isWindowExpiredError(data.error)) {
      const fallbackPayload = { ...payload, messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" };
      res = await fetch(`${GRAPH_API}/me/messages?access_token=${pageToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fallbackPayload),
      });
      data = await res.json();
    }

    if (data.error) {
      throw new MetaSocialError(data.error.code, data.error.message, "facebook");
    }

    return { messageId: data.message_id, recipientId: data.recipient_id };
  }

  /**
   * Envia botões (Quick Replies) via Instagram Direct Message.
   */
  static async sendInstagramQuickReplies(
    pageToken: string,
    igAccountId: string,
    igsid: string,
    text: string,
    buttons: Array<{ id: string; title: string }>
  ): Promise<MetaSendResult> {
    const quickReplies = buttons.slice(0, 13).map(btn => ({
      content_type: "text",
      title: btn.title.substring(0, 20),
      payload: btn.id
    }));

    const payload = {
      recipient: { id: igsid },
      message: {
        text,
        quick_replies: quickReplies
      },
      messaging_type: "RESPONSE",
    };

    let res = await fetch(`${GRAPH_API}/me/messages?access_token=${pageToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data = await res.json();

    if (data.error && MetaSocialClient.isWindowExpiredError(data.error)) {
      const fallbackPayload = { ...payload, messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" };
      res = await fetch(`${GRAPH_API}/me/messages?access_token=${pageToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fallbackPayload),
      });
      data = await res.json();
    }

    if (data.error) {
      throw new MetaSocialError(data.error.code, data.error.message, "instagram");
    }

    return { messageId: data.message_id, recipientId: data.recipient_id };
  }

  /**
   * Envia anexo (imagem, vídeo, áudio ou arquivo) via Facebook Messenger.
   * @param pageToken  Page Access Token da página do Facebook
   * @param psid       Page-Scoped User ID do destinatário
   * @param mediaUrl   URL pública do arquivo (Supabase Storage)
   * @param mediaType  Tipo de mídia da app ('image' | 'audio' | 'video' | 'document' | 'sticker' | 'gif')
   */
  static async sendFacebookAttachment(
    pageToken: string,
    psid: string,
    mediaUrl: string,
    mediaType: string
  ): Promise<MetaSendResult> {
    const payload = {
      recipient: { id: psid },
      message: {
        attachment: {
          type: toMetaAttachmentType(mediaType),
          payload: { url: mediaUrl, is_reusable: true },
        },
      },
      messaging_type: "RESPONSE",
    };

    let res = await fetch(`${GRAPH_API}/me/messages?access_token=${pageToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data = await res.json();

    if (data.error && MetaSocialClient.isWindowExpiredError(data.error)) {
      const fallbackPayload = { ...payload, messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" };
      res = await fetch(`${GRAPH_API}/me/messages?access_token=${pageToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fallbackPayload),
      });
      data = await res.json();
    }

    if (data.error) {
      throw new MetaSocialError(data.error.code, data.error.message, "facebook");
    }

    return { messageId: data.message_id, recipientId: data.recipient_id };
  }

  /**
   * Envia anexo (imagem, vídeo ou áudio) via Instagram Direct Message.
   * @param pageToken   Page Access Token da página FB conectada ao Instagram
   * @param igsid       Instagram-Scoped User ID do destinatário
   * @param mediaUrl    URL pública do arquivo (Supabase Storage)
   * @param mediaType   Tipo de mídia da app ('image' | 'audio' | 'video' | 'document' | 'sticker' | 'gif')
   */
  static async sendInstagramAttachment(
    pageToken: string,
    igsid: string,
    mediaUrl: string,
    mediaType: string
  ): Promise<MetaSendResult> {
    const payload = {
      recipient: { id: igsid },
      message: {
        attachment: {
          type: toMetaAttachmentType(mediaType),
          payload: { url: mediaUrl, is_reusable: true },
        },
      },
      messaging_type: "RESPONSE",
    };

    let res = await fetch(`${GRAPH_API}/me/messages?access_token=${pageToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data = await res.json();

    if (data.error && MetaSocialClient.isWindowExpiredError(data.error)) {
      const fallbackPayload = { ...payload, messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" };
      res = await fetch(`${GRAPH_API}/me/messages?access_token=${pageToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fallbackPayload),
      });
      data = await res.json();
    }

    if (data.error) {
      throw new MetaSocialError(data.error.code, data.error.message, "instagram");
    }

    return { messageId: data.message_id, recipientId: data.recipient_id };
  }

  /**
   * Responde publicamente a um comentário de post do Instagram.
   * Endpoint diferente do envio de DM (POST /{comment-id}/replies em vez de
   * /me/messages) — não existe conceito de janela de 24h para comentário
   * público, então não há fallback de messaging_type aqui.
   * @param pageToken   Page Access Token da página FB conectada ao Instagram
   * @param commentId   ID do comentário do Instagram a responder
   * @param text        Texto da resposta pública
   */
  static async replyToInstagramComment(
    pageToken: string,
    commentId: string,
    text: string
  ): Promise<{ id: string }> {
    const res = await fetch(`${GRAPH_API}/${commentId}/replies?access_token=${pageToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();

    if (data.error) {
      throw new MetaSocialError(data.error.code, data.error.message, "instagram");
    }

    return { id: data.id };
  }

  /**
   * Envia uma resposta PRIVADA (Private Reply oficial da Meta) a quem comentou
   * um post do Instagram. Diferente de sendInstagramMessage: usa o endpoint
   * /{ig-account-id}/messages com recipient.comment_id (não recipient.id), não
   * abre uma "conversa" contínua — é um disparo único por comentário, dentro
   * de uma janela de 7 dias, sem exigir troca de mensagem prévia. Documentação:
   * https://developers.facebook.com/docs/instagram-platform/private-replies/
   * @param pageToken   Page Access Token da página FB conectada ao Instagram
   * @param igAccountId ID numérico da conta Instagram Business do tenant
   * @param commentId   ID do comentário que originou o gatilho
   * @param text        Texto da mensagem privada
   */
  static async sendPrivateReplyToComment(
    pageToken: string,
    igAccountId: string,
    commentId: string,
    text: string
  ): Promise<{ messageId: string; recipientId: string }> {
    const res = await fetch(`${GRAPH_API}/${igAccountId}/messages?access_token=${pageToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text },
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
    return (
      this.code === 10 ||
      this.code === 200 ||
      this.code === 100 ||
      this.message.includes("24-hour") ||
      this.message.includes("outside of allowed window") ||
      this.message.includes("outside the allowed window")
    );
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
