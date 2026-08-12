/**
 * registration_gap_test — E-4-bis (2026-08-02, segundo teste de estresse).
 *
 * O paciente informou nome, telefone e e-mail; o agente confirmou os 3 dados
 * em prosa ("is all of that correct?"); o paciente disse "yes"; e o e-mail
 * NUNCA foi salvo (`patients.email = null`, confirmado por consulta direta ao
 * banco após limpeza total de dados de teste — só havia UM registro, criado
 * no último turno). ver_disponibilidade viu o e-mail ausente, disparou o HARD
 * STOP mandando "peça o e-mail de novo", o modelo entrou em contradição (ele
 * ACABOU de confirmar esse e-mail) e transferiu para humano.
 *
 * Causa raiz: o sistema confiava cegamente que o modelo repassava cada campo
 * no `input` de atualizar_cadastro_paciente — nada verificava se o que foi
 * dito ao paciente em prosa realmente chegou ao banco.
 *
 * Também corrigido aqui: o E-3 (`toolCallFailedThisTurn`) disparava em
 * QUALQUER `error`, inclusive estados normais do fluxo (falta dado, pediu
 * confirmação) — isso reprovava respostas corretas do modelo e derrubava o
 * turno em handoff no primeiro obstáculo pequeno.
 */
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { executeSchedulingTool } from "../../_shared/schedulingTools.ts";
import { EXPECTED_FLOW_ERROR_CODES } from "../../_shared/copilot.ts";

const digits = (s: string) => (s || "").replace(/\D/g, "");

function buildMock(opts: {
    patients?: { id: string; full_name: string | null; phone: string; email?: string | null }[];
} = {}) {
    const patients = opts.patients ? [...opts.patients] : [];
    const updated: { id: string; payload: any }[] = [];
    const inserted: any[] = [];

    return {
        patients, updated, inserted,
        from(table: string) {
            if (table === "channel_identities") {
                return {
                    select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
                    insert: (payload: any) => ({ select: () => ({ single: async () => ({ data: { id: "identity-new", ...payload, patient_id: null }, error: null }) }) }),
                    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
                };
            }
            if (table === "patients") {
                return {
                    select: (_cols: string) => ({
                        eq: (_c1: string, _tenantId: string) => ({
                            in: (_col: string, candidates: string[]) => {
                                const wanted = new Set(candidates.map(digits));
                                const matched = patients.filter(p => wanted.has(digits(p.phone)));
                                return { order: () => ({ limit: async () => ({ data: matched.slice(0, 5), error: null }) }) };
                            },
                            eq: (_c2: string, id: string) => ({
                                maybeSingle: async () => ({ data: patients.find(p => p.id === id) || null, error: null }),
                            }),
                        }),
                    }),
                    insert: (payload: any) => {
                        const row = { id: `new-patient-${inserted.length + 1}`, ...payload };
                        inserted.push(row);
                        patients.push(row as any);
                        return { select: () => ({ single: async () => ({ data: { id: row.id }, error: null }) }) };
                    },
                    update: (payload: any) => ({
                        eq: (_c: string, id: string) => ({
                            eq: async (_c2: string, _tid: string) => {
                                const p = patients.find(pp => pp.id === id);
                                if (p) Object.assign(p, payload);
                                updated.push({ id, payload });
                                return { error: null };
                            },
                        }),
                    }),
                };
            }
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
        },
    };
}

// ── atualizar_cadastro_paciente: transparência do estado persistido ──

Deno.test("atualizar_cadastro_paciente: e-mail ausente no input — resposta expõe patient.email=null e instrui a regravar, nunca reporta silêncio", async () => {
    const mock = buildMock({ patients: [] });
    // Reproduz o bug: modelo chama sem email (esqueceu de repassar o campo).
    const call = { id: "c1", name: "atualizar_cadastro_paciente", input: { full_name: "Fabio Radovanski", phone: "14049257024" } };
    const res = await executeSchedulingTool(mock as any, "tenant-1", "14049257024", "Fabio", call as any, "yes", "en", {}, "whatsapp");
    assertEquals(res.data.success, true);
    assertEquals(res.data.patient.email, null, "a resposta precisa refletir o que REALMENTE está salvo");
    assertStringIncludes(res.data.note, "email");
    assertStringIncludes(res.data.note, "NOVAMENTE");
});

Deno.test("atualizar_cadastro_paciente: os 3 campos presentes — patient reflete tudo salvo, nota não pede regravação", async () => {
    const mock = buildMock({ patients: [] });
    const call = { id: "c1", name: "atualizar_cadastro_paciente", input: { full_name: "Fabio Radovanski", phone: "14049257024", email: "fabriciooliveiraoficial@hotmail.com" } };
    const res = await executeSchedulingTool(mock as any, "tenant-1", "14049257024", "Fabio", call as any, "yes", "en", {}, "whatsapp");
    assertEquals(res.data.success, true);
    assertEquals(res.data.patient.email, "fabriciooliveiraoficial@hotmail.com");
    assert(!res.data.note.includes("NOVAMENTE"));
});

Deno.test("atualizar_cadastro_paciente: registration_confirmed=true mas e-mail AINDA vazio no banco — nunca pula a escrita mesmo sem mudança aparente (guarda endurecida)", async () => {
    const mock = buildMock({
        patients: [{ id: "pat-1", full_name: "Fabio Radovanski", phone: "14049257024", email: null }],
    });
    // Modelo re-confirma nome+telefone (idênticos) SEM incluir email de novo.
    const call = { id: "c1", name: "atualizar_cadastro_paciente", input: { full_name: "Fabio Radovanski", phone: "14049257024" } };
    const res = await executeSchedulingTool(mock as any, "tenant-1", "14049257024", "Fabio", call as any, "yes", "en", { registration_confirmed: true }, "whatsapp");
    assertEquals(res.data.success, true);
    // Nada "mudou" nos campos passados, mas email continua null — não é um no-op válido.
    assertEquals(res.data.patient.email, null);
    assertStringIncludes(res.data.note, "email");
});

