/**
 * channelResolver_test — E-6 (2026-08-02). Auditoria pedida pelo usuário:
 * lembretes (e NPS/recuperação) precisavam cair no e-mail cadastrado para
 * pacientes de Live Chat/Instagram/Messenger. A causa raiz era esta linha:
 *
 *   const row = matrix?.[c.channel];
 *   if (row === undefined) return true; // canais fora da matriz seguem a preferência
 *
 * Instagram/Facebook NUNCA aparecem em channel_automations — a própria tela
 * Notificações os mostra riscados, com um aviso fixo "Indisponível (Restrição
 * da Janela de 24h da Meta)", sem nenhum toggle (NotificationsPage.tsx,
 * MatrixRowMetaDisabled — puramente decorativo, não grava nada). O código
 * lia essa AUSÊNCIA como "libere por padrão"; era o oposto: bloqueado por
 * design do produto. Combinado com o Live Chat nunca tendo canal de
 * notificação próprio, nenhum dos dois caminhos chegava ao e-mail cadastrado.
 */
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { filterChannelsByMatrix, resolveEligibleChannels, type ChannelInfo } from "../../_shared/channelResolver.ts";

const MATRIX_TENANT_TESTE = {
    whatsapp: { no_show: true, videos: false, nps: true, recovery: true },
    sms:      { no_show: false, videos: false, nps: false, recovery: false },
    mms:      { no_show: false, videos: false, nps: false, recovery: false },
    email:    { no_show: true, videos: false, nps: true, recovery: true },
    // instagram/facebook: DELIBERADAMENTE ausentes — é assim que a tela salva hoje.
};

// ── filterChannelsByMatrix: Instagram/Facebook NUNCA elegíveis para automação ──

Deno.test("filterChannelsByMatrix: Instagram nunca é elegível, mesmo ausente da matriz (era exatamente o bug)", () => {
    const out = filterChannelsByMatrix(
        [{ channel: "instagram", recipientId: "igsid-123" }],
        MATRIX_TENANT_TESTE,
        "no_show",
    );
    assertEquals(out, [], "Instagram não pode passar como canal elegível para lembrete");
});

Deno.test("filterChannelsByMatrix: Facebook nunca é elegível, para nenhuma automação", () => {
    for (const key of ["no_show", "nps", "recovery", "videos"] as const) {
        const out = filterChannelsByMatrix([{ channel: "facebook", recipientId: "psid-456" }], MATRIX_TENANT_TESTE, key);
        assertEquals(out, [], `Facebook não deveria ser elegível para ${key}`);
    }
});

Deno.test("filterChannelsByMatrix: e-mail ligado na matriz (como na tela real) passa normalmente", () => {
    const out = filterChannelsByMatrix([{ channel: "email", recipientId: "paciente@example.com" }], MATRIX_TENANT_TESTE, "no_show");
    assertEquals(out.length, 1);
    assertEquals(out[0].channel, "email");
});

Deno.test("filterChannelsByMatrix: e-mail com endereço inválido nunca passa, mesmo com a automação ligada", () => {
    const out = filterChannelsByMatrix([{ channel: "email", recipientId: "não-é-email" }], MATRIX_TENANT_TESTE, "no_show");
    assertEquals(out, []);
});

Deno.test("filterChannelsByMatrix: WhatsApp continua respeitando a matriz normalmente (comportamento existente preservado)", () => {
    const okChannel = filterChannelsByMatrix([{ channel: "whatsapp", recipientId: "+5511999999999" }], MATRIX_TENANT_TESTE, "no_show");
    assertEquals(okChannel.length, 1);
    const blockedChannel = filterChannelsByMatrix([{ channel: "whatsapp", recipientId: "+5511999999999" }], MATRIX_TENANT_TESTE, "videos");
    assertEquals(blockedChannel, []);
});

Deno.test("filterChannelsByMatrix: retrocompatibilidade de Recuperação (whatsapp sem a chave 'recovery' = ligado por padrão) preservada", () => {
    const matrixAntiga = { whatsapp: { no_show: true, videos: false, nps: true } }; // sem 'recovery'
    const out = filterChannelsByMatrix([{ channel: "whatsapp", recipientId: "+5511999999999" }], matrixAntiga, "recovery");
    assertEquals(out.length, 1, "config antiga sem a chave recovery deveria continuar ligada por padrão");
});

// ── resolveEligibleChannels: o caminho completo, com o cenário real do usuário ──

