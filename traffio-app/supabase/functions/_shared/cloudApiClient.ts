import { crypto } from "https://deno.land/std@0.177.0/crypto/mod.ts";
import { encode as hexEncode } from "https://deno.land/std@0.177.0/encoding/hex.ts";

/**
 * CloudApiClient - A specialized client for interacting with the Meta WhatsApp Cloud API.
 * This client handles message sending (text, buttons, lists, flows) and webhook signature verification.
 */
export class CloudApiClient {
  private phoneNumberId: string;
  private accessToken: string;
  private apiVersion = 'v21.0';
  private baseUrl = 'https://graph.facebook.com';

  constructor(phoneNumberId: string, accessToken: string) {
    if (!phoneNumberId || !accessToken) {
      throw new Error("Missing phoneNumberId or accessToken for CloudApiClient");
    }
    this.phoneNumberId = phoneNumberId;
    this.accessToken = accessToken;
  }

  /**
   * Helper to send POST requests to the Graph API
   */
  private async postRequest(endpoint: string, body: any) {
    const url = `${this.baseUrl}/${this.apiVersion}/${this.phoneNumberId}/${endpoint}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error(`[CloudApiClient Error] ${response.status}:`, JSON.stringify(errorData, null, 2));
      throw new Error(`Cloud API Request Failed: ${errorData.error?.message || response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Send a simple text message
   */
  async sendText(to: string, text: string, quotedMsgId?: string): Promise<any> {
    const body: any = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: this.formatPhone(to),
      type: "text",
      text: { body: text },
    };
    if (quotedMsgId) {
      body.context = { message_id: quotedMsgId };
    }
    return this.postRequest('messages', body);
  }

  /**
   * Send interactive buttons (max 3)
   */
  async sendButtons(to: string, bodyText: string, buttons: Array<{ id: string, title: string }>): Promise<any> {
    return this.postRequest('messages', {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: this.formatPhone(to),
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText },
        action: {
          buttons: buttons.map(btn => ({
            type: "reply",
            reply: { id: btn.id, title: btn.title }
          }))
        }
      }
    });
  }

  /**
   * Send an interactive list (max 10 rows per section)
   */
  async sendList(
    to: string, 
    bodyText: string, 
    buttonText: string, 
    sections: Array<{ title: string, rows: Array<{ id: string, title: string, description?: string }> }>
  ): Promise<any> {
    return this.postRequest('messages', {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: this.formatPhone(to),
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: bodyText },
        action: {
          button: buttonText,
          sections: sections.map(section => ({
            title: section.title,
            rows: section.rows.map(row => ({
              id: row.id,
              title: row.title,
              description: row.description
            }))
          }))
        }
      }
    });
  }

  /**
   * Send a WhatsApp Flow
   */
  async sendFlow(
    to: string, 
    bodyText: string, 
    flowId: string, 
    flowToken: string, 
    flowAction: 'navigate' | 'data_exchange', 
    screenId?: string
  ): Promise<any> {
    return this.postRequest('messages', {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: this.formatPhone(to),
      type: "interactive",
      interactive: {
        type: "flow",
        body: { text: bodyText },
        action: {
          name: "flow",
          parameters: {
            flow_message_version: "3",
            flow_id: flowId,
            flow_token: flowToken,
            flow_action: flowAction,
            flow_action_payload: screenId ? { screen: screenId } : undefined
          }
        }
      }
    });
  }

  /**
   * Mark a message as read
   */
  async markAsRead(messageId: string): Promise<any> {
    return this.postRequest('messages', {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId
    });
  }

  /**
   * Upload de mídia para os servidores da Meta (obrigatório antes de sendMedia)
   * Retorna o media_id para uso no sendMedia()
   */
  async uploadMedia(fileUrl: string, mimeType: string): Promise<string> {
    // Baixar o arquivo da URL pública (Supabase Storage)
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) throw new Error(`Failed to fetch media from ${fileUrl}`);
    const fileBlob = await fileRes.blob();

    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('file', fileBlob, 'media');
    formData.append('type', mimeType);

    const url = `${this.baseUrl}/${this.apiVersion}/${this.phoneNumberId}/media`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.accessToken}` },
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(`Media upload failed: ${err.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data.id as string;
  }

  /**
   * Enviar mídia (image, audio, video, document, sticker)
   * Para Cloud API: faz upload primeiro para obter media_id
   */
  async sendMedia(
    to: string,
    mediaType: 'image' | 'audio' | 'video' | 'document' | 'sticker',
    mediaUrl: string,
    mimeType: string,
    caption?: string,
    fileName?: string,
    quotedMsgId?: string
  ): Promise<any> {
    // Cloud API requer upload prévio para obter media_id
    const mediaId = await this.uploadMedia(mediaUrl, mimeType);

    const mediaObject: any = { id: mediaId };
    if (caption && (mediaType === 'image' || mediaType === 'video' || mediaType === 'document')) {
      mediaObject.caption = caption;
    }
    if (fileName && mediaType === 'document') {
      mediaObject.filename = fileName;
    }

    const body: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.formatPhone(to),
      type: mediaType,
      [mediaType]: mediaObject,
    };

    if (quotedMsgId) {
      body.context = { message_id: quotedMsgId };
    }

    return this.postRequest('messages', body);
  }

  /**
   * Ensures the phone number has only digits
   */
  private formatPhone(phone: string): string {
    return phone.replace(/\D/g, '');
  }

  /**
   * Verifies the HMAC SHA-256 signature from WhatsApp webhooks
   */
  static async verifyWebhookSignature(payload: string, signature: string, appSecret: string): Promise<boolean> {
    if (!signature || !appSecret) return false;

    // Signature format is "sha256=HEX_SIG"
    const sigHeader = signature.startsWith('sha256=') ? signature.substring(7) : signature;
    
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(appSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const sigBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(payload)
    );

    const calculatedSig = new TextDecoder().decode(hexEncode(new Uint8Array(sigBuffer)));
    return calculatedSig === sigHeader;
  }
}
