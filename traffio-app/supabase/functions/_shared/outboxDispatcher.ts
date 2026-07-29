/**
 * SPRINT 2 — Message Outbox Dispatcher
 *
 * Em vez de chamar a Z-API diretamente dentro da Edge Function do webhook
 * (onde uma falha significa que o paciente nunca recebe a mensagem apesar do
 * agendamento estar confirmado), enfileiramos a mensagem no banco e a entregamos
 * de forma assíncrona com retry automático.
 *
 * Fluxo:
 *   1. whatsapp-bot/index.ts → enqueue() → grava em message_outbox (status='pending')
 *   2. Edge Function /process-outbox (chamada a cada 30s por Supabase cron) →
 *      processa lotes de mensagens pendentes → chama Z-API → atualiza status
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { CloudApiClient } from "./cloudApiClient.ts";
import { MetaSocialClient } from "./metaSocialClient.ts";
import { getCloudApiPricing } from "./pricing.ts";

/**
 * Categoria de billing Cloud API (Meta) do envio — roadmap item 4, 16/07/2026.
 * "service" (conversa iniciada pelo paciente) é grátis e é o default — só
 * marketing/utility geram linha em tenant_usage_log. Z-API nunca é medido
 * (o tenant paga a mensalidade fixa direto pra Z-API, fora da Traffio).
 */
export type CloudApiBillingCategory = "marketing" | "utility" | "service";

export class OutboxDispatcher {
    constructor(private supabase: SupabaseClient) {}

    /**
     * Envia imediatamente via Z-API, Cloud API ou Meta Graph API (Instagram/FB).
     * Se falhar, lança exceção (quem chama decide se faz enqueue como fallback).
     */
    async sendNow(
        tenant: any,
        phone: string,
        payload: { text: string; interactive?: any; channel?: string },
        typingDelayMs = 0,
        quotedMsgId?: string,
        category: CloudApiBillingCategory = "service",
        channel: string = "whatsapp"
    ): Promise<string | undefined> {
        const effectiveChannel = payload?.channel || channel || "whatsapp";

        if (tenant?.bot_config?.outbound_dry_run) {
            const fakeId = `dry-run-${crypto.randomUUID()}`;
            console.log(`[OutboxDispatcher] DRY RUN (tenant ${tenant.id}) — não enviou de verdade para ${phone} (${effectiveChannel}): "${payload.text.substring(0, 60)}" (id simulado: ${fakeId})`);
            return fakeId;
        }

        if (effectiveChannel === "instagram" || effectiveChannel === "facebook") {
            const isInstagram = effectiveChannel === "instagram";
            const pageQuery = isInstagram
                ? this.supabase.from("tenant_meta_pages").select("page_access_token, instagram_account_id").eq("tenant_id", tenant.id).not("instagram_account_id", "is", null).eq("is_active", true).limit(1).maybeSingle()
                : this.supabase.from("tenant_meta_pages").select("page_access_token").eq("tenant_id", tenant.id).eq("is_active", true).limit(1).maybeSingle();

            const { data: metaPage, error: pageErr } = await pageQuery;

            if (pageErr || !metaPage?.page_access_token) {
                console.error(`[OutboxDispatcher] Sem credenciais Meta ativas para tenant ${tenant.id} (${effectiveChannel}). Não entregou para ${phone}`);
                throw new Error(`Sem credenciais ativas do Meta/Page para o canal ${effectiveChannel}`);
            }

            const metaButtons = extractButtonsFromInteractive(payload?.interactive);

            if (isInstagram) {
                const res = metaButtons.length > 0
                    ? await MetaSocialClient.sendInstagramQuickReplies(metaPage.page_access_token, metaPage.instagram_account_id, phone, payload.text, metaButtons)
                    : await MetaSocialClient.sendInstagramMessage(metaPage.page_access_token, metaPage.instagram_account_id, phone, payload.text);
                console.log(`[OutboxDispatcher] Instagram DM enviada com sucesso para ${phone} (msgId: ${res.messageId})`);
                return res.messageId;
            } else {
                const res = metaButtons.length > 0
                    ? await MetaSocialClient.sendFacebookQuickReplies(metaPage.page_access_token, phone, payload.text, metaButtons)
                    : await MetaSocialClient.sendFacebookMessage(metaPage.page_access_token, phone, payload.text);
                console.log(`[OutboxDispatcher] Facebook Messenger enviada com sucesso para ${phone} (msgId: ${res.messageId})`);
                return res.messageId;
            }
        }

        if (effectiveChannel === "livechat") {
            console.log(`[OutboxDispatcher] Livechat dispatch para ${phone}: "${payload.text.substring(0, 60)}"`);

            // Localizar a sessão pelo patient_phone para transmitir via Supabase Realtime Broadcast
            const { data: session } = await this.supabase
                .from('conversation_sessions')
                .select('id')
                .eq('tenant_id', tenant.id)
                .eq('patient_phone', phone)
                .maybeSingle();

            const msgId = `livechat-${crypto.randomUUID()}`;

            if (session?.id) {
                const realtimeChannel = this.supabase.channel(`livechat:${session.id}`);
                await realtimeChannel.send({
                    type: 'broadcast',
                    event: 'message',
                    payload: {
                        id: msgId,
                        role: 'ai',
                        content: payload.text,
                        interactive: payload.interactive || null,
                        sender_name: tenant.name || 'Atendimento',
                        created_at: new Date().toISOString()
                    }
                });
                console.log(`[OutboxDispatcher] Realtime broadcast enviado com sucesso para livechat:${session.id}`);
            }

            return msgId;
        }

        if (tenant.whatsapp_provider === 'cloud_api' && tenant.cloud_api_phone_number_id && tenant.cloud_api_access_token) {
            const result = await sendCloudApiMessage(tenant, phone, payload, quotedMsgId);
            await this.trackCloudApiUsage(tenant.id, category);
            return result;
        } else {
            return await sendZapiMessage(tenant, phone, payload, typingDelayMs, quotedMsgId);
        }
    }

