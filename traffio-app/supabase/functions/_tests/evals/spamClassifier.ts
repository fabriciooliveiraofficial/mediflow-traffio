/**
 * Eval do classificador anti-spam (Camada 1) contra o MODELO REAL — barato
 * (Haiku, ~40 tokens de saída por caso). Roda só os casos que chegariam ao
 * classificador em produção (suspeitos), com foco em FALSO POSITIVO.
 *
 *   .\_tests\evals\run-evals.ps1 não cobre este arquivo; rode direto:
 *   $env:ANTHROPIC_API_KEY="..."; npx deno run -A _tests/evals/spamClassifier.ts
 */
import { screenInbound } from "../../_shared/inboundSpamFilter.ts";

const stubSupabase: any = {
    from: () => {
        const c: any = {
            select: () => c, eq: () => c, gte: () => c, limit: () => c,
            maybeSingle: () => Promise.resolve({ data: null }),
            insert: () => Promise.resolve({ error: null }),
            upsert: () => Promise.resolve({ error: null }),
            update: () => c,
            then: (resolve: any) => resolve({ data: [], error: null }),
        };
        return c;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
};

// expect: "allow" = paciente/ambíguo (NUNCA pode filtrar) | "filter" = spam/fornecedor
const CASES: { text: string; expect: "allow" | "filter" }[] = [
    // Pacientes com sinal suspeito (link, @, "parceria", "proposta"...) — o teste que importa
    { text: "olha esse sorriso que eu quero fazer igual https://www.instagram.com/p/Cxyz123/", expect: "allow" },
    { text: "Vocês têm parceria com a Amil ou Bradesco Dental?", expect: "allow" },
    { text: "Recebi uma proposta de tratamento de outra clínica e queria uma segunda opinião de vocês", expect: "allow" },
    { text: "vi a promoção de clareamento no perfil @clinica_sorriso, ainda está valendo?", expect: "allow" },
    { text: "Minha empresa quer fazer um convênio para os funcionários, como funciona?", expect: "allow" },
    { text: "Sou fornecedor de alimentos e trabalho viajando, vocês atendem sábado?", expect: "allow" },
    { text: "Queria mandar meu currículo, vocês têm vaga de emprego para recepcionista?", expect: "allow" },
    { text: "Ajudamos dentistas? não kkk eu que preciso de ajuda, meu dente tá doendo muito, tem horário hoje?", expect: "allow" },
    // Fornecedores / spam que escapam das regras ou trazem vocabulário odontológico
    { text: "Olá! Temos uma proposta de parceria para divulgar a marca de vocês para milhares de pessoas da região. Podemos conversar?", expect: "filter" },
    { text: "Ajudamos dentistas a lotar a agenda de implante com tráfego pago para sua clínica. Posso te mostrar como?", expect: "filter" },
    { text: "Hi! Our agency specializes in dental implant leads. We can fill your appointment calendar in 30 days. Interested?", expect: "filter" },
    { text: "Boa tarde, nossa empresa fornece software de gestão para clínicas odontológicas com 30 dias grátis, acesse www.odontosys.app", expect: "filter" },
    { text: "Parabéns pelo perfil! Conheça nosso método para faturar 100k/mês com harmonização, link na bio @mentor_odonto", expect: "filter" },
    { text: "Somos atacado de materiais odontológicos com preço de fábrica, posso enviar nosso catálogo?", expect: "filter" },
];

let failures = 0, falsePositives = 0;
for (const c of CASES) {
    const r = await screenInbound(stubSupabase, { tenantId: "eval", platform: "instagram", senderId: `s-${Math.random()}`, text: c.text, aiConfigured: true });
    const ok = r.action === c.expect;
    if (!ok) { failures++; if (c.expect === "allow") falsePositives++; }
    const detail = r.action === "filter" ? `${r.verdict}/${r.layer} — ${r.reason}` : r.why;
    console.log(`${ok ? "✅" : (c.expect === "allow" ? "🚨 FALSO POSITIVO" : "⚠️  escapou")} [${r.action}] ${detail}\n     "${c.text.substring(0, 110)}"`);
}
console.log(`\n═══ ${CASES.length - failures}/${CASES.length} — falsos positivos: ${falsePositives} (precisa ser 0) ═══`);
Deno.exit(falsePositives > 0 ? 1 : 0);
