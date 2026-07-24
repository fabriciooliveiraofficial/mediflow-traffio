/**
 * pipeline_test.ts — Onda 4.1: evals que enxergam o PIPELINE, não só a função isolada.
 *
 * Fixtures de payload de webhook REAL (Z-API/Cloud API) → conteúdo extraído →
 * rota que o process-inbox tomaria. Puro, sem rede, sem banco, roda sem
 * ANTHROPIC_API_KEY.
 *
 * Motivação: o bug B1 (2026-07-21) — clique em botão de horário nunca chegava
 * ao paciente — não foi pego por nenhum teste unitário existente, porque cada
 * peça (extractZapiContent, parseSlotClick) tinha teste próprio e passava
 * isoladamente. O bug só existia na COSTURA entre os dois: o webhook lia
 * campos que a Z-API nunca envia. Este arquivo testa a costura.
 *
 * Regra do projeto (docs/SPEC_AGENTE_IA_CLAUDE.md): mudou webhook, parser ou
 * roteamento → esta suíte roda antes do deploy.
 */
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { extractZapiContent, extractCloudApiContent } from "../../_shared/inboundParser.ts";
import { parseSlotClick, resolveSlotIdByTitle, isPendingSlotsFresh } from "../../_shared/schedulingTools.ts";

type Route = "structured_flow" | "no_match" | "ignored";

interface PipelineFixture {
    name: string;
    /** Payload cru como o provedor realmente envia. */
    webhookPayload: any;
    provider: "zapi" | "cloud_api";
    /** Estado da sessão no momento do turno (o que importa para o roteamento). */
    sessionContext?: { pending_slots?: string[]; pending_slot_titles?: string[]; pending_slots_at?: string | null };
    /** Rota esperada ao final da costura webhook → parser → pré-filtro estruturado. */
    expectedRoute: Route;
    /** Quando expectedRoute === "structured_flow", o slot_id que deveria casar. */
    expectedSlotId?: string;
}