    /**
     * Envia uma sequência de bolhas de mensagem ao paciente com cadência de digitação.
     * Se uma bolha intermediária falhar no envio síncrono, as bolhas restantes são enfileiradas no outbox.
     * Retorna a lista de bolhas efetivamente entregues ou enfileiradas.
     */
    async sendSequence(
        tenant: any,
        phone: string,
        bubbles: string[],
        interactive?: any,
        category: CloudApiBillingCategory = "service",
        channel: string = "whatsapp",
        mediaUrl?: string,
        mediaAttachedText?: string
    ): Promise<string[]> {
        if (!bubbles || bubbles.length === 0) return [];

        const sentBubbles: string[] = [];
        for (let i = 0; i < bubbles.length; i++) {
            const bubble = bubbles[i];
            const isLast = (i === bubbles.length - 1);
            const payload: { text: string; interactive?: any; channel?: string; media_url?: string; media_type?: string; caption?: string } = { text: bubble, channel };
            if (isLast && interactive) {
                payload.interactive = interactive;
            }

            let attachHere = false;
            if (mediaUrl) {
                if (mediaAttachedText) {
                    const normalizedBubble = bubble.replace(/\s+/g, "");
                    const normalizedTarget = mediaAttachedText.replace(/\s+/g, "");
                    if (normalizedBubble.includes(normalizedTarget) || normalizedTarget.includes(normalizedBubble)) {
                        attachHere = true;
                    }
                }
                if (!attachHere && isLast) {
                    attachHere = true;
                }
            }

            if (attachHere) {
                payload.media_url = mediaUrl;
                payload.media_type = 'image';
                payload.caption = bubble;
                mediaUrl = undefined; // consume it
            }

            const typingDelayMs = Math.min(2200, Math.max(800, bubble.length * 35));

            try {
                await this.sendNow(tenant, phone, payload, typingDelayMs, undefined, category, channel);
                sentBubbles.push(bubble);
            } catch (err: any) {
                console.warn(`[OutboxDispatcher] Falha no envio síncrono da bolha ${i + 1}/${bubbles.length}: ${err?.message}. Enfileirando restantes.`);
                for (let j = i; j < bubbles.length; j++) {
                    const remBubble = bubbles[j];
                    const remIsLast = (j === bubbles.length - 1);
                    const remPayload: { text: string; interactive?: any; channel?: string; media_url?: string; media_type?: string; caption?: string } = { text: remBubble, channel };
                    if (remIsLast && interactive) remPayload.interactive = interactive;
                    
                    let remAttachHere = false;
                    if (mediaUrl) {
                        if (mediaAttachedText) {
                            const normalizedBubble = remBubble.replace(/\s+/g, "");
                            const normalizedTarget = mediaAttachedText.replace(/\s+/g, "");
                            if (normalizedBubble.includes(normalizedTarget) || normalizedTarget.includes(normalizedBubble)) {
                                remAttachHere = true;
                            }
                        }
                        if (!remAttachHere && remIsLast) {
                            remAttachHere = true;
                        }
                    }

                    if (remAttachHere) {
                        remPayload.media_url = mediaUrl;
                        remPayload.media_type = 'image';
                        remPayload.caption = remBubble;
                        mediaUrl = undefined;
                    }

                    await this.enqueue(tenant.id, phone, remPayload, channel);
                    sentBubbles.push(remBubble);
                }
                break;
            }

            if (i < bubbles.length - 1) {
                const interBubbleDelay = Math.min(1500, Math.max(600, bubble.length * 20));
                await new Promise((resolve) => setTimeout(resolve, interBubbleDelay));
            }
        }

        return sentBubbles;
    }

