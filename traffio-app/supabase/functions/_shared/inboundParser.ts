/**
 * inboundParser — extração de conteúdo do webhook, isolada e testável.
 *
 * Bug de produção (2026-07-21): o handler Z-API lia `body.buttonResponse.buttonId`
 * e `body.optionListResponse.id` — campos que NÃO existem no payload da Z-API.
 * O clique do paciente num botão de horário caía em "Empty event" e a mensagem
 * NUNCA entrava no message_inbox. Silêncio total para o paciente.
 *
 * Regra desta camada: o id do interativo (buttonId/selectedRowId) SEMPRE vence o
 * texto/rótulo — é ele que carrega o slot_id determinístico ("slot|...").
 */

/**
 * Atribuição de anúncio (Meta Click-to-WhatsApp/Messenger/Instagram) — a Meta
 * inclui isto na PRIMEIRA mensagem de uma conversa iniciada por clique de
 * anúncio. Nunca presente em contato orgânico. Ver _shared/identityResolution.ts
 * para onde isto é persistido (channel_identities.platform_meta).
 */
export interface InboundReferral {
    sourceId: string | null;
    sourceType: string | null;
    sourceUrl: string | null;
    ctwaClid: string | null;
    headline: string | null;
}

export interface InboundContent {
    /** Conteúdo que vai para message_inbox.content (id do interativo quando houver) */
    content: string | null;
    /** Rótulo visível do interativo (ex.: "22/07 · 08:30") — fallback de correlação */
    interactiveTitle: string | null;
    messageType: string;
    mediaUrl: string | null;
    caption: string | null;
    /** true quando o evento é resposta a botão/lista — nunca pode virar "Empty event" */
    isInteractiveReply: boolean;
    /** Nome original do arquivo (Fase 2 — Arquivos, 2026-08-13). Só documento tem; null para o resto. */
    fileName: string | null;
    /** Mime type declarado pelo provedor (Fase 2 — Arquivos, 2026-08-13). Só documento tem; null para o resto. */
    mimeType: string | null;
    /** Atribuição de anúncio (Dashboard — Leads Feed, 2026-08-13). null em contato orgânico. */
    referral: InboundReferral | null;
}

/** Lê o objeto `referral` de um payload de webhook — mesmo formato documentado
 * pela Cloud API; Z-API pode ou não repassar o campo (não confirmado), então
 * esta função é usada em ambos os parsers e nunca lança nem assume presença. */
export function extractReferral(source: any): InboundReferral | null {
    const r = source?.referral;
    if (!r || typeof r !== "object") return null;
    return {
        sourceId: r.source_id || null,
        sourceType: r.source_type || null,
        sourceUrl: r.source_url || null,
        ctwaClid: r.ctwa_clid || null,
        headline: r.headline || null,
    };
}

/**
 * Extrai o conteúdo relevante de um payload Z-API.
 */
export function extractZapiContent(body: any): InboundContent {
    if (!body || typeof body !== "object") {
        return {
            content: null,
            interactiveTitle: null,
            messageType: "text",
            mediaUrl: null,
            caption: null,
            isInteractiveReply: false,
            fileName: null,
            mimeType: null,
            referral: null,
        };
    }

    // 1. Resposta a botão (/send-button-list)
    if (body.buttonsResponseMessage) {
        const btnId = body.buttonsResponseMessage.buttonId || null;
        const title = body.buttonsResponseMessage.message || body.buttonsResponseMessage.label || body.buttonsResponseMessage.title || null;
        const rawContent = btnId || title || "[interactive]";
        return {
            content: rawContent,
            interactiveTitle: title,
            messageType: "text",
            mediaUrl: null,
            caption: null,
            isInteractiveReply: true,
            fileName: null,
            mimeType: null,
            referral: null,
        };
    }

    // 2. Resposta a lista (/send-option-list)
    if (body.listResponseMessage) {
        const rowId = body.listResponseMessage.selectedRowId || null;
        const title = body.listResponseMessage.title || body.listResponseMessage.message || null;
        const rawContent = rowId || title || "[interactive]";
        return {
            content: rawContent,
            interactiveTitle: title,
            messageType: "text",
            mediaUrl: null,
            caption: null,
            isInteractiveReply: true,
            fileName: null,
            mimeType: null,
            referral: null,
        };
    }

    // 3. Variações de template buttons
    if (body.hydratedTemplate || body.templateButtonReplyMessage || body.templateButtonReply) {
        const tpl = body.hydratedTemplate || body.templateButtonReplyMessage || body.templateButtonReply;
        const btnId = tpl.buttonId || tpl.selectedButtonId || tpl.selectedId || null;
        const title = tpl.selectedDisplayText || tpl.title || tpl.message || null;
        const rawContent = btnId || title || "[interactive]";
        return {
            content: rawContent,
            interactiveTitle: title,
            messageType: "text",
            mediaUrl: null,
            caption: null,
            isInteractiveReply: true,
            fileName: null,
            mimeType: null,
            referral: null,
        };
    }

    // 4. Mídia
    const mediaUrl = body.image?.imageUrl || body.audio?.audioUrl || body.video?.videoUrl || body.document?.documentUrl || body.sticker?.stickerUrl || null;
    const caption = body.image?.caption || body.video?.caption || body.document?.caption || null;
    // Fase 2 (Arquivos, 2026-08-13): a Z-API expõe o nome original só no objeto
    // `document` — `fileName` é o campo documentado; `title` é um fallback visto
    // em alguns payloads reais. image/audio/video não carregam nome de arquivo.
    const fileName = body.document?.fileName || body.document?.title || null;
    const mimeType = body.document?.mimeType || null;
    let messageType = "text";
    if (body.image) messageType = "image";
    else if (body.audio) messageType = "audio";
    else if (body.video) messageType = "video";
    else if (body.document) messageType = "document";
    else if (body.sticker) messageType = "sticker";

    // 5. Mensagem de texto simples
    const textMsg = body.text?.message || body.message || body.data?.message || null;

    const content = textMsg || caption || (mediaUrl ? `[${messageType}]` : null);

    return {
        content,
        interactiveTitle: null,
        messageType,
        mediaUrl,
        caption,
        isInteractiveReply: false,
        fileName,
        mimeType,
        // Z-API: não confirmado se repassa o `referral` da Meta — lido de forma
        // defensiva (extractReferral nunca lança, retorna null se ausente).
        referral: extractReferral(body),
    };
}

