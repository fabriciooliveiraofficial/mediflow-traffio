/**
 * confirmation_test — E-2 (2026-07-31, teste de estresse).
 *
 * REGRA DE PRODUTO travada aqui: a confirmação de agendamento é SEMPRE, e
 * exclusivamente, a mensagem que o tenant personalizou em Notificações →
 * Confirmação de Agendamento. Nem a plataforma nem o agente têm autorização
 * para enviar texto próprio. A plataforma só substitui as variáveis e entrega
 * preservando ícones e quebras de linha; havendo imagem, tudo vai numa ÚNICA
 * mensagem com o texto como legenda.
 *
 * O que quebrou em produção: o bundle publicado era anterior a essa fiação e
 * enviou um texto escrito no código ("Prontinho, Fabricio! …📝 Detalhes do
 * Agendamento…"). Aqueles textos foram removidos do repositório; estes testes
 * garantem que nenhum volte.
 */
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
    buildBookingConfirmation,
    confirmationDoctorTitle,
    confirmationMapsUrl,
    dispatchBookingConfirmation,
    pickBookingTemplate,
} from "../../_shared/schedulingTools.ts";

const CAPTION_PT = "Olá {{nome_paciente}}! 😊\nSeu agendamento está confirmado.\n\n📅 Data: {{data_agendamento}}\n🕒 Horário: {{horario_agendamento}}\n📍 Local: {{nome_local}}\n🗺️ Como Chegar: {{link_endereco}}";
const CAPTION_EN = "Hi {{nome_paciente}}! 😊\nYour appointment is confirmed.\n\n📅 Date: {{data_agendamento}}\n🕒 Time: {{horario_agendamento}}";

function mockSupabase(opts: {
    botConfig?: any;
    patientName?: string | null;
    locationName?: string;
    locationMapsUrl?: string;
    clinicInfoAddress?: string | null;
} = {}) {
    const chainable = (item: any) => {
        const obj: any = {
            eq: () => obj, in: () => obj, or: () => obj, ilike: () => obj, gte: () => obj,
            not: () => obj, limit: () => obj, order: () => obj, select: () => obj,
            single: async () => ({ data: item, error: null }),
            maybeSingle: async () => ({ data: item, error: null }),
            then: (resolve: any) => resolve({ data: item ? [item] : [], error: null }),
        };
        return obj;
    };
    return {
        from: (table: string) => {
            if (table === "tenants") {
                return { select: () => chainable({ name: "Auckland Dental", whatsapp_phone: "64211111111", bot_config: opts.botConfig ?? null }) };
            }
            if (table === "locations") {
                return { select: () => chainable({ name: opts.locationName ?? "Auckland Dental Care", google_maps_url: opts.locationMapsUrl ?? null }) };
            }
            if (table === "patients") {
                return { select: () => chainable({ full_name: opts.patientName === undefined ? "Fabricio Oliveira" : opts.patientName }) };
            }
            if (table === "clinic_info") {
                const v = opts.clinicInfoAddress;
                return { select: () => chainable(v ? { value: v } : null) };
            }
            return { select: () => chainable(null) };
        },
    };
}

/** Dispatcher que grava os payloads enviados, para provar "uma única mensagem". */
function mockDispatcher() {
    const sent: any[] = [];
    const queued: any[] = [];
    return {
        sent, queued,
        sendNow: async (_t: any, _p: string, payload: any) => { sent.push(payload); },
        enqueue: async (_tid: string, _p: string, payload: any) => { queued.push(payload); },
    };
}

const BOOKING = { id: "apt-1", date: "2026-08-01", start_time: "08:30", location_id: "loc-1" };

// ── pickBookingTemplate: idioma do lead manda, e nunca cai num texto nosso ──

Deno.test("pickBookingTemplate: idioma do LEAD vence o idioma padrão do tenant", () => {
    const captions = { pt: CAPTION_PT, en: CAPTION_EN };
    assertEquals(pickBookingTemplate(captions, "en", "pt"), CAPTION_EN);
    assertEquals(pickBookingTemplate(captions, "pt", "en"), CAPTION_PT);
});

Deno.test("pickBookingTemplate: idioma do lead em branco cai no idioma padrão do TENANT, nunca em texto da plataforma", () => {
    const captions = { pt: CAPTION_PT, en: "   ", es: "" };
    assertEquals(pickBookingTemplate(captions, "en", "pt"), CAPTION_PT);
    assertEquals(pickBookingTemplate(captions, "es", "pt"), CAPTION_PT);
});