const FIXTURES: PipelineFixture[] = [
    // ── B1: o caso que quebrou em produção (2026-07-21) ──────────────────────
    {
        name: "B1 — Z-API clique em botão de horário (payload real de /send-button-list)",
        provider: "zapi",
        webhookPayload: {
            instanceId: "3E7A1782ADDED03618F7326225A8F6AC",
            phone: "5511999999999",
            buttonsResponseMessage: {
                buttonId: "slot|doc1|loc1|type1|2026-07-22|08:30",
                message: "22/07 · 08:30",
            },
        },
        sessionContext: {
            pending_slots: ["slot|doc1|loc1|type1|2026-07-22|08:30", "slot|doc1|loc1|type1|2026-07-22|09:00"],
        },
        expectedRoute: "structured_flow",
        expectedSlotId: "slot|doc1|loc1|type1|2026-07-22|08:30",
    },
    {
        name: "Z-API clique em item de lista (payload real de /send-option-list)",
        provider: "zapi",
        webhookPayload: {
            instanceId: "3E7A1782ADDED03618F7326225A8F6AC",
            phone: "5511999999999",
            listResponseMessage: {
                selectedRowId: "slot|doc1|loc1|type1|2026-07-23|14:00",
                title: "23/07 · 14:00",
            },
        },
        sessionContext: {
            pending_slots: ["slot|doc1|loc1|type1|2026-07-23|14:00"],
        },
        expectedRoute: "structured_flow",
        expectedSlotId: "slot|doc1|loc1|type1|2026-07-23|14:00",
    },
    {
        name: "Z-API: provedor só entrega o RÓTULO do botão (id vazio) — fallback por título resolve",
        provider: "zapi",
        webhookPayload: {
            instanceId: "3E7A1782ADDED03618F7326225A8F6AC",
            phone: "5511999999999",
            buttonsResponseMessage: { buttonId: "", message: "22/07 · 08:30" },
        },
        sessionContext: {
            pending_slots: ["slot|doc1|loc1|type1|2026-07-22|08:30"],
            pending_slot_titles: ["22/07 · 08:30"],
            pending_slots_at: new Date().toISOString(),
        },
        expectedRoute: "structured_flow",
        expectedSlotId: "slot|doc1|loc1|type1|2026-07-22|08:30",
    },
    // ── E3 (2026-07-24): TTL dos botões oferecidos ────────────────────────────
    {
        name: "TTL: dígito sobre lista VENCIDA (>1h) não casa — evidência de produção (sessão real achada com pending_slots de 1h+ contendo horários já ocupados por outra pessoa)",
        provider: "zapi",
        webhookPayload: {
            instanceId: "3E7A1782ADDED03618F7326225A8F6AC",
            phone: "5511999999999",
            text: { message: "1" },
        },
        sessionContext: {
            pending_slots: ["slot|doc1|loc1|type1|2026-07-22|08:30"],
            pending_slots_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(), // 90min atrás
        },
        expectedRoute: "no_match",
    },
    {
        name: "TTL: dígito sobre lista FRESCA (<1h) casa normalmente",
        provider: "zapi",
        webhookPayload: {
            instanceId: "3E7A1782ADDED03618F7326225A8F6AC",
            phone: "5511999999999",
            text: { message: "1" },
        },
        sessionContext: {
            pending_slots: ["slot|doc1|loc1|type1|2026-07-22|08:30"],
            pending_slots_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5min atrás
        },
        expectedRoute: "structured_flow",
        expectedSlotId: "slot|doc1|loc1|type1|2026-07-22|08:30",
    },
    {
        name: "TTL: título sobre lista VENCIDA não casa (fallback por título desligado)",
        provider: "zapi",
        webhookPayload: {
            instanceId: "3E7A1782ADDED03618F7326225A8F6AC",
            phone: "5511999999999",
            buttonsResponseMessage: { buttonId: "", message: "22/07 · 08:30" },
        },
        sessionContext: {
            pending_slots: ["slot|doc1|loc1|type1|2026-07-22|08:30"],
            pending_slot_titles: ["22/07 · 08:30"],
            pending_slots_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h atrás
        },
        expectedRoute: "no_match",
    },
    {
        name: "TTL: clique CRU (slot|...) continua casando mesmo com pending_slots vencido — RPC atômico revalida depois",
        provider: "zapi",
        webhookPayload: {
            instanceId: "3E7A1782ADDED03618F7326225A8F6AC",
            phone: "5511999999999",
            buttonsResponseMessage: { buttonId: "slot|doc1|loc1|type1|2026-07-22|08:30", message: "22/07 · 08:30" },
        },
        sessionContext: {
            pending_slots: ["slot|doc1|loc1|type1|2026-07-22|08:30"],
            pending_slots_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h atrás
        },
        expectedRoute: "structured_flow",
        expectedSlotId: "slot|doc1|loc1|type1|2026-07-22|08:30",
    },
    {
        name: "Cloud API: clique em botão (payload real da Meta)",
        provider: "cloud_api",
        webhookPayload: {
            type: "interactive",
            interactive: {
                type: "button_reply",
                button_reply: { id: "slot|doc9|loc9|type9|2026-08-01|10:00", title: "01/08 · 10:00" },
            },
        },
        sessionContext: {
            pending_slots: ["slot|doc9|loc9|type9|2026-08-01|10:00"],
        },
        expectedRoute: "structured_flow",
        expectedSlotId: "slot|doc9|loc9|type9|2026-08-01|10:00",
    },
    // ── Não devem casar como clique de horário ────────────────────────────────
    {
        name: "Texto livre do paciente não casa com structured_flow mesmo com slots pendentes",
        provider: "zapi",
        webhookPayload: {
            instanceId: "3E7A1782ADDED03618F7326225A8F6AC",
            phone: "5511999999999",
            text: { message: "hi, i need more information about dental implants please" },
        },
        sessionContext: {
            pending_slots: ["slot|doc1|loc1|type1|2026-07-22|08:30"],
            pending_slot_titles: ["22/07 · 08:30"],
        },
        expectedRoute: "no_match",
    },
    {
        name: "Clique de botão sem nenhum pending_slots na sessão (correlação expirada) — não inventa match",
        provider: "zapi",
        webhookPayload: {
            instanceId: "3E7A1782ADDED03618F7326225A8F6AC",
            phone: "5511999999999",
            buttonsResponseMessage: { buttonId: "slot|doc1|loc1|type1|2026-07-22|08:30", message: "22/07 · 08:30" },
        },
        sessionContext: {},
        expectedRoute: "structured_flow", // parseSlotClick por si só ainda reconhece o formato — a
        // reautorização de tenant/paciente acontece depois, no executor real (fora do escopo deste
        // teste de parsing). O que garantimos aqui é que o slot_id chega intacto até esse ponto.
        expectedSlotId: "slot|doc1|loc1|type1|2026-07-22|08:30",
    },
    // ── Webhook vazio/malformado nunca deve crashar o parser ──────────────────
    {
        name: "Z-API payload vazio não derruba o parser",
        provider: "zapi",
        webhookPayload: {},
        expectedRoute: "ignored",
    },
    {
        name: "Cloud API mensagem de status (sem 'messages') não é conteúdo de paciente",
        provider: "cloud_api",
        webhookPayload: { type: "unknown_status_event" },
        expectedRoute: "no_match", // extractCloudApiContent devolve `[unknown_status_event]` como
        // conteúdo — o pré-filtro estruturado não casa; cai no roteamento normal (agente/humano).
    },
];

