/**
 * identity_test — E-4 (2026-08-02, teste de estresse). O agente alucinou
 * "esse e-mail já está vinculado a outro cadastro" sem NENHUMA ferramenta ter
 * checado isso — confirmado por auditoria: não existe consulta por e-mail no
 * fluxo, e a única trigger em `patients` (tr_crm_patients, AFTER INSERT) só
 * usa NEW.phone, nunca email. A causa raiz era comportamental: o cadastro
 * (atualizar_cadastro_paciente) resolvia identidade só por telefone — sempre
 * o registro mais antigo — sem olhar nome nem canal, então uma segunda
 * chamada podia colidir consigo mesma, e um canal sem telefone real
 * (Instagram/Messenger) tratava o sender id da Meta como se fosse telefone.
 *
 * Estes testes travam a correção:
 * 1. resolvePatientIdentity: liga channel_identities (existia no schema desde
 *    20260724180000 mas nunca foi usado por nenhum código) por cima da
 *    resolução família/telefone já testada (resolvePatientForBooking).
 * 2. Mesmo telefone, nome diferente → cria dependente, nunca sobrescreve
 *    (mãe/filho, cônjuge, idoso — pedido explícito do usuário).
 * 3. Canal sem telefone real (Instagram/Messenger) nunca grava o sender id
 *    como telefone; quando o paciente digita o telefone real, funde com um
 *    cadastro existente de OUTRO canal em vez de duplicar.
 * 4. atualizar_cadastro_paciente não regrava dado já confirmado e idêntico
 *    (elimina a "segunda checagem" desnecessária).
 * 5. Erro de banco nunca mais vaza cru para o modelo interpretar.
 * 6. solicitar_exclusao_cadastro nunca apaga — só sinaliza.
 * 7. Validador: alegação de "pertence a outro paciente" sem fonte é
 *    bloqueada; aprovada quando a ferramenta de fato devolveu ambiguidade.
 */
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { executeSchedulingTool, resolvePatientIdentity } from "../../_shared/schedulingTools.ts";
import { validateAgentReply } from "../../_shared/copilot.ts";

const digits = (s: string) => (s || "").replace(/\D/g, "");