Deno.test("resolveEligibleChannels: Live Chat (SEM nenhuma preferência salva) cai direto no e-mail cadastrado", () => {
    const out = resolveEligibleChannels({
        preferredChannels: [], // Live Chat nunca grava patient_channel_preferences hoje
        matrix: MATRIX_TENANT_TESTE,
        automationKey: "no_show",
        botConfig: { default_notification_channel: "whatsapp" }, // padrão do tenant é whatsapp — não pode vencer aqui
        patientPhone: "livechat-957394e7-0460-4435-a659-ed875e667f06",
        patientEmail: "amanda@example.com",
    });
    assertEquals(out, [{ channel: "email", recipientId: "amanda@example.com" }]);
});

Deno.test("resolveEligibleChannels: Instagram (preferência salva pelo webhook) cai no e-mail cadastrado, não fica preso no DM", () => {
    const out = resolveEligibleChannels({
        preferredChannels: [{ channel: "instagram", recipientId: "igsid-123" }], // é o que meta-social-webhook grava hoje
        matrix: MATRIX_TENANT_TESTE,
        automationKey: "nps",
        botConfig: { default_notification_channel: "whatsapp" },
        patientPhone: "igsid-123",
        patientEmail: "cliente@example.com",
    });
    assertEquals(out, [{ channel: "email", recipientId: "cliente@example.com" }]);
});

Deno.test("resolveEligibleChannels: Facebook Messenger — mesmo comportamento do Instagram", () => {
    const out = resolveEligibleChannels({
        preferredChannels: [{ channel: "facebook", recipientId: "psid-456" }],
        matrix: MATRIX_TENANT_TESTE,
        automationKey: "recovery",
        botConfig: { default_notification_channel: "whatsapp" },
        patientPhone: "psid-456",
        patientEmail: "cliente2@example.com",
    });
    assertEquals(out, [{ channel: "email", recipientId: "cliente2@example.com" }]);
});

Deno.test("resolveEligibleChannels: sem preferência viável, e-mail DESLIGADO na matriz → nenhum canal (nunca cai para whatsapp/synthetic phone)", () => {
    const matrixSemEmail = { ...MATRIX_TENANT_TESTE, email: { no_show: false, videos: false, nps: false, recovery: false } };
    const out = resolveEligibleChannels({
        preferredChannels: [],
        matrix: matrixSemEmail,
        automationKey: "no_show",
        botConfig: { default_notification_channel: "whatsapp" },
        patientPhone: "livechat-abc",
        patientEmail: "amanda@example.com",
    });
    assertEquals(out, [], "com e-mail desligado na matriz, não deveria inventar nenhum canal");
});

Deno.test("resolveEligibleChannels: sem preferência viável e paciente sem e-mail válido → nenhum canal", () => {
    const out = resolveEligibleChannels({
        preferredChannels: [{ channel: "instagram", recipientId: "igsid-999" }],
        matrix: MATRIX_TENANT_TESTE,
        automationKey: "no_show",
        botConfig: { default_notification_channel: "whatsapp" },
        patientPhone: "igsid-999",
        patientEmail: null,
    });
    assertEquals(out, []);
});

Deno.test("resolveEligibleChannels: preferência explícita por um canal DESLIGADO (ex.: SMS) — comportamento antigo preservado (fallback pelo canal padrão do tenant, NÃO pelo atalho de e-mail)", () => {
    // Este é o caso que NÃO deve mudar: paciente pediu SMS, tenant desligou SMS
    // na matriz — o sistema já caía para o canal padrão do tenant antes desta
    // correção, e deve continuar caindo exatamente assim (aqui, whatsapp).
    const out = resolveEligibleChannels({
        preferredChannels: [{ channel: "sms", recipientId: "+5511999999999" }],
        matrix: MATRIX_TENANT_TESTE,
        automationKey: "no_show",
        botConfig: { default_notification_channel: "whatsapp" },
        patientPhone: "+5511999999999",
        patientEmail: "cliente@example.com",
    });
    assertEquals(out, [{ channel: "whatsapp", recipientId: "+5511999999999" }]);
});

Deno.test("resolveEligibleChannels: WhatsApp com preferência elegível — caminho principal inalterado", () => {
    const out = resolveEligibleChannels({
        preferredChannels: [{ channel: "whatsapp", recipientId: "+5511999999999" }],
        matrix: MATRIX_TENANT_TESTE,
        automationKey: "no_show",
        botConfig: { default_notification_channel: "whatsapp" },
        patientPhone: "+5511999999999",
        patientEmail: "cliente@example.com",
    });
    assertEquals(out, [{ channel: "whatsapp", recipientId: "+5511999999999" }]);
});
