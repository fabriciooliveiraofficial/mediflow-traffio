import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { extractZapiContent, extractCloudApiContent, extractReferral } from "../../_shared/inboundParser.ts";
import { resolveSlotIdByTitle } from "../../_shared/schedulingTools.ts";
import { resolveTurnLanguage } from "../../_shared/copilot.ts";

Deno.test("inboundParser — Z-API button response", () => {
    const body = {
        buttonsResponseMessage: {
            buttonId: "slot|doc1|loc1|type1|2026-07-22|08:30",
            message: "22/07 · 08:30",
        },
    };
    const parsed = extractZapiContent(body);
    assertEquals(parsed.content, "slot|doc1|loc1|type1|2026-07-22|08:30");
    assertEquals(parsed.interactiveTitle, "22/07 · 08:30");
    assertEquals(parsed.messageType, "text");
    assertEquals(parsed.isInteractiveReply, true);
});

Deno.test("inboundParser — Z-API option list response", () => {
    const body = {
        listResponseMessage: {
            selectedRowId: "slot|doc1|loc1|type1|2026-07-22|09:00",
            title: "22/07 · 09:00",
            message: "Auckland Dental Care",
        },
    };
    const parsed = extractZapiContent(body);
    assertEquals(parsed.content, "slot|doc1|loc1|type1|2026-07-22|09:00");
    assertEquals(parsed.interactiveTitle, "22/07 · 09:00");
    assertEquals(parsed.isInteractiveReply, true);
});

Deno.test("inboundParser — Z-API template button response", () => {
    const body = {
        hydratedTemplate: {
            buttonId: "slot|doc1|loc1|type1|2026-07-22|10:00",
            selectedDisplayText: "22/07 · 10:00",
        },
    };
    const parsed = extractZapiContent(body);
    assertEquals(parsed.content, "slot|doc1|loc1|type1|2026-07-22|10:00");
    assertEquals(parsed.interactiveTitle, "22/07 · 10:00");
    assertEquals(parsed.isInteractiveReply, true);
});

Deno.test("inboundParser — Z-API simple text message", () => {
    const body = {
        text: { message: "Hello, I would like to book an appointment" },
    };
    const parsed = extractZapiContent(body);
    assertEquals(parsed.content, "Hello, I would like to book an appointment");
    assertEquals(parsed.interactiveTitle, null);
    assertEquals(parsed.isInteractiveReply, false);
});

Deno.test("inboundParser — Z-API media image with caption", () => {
    const body = {
        image: { imageUrl: "http://example.com/img.jpg", caption: "Look at this" },
    };
    const parsed = extractZapiContent(body);
    assertEquals(parsed.content, "Look at this");
    assertEquals(parsed.messageType, "image");
    assertEquals(parsed.mediaUrl, "http://example.com/img.jpg");
    assertEquals(parsed.isInteractiveReply, false);
});

Deno.test("inboundParser — Z-API media audio without caption", () => {
    const body = {
        audio: { audioUrl: "http://example.com/audio.mp3" },
    };
    const parsed = extractZapiContent(body);
    assertEquals(parsed.content, "[audio]");
    assertEquals(parsed.messageType, "audio");
    assertEquals(parsed.mediaUrl, "http://example.com/audio.mp3");
});

Deno.test("inboundParser — Z-API sticker", () => {
    const body = {
        sticker: { stickerUrl: "http://example.com/sticker.webp" },
    };
    const parsed = extractZapiContent(body);
    assertEquals(parsed.content, "[sticker]");
    assertEquals(parsed.messageType, "sticker");
});

Deno.test("inboundParser — Z-API interactive reply with empty buttonId but title present", () => {
    const body = {
        buttonsResponseMessage: {
            buttonId: "",
            message: "22/07 · 11:00",
        },
    };
    const parsed = extractZapiContent(body);
    assertEquals(parsed.content, "22/07 · 11:00");
    assertEquals(parsed.interactiveTitle, "22/07 · 11:00");
    assertEquals(parsed.isInteractiveReply, true);
});

Deno.test("inboundParser — Z-API empty payload", () => {
    const parsed = extractZapiContent({});
    assertEquals(parsed.content, null);
    assertEquals(parsed.isInteractiveReply, false);
});

// ── Fase 2 (Arquivos, 2026-08-13) — fileName/mimeType nunca eram capturados;
// o nome do arquivo se perdia no fio inteiro pra Z-API. ─────────────────────