/**
 * Extrai o conteúdo relevante de uma mensagem da WhatsApp Cloud API (Meta).
 */
export function extractCloudApiContent(msg: any): InboundContent {
    if (!msg || typeof msg !== "object") {
        return {
            content: null,
            interactiveTitle: null,
            messageType: "text",
            mediaUrl: null,
            caption: null,
            isInteractiveReply: false,
            fileName: null,
            mimeType: null,
            referral: null,
        };
    }

    const msgType = msg.type;
    let content: string | null = null;
    let interactiveTitle: string | null = null;
    let messageType = "text";
    let mediaUrl: string | null = null;
    let caption: string | null = null;
    let isInteractiveReply = false;
    let fileName: string | null = null;
    let mimeType: string | null = null;

    if (msgType === "interactive") {
        isInteractiveReply = true;
        const interactive = msg.interactive;
        if (interactive?.type === "button_reply") {
            const btn = interactive.button_reply;
            interactiveTitle = btn?.title || null;
            content = btn?.id || interactiveTitle || "[interactive]";
        } else if (interactive?.type === "list_reply") {
            const list = interactive.list_reply;
            interactiveTitle = list?.title || null;
            content = list?.id || interactiveTitle || "[interactive]";
        } else {
            content = "[interactive]";
        }
    } else if (msgType === "button") {
        isInteractiveReply = true;
        interactiveTitle = msg.button?.text || null;
        content = msg.button?.payload || interactiveTitle || "[interactive]";
    } else if (msgType === "text") {
        content = msg.text?.body || null;
    } else if (msgType === "image") {
        mediaUrl = msg.image?.id || null;
        caption = msg.image?.caption || null;
        messageType = "image";
        content = caption || "[imagem]";
    } else if (msgType === "audio") {
        mediaUrl = msg.audio?.id || null;
        messageType = "audio";
        content = "[áudio]";
    } else if (msgType === "video") {
        mediaUrl = msg.video?.id || null;
        caption = msg.video?.caption || null;
        messageType = "video";
        content = caption || "[vídeo]";
    } else if (msgType === "document") {
        mediaUrl = msg.document?.id || null;
        messageType = "document";
        fileName = msg.document?.filename || null;
        mimeType = msg.document?.mime_type || null;
        // Fase 2 (Arquivos, 2026-08-13): a Cloud API expõe caption em document
        // igual expõe em image/video — antes esta linha nunca era lida, então
        // uma legenda mandada junto de um PDF pela Cloud API se perdia.
        caption = msg.document?.caption || null;
        content = caption || fileName || "[documento]";
    } else if (msgType === "sticker") {
        mediaUrl = msg.sticker?.id || null;
        messageType = "sticker";
        content = "[figurinha]";
    } else {
        content = `[${msgType}]`;
    }

    return {
        content,
        interactiveTitle,
        messageType,
        mediaUrl,
        caption,
        isInteractiveReply,
        fileName,
        mimeType,
        // Presente só na 1ª mensagem de uma conversa iniciada por clique de
        // anúncio Click-to-WhatsApp — nunca lançar, extractReferral trata ausência.
        referral: extractReferral(msg),
    };
}
