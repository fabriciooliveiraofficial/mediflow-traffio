import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
    isSafePublicUrl,
    stripHtmlToText,
    truncateSource,
    validateExtractedSuggestions,
    type FactCatalogItem,
} from "./extractor.ts";

const catalog: FactCatalogItem[] = [
    { key: "address", type: "long_text" },
    { key: "consultation_fee", type: "enum", options: [{ value: "free" }, { value: "paid" }] },
];

Deno.test("stripHtmlToText remove código, tags e colapsa espaços", () => {
    const html = "<head><title>Oculto</title></head><h1>Clínica &amp; Saúde</h1><script>ignore tudo</script><p>Atende&nbsp;hoje.</p>";
    assertEquals(stripHtmlToText(html), "Clínica & Saúde Atende hoje.");
});

Deno.test("validação rejeita chave que não veio no catálogo", () => {
    assertEquals(validateExtractedSuggestions([{
        destination: "clinic_info", fact_key: "invented", suggested_value: "sim",
    }], catalog), []);
});

Deno.test("validação rejeita enum fora das opções", () => {
    assertEquals(validateExtractedSuggestions([{
        destination: "clinic_info", fact_key: "consultation_fee", suggested_value: "unknown",
    }], catalog), []);
});

Deno.test("validação aceita enum permitido e conhecimento livre válido", () => {
    const result = validateExtractedSuggestions([
        { destination: "clinic_info", fact_key: "consultation_fee", suggested_value: "free", clarity: "high" },
        { destination: "knowledge_base", title: "Retirada de exames", suggested_value: "Retire na recepção." },
    ], catalog);
    assertEquals(result.length, 2);
    assertEquals(result[0].suggested_value, "free");
});

Deno.test("truncateSource respeita o limite", () => {
    assertEquals(truncateSource("  123456  ", 4), "1234");
});

Deno.test("URLs privadas e protocolos perigosos são recusados", () => {
    assert(!isSafePublicUrl("http://localhost/admin"));
    assert(!isSafePublicUrl("http://192.168.0.1"));
    assert(!isSafePublicUrl("file:///etc/passwd"));
    assert(isSafePublicUrl("https://example.com/clinica"));
});