function runFixture(f: PipelineFixture): { route: Route; slotId: string | null } {
    const parsed = f.provider === "zapi"
        ? extractZapiContent(f.webhookPayload)
        : extractCloudApiContent(f.webhookPayload);

    if (!parsed.content && !parsed.isInteractiveReply) {
        return { route: "ignored", slotId: null };
    }

    const pendingSlots = f.sessionContext?.pending_slots ?? [];
    const pendingTitles = f.sessionContext?.pending_slot_titles;
    const pendingSlotsFresh = isPendingSlotsFresh(f.sessionContext?.pending_slots_at);

    // Espelha a ordem exata de structuredFlow.ts: dígito (só se pending_slots
    // estiver FRESCO — TTL, E3) → id cru → fallback por título (idem, só se
    // fresco). Um clique CRU em "slot|..." nunca passa pelo TTL.
    let clickContent = parsed.content ?? "";
    const digitMatch = clickContent.trim().match(/^([1-9])[.)]?$/);
    if (pendingSlotsFresh && digitMatch && pendingSlots.length > 0) {
        const idx = parseInt(digitMatch[1], 10) - 1;
        if (idx < pendingSlots.length) clickContent = pendingSlots[idx];
    }
    if (!clickContent.startsWith("slot|") && pendingSlotsFresh) {
        const byTitle = resolveSlotIdByTitle(clickContent, pendingSlots, pendingTitles);
        if (byTitle) clickContent = byTitle;
    }
    const slotClick = parseSlotClick(clickContent);

    if (slotClick) {
        const slotId = `slot|${slotClick.doctor_id}|${slotClick.location_id}|${slotClick.type_id ?? ""}|${slotClick.date}|${slotClick.time}`;
        return { route: "structured_flow", slotId };
    }

    return { route: "no_match", slotId: null };
}

for (const fixture of FIXTURES) {
    Deno.test(`pipeline: ${fixture.name}`, () => {
        const result = runFixture(fixture);
        assertEquals(result.route, fixture.expectedRoute, `rota esperada "${fixture.expectedRoute}", obtida "${result.route}"`);
        if (fixture.expectedSlotId) {
            assertEquals(result.slotId, fixture.expectedSlotId);
        }
    });
}

Deno.test("pipeline: regressão B1 fechada — o payload exato do incidente de produção nunca mais silencia", () => {
    // Payload capturado do incidente real: Z-API /send-button-list, paciente
    // respondendo à oferta de horário do agente autônomo (2026-07-21).
    const productionPayload = {
        instanceId: "3E7A1782ADDED03618F7326225A8F6AC",
        phone: "14049257024",
        buttonsResponseMessage: {
            buttonId: "slot|d0c70r00-0000-0000-0000-000000000001|10ca7100-0000-0000-0000-000000000001||2026-07-22|09:30",
            message: "22/07 · 09:30",
        },
    };
    const parsed = extractZapiContent(productionPayload);
    // Esta é a asserção que teria falhado antes do fix: content vinha null,
    // isInteractiveReply vinha false, e o webhook respondia "Empty event".
    assertEquals(parsed.isInteractiveReply, true);
    assertEquals(parsed.content, "slot|d0c70r00-0000-0000-0000-000000000001|10ca7100-0000-0000-0000-000000000001||2026-07-22|09:30");

    const slotClick = parseSlotClick(parsed.content);
    assertEquals(slotClick?.date, "2026-07-22");
    assertEquals(slotClick?.time, "09:30");
});