Deno.test("inboundParser — Z-API documento com nome, mime e legenda", () => {
    const body = {
        document: {
            documentUrl: "http://example.com/orcamento.pdf",
            fileName: "orcamento-implante.pdf",
            mimeType: "application/pdf",
            caption: "segue o orçamento",
        },
    };
    const parsed = extractZapiContent(body);
    assertEquals(parsed.messageType, "document");
    assertEquals(parsed.mediaUrl, "http://example.com/orcamento.pdf");
    assertEquals(parsed.fileName, "orcamento-implante.pdf");
    assertEquals(parsed.mimeType, "application/pdf");
    assertEquals(parsed.caption, "segue o orçamento");
    assertEquals(parsed.content, "segue o orçamento");
});

Deno.test("inboundParser — Z-API documento usa 'title' como fallback de fileName", () => {
    const body = {
        document: { documentUrl: "http://example.com/carteirinha.pdf", title: "carteirinha.pdf" },
    };
    const parsed = extractZapiContent(body);
    assertEquals(parsed.fileName, "carteirinha.pdf");
    assertEquals(parsed.mimeType, null);
});

Deno.test("inboundParser — Z-API imagem/áudio nunca têm fileName/mimeType", () => {
    const parsedImg = extractZapiContent({ image: { imageUrl: "http://example.com/a.jpg" } });
    assertEquals(parsedImg.fileName, null);
    assertEquals(parsedImg.mimeType, null);
    const parsedAudio = extractZapiContent({ audio: { audioUrl: "http://example.com/a.ogg" } });
    assertEquals(parsedAudio.fileName, null);
    assertEquals(parsedAudio.mimeType, null);
});

Deno.test("inboundParser — Cloud API button reply", () => {
    const msg = {
        type: "interactive",
        interactive: {
            type: "button_reply",
            button_reply: { id: "slot|doc1|loc1|type1|2026-07-22|08:30", title: "22/07 · 08:30" },
        },
    };
    const parsed = extractCloudApiContent(msg);
    assertEquals(parsed.content, "slot|doc1|loc1|type1|2026-07-22|08:30");
    assertEquals(parsed.interactiveTitle, "22/07 · 08:30");
    assertEquals(parsed.isInteractiveReply, true);
});

Deno.test("inboundParser — Cloud API list reply", () => {
    const msg = {
        type: "interactive",
        interactive: {
            type: "list_reply",
            list_reply: { id: "slot|doc1|loc1|type1|2026-07-22|09:30", title: "22/07 · 09:30" },
        },
    };
    const parsed = extractCloudApiContent(msg);
    assertEquals(parsed.content, "slot|doc1|loc1|type1|2026-07-22|09:30");
    assertEquals(parsed.interactiveTitle, "22/07 · 09:30");
    assertEquals(parsed.isInteractiveReply, true);
});

Deno.test("inboundParser — Cloud API text message", () => {
    const msg = {
        type: "text",
        text: { body: "Can I get a quote?" },
    };
    const parsed = extractCloudApiContent(msg);
    assertEquals(parsed.content, "Can I get a quote?");
    assertEquals(parsed.isInteractiveReply, false);
});

// ── Fase 2 (Arquivos, 2026-08-13) — Cloud API já lia filename (só como
// fallback de content), mas NUNCA lia document.caption: uma legenda mandada
// junto de um PDF pela Cloud API se perdia silenciosamente. ────────────────

Deno.test("inboundParser — Cloud API documento com legenda usa a legenda como content, mas preserva fileName", () => {
    const msg = {
        type: "document",
        document: { id: "media-id-123", filename: "encaminhamento.pdf", mime_type: "application/pdf", caption: "meu encaminhamento" },
    };
    const parsed = extractCloudApiContent(msg);
    assertEquals(parsed.messageType, "document");
    assertEquals(parsed.mediaUrl, "media-id-123");
    assertEquals(parsed.fileName, "encaminhamento.pdf");
    assertEquals(parsed.mimeType, "application/pdf");
    assertEquals(parsed.caption, "meu encaminhamento");
    assertEquals(parsed.content, "meu encaminhamento");
});

Deno.test("inboundParser — Cloud API documento sem legenda cai no filename, depois no marcador genérico", () => {
    const withFilename = extractCloudApiContent({ type: "document", document: { id: "m1", filename: "raio-x.pdf" } });
    assertEquals(withFilename.content, "raio-x.pdf");
    assertEquals(withFilename.caption, null);

    const withoutFilename = extractCloudApiContent({ type: "document", document: { id: "m2" } });
    assertEquals(withoutFilename.content, "[documento]");
    assertEquals(withoutFilename.fileName, null);
});

Deno.test("inboundParser — Cloud API imagem/áudio nunca têm fileName", () => {
    const parsedImg = extractCloudApiContent({ type: "image", image: { id: "m1" } });
    assertEquals(parsedImg.fileName, null);
    assertEquals(parsedImg.mimeType, null);
});

