import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { extractZapiContent, extractCloudApiContent } from "../../_shared/inboundParser.ts";
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