Deno.test("pickBookingTemplate: nada configurado → null (a plataforma não inventa mensagem)", () => {
    assertEquals(pickBookingTemplate(null, "pt", "pt"), null);
    assertEquals(pickBookingTemplate(undefined, "pt", null), null);
    assertEquals(pickBookingTemplate({ pt: "", en: "  ", es: "" }, "pt", "pt"), null);
});

// ── buildBookingConfirmation: só substitui variáveis, preserva a estrutura ──

Deno.test("buildBookingConfirmation: entrega o texto do tenant com variáveis substituídas e quebras de linha preservadas", async () => {
    const supa = mockSupabase({
        botConfig: { booking_confirmation_captions: { pt: CAPTION_PT } },
        clinicInfoAddress: "9 Anzac Street, Takapuna: https://maps.app.goo.gl/oqJJ6j",
    });
    const res = await buildBookingConfirmation(supa as any, "tenant-1", BOOKING, "Fabricio Pacheco", "pat-1", "pt");
    assert(res);
    assertStringIncludes(res!.text, "Olá Fabricio! 😊");
    assertStringIncludes(res!.text, "📅 Data: 01/08/2026");
    assertStringIncludes(res!.text, "📍 Local: Auckland Dental Care");
    assertStringIncludes(res!.text, "🗺️ Como Chegar: https://maps.app.goo.gl/oqJJ6j");
    // Estrutura do tenant preservada (linhas separadas, não amontoadas).
    assert(res!.text.split("\n").length >= 6);
    // Nenhum texto nosso foi adicionado.
    assert(!res!.text.includes("Detalhes do Agendamento"));
    assert(!res!.text.includes("Prontinho"));
});

Deno.test("buildBookingConfirmation: idioma do lead escolhe o template (EN para lead em inglês)", async () => {
    const supa = mockSupabase({
        botConfig: { booking_confirmation_captions: { pt: CAPTION_PT, en: CAPTION_EN }, notification_locale: "pt" },
    });
    const res = await buildBookingConfirmation(supa as any, "tenant-1", BOOKING, "Fabricio Pacheco", "pat-1", "en");
    assert(res);
    assertStringIncludes(res!.text, "Your appointment is confirmed.");
    assertStringIncludes(res!.text, "📅 Date: 08/01/2026");  // formato EN
    assert(!res!.text.includes("Seu agendamento"));
});

Deno.test("buildBookingConfirmation: tenant sem mensagem configurada → null (nada é enviado)", async () => {
    const supa = mockSupabase({ botConfig: { booking_confirmation_captions: {} } });
    assertEquals(await buildBookingConfirmation(supa as any, "tenant-1", BOOKING, "Ana", "pat-1", "pt"), null);

    const semBotConfig = mockSupabase({ botConfig: null });
    assertEquals(await buildBookingConfirmation(semBotConfig as any, "tenant-1", BOOKING, "Ana", "pat-1", "pt"), null);
});

Deno.test("buildBookingConfirmation: {{link_endereco}} vem de Logística e acesso; locations só como rede de segurança", async () => {
    const daInteligencia = mockSupabase({
        botConfig: { booking_confirmation_captions: { pt: "Link: {{link_endereco}}" } },
        clinicInfoAddress: "Rua X: https://maps.app.goo.gl/DA-INTELIGENCIA",
        locationMapsUrl: "https://maps.app.goo.gl/DE-LOCATIONS",
    });
    const a = await buildBookingConfirmation(daInteligencia as any, "tenant-1", BOOKING, null, "pat-1", "pt");
    assertStringIncludes(a!.text, "DA-INTELIGENCIA");

    const semLinkNaInteligencia = mockSupabase({
        botConfig: { booking_confirmation_captions: { pt: "Link: {{link_endereco}}" } },
        clinicInfoAddress: "Rua X, sem link",
        locationMapsUrl: "https://maps.app.goo.gl/DE-LOCATIONS",
    });
    const b = await buildBookingConfirmation(semLinkNaInteligencia as any, "tenant-1", BOOKING, null, "pat-1", "pt");
    assertStringIncludes(b!.text, "DE-LOCATIONS");
});