// ── Atribuição de anúncio (Dashboard — Leads Feed, 2026-08-13) — a Meta inclui
// `referral` (source_id/source_type/source_url/ctwa_clid/headline) só na 1ª
// mensagem de uma conversa iniciada por clique de anúncio. Antes desta fase o
// campo chegava e era descartado; o Dashboard fabricava a origem do lead
// (ícone alternando por posição no array, "FORM ADS" fixo). ──────────────────

Deno.test("extractReferral — payload com referral completo", () => {
    const r = extractReferral({ referral: { source_id: "ad-123", source_type: "ad", source_url: "https://fb.me/x", ctwa_clid: "clid-abc", headline: "Avaliação grátis" } });
    assertEquals(r, { sourceId: "ad-123", sourceType: "ad", sourceUrl: "https://fb.me/x", ctwaClid: "clid-abc", headline: "Avaliação grátis" });
});

Deno.test("extractReferral — sem campo referral retorna null (contato orgânico)", () => {
    assertEquals(extractReferral({ text: { body: "oi" } }), null);
    assertEquals(extractReferral({}), null);
    assertEquals(extractReferral(null), null);
    assertEquals(extractReferral(undefined), null);
});

Deno.test("extractReferral — referral malformado (não-objeto) nunca lança, retorna null", () => {
    assertEquals(extractReferral({ referral: "garbage" }), null);
    assertEquals(extractReferral({ referral: 123 }), null);
});

Deno.test("inboundParser — Cloud API texto COM referral de anúncio", () => {
    const msg = {
        type: "text",
        text: { body: "Olá, vi o anúncio de vocês" },
        referral: { source_id: "ad-999", source_type: "ad", ctwa_clid: "clid-xyz", headline: "Implante dentário" },
    };
    const parsed = extractCloudApiContent(msg);
    assertEquals(parsed.content, "Olá, vi o anúncio de vocês");
    assertEquals(parsed.referral?.sourceId, "ad-999");
    assertEquals(parsed.referral?.ctwaClid, "clid-xyz");
    assertEquals(parsed.referral?.headline, "Implante dentário");
});

Deno.test("inboundParser — Cloud API texto SEM referral (contato direto/orgânico) — referral null", () => {
    const msg = { type: "text", text: { body: "Quero agendar uma consulta" } };
    const parsed = extractCloudApiContent(msg);
    assertEquals(parsed.referral, null);
});

Deno.test("inboundParser — Z-API não confirmado se repassa referral, mas lê defensivamente se vier no mesmo formato", () => {
    const withReferral = extractZapiContent({ text: { message: "oi" }, referral: { source_id: "ad-1", source_type: "ad" } });
    assertEquals(withReferral.referral?.sourceId, "ad-1");
    const withoutReferral = extractZapiContent({ text: { message: "oi" } });
    assertEquals(withoutReferral.referral, null);
});

// ─── Tests for resolveSlotIdByTitle ──────────────────────────────────────────

Deno.test("resolveSlotIdByTitle — exact title match", () => {
    const pendingSlots = ["slot|doc1|loc1|type1|2026-07-22|08:30", "slot|doc1|loc1|type1|2026-07-22|09:00"];
    const pendingTitles = ["22/07 · 08:30", "22/07 · 09:00"];
    const result = resolveSlotIdByTitle("22/07 · 08:30", pendingSlots, pendingTitles);
    assertEquals(result, "slot|doc1|loc1|type1|2026-07-22|08:30");
});

Deno.test("resolveSlotIdByTitle — match with description on 2nd line", () => {
    const pendingSlots = ["slot|doc1|loc1|type1|2026-07-22|08:30"];
    const pendingTitles = ["22/07 · 08:30"];
    const result = resolveSlotIdByTitle("22/07 · 08:30\nAuckland Dental Clinic", pendingSlots, pendingTitles);
    assertEquals(result, "slot|doc1|loc1|type1|2026-07-22|08:30");
});

Deno.test("resolveSlotIdByTitle — accent and separator normalization", () => {
    const pendingSlots = ["slot|doc1|loc1|type1|2026-07-22|08:30"];
    const pendingTitles = ["22/07 · 08:30"];
    const result = resolveSlotIdByTitle("22/07 - 08:30", pendingSlots, pendingTitles);
    assertEquals(result, "slot|doc1|loc1|type1|2026-07-22|08:30");
});

Deno.test("resolveSlotIdByTitle — extra spacing differences", () => {
    const pendingSlots = ["slot|doc1|loc1|type1|2026-07-22|08:30"];
    const pendingTitles = ["22/07 · 08:30"];
    const result = resolveSlotIdByTitle("  22/07   08:30  ", pendingSlots, pendingTitles);
    assertEquals(result, "slot|doc1|loc1|type1|2026-07-22|08:30");
});