    /** Billing medido de mensagens Cloud API (roadmap item 4) — non-blocking, nunca derruba o envio. */
    private async trackCloudApiUsage(tenantId: string, category: CloudApiBillingCategory): Promise<void> {
        if (category === "service") return;
        try {
            const pricing = getCloudApiPricing(category);
            await this.supabase.from("tenant_usage_log").insert({
                tenant_id: tenantId,
                resource_type: category === "marketing" ? "whatsapp_marketing" : "whatsapp_utility",
                quantity: 1,
                unit_cost_usd: pricing.unitCostUsd,
            });
        } catch (err: any) {
            console.warn(`[OutboxDispatcher] Cloud API usage tracking falhou (non-fatal): ${err?.message}`);
        }
    }

    /**
     * Enfileira uma mensagem para entrega assíncrona.
     */
    async enqueue(tenantId: string, phone: string, payload: { text: string; interactive?: any; quotedMsgId?: string; channel?: string }, channel: string = "whatsapp"): Promise<void> {
        const payloadWithChannel = { ...payload, channel: payload.channel || channel };
        const { error } = await this.supabase
            .from('message_outbox')
            .insert({
                tenant_id: tenantId,
                phone,
                payload: payloadWithChannel,
                status: 'pending',
                attempts: 0,
                next_attempt_at: new Date().toISOString()
            });

        if (error) {
            console.error('[OutboxDispatcher] Failed to enqueue message:', error);
        }
    }

    /**
     * Envia mídia imediatamente via Z-API ou Cloud API.
     */
    async sendMedia(
        tenant: any,
        phone: string,
        payload: {
            media_url:   string;
            media_type:  'image' | 'audio' | 'video' | 'document' | 'sticker' | 'gif';
            mime_type?:  string;
            caption?:    string;
            file_name?:  string;
        },
        quotedMsgId?: string,
        category: CloudApiBillingCategory = "service"
    ): Promise<string | undefined> {
        if (tenant.whatsapp_provider === 'cloud_api' &&
            tenant.cloud_api_phone_number_id &&
            tenant.cloud_api_access_token) {
            const result = await sendCloudApiMedia(tenant, phone, payload, quotedMsgId);
            await this.trackCloudApiUsage(tenant.id, category);
            return result;
        } else {
            return await sendZapiMedia(tenant, phone, payload, quotedMsgId);
        }
    }

    /**
     * Delete a message for everyone (Z-API ONLY).
     */
    async deleteMessage(tenant: any, phone: string, waMsgId: string, isOwner: boolean): Promise<void> {
        if (tenant.whatsapp_provider === 'cloud_api') {
            throw new Error('Deletion for everyone is not supported by standard Cloud API.');
        } else {
            const baseUrl = `https://api.z-api.io/instances/${tenant.zapi_instance_id}/token/${tenant.zapi_token}`;
            const clientToken = tenant.zapi_client_token;
            const endpoint = `/messages?messageId=${waMsgId}&phone=${phone}&owner=${isOwner}`;
            await zapiDelete(baseUrl, clientToken, endpoint);
        }
    }

