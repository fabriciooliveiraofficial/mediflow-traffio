/**
 * Filtro anti-spam dos canais Meta (_shared/inboundSpamFilter.ts) — testes puros.
 * O eixo que importa aqui é o FALSO POSITIVO: nenhuma mensagem plausível de
 * paciente pode ser filtrada. Spam que escapa custa tokens; paciente filtrado
 * custa o paciente.
 */
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
    ruleVerdict, isSuspicious, normalizeForFingerprint, screenInbound, CLASSIFIER_MIN_CONFIDENCE,
} from "../../_shared/inboundSpamFilter.ts";
import { detectCommercialSolicitation } from "../../_shared/copilot.ts";

const PATIENT_MESSAGES = [
    "Oi, tudo bem?",
    "Boa tarde! Vocês fazem clareamento?",
    "quanto custa um implante?",
    "Quero agendar uma avaliação pra essa semana",
    "vocês têm parceria com algum convênio?",
    "vi o anúncio de vocês no instagram e queria saber mais",
    "Meu dente quebrou, conseguem me atender hoje?",
    "Hi! Do you have any appointments available this week?",
    "I saw your page, how much is teeth whitening?",
    "Hola, quiero una cita para limpieza",
    "Amei o resultado!! 😍😍",
    "Vocês atendem criança?",
    "olha esse sorriso que eu quero https://www.instagram.com/p/abc123/",
    "sou paciente de vocês e preciso remarcar",
    "Trabalho com vendas e só consigo ir depois das 18h, tem horário?",
    "minha empresa tem plano odontológico, vocês aceitam?",
    "Vocês estão contratando? Sou auxiliar de saúde bucal",
    "Quero aumentar meu sorriso, fazer lente em todos os dentes",
    "Sou designer e trabalho o dia todo sorrindo pra cliente, queria arrumar meus dentes",
];

Deno.test("ruleVerdict: NENHUMA mensagem plausível de paciente é condenada por regra", () => {
    for (const msg of PATIENT_MESSAGES) {
        const v = ruleVerdict(msg);
        assert(!v || v.hasPatientSignal, `falso positivo de regra em: "${msg}" → ${v?.reason}`);
    }
});

Deno.test("ruleVerdict: spam clássico é pego (pt/en/es)", () => {
    const spam = [
        "Ganhe 10 mil seguidores reais em 24h, chama no direct",
        "Nice pic! Promote it on @beauty_hub_feature",
        "DM me for a paid collab, earn $500 weekly",
        "Invista em bitcoin com retorno garantido de 30% ao mês",
        "Renda extra trabalhando de casa, me chama",
        "Empréstimo aprovado na hora mesmo negativado",
        "Your page will be disabled due to copyright violation, verify here",
        "Congratulations! You have won our giveaway",
        "Jogue no tigrinho e ganhe bônus no cadastro",
    ];
    for (const msg of spam) assertEquals(ruleVerdict(msg)?.verdict, "spam", msg);
});

Deno.test("ruleVerdict: fornecedor oferecendo serviço é pego", () => {
    const vendor = [
        "Olá! Fazemos criação de sites profissionais, posso te mandar uma proposta?",
        "Sou gestor de tráfego pago e queria apresentar meu trabalho",
        "Geramos leads qualificados todos os meses",
        "We help dental practices get more patients with Google Ads",
        "Gostaria de apresentar nossa plataforma de gestão",
        "Sou representante comercial da OdontoSupply",
        "Quem é o responsável pelo marketing da empresa?",
        "Sou editor de vídeos e estou com vagas para novos clientes, segue meu portfólio",
    ];
    for (const msg of vendor) assertEquals(ruleVerdict(msg)?.verdict, "vendor", msg);
});

Deno.test("ruleVerdict: vendedor que usa vocabulário odontológico NÃO é condenado por regra — sobe para o classificador", () => {
    const v = ruleVerdict("Ajudamos dentistas a lotar a agenda de implante com tráfego pago para sua clínica");
    assert(v, "deveria casar regra de fornecedor");
    assertEquals(v!.hasPatientSignal, true);
});

Deno.test("normalizeForFingerprint: URL, @, números, emoji e caixa não mudam a impressão digital", () => {
    assertEquals(
        normalizeForFingerprint("GANHE 5000 seguidores!! 🚀 acesse https://x.co/abc @promo_1"),
        normalizeForFingerprint("ganhe 9999 seguidores acesse https://outro.link/zzz @promo_2"),
    );
});

// ── screenInbound com banco simulado ─────────────────────────────────────────
function mockDb(opts: { reputation?: { verdict: string; reason?: string } | null; fingerprintSenders?: number; failAll?: boolean } = {}) {
    const writes: { table: string; op: string; payload: any }[] = [];
    const chain = (table: string) => {
        const c: any = {
            select: () => c, eq: () => c, gte: () => c, limit: () => c, not: () => c, in: () => c, order: () => c,
            maybeSingle: () => {
                if (opts.failAll) throw new Error("db down");
                if (table === "channel_sender_reputation") return Promise.resolve({ data: opts.reputation ?? null });
                return Promise.resolve({ data: null });
            },
            insert: (payload: any) => { writes.push({ table, op: "insert", payload }); return Promise.resolve({ error: null }); },
            upsert: (payload: any) => { writes.push({ table, op: "upsert", payload }); return Promise.resolve({ error: null }); },
            update: (payload: any) => { writes.push({ table, op: "update", payload }); return c; },
            then: (resolve: any) => {
                if (table === "inbound_text_fingerprints") {
                    return resolve({ data: Array.from({ length: opts.fingerprintSenders ?? 1 }, (_, i) => ({ sender_id: `s${i}` })) });
                }
                return resolve({ data: [], error: null });
            },
        };
        return c;
    };
    return {
        writes,
        from: (table: string) => chain(table),
        rpc: () => Promise.resolve({ data: null, error: null }),
    };
}
const base = { tenantId: "t1", platform: "instagram" as const, senderId: "ig-1" };