Deno.test("resolveSlotIdByTitle — missing pendingTitles (derived from slot_id)", () => {
    const pendingSlots = ["slot|doc1|loc1|type1|2026-07-22|08:30"];
    const result = resolveSlotIdByTitle("22/07 · 08:30", pendingSlots, undefined);
    assertEquals(result, "slot|doc1|loc1|type1|2026-07-22|08:30");
});

Deno.test("resolveSlotIdByTitle — title not in list returns null", () => {
    const pendingSlots = ["slot|doc1|loc1|type1|2026-07-22|08:30"];
    const pendingTitles = ["22/07 · 08:30"];
    const result = resolveSlotIdByTitle("25/07 · 14:00", pendingSlots, pendingTitles);
    assertEquals(result, null);
});

Deno.test("resolveSlotIdByTitle — empty pendingSlots returns null", () => {
    const result = resolveSlotIdByTitle("22/07 · 08:30", [], []);
    assertEquals(result, null);
});

Deno.test("resolveSlotIdByTitle — arbitrary free text returns null", () => {
    const pendingSlots = ["slot|doc1|loc1|type1|2026-07-22|08:30"];
    const pendingTitles = ["22/07 · 08:30"];
    const result = resolveSlotIdByTitle("I prefer afternoon appointments", pendingSlots, pendingTitles);
    assertEquals(result, null);
});

// ─── Tests for resolveTurnLanguage ─────────────────────────────────────────

Deno.test("resolveTurnLanguage — 1st turn in English without stored language -> en", () => {
    const lang = resolveTurnLanguage("Hello, I would like to check prices for dental implants", undefined);
    assertEquals(lang, "en");
});

Deno.test("resolveTurnLanguage — 1st turn in Spanish without stored language -> es", () => {
    const lang = resolveTurnLanguage("Hola buenos dias, necesito una cita de limpieza", undefined);
    assertEquals(lang, "es");
});

Deno.test("resolveTurnLanguage — 1st turn in Portuguese without stored language -> pt", () => {
    const lang = resolveTurnLanguage("Olá, quanto custa a avaliação?", undefined);
    assertEquals(lang, "pt");
});

Deno.test("resolveTurnLanguage — short greeting 'hi' -> en", () => {
    const lang = resolveTurnLanguage("hi", undefined);
    assertEquals(lang, "en");
});

Deno.test("resolveTurnLanguage — short greeting 'hello' -> en", () => {
    const lang = resolveTurnLanguage("hello", undefined);
    assertEquals(lang, "en");
});

Deno.test("resolveTurnLanguage — short phrase 'good morning' -> en", () => {
    const lang = resolveTurnLanguage("good morning", undefined);
    assertEquals(lang, "en");
});

Deno.test("resolveTurnLanguage — short phrase 'hola' -> es", () => {
    const lang = resolveTurnLanguage("hola", undefined);
    assertEquals(lang, "es");
});

Deno.test("resolveTurnLanguage — short phrase 'oi' -> pt", () => {
    const lang = resolveTurnLanguage("oi", undefined);
    assertEquals(lang, "pt");
});

Deno.test("resolveTurnLanguage — 'ok' with storedLanguage=en -> en (fallback)", () => {
    const lang = resolveTurnLanguage("ok", "en");
    assertEquals(lang, "en");
});

Deno.test("resolveTurnLanguage — explicit language switch in mid-conversation (es) -> es", () => {
    const lang = resolveTurnLanguage("gracias por todo", "en");
    assertEquals(lang, "es");
});

Deno.test("resolveTurnLanguage — ambiguous query uses stored language fallback", () => {
    const lang = resolveTurnLanguage("123", "es");
    assertEquals(lang, "es");
});

Deno.test("resolveTurnLanguage — time string uses stored language fallback", () => {
    const lang = resolveTurnLanguage("08:30", "en");
    assertEquals(lang, "en");
});

// Regressão real (achada pelo eval multi-turno conversation.ts, 2026-07-21):
// "horarios" sem acento é ortografia espanhola válida; o hint de pt aceitava
// "horarios" (acento opcional) e colidia com o hint de es ("mañana") na MESMA
// mensagem → ambíguo → caía no idioma armazenado ("en"), nunca detectava a
// troca para es. Mesma classe de bug do B2 (idioma do turno anterior vazando
// pro turno seguinte), só que via colisão de regex em vez de timing.
Deno.test("resolveTurnLanguage — 'horarios' (sem acento) + 'mañana' não é ambíguo — es vence", () => {
    const lang = resolveTurnLanguage("perdón, prefiero seguir en español a partir de ahora, ¿tienen horarios en la mañana?", "en");
    assertEquals(lang, "es");
});