    /**
     * Processa um lote de mensagens pendentes.
     * Chamado pelo processo-outbox Edge Function (via Supabase cron).
     */
    async processBatch(batchSize: number = 20): Promise<{ sent: number; failed: number }> {
        const now = new Date().toISOString();

        // Buscar mensagens pendentes com next_attempt_at <= agora, em lote
        const { data: pending, error } = await this.supabase
            .from('message_outbox')
            .select('*, tenants(whatsapp_provider, zapi_instance_id, zapi_token, zapi_client_token, cloud_api_phone_number_id, cloud_api_access_token)')
            .eq('status', 'pending')
            .lte('next_attempt_at', now)
            .lt('attempts', 3) // max_attempts
            .order('created_at', { ascending: true })
            .limit(batchSize);

        if (error || !pending?.length) return { sent: 0, failed: 0 };

        let sent = 0;
        let failed = 0;

        for (const msg of pending) {
            const tenant = (msg as any).tenants;
            const channel = msg.payload?.channel || 'whatsapp';

            try {
                if (channel === 'instagram' || channel === 'facebook') {
                    const isInstagram = channel === 'instagram';
                    const pageQuery = isInstagram
                        ? this.supabase.from("tenant_meta_pages").select("page_access_token, instagram_account_id").eq("tenant_id", msg.tenant_id).not("instagram_account_id", "is", null).eq("is_active", true).limit(1).maybeSingle()
                        : this.supabase.from("tenant_meta_pages").select("page_access_token").eq("tenant_id", msg.tenant_id).eq("is_active", true).limit(1).maybeSingle();

                    const { data: metaPage, error: pageErr } = await pageQuery;

                    if (pageErr || !metaPage?.page_access_token) {
                        await this.markFailed(msg.id, `Missing Meta page token for channel ${channel}`);
                        failed++;
                        continue;
                    }

                    const metaButtons = extractButtonsFromInteractive(msg.payload?.interactive);
                    if (isInstagram) {
                        if (metaButtons.length > 0) {
                            await MetaSocialClient.sendInstagramQuickReplies(metaPage.page_access_token, metaPage.instagram_account_id, msg.phone, msg.payload.text, metaButtons);
                        } else {
                            await MetaSocialClient.sendInstagramMessage(metaPage.page_access_token, metaPage.instagram_account_id, msg.phone, msg.payload.text);
                        }
                    } else {
                        if (metaButtons.length > 0) {
                            await MetaSocialClient.sendFacebookQuickReplies(metaPage.page_access_token, msg.phone, msg.payload.text, metaButtons);
                        } else {
                            await MetaSocialClient.sendFacebookMessage(metaPage.page_access_token, msg.phone, msg.payload.text);
                        }
                    }
                } else if (tenant?.whatsapp_provider === 'cloud_api' && tenant?.cloud_api_phone_number_id && tenant?.cloud_api_access_token) {
                    await sendCloudApiMessage(tenant, msg.phone, msg.payload);
                } else {
                    if (!tenant?.zapi_instance_id || !tenant?.zapi_token) {
                        await this.markFailed(msg.id, 'Missing WhatsApp API credentials');
                        failed++;
                        continue;
                    }
                    await sendZapiMessage(tenant, msg.phone, msg.payload);
                }
                
                await this.supabase
                    .from('message_outbox')
                    .update({ status: 'sent', sent_at: new Date().toISOString() })
                    .eq('id', msg.id);
                sent++;
            } catch (e: any) {
                const newAttempts = (msg.attempts || 0) + 1;
                if (newAttempts >= 3) {
                    await this.markFailed(msg.id, e.message);
                    failed++;
                } else {
                    // Backoff exponencial: 30s, 2min, 8min
                    const backoffSeconds = Math.pow(4, newAttempts) * 30;
                    const nextAttempt = new Date(Date.now() + backoffSeconds * 1000).toISOString();
                    await this.supabase
                        .from('message_outbox')
                        .update({ attempts: newAttempts, next_attempt_at: nextAttempt, error_detail: e.message })
                        .eq('id', msg.id);
                }
            }
        }

        return { sent, failed };
    }

    private async markFailed(id: string, reason: string) {
        await this.supabase
            .from('message_outbox')
            .update({ status: 'failed', error_detail: reason })
            .eq('id', id);
    }
}