Deno.test("screenInbound: clique em anúncio, contato conhecido e remetente 'trusted' NUNCA são filtrados — nem com texto de spam", async () => {
    const spamText = "Ganhe 10 mil seguidores reais hoje";
    assertEquals((await screenInbound(mockDb() as any, { ...base, text: spamText, fromAdReferral: true })).action, "allow");
    assertEquals((await screenInbound(mockDb() as any, { ...base, text: spamText, knownContact: true })).action, "allow");
    assertEquals((await screenInbound(mockDb({ reputation: { verdict: "trusted" } }) as any, { ...base, text: spamText })).action, "allow");
});

Deno.test("screenInbound: regra forte filtra SEM chamar LLM e grava reputação global", async () => {
    const db = mockDb();
    let llmCalls = 0;
    const r = await screenInbound(db as any, { ...base, text: "Nice pic! Promote it on @beauty_hub" }, { claudeJsonFn: (async () => { llmCalls++; return null; }) as any });
    assertEquals(r.action, "filter");
    assertEquals(llmCalls, 0);
    assert(db.writes.some(w => w.table === "channel_sender_reputation" && w.payload.verdict === "spam"));
});

Deno.test("screenInbound: remetente já condenado é barrado na reputação, mesmo sendo contato conhecido e com texto inocente", async () => {
    const r = await screenInbound(mockDb({ reputation: { verdict: "vendor", reason: "oferta de site" } }) as any, { ...base, text: "oi, tudo bem?", knownContact: true });
    assertEquals(r.action, "filter");
    assertEquals((r as any).layer, "reputation");
});

Deno.test("screenInbound: mensagem comum de paciente libera SEM gastar classificador", async () => {
    let llmCalls = 0;
    for (const text of PATIENT_MESSAGES.filter(m => !isSuspicious(m))) {
        const r = await screenInbound(mockDb() as any, { ...base, text, aiConfigured: true }, { claudeJsonFn: (async () => { llmCalls++; return null; }) as any });
        assertEquals(r.action, "allow", text);
    }
    assertEquals(llmCalls, 0);
});

Deno.test("screenInbound: suspeita → classificador; só filtra com confiança alta; abaixo do corte libera", async () => {
    const text = "Olá, temos uma proposta de parceria para divulgar a marca de vocês, podemos conversar?";
    const high = await screenInbound(mockDb() as any, { ...base, text, aiConfigured: true }, { claudeJsonFn: (async () => ({ category: "vendor", confidence: 0.95 })) as any });
    assertEquals(high.action, "filter");
    const low = await screenInbound(mockDb() as any, { ...base, text, aiConfigured: true }, { claudeJsonFn: (async () => ({ category: "vendor", confidence: CLASSIFIER_MIN_CONFIDENCE - 0.1 })) as any });
    assertEquals(low.action, "allow");
    const patient = await screenInbound(mockDb() as any, { ...base, text, aiConfigured: true }, { claudeJsonFn: (async () => ({ category: "patient", confidence: 0.99 })) as any });
    assertEquals(patient.action, "allow");
});

Deno.test("screenInbound: texto repetido em massa é só SINAL — sem IA configurada, libera (texto pré-preenchido de anúncio é idêntico para todo lead)", async () => {
    const text = "Olá! Posso obter mais informações sobre isso? Vi a publicação de vocês.";
    const r = await screenInbound(mockDb({ fingerprintSenders: 12 }) as any, { ...base, text, aiConfigured: false });
    assertEquals(r.action, "allow");
});

Deno.test("screenInbound: fail-open — banco fora do ar ou classificador quebrado NUNCA filtra", async () => {
    assertEquals((await screenInbound(mockDb({ failAll: true }) as any, { ...base, text: "Promote it on @x" })).action, "allow");
    const r = await screenInbound(mockDb() as any, { ...base, text: "proposta de parceria comercial com nossa agência", aiConfigured: true },
        { claudeJsonFn: (async () => { throw new Error("llm down"); }) as any });
    assertEquals(r.action, "allow");
});

// ── Camada 3 ────────────────────────────────────────────────────────────────
Deno.test("detectCommercialSolicitation: exige triagem + corroboração; qualquer traço de paciente veta", () => {
    const vendorTalk = ["oi, tudo bem?", "na verdade eu queria apresentar nossa plataforma de gestão para clínicas"];
    const clean = { hasPatientRecord: false, hasProcedure: false, hasBookingState: false };
    assert(detectCommercialSolicitation({ triageFlag: true, patientTexts: vendorTalk, ...clean }));
    assertEquals(detectCommercialSolicitation({ triageFlag: false, patientTexts: vendorTalk, ...clean }), null);
    assertEquals(detectCommercialSolicitation({ triageFlag: true, patientTexts: vendorTalk, ...clean, hasPatientRecord: true }), null);
    assertEquals(detectCommercialSolicitation({ triageFlag: true, patientTexts: vendorTalk, ...clean, hasProcedure: true }), null);
    assertEquals(detectCommercialSolicitation({ triageFlag: true, patientTexts: vendorTalk, ...clean, hasBookingState: true }), null);
    // Triagem errou num paciente comum: sem corroboração no texto, nada acontece.
    assertEquals(detectCommercialSolicitation({ triageFlag: true, patientTexts: ["oi", "queria saber do clareamento"], ...clean }), null);
});
