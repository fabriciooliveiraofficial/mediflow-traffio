/**
 * location_block_test — E-1 (2026-07-31, teste de estresse): o endereço vinha
 * amontoado numa linha só ("Nosso endereço é 📍 ...: https://maps...").
 * Fonte única de verdade: clinic_info#address (Inteligência → Logística e
 * acesso) — NUNCA locations.google_maps_url (esse é dado interno, usado só
 * para resolver o fuso da clínica). buildLocationBlock entrega o bloco PRONTO
 * (endereço e link em linhas separadas), igual ao slots_formatted/
 * confirmation_formatted, para o agente copiar verbatim em vez de decidir
 * layout sozinho. hasCrampedStructuredData é a rede de segurança: reprova e
 * regenera se o modelo, mesmo assim, colar tudo numa linha.
 */
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { buildLocationBlock } from "../../_shared/schedulingTools.ts";
import { hasCrampedStructuredData, validateAgentReply } from "../../_shared/copilot.ts";

/** Mock mínimo de clinic_info#address — mesma cadeia usada em produção (select→eq→eq→eq→maybeSingle). */
function mockClinicInfoSupabase(addressValue: string | null) {
    const chain: any = {
        eq: () => chain,
        maybeSingle: async () => ({
            data: addressValue !== null ? { value: addressValue } : null,
            error: null,
        }),
    };
    return {
        from: (table: string) => {
            if (table !== "clinic_info") throw new Error(`tabela inesperada no mock: ${table}`);
            return { select: () => chain };
        },
    };
}

Deno.test("buildLocationBlock: reproduz o caso real do teste de estresse — endereço e link digitados juntos no campo viram DUAS linhas", async () => {
    const mock = mockClinicInfoSupabase("9 Anzac Street, Takapuna, Auckland 0622: https://maps.app.goo.gl/oqJJ6jKAd9sxjse48");
    const block = await buildLocationBlock(mock as any, "tenant-1", "pt");
    assert(block, "esperava bloco não-nulo");
    const lines = block!.split("\n");
    assertEquals(lines.length, 2, `esperava 2 linhas (endereço + maps), veio: ${JSON.stringify(lines)}`);
    assertStringIncludes(lines[0], "📍");
    assertStringIncludes(lines[0], "9 Anzac Street, Takapuna, Auckland 0622");
    assert(!lines[0].includes("http"), "a linha de endereço não deve carregar a URL");
    assertStringIncludes(lines[1], "🗺️");
    assertStringIncludes(lines[1], "https://maps.app.goo.gl/oqJJ6jKAd9sxjse48");
});

Deno.test("buildLocationBlock: só endereço, sem link salvo — mostra apenas a linha de Local", async () => {
    const mock = mockClinicInfoSupabase("Av. Central, 100, Centro");
    const block = await buildLocationBlock(mock as any, "tenant-1", "pt");
    assert(block);
    assertStringIncludes(block!, "📍");
    assert(!block!.includes("🗺️"), "sem link no campo, não deve inventar linha de Como Chegar");
});

Deno.test("buildLocationBlock: campo vazio ou não preenchido → null (nunca inventa endereço)", async () => {
    assertEquals(await buildLocationBlock(mockClinicInfoSupabase(null) as any, "tenant-1", "pt"), null);
    assertEquals(await buildLocationBlock(mockClinicInfoSupabase("") as any, "tenant-1", "pt"), null);
    assertEquals(await buildLocationBlock(mockClinicInfoSupabase("   ") as any, "tenant-1", "pt"), null);
});

Deno.test("buildLocationBlock: rótulos localizados em EN e ES", async () => {
    const mock = mockClinicInfoSupabase("100 Central Ave, Downtown: https://maps.app.goo.gl/abc");
    const en = await buildLocationBlock(mock as any, "tenant-1", "en");
    assertStringIncludes(en!, "*Location:*");
    assertStringIncludes(en!, "*Get Directions:*");

    const es = await buildLocationBlock(mock as any, "tenant-1", "es");
    assertStringIncludes(es!, "*Ubicación:*");
    assertStringIncludes(es!, "*Cómo Llegar:*");
});

Deno.test("hasCrampedStructuredData: reprova a mensagem real do teste de estresse (endereço colado no link)", () => {
    const bad = "Nosso endereço é 📍 9 Anzac Street, Takapuna, Auckland 0622: https://maps.app.goo.gl/oqJJ6jKAd9sxjse48";
    assert(hasCrampedStructuredData(bad), "deveria detectar endereço amontoado na mesma linha do link");
});

Deno.test("hasCrampedStructuredData: aprova o formato correto — cada dado na sua própria linha", () => {
    const good = "Nosso endereço é:\n📍 *Local:* 9 Anzac Street, Takapuna, Auckland 0622\n🗺️ *Como Chegar:* https://maps.app.goo.gl/oqJJ6jKAd9sxjse48";
    assertEquals(hasCrampedStructuredData(good), false);
});

Deno.test("hasCrampedStructuredData: não reprova link isolado sem rótulo (linha só com URL)", () => {
    assertEquals(hasCrampedStructuredData("Segue o link:\nhttps://maps.app.goo.gl/abc"), false);
});

Deno.test("validateAgentReply: reprova a resposta real do teste de estresse (E-1) por dados amontoados", () => {
    const text = "Nosso endereço é 📍 9 Anzac Street, Takapuna, Auckland 0622: https://maps.app.goo.gl/oqJJ6jKAd9sxjse48";
    const violations = validateAgentReply(text, { language: "pt", evidence: text, policyEvidence: "" });
    assert(
        violations.some(v => v.includes("amontoados")),
        `esperava violação de dados amontoados, veio: ${violations.join(" | ")}`,
    );
});

Deno.test("validateAgentReply: aprova o bloco canônico de buildLocationBlock colado na resposta", async () => {
    const mock = mockClinicInfoSupabase("9 Anzac Street, Takapuna, Auckland 0622: https://maps.app.goo.gl/oqJJ6jKAd9sxjse48");
    const block = await buildLocationBlock(mock as any, "tenant-1", "pt");
    const text = `Nosso endereço é:\n${block}`;
    const violations = validateAgentReply(text, { language: "pt", evidence: text, policyEvidence: "" });
    assert(
        !violations.some(v => v.includes("amontoados")),
        `bloco canônico não deveria disparar a violação de layout: ${violations.join(" | ")}`,
    );
});