async function zapiPost(baseUrl: string, clientToken: string, endpoint: string, body: any): Promise<any> {
    const res = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
            'Client-Token': clientToken,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    // Z-API sometimes returns HTTP 200 with an error body (e.g. NOT_FOUND for unsupported endpoints)
    const resBody = await res.json().catch(() => ({}));

    if (!res.ok || resBody.error || resBody.message === 'Unable to find matching target resource method') {
        const errDetail = `Z-API ${endpoint} [${res.status}]: ${JSON.stringify(resBody)}`;
        console.error(`❌ [OutboxDispatcher] ${errDetail}`);
        throw new Error(errDetail);
    }
    console.log(`✅ [OutboxDispatcher] ${endpoint} success: ${res.status}`);
    return resBody;
}

async function zapiDelete(baseUrl: string, clientToken: string, endpoint: string): Promise<any> {
    const res = await fetch(`${baseUrl}${endpoint}`, {
        method: 'DELETE',
        headers: {
            'Client-Token': clientToken,
            'Content-Type': 'application/json'
        }
    });

    if (res.status === 204) return { success: true };

    const resBody = await res.json().catch(() => ({}));
    if (!res.ok || resBody.error) {
        const errDetail = `Z-API DELETE ${endpoint} [${res.status}]: ${JSON.stringify(resBody)}`;
        console.error(`❌ [OutboxDispatcher] ${errDetail}`);
        throw new Error(errDetail);
    }
    return resBody;
}

async function sendZapiMessage(tenant: any, phone: string, payload: any, typingDelayMs = 0, quotedMsgId?: string): Promise<string | undefined> {
    const { text, interactive, media_url, media_type, caption } = payload;
    const finalQuotedMsgId = quotedMsgId || payload.quotedMsgId;
    const baseUrl = `https://api.z-api.io/instances/${tenant.zapi_instance_id}/token/${tenant.zapi_token}`;
    const clientToken = tenant.zapi_client_token;

    if (media_url) {
        return await sendZapiMedia(tenant, phone, {
            media_url,
            media_type: media_type || 'image',
            caption: caption || text,
            file_name: payload.file_name,
        }, finalQuotedMsgId);
    }

    // Try interactive (button/list) first; fall back to numbered text on any error.
    // Payloads conforme a doc oficial da Z-API (validado 14/07/2026):
    //   /send-button-list  → { phone, message, buttonList: { buttons: [{id, label}] } }
    //   /send-option-list  → { phone, message, optionList: { title, buttonLabel, options: [{id, title, description}] } }
    if (interactive?.type === 'button') {
        try {
            const resBody = await zapiPost(baseUrl, clientToken, '/send-button-list', {
                phone,
                message: text,
                buttonList: {
                    buttons: interactive.buttons?.map((b: any) => ({ id: b.id, label: b.title })),
                },
            });
            return resBody?.messageId;
        } catch (e) {
            console.warn('[OutboxDispatcher] button endpoint failed, falling back to numbered text:', e);
        }
    } else if (interactive?.type === 'list') {
        try {
            const rows = (interactive.sections || []).flatMap((s: any) => s.rows || []);
            const resBody = await zapiPost(baseUrl, clientToken, '/send-option-list', {
                phone,
                message: text,
                optionList: {
                    title: interactive.header || 'Opções',
                    buttonLabel: interactive.buttonText || 'Ver opções',
                    options: rows.map((r: any) => ({ id: r.id, title: r.title, description: r.description })),
                },
            });
            return resBody?.messageId;
        } catch (e) {
            console.warn('[OutboxDispatcher] list endpoint failed, falling back to numbered text:', e);
        }
    }

    // Plain text — com opções numeradas quando o interativo falhou (as opções
    // NUNCA se perdem; o paciente responde com o número)
    const finalText = interactiveAsNumberedText(text, interactive);
    const body: any = { phone, message: finalText, delay: typingDelayMs };
    if (finalQuotedMsgId) body.messageId = finalQuotedMsgId; // Z-API quoted reply field
    const resBody = await zapiPost(baseUrl, clientToken, '/send-text', body);
    return resBody?.messageId;
}

/**
 * Degrada um payload interativo para texto numerado — a rede de segurança da
 * instabilidade de botões da Z-API. "1️⃣ 16/07 · 09:00" etc.; quem processa a
 * resposta aceita o dígito (ver runAutonomousAgent → pending_slots).
 */