Deno.test("atualizar_cadastro_paciente: registration_confirmed=true e os 3 campos JÁ completos e idênticos — aí sim não regrava (Passo 1 original preservado)", async () => {
    const mock = buildMock({
        patients: [{ id: "pat-1", full_name: "Fabio Radovanski", phone: "+14049257024", email: "fabriciooliveiraoficial@hotmail.com" }],
    });
    const call = { id: "c1", name: "atualizar_cadastro_paciente", input: { full_name: "Fabio Radovanski", email: "fabriciooliveiraoficial@hotmail.com" } };
    const res = await executeSchedulingTool(mock as any, "tenant-1", "14049257024", "Fabio", call as any, "", "en", { registration_confirmed: true }, "whatsapp");
    assertEquals(res.data.success, true);
    assertEquals(mock.updated.length, 0, "os 3 campos-núcleo já estão completos e idênticos — não deveria regravar");
});

// ── atualizar_cadastro_paciente: telefone nunca volta com "+" (bug 2026-08-12) ──
// normalizePhoneNumber() tinha o país-padrão fixo em "55" (Brasil): um paciente
// de qualquer outro país que confirmasse o telefone sem "+" (o formato que o
// WhatsApp já entrega em todo o resto do sistema) tinha o número CORROMPIDO
// como se fosse brasileiro, e o "+" que a função sempre devolvia sobrescrevia
// o telefone canônico gravado segundos antes na criação — escondendo o
// histórico do paciente na próxima conversa. canonicalizePhone só mantém os
// dígitos como vieram, nunca inventa país.

Deno.test("atualizar_cadastro_paciente: telefone da Nova Zelândia sem '+' não é corrompido como brasileiro", async () => {
    const mock = buildMock({ patients: [] });
    const call = { id: "c1", name: "atualizar_cadastro_paciente", input: { full_name: "Fabricio Oliveira", phone: "6421234567", email: "f@example.com" } };
    const res = await executeSchedulingTool(mock as any, "tenant-nz", "6421234567", "Fabricio", call as any, "yes", "en", {}, "whatsapp");
    assertEquals(res.data.success, true);
    assertEquals(res.data.patient.phone, "6421234567");
    assert(!String(res.data.patient.phone).startsWith("+"));
    assert(!String(res.data.patient.phone).startsWith("55"), "não pode ganhar o prefixo do Brasil");
});

Deno.test("atualizar_cadastro_paciente: telefone confirmado com '+' na frente é gravado canônico (sem '+')", async () => {
    const mock = buildMock({ patients: [] });
    const call = { id: "c1", name: "atualizar_cadastro_paciente", input: { full_name: "Fabricio Oliveira", phone: "+554198933579", email: "f@example.com" } };
    const res = await executeSchedulingTool(mock as any, "tenant-1", "554198933579", "Fabricio", call as any, "yes", "en", {}, "whatsapp");
    assertEquals(res.data.success, true);
    assertEquals(res.data.patient.phone, "554198933579");
});

// ── ver_disponibilidade: guard orienta a gravar, nunca contradiz uma confirmação real ──

Deno.test("ver_disponibilidade: e-mail ausente — a nota manda GRAVAR se já foi dito, não perguntar de novo (elimina a contradição que causava handoff)", async () => {
    const mock = buildMock({
        patients: [{ id: "pat-1", full_name: "Fabio Radovanski", phone: "14049257024", email: null }],
    });
    const call = { id: "c1", name: "ver_disponibilidade", input: { procedure: "implant" } };
    const res = await executeSchedulingTool(mock as any, "tenant-1", "14049257024", "Fabio", call as any, "yes", "en", { registration_confirmed: true }, "whatsapp");
    assertEquals(res.data.needs_patient_info, true);
    assertStringIncludes(res.data.note, "atualizar_cadastro_paciente");
    assertStringIncludes(res.data.note, "NÃO pergunte de novo");
});

// Nota: "cadastro completo → sem HARD STOP" e "identidade consistente entre
// gravação e leitura" já estão cobertos — o primeiro em unit_test.ts (com o
// mock completo que sustenta o fluxo até a RPC de horários), o segundo pelos
// testes de resolvePatientIdentity em identity_test.ts (mesma função agora
// usada por atualizar_cadastro_paciente, ver_disponibilidade, remarcar e
// adicionar_lista_espera — não há mais divergência possível entre elas).

// ── EXPECTED_FLOW_ERROR_CODES: a calibragem do E-3 ──

Deno.test("EXPECTED_FLOW_ERROR_CODES: contém os estados normais do fluxo (nunca contam como falha real)", () => {
    for (const code of [
        "invalid_name", "surname_required", "patient_info_incomplete",
        "missing_booking_fields", "no_explicit_confirmation",
        "multiple_patients_on_this_phone", "no_doctor_available",
        "no_professionals_available", "patient_not_found", "patient_not_registered",
    ]) {
        assert(EXPECTED_FLOW_ERROR_CODES.has(code), `"${code}" deveria ser um estado normal de fluxo`);
    }
});

Deno.test("EXPECTED_FLOW_ERROR_CODES: NÃO contém falhas reais (essas devem continuar contando)", () => {
    assert(!EXPECTED_FLOW_ERROR_CODES.has("database_error"));
    assert(!EXPECTED_FLOW_ERROR_CODES.has("patient_create_failed"));
    assert(!EXPECTED_FLOW_ERROR_CODES.has("blocked_in_this_turn"));
});
