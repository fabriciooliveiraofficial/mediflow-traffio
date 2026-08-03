/**
 * emailHeaderSafety_test — E-6 (2026-08-02, teste de estresse). O lembrete
 * chegou por e-mail com sucesso (roteamento corrigido), mas o e-mail em si
 * veio ilegível: o cabeçalho Assunto cortado no meio da palavra
 * ("...Dental Test 4 Clin=") e o corpo MIME inteiro aparecendo como texto
 * cru na caixa de entrada.
 *
 * Causa raiz confirmada no código-fonte do denomailer (dependência de
 * terceiros, config/mail/encoding.ts): quotedPrintableEncodeInline codifica
 * Subject/From não-ASCII reaproveitando quotedPrintableEncode — a MESMA
 * função usada para o CORPO do e-mail, que quebra a cada 74 caracteres no
 * estilo quoted-printable. Cabeçalhos (RFC 2822/2047) têm regra de dobra
 * diferente (linha de continuação precisa começar com espaço, e cada
 * fragmento do encoded-word precisa ser reaberto) — a função não faz isso.
 * Resultado: assunto com acento (ex.: "Recordatorio de cita — ... | Dental
 * Test 4 Clinica") quebra sem fechar o encoded-word, o parser do lado do
 * destinatário perde a fronteira entre cabeçalho e corpo, e a mensagem
 * inteira vira texto cru.
 *
 * A função também re-codifica QUALQUER string que já comece com "=?" — não
 * dá para contornar pré-codificando manualmente (pioraria: dupla
 * codificação). A única saída sem depender de correção upstream é nunca
 * deixar caractere não-ASCII chegar a um cabeçalho.
 */
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { asciiSafeHeaderText } from "../../_shared/emailClient.ts";

Deno.test("asciiSafeHeaderText: reproduz o assunto REAL do teste de estresse — some com o acento/travessão, texto continua legível", () => {
    const original = "Recordatorio de cita — 03/08/2026 a las 09:00 | Dental Test 4 Clinica";
    const safe = asciiSafeHeaderText(original);
    assertEquals(/^[\x00-\x7f]*$/.test(safe), true, "não pode sobrar nenhum caractere fora do ASCII");
    assert(safe.includes("Dental Test 4 Clinica"), "o texto legível não pode ser perdido");
    assert(safe.includes("-"), "travessão vira hífen simples, não desaparece");
    assert(!safe.includes("—"), "o travessão original não pode sobrar");
});

Deno.test("asciiSafeHeaderText: decompõe acentos em vez de apagar a palavra (á -> a, não some)", () => {
    assertEquals(asciiSafeHeaderText("Confirmação de Agendamento — Clínica São Paulo"), "Confirmacao de Agendamento - Clinica Sao Paulo");
    assertEquals(asciiSafeHeaderText("¿Cómo fue su experiencia en Clínica Peña?"), "Como fue su experiencia en Clinica Pena?");
});

Deno.test("asciiSafeHeaderText: string já puramente ASCII passa intacta", () => {
    assertEquals(asciiSafeHeaderText("Appointment reminder - Dental Care"), "Appointment reminder - Dental Care");
});

Deno.test("asciiSafeHeaderText: nunca produz uma string que comece com '=?' (evitaria a dupla codificação do denomailer)", () => {
    // Regressão específica: o bug do denomailer SÓ deixa de recodificar
    // strings puramente ASCII. Qualquer não-ASCII remanescente reativaria o
    // bug (e uma string começando com "=?" seria recodificada por cima).
    const casosDeRisco = [
        "Lembrete de consulta — 03/08 às 09:00 | Clínica Ipê",
        "¡Hola! ¿Qué tal?",
        "Emoji test 🦷😊 clínica",
    ];
    for (const texto of casosDeRisco) {
        const safe = asciiSafeHeaderText(texto);
        assert(!safe.startsWith("=?"), `não deveria começar com "=?": "${safe}"`);
        assertEquals(/^[\x00-\x7f]*$/.test(safe), true, `deveria ser 100% ASCII: "${safe}"`);
    }
});

Deno.test("asciiSafeHeaderText: nunca deixa espaços duplos ou sobra de espaçamento após remover diacríticos", () => {
    const safe = asciiSafeHeaderText("Olá   —   Clínica");
    assertEquals(safe, "Ola - Clinica");
});
