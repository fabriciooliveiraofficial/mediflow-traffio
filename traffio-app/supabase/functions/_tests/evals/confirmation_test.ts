/**
 * confirmation_test — trava o formato da CONFIRMAÇÃO de agendamento
 * (pedido do usuário, 2026-07-23): título do Dr., data, hora, contato, local e
 * link do Maps, num bloco amigável com emojis que o agente copia verbatim. E
 * garante que esse bloco NÃO é rejeitado pelo validador de emoji.
 */
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { buildConfirmationBlock, confirmationDoctorTitle, confirmationMapsUrl, CONFIRMATION_GREETING } from "../../_shared/schedulingTools.ts";
import { countDecorativeEmoji, validateAgentReply } from "../../_shared/copilot.ts";

const CLOCK_12H: any = { timezone: "Pacific/Auckland", timeFormat: "12h", locale: "en-NZ", today: "2026-07-23", now: "10:00" };
const CLOCK_24H: any = { timezone: "America/Sao_Paulo", timeFormat: "24h", locale: "pt-BR", today: "2026-07-23", now: "10:00" };

Deno.test("confirmationDoctorTitle: prefixa Dr. quando falta título", () => {
    assertEquals(confirmationDoctorTitle("Fabricio Pacheco"), "Dr. Fabricio Pacheco");
});

Deno.test("confirmationDoctorTitle: não duplica título já presente (Dr./Dra.)", () => {
    assertEquals(confirmationDoctorTitle("Dr. Fabricio Pacheco"), "Dr. Fabricio Pacheco");
    assertEquals(confirmationDoctorTitle("Dra. Ana Souza"), "Dra. Ana Souza");
});

Deno.test("confirmationMapsUrl: usa google_maps_url quando presente", () => {
    assertEquals(confirmationMapsUrl({ google_maps_url: "https://maps.app.goo.gl/abc" }), "https://maps.app.goo.gl/abc");
});

Deno.test("confirmationMapsUrl: sem link salvo, constrói busca pelo endereço; nada → null", () => {
    const url = confirmationMapsUrl({ address: "Av. Central", address_number: "100", address_neighborhood: "Centro" });
    assertStringIncludes(url!, "google.com/maps/search");
    assertStringIncludes(url!, encodeURIComponent("Av. Central"));
    assertEquals(confirmationMapsUrl({}), null);
});

Deno.test("buildConfirmationBlock: bloco completo em EN com título do Dr., 12h, contato, local e maps", () => {
    const block = buildConfirmationBlock({
        date: "2026-07-24", time: "08:30", doctorName: "Fabricio Pacheco",
        location: { name: "Auckland Dental Care", google_maps_url: "https://maps.app.goo.gl/xyz" },
        contact: "021 088 40919", clock: CLOCK_12H, language: "en",
    });
    assertStringIncludes(block, "*Date:* 07/24/2026");
    assertStringIncludes(block, "*Time:* 08:30 am");           // 12h
    assertStringIncludes(block, "*Doctor:* Dr. Fabricio Pacheco"); // título
    assertStringIncludes(block, "*Contact:* 021 088 40919");
    assertStringIncludes(block, "*Location:* Auckland Dental Care");
    assertStringIncludes(block, "https://maps.app.goo.gl/xyz");
});

Deno.test("buildConfirmationBlock: rótulos localizados em PT + hora 24h", () => {
    const block = buildConfirmationBlock({
        date: "2026-07-24", time: "08:30", doctorName: "Ana Souza",
        location: { name: "Unidade Centro" }, contact: null, clock: CLOCK_24H, language: "pt",
    });
    assertStringIncludes(block, "*Data:* 24/07/2026");
    assertStringIncludes(block, "*Horário:* 08:30");   // 24h, sem am/pm
    assertStringIncludes(block, "*Profissional:* Dr. Ana Souza");
    assert(!block.includes("Contato"), "sem contato, a linha de contato é omitida");
});

Deno.test("buildConfirmationBlock: omite linhas sem dado (local/maps/contato ausentes)", () => {
    const block = buildConfirmationBlock({
        date: "2026-07-24", time: "08:30", doctorName: "Ana Souza",
        location: {}, contact: null, clock: CLOCK_24H, language: "pt",
    });
    assert(!block.includes("Local"));
    assert(!block.includes("Como Chegar"));
    assertStringIncludes(block, "*Profissional:*");
});

Deno.test("CONFIRMATION_GREETING (P3, 2026-07-24): saudação com e sem nome, nos 3 idiomas", () => {
    // EN com nome — bate com o formato do exemplo do usuário.
    assertStringIncludes(CONFIRMATION_GREETING.en("Fabricio"), "Hi Fabricio! 😊");
    assertStringIncludes(CONFIRMATION_GREETING.en("Fabricio"), "successfully booked");
    // Sem nome (placeholder/ausente): saúda sem vírgula solta nem nome vazio.
    assertEquals(CONFIRMATION_GREETING.en(null).startsWith("Hi! 😊"), true);
    assertEquals(CONFIRMATION_GREETING.pt(null).startsWith("Prontinho! 😊"), true);
    assertEquals(CONFIRMATION_GREETING.es(null).startsWith("¡Listo! 😊"), true);
    // Com nome: PT e ES usam vírgula.
    assertStringIncludes(CONFIRMATION_GREETING.pt("Ana"), "Prontinho, Ana! 😊");
    assertStringIncludes(CONFIRMATION_GREETING.es("Ana"), "¡Listo, Ana! 😊");
});

Deno.test("GUARD emoji: o bloco de confirmação NÃO estoura o teto (marcadores são estruturais)", () => {
    const block = "All set! ✅\n\n" + buildConfirmationBlock({
        date: "2026-07-24", time: "08:30", doctorName: "Fabricio Pacheco",
        location: { name: "Auckland Dental Care", google_maps_url: "https://maps.app.goo.gl/xyz", phone: "021" },
        contact: "021 088 40919", clock: CLOCK_12H, language: "en",
    });
    // Só o ✅ de abertura conta como decorativo; 📝📍🗺️☎️👨‍⚕️🕒📅 são estruturais.
    const decorative = countDecorativeEmoji(block);
    assert(decorative <= 3, `esperava <= 3 decorativos, veio ${decorative}`);
    // E passa no validador completo (sem preço, sem horário inventado — a hora está na evidência).
    const violations = validateAgentReply(block, {
        language: "en",
        evidence: block, // a confirmação veio da ferramenta; o horário está na evidência do turno
        policyEvidence: "",
    });
    assertEquals(violations, [], `confirmação não deveria violar nada: ${violations.join(" | ")}`);
});