Deno.test("buildBookingConfirmation: imagem configurada volta junto do texto", async () => {
    const supa = mockSupabase({
        botConfig: {
            booking_confirmation_captions: { pt: CAPTION_PT },
            booking_confirmation_image_url: "https://cdn.example.com/capa.png",
        },
    });
    const res = await buildBookingConfirmation(supa as any, "tenant-1", BOOKING, "Ana Souza", "pat-1", "pt");
    assertEquals(res!.imageUrl, "https://cdn.example.com/capa.png");
});

// ── dispatchBookingConfirmation: SEMPRE uma única mensagem ──

Deno.test("dispatchBookingConfirmation: com imagem envia UMA mensagem — imagem + texto inteiro como legenda", async () => {
    const d = mockDispatcher();
    await dispatchBookingConfirmation(
        d as any, { id: "tenant-1" }, "tenant-1", "5511999999999",
        { text: "Linha 1\nLinha 2\nLinha 3", imageUrl: "https://cdn.example.com/capa.png" },
    );
    assertEquals(d.sent.length, 1, "o paciente deve ver um único bloco");
    assertEquals(d.sent[0].media_url, "https://cdn.example.com/capa.png");
    assertEquals(d.sent[0].media_type, "image");
    assertEquals(d.sent[0].caption, "Linha 1\nLinha 2\nLinha 3");
});

Deno.test("dispatchBookingConfirmation: sem imagem envia UMA mensagem de texto, sem mídia", async () => {
    const d = mockDispatcher();
    await dispatchBookingConfirmation(
        d as any, { id: "tenant-1" }, "tenant-1", "5511999999999",
        { text: "Confirmado!", imageUrl: null },
    );
    assertEquals(d.sent.length, 1);
    assertEquals(d.sent[0].text, "Confirmado!");
    assertEquals(d.sent[0].media_url, undefined);
});

Deno.test("dispatchBookingConfirmation: falha no envio síncrono cai na fila com o MESMO payload (não perde a confirmação)", async () => {
    const queued: any[] = [];
    const failing = {
        sendNow: async () => { throw new Error("z-api fora do ar"); },
        enqueue: async (_tid: string, _p: string, payload: any) => { queued.push(payload); },
    };
    await dispatchBookingConfirmation(
        failing as any, { id: "tenant-1" }, "tenant-1", "5511999999999",
        { text: "Confirmado!", imageUrl: "https://cdn.example.com/capa.png" },
    );
    assertEquals(queued.length, 1);
    assertEquals(queued[0].caption, "Confirmado!");
});

// ── Helpers que continuam em uso ──

Deno.test("confirmationDoctorTitle: prefixa Dr. quando falta título e não duplica quando já existe", () => {
    assertEquals(confirmationDoctorTitle("Fabricio Pacheco"), "Dr. Fabricio Pacheco");
    assertEquals(confirmationDoctorTitle("Dr. Fabricio Pacheco"), "Dr. Fabricio Pacheco");
    assertEquals(confirmationDoctorTitle("Dra. Ana Souza"), "Dra. Ana Souza");
});

Deno.test("confirmationMapsUrl: usa google_maps_url; sem link salvo constrói busca; nada → null", () => {
    assertEquals(confirmationMapsUrl({ google_maps_url: "https://maps.app.goo.gl/abc" }), "https://maps.app.goo.gl/abc");
    const url = confirmationMapsUrl({ address: "Av. Central", address_number: "100" });
    assertStringIncludes(url!, "google.com/maps/search");
    assertEquals(confirmationMapsUrl({}), null);
});

// ── Guarda de regressão: nenhum texto de confirmação pode voltar ao código ──

Deno.test("GUARDA: schedulingTools.ts não contém nenhuma mensagem de confirmação escrita no código", async () => {
    const raw = await Deno.readTextFile(new URL("../../_shared/schedulingTools.ts", import.meta.url));
    // Comentários podem (e devem) citar os nomes removidos para explicar a
    // regra; o que não pode voltar é CÓDIGO com texto de confirmação.
    const src = raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
    const proibidos = [
        "Seu agendamento foi confirmado com sucesso",
        "Seu agendamento foi realizado com sucesso",
        "successfully booked",
        "Sua consulta está agendada para",
        "Detalhes do Agendamento:",
        "CONFIRMATION_GREETING",
        "DEFAULT_BOOKING_CAPTIONS",
        "SLOT_CONFIRM_MSG",
    ];
    for (const termo of proibidos) {
        assert(
            !src.includes(termo),
            `"${termo}" voltou ao código — a confirmação só pode vir do campo personalizado do tenant`,
        );
    }
});