/** Mock com "banco" de pacientes de verdade (mutável) + channel_identities. */
function buildMock(opts: {
    identity?: { id: string; patient_id: string | null } | null;
    patients?: { id: string; full_name: string | null; phone: string; email?: string; birth_date?: string; notes?: string }[];
    forceUpdateError?: string;
} = {}) {
    const patients = opts.patients ? [...opts.patients] : [];
    const linked: { identityId: string; patientId: string }[] = [];
    const inserted: any[] = [];
    const updated: { id: string; payload: any }[] = [];

    return {
        patients, linked, inserted, updated,
        from(table: string) {
            if (table === "channel_identities") {
                return {
                    select: () => ({
                        eq: () => ({
                            eq: () => ({
                                eq: () => ({
                                    maybeSingle: async () => ({ data: opts.identity ?? null, error: null }),
                                }),
                            }),
                        }),
                    }),
                    insert: (payload: any) => ({
                        select: () => ({
                            single: async () => ({
                                data: { id: "identity-new", tenant_id: payload.tenant_id, channel: payload.channel, channel_user_id: payload.channel_user_id, patient_id: null, platform_meta: {} },
                                error: null,
                            }),
                        }),
                    }),
                    update: (payload: any) => ({
                        eq: (_c: string, id: string) => {
                            linked.push({ identityId: id, patientId: payload.patient_id });
                            return Promise.resolve({ error: null, data: null });
                        },
                    }),
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
                                if (opts.forceUpdateError) return { error: { message: opts.forceUpdateError } };
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

// ── resolvePatientIdentity: fast path via canal já ligado ──

Deno.test("resolvePatientIdentity: canal já ligado a um paciente resolve direto, sem consultar telefone/nome", async () => {
    const mock = buildMock({ identity: { id: "identity-1", patient_id: "pat-existing" } });
    const res = await resolvePatientIdentity(mock as any, "tenant-1", "instagram", "ig-sender-999", null, "Qualquer Nome");
    assertEquals(res.patient?.id, "pat-existing");
});

// ── Família dividindo telefone: nunca sobrescreve, cria dependente ──

Deno.test("resolvePatientIdentity: telefone já tem cadastro com nome DIFERENTE — cria dependente, não sobrescreve (mãe → filho)", async () => {
    const mock = buildMock({
        patients: [{ id: "pat-mae", full_name: "Maria Silva", phone: "5511999999999" }],
    });
    const res = await resolvePatientIdentity(mock as any, "tenant-1", "whatsapp", "5511999999999", "João Silva", null);
    assert(res.patient, "esperava paciente resolvido");
    assert(res.patient!.id !== "pat-mae", "não pode reaproveitar o cadastro da mãe para o filho");
    assertEquals(mock.inserted.length, 1);
    assertEquals(mock.inserted[0].full_name, "João Silva");
    assertEquals(mock.inserted[0].phone, "5511999999999");
    // Mãe continua intacta.
    assertEquals(mock.patients.find(p => p.id === "pat-mae")?.full_name, "Maria Silva");
});

Deno.test("resolvePatientIdentity: mesmo telefone, mesmo nome (reconfirmação) — reaproveita, nunca duplica", async () => {
    const mock = buildMock({
        patients: [{ id: "pat-1", full_name: "Fabio Radovanski", phone: "14049257024" }],
    });
    const res = await resolvePatientIdentity(mock as any, "tenant-1", "whatsapp", "14049257024", "Fabio Radovanski", null);
    assertEquals(res.patient?.id, "pat-1");
    assertEquals(mock.inserted.length, 0, "nome igual ao existente não deveria criar segundo cadastro");
});

// ── Cross-channel: Instagram nunca grava sender id como telefone; funde com WhatsApp existente ──

Deno.test("resolvePatientIdentity: Instagram sem telefone real ainda NÃO conhecido — cria com o sender id (comportamento anterior preservado até haver telefone real)", async () => {
    const mock = buildMock({ patients: [] });
    const res = await resolvePatientIdentity(mock as any, "tenant-1", "instagram", "ig-sender-abc", "Ana Costa Silva", null);
    assert(res.patient);
    assertEquals(mock.inserted[0].phone, "ig-sender-abc");
});

Deno.test("resolvePatientIdentity: paciente digita o telefone REAL no Instagram — funde com cadastro existente do WhatsApp em vez de duplicar", async () => {
    const mock = buildMock({
        patients: [{ id: "pat-whatsapp", full_name: "Fabio Radovanski", phone: "+14049257024" }],
    });
    const res = await resolvePatientIdentity(
        mock as any, "tenant-1", "instagram", "ig-sender-abc", "Fabio Radovanski", null, "14049257024",
    );
    assertEquals(res.patient?.id, "pat-whatsapp", "deveria encontrar o cadastro do WhatsApp pelo telefone real, não criar um novo com o sender id");
    assertEquals(mock.inserted.length, 0);
    assertEquals(mock.linked.length, 1, "a identidade do Instagram deveria ficar ligada ao paciente encontrado");
    assertEquals(mock.linked[0].patientId, "pat-whatsapp");
});

// ── atualizar_cadastro_paciente: reprodução do caso real do teste de estresse ──

Deno.test("atualizar_cadastro_paciente: dados já confirmados e IDÊNTICOS — não regrava nada (elimina a 'segunda checagem')", async () => {
    const mock = buildMock({
        patients: [{ id: "pat-1", full_name: "Fabio Radovanski", phone: "+14049257024", email: "fabriciooliveiraoficial@hotmail.com" }],
    });
    const call = { id: "c1", name: "atualizar_cadastro_paciente", input: { full_name: "Fabio Radovanski", email: "fabriciooliveiraoficial@hotmail.com" } };
    const res = await executeSchedulingTool(
        mock as any, "tenant-1", "14049257024", "Fabio", call as any, "yes, it is", "en",
        { registration_confirmed: true }, "whatsapp",
    );
    assertEquals(res.data.success, true);
    assertEquals(mock.updated.length, 0, "nada mudou — não deveria ter tocado o banco");
});

Deno.test("atualizar_cadastro_paciente: dado realmente diferente — atualiza normalmente mesmo já confirmado", async () => {
    const mock = buildMock({
        patients: [{ id: "pat-1", full_name: "Fabio Radovanski", phone: "+14049257024", email: "antigo@example.com" }],
    });
    const call = { id: "c1", name: "atualizar_cadastro_paciente", input: { full_name: "Fabio Radovanski", email: "novo@example.com" } };
    const res = await executeSchedulingTool(
        mock as any, "tenant-1", "14049257024", "Fabio", call as any, "", "en",
        { registration_confirmed: true }, "whatsapp",
    );
    assertEquals(res.data.success, true);
    assertEquals(mock.updated.length, 1);
    assertEquals(mock.updated[0].payload.email, "novo@example.com");
});

Deno.test("atualizar_cadastro_paciente: erro de banco nunca vaza cru para o modelo (Passo 6)", async () => {
    const mock = buildMock({
        patients: [{ id: "pat-1", full_name: "Fabio Radovanski", phone: "+14049257024" }],
        forceUpdateError: 'duplicate key value violates unique constraint "patients_email_key"',
    });
    const call = { id: "c1", name: "atualizar_cadastro_paciente", input: { full_name: "Fabio Radovanski", email: "x@example.com" } };
    const res = await executeSchedulingTool(mock as any, "tenant-1", "14049257024", "Fabio", call as any, "", "en", {}, "whatsapp");
    assertEquals(res.data.success, false);
    assertEquals(res.data.error, "database_error");
    assert(!JSON.stringify(res.data).includes("duplicate key"), "a mensagem crua do Postgres nunca deve chegar ao modelo");
    assert(!JSON.stringify(res.data).includes("constraint"));
});

Deno.test("atualizar_cadastro_paciente: telefone já tem OUTRA pessoa — cria dependente em vez de sobrescrever (regressão do bug família)", async () => {
    const mock = buildMock({
        patients: [{ id: "pat-mae", full_name: "Maria Silva", phone: "5511999999999" }],
    });
    const call = { id: "c1", name: "atualizar_cadastro_paciente", input: { full_name: "João Silva", email: "joao@example.com" } };
    const res = await executeSchedulingTool(mock as any, "tenant-1", "5511999999999", "João", call as any, "", "pt", {}, "whatsapp");
    assertEquals(res.data.success, true);
    assertEquals(res.data.created, true);
    assert(res.data.patient_id !== "pat-mae");
    assertEquals(mock.patients.find(p => p.id === "pat-mae")?.email, undefined, "cadastro da mãe não deve ser tocado");
});

// ── solicitar_exclusao_cadastro: nunca apaga, só sinaliza ──

Deno.test("solicitar_exclusao_cadastro: nunca chama delete — só sinaliza o pedido", async () => {
    const mock = buildMock({ patients: [{ id: "pat-1", full_name: "Fabio Radovanski", phone: "14049257024" }] });
    (mock as any).from = new Proxy(mock.from.bind(mock), {
        apply(target, thisArg, args) {
            const result = Reflect.apply(target, thisArg, args);
            if (result && typeof result === "object") {
                (result as any).delete = () => { throw new Error("NUNCA deveria chamar delete()"); };
            }
            return result;
        },
    });
    const call = { id: "c1", name: "solicitar_exclusao_cadastro", input: {} };
    const res = await executeSchedulingTool(mock as any, "tenant-1", "14049257024", "Fabio", call as any, "", "pt", {}, "whatsapp");
    assertEquals(res.data.success, true);
    assertEquals(res.data.deletion_requested, true);
    assertEquals(res.data.patient_id, "pat-1");
});

// ── Validador: alegação de identidade duplicada sem fonte ──

Deno.test("validateAgentReply: reprova a alegação REAL do teste de estresse (sem nenhuma ferramenta ter confirmado)", () => {
    const text = "It looks like that email is already linked to another file in our system, so I'm unable to save it under your name just yet.";
    const violations = validateAgentReply(text, { language: "en", evidence: text, policyEvidence: "" });
    assert(
        violations.some(v => v.includes("conflito de identidade sem fonte")),
        `esperava violação de identidade sem fonte, veio: ${violations.join(" | ")}`,
    );
});

Deno.test("validateAgentReply: aprova quando a ferramenta REALMENTE devolveu ambiguidade (multiple_patients_on_this_phone)", () => {
    const text = "Esse telefone já tem outro cadastro em nome diferente — é para você ou para outra pessoa da família?";
    const evidence = text + '\n{"error":"multiple_patients_on_this_phone","patients":["Maria Silva"]}';
    const violations = validateAgentReply(text, { language: "pt", evidence, policyEvidence: "" });
    assert(
        !violations.some(v => v.includes("conflito de identidade sem fonte")),
        `com fonte real, não deveria reprovar: ${violations.join(" | ")}`,
    );
});

Deno.test("validateAgentReply: frase parecida mas sem alegação de conflito não é reprovada", () => {
    const text = "Perfeito, seu cadastro está confirmado! Vamos ver os horários disponíveis.";
    const violations = validateAgentReply(text, { language: "pt", evidence: text, policyEvidence: "" });
    assert(!violations.some(v => v.includes("conflito de identidade sem fonte")));
});