function interactiveAsNumberedText(text: string, interactive: any): string {
    const options: any[] = interactive?.type === 'button'
        ? (interactive.buttons || [])
        : interactive?.type === 'list'
            ? (interactive.sections || []).flatMap((s: any) => s.rows || [])
            : [];
    if (!options.length) return text;

    const digits = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
    const lines = options.map((o: any, i: number) =>
        `${digits[i] || `${i + 1}.`} ${o.title}${o.description ? ` — ${o.description}` : ''}`);
    return `${text}\n\n${lines.join('\n')}`;
}

async function sendCloudApiMessage(tenant: any, phone: string, payload: any, quotedMsgId?: string): Promise<string | undefined> {
    const { text, interactive, media_url, caption } = payload;
    const finalQuotedMsgId = quotedMsgId || payload.quotedMsgId;
    const client = new CloudApiClient(tenant.cloud_api_phone_number_id, tenant.cloud_api_access_token);

    let res;
    if (media_url) {
        res = await client.sendImage(phone, media_url, caption || text, finalQuotedMsgId);
    } else if (interactive?.type === 'button') {
        res = await client.sendButtons(phone, text, interactive.buttons);
    } else if (interactive?.type === 'list') {
        res = await client.sendList(
            phone,
            text,
            interactive.buttonText || "Ver Opções",
            interactive.sections
        );
    } else if (interactive?.type === 'flow') {
        const { flowId, flowToken, flowAction, screenId } = interactive;
        res = await client.sendFlow(phone, text, flowId, flowToken, flowAction, screenId);
    } else {
        res = await client.sendText(phone, text, finalQuotedMsgId);
    }
    return res?.messages?.[0]?.id;
}

async function sendZapiMedia(tenant: any, phone: string, payload: any, quotedMsgId?: string): Promise<string | undefined> {
    const { media_url, media_type, caption, file_name } = payload;
    const baseUrl     = `https://api.z-api.io/instances/${tenant.zapi_instance_id}/token/${tenant.zapi_token}`;
    const clientToken = tenant.zapi_client_token;

    // GIFs são enviados como imagem pela Z-API
    const effectiveType = media_type === 'gif' ? 'image' : media_type;

    const endpointMap: Record<string, string> = {
        image:    '/send-image',
        audio:    '/send-audio',
        video:    '/send-video',
        document: '/send-document',
        sticker:  '/send-sticker',
    };

    const endpoint = endpointMap[effectiveType];
    if (!endpoint) throw new Error(`Unsupported media type for Z-API: ${effectiveType}`);

    const bodyMap: Record<string, any> = {
        image:    { phone, image: media_url, caption: caption || '' },
        audio:    { phone, audio: media_url },
        video:    { phone, video: media_url, caption: caption || '' },
        document: { phone, document: media_url, fileName: file_name || 'arquivo', caption: caption || '' },
        sticker:  { phone, sticker: media_url },
    };

    const body = bodyMap[effectiveType];
    if (quotedMsgId) body.messageId = quotedMsgId;

    const resBody = await zapiPost(baseUrl, clientToken, endpoint, body);
    return resBody?.messageId;
}

async function sendCloudApiMedia(tenant: any, phone: string, payload: any, quotedMsgId?: string): Promise<string | undefined> {
    const { media_url, media_type, mime_type, caption, file_name } = payload;
    const client = new CloudApiClient(tenant.cloud_api_phone_number_id, tenant.cloud_api_access_token);

    const effectiveType = media_type === 'gif' ? 'image' : media_type;

    const res = await client.sendMedia(
        phone,
        effectiveType as 'image' | 'audio' | 'video' | 'document' | 'sticker',
        media_url,
        mime_type || 'application/octet-stream',
        caption,
        file_name,
        quotedMsgId
    );
    
    return res?.messages?.[0]?.id;
}

function extractButtonsFromInteractive(interactive: any): Array<{ id: string; title: string }> {
    if (!interactive) return [];
    if (interactive.type === 'button' && Array.isArray(interactive.buttons)) {
        return interactive.buttons.map((b: any) => ({ id: b.id, title: b.title || b.label }));
    }
    if (interactive.type === 'list' && Array.isArray(interactive.sections)) {
        const rows = interactive.sections.flatMap((s: any) => s.rows || []);
        return rows.map((r: any) => ({ id: r.id, title: r.title }));
    }
    return [];
}
