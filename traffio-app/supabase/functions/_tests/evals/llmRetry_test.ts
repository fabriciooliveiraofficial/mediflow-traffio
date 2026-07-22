/**
 * llmRetry_test — prova o backoff do item 3 do hardening de carga
 * (docs/DIAGNOSTICO_CONCORRENCIA_AGENTE.md): crescimento exponencial, teto,
 * retry-after honrado (e capado), full jitter dentro dos limites.
 */
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { computeRetryDelayMs } from "../../_shared/llmProvider.ts";

Deno.test("computeRetryDelayMs: cresce exponencialmente por tentativa (com random determinístico no teto)", () => {
    const random = () => 1; // força o teto da faixa em cada chamada
    assertEquals(computeRetryDelayMs(0, { random, baseMs: 1000, maxMs: 30_000 }), 1000);
    assertEquals(computeRetryDelayMs(1, { random, baseMs: 1000, maxMs: 30_000 }), 2000);
    assertEquals(computeRetryDelayMs(2, { random, baseMs: 1000, maxMs: 30_000 }), 4000);
    assertEquals(computeRetryDelayMs(3, { random, baseMs: 1000, maxMs: 30_000 }), 8000);
});

Deno.test("computeRetryDelayMs: nunca excede maxMs mesmo em tentativas altas", () => {
    const random = () => 1;
    const delay = computeRetryDelayMs(10, { random, baseMs: 1000, maxMs: 30_000 });
    assertEquals(delay, 30_000);
});

Deno.test("computeRetryDelayMs: com random=0 o delay é 0 (full jitter cobre o intervalo inteiro)", () => {
    const random = () => 0;
    assertEquals(computeRetryDelayMs(2, { random, baseMs: 1000, maxMs: 30_000 }), 0);
});

Deno.test("computeRetryDelayMs: retry-after do servidor tem prioridade sobre o cálculo exponencial", () => {
    const delay = computeRetryDelayMs(0, { retryAfterHeader: "5", baseMs: 1000, maxMs: 30_000 });
    assertEquals(delay, 5000);
});

Deno.test("computeRetryDelayMs: retry-after é capado por maxMs — servidor não trava o turno inteiro", () => {
    const delay = computeRetryDelayMs(0, { retryAfterHeader: "120", maxMs: 30_000 });
    assertEquals(delay, 30_000);
});

Deno.test("computeRetryDelayMs: retry-after inválido/não numérico cai para o cálculo exponencial", () => {
    const random = () => 1;
    const delay = computeRetryDelayMs(1, { retryAfterHeader: "not-a-number", random, baseMs: 1000, maxMs: 30_000 });
    assertEquals(delay, 2000);
});

Deno.test("computeRetryDelayMs: sem header nem opções, respeita os limites default (random real)", () => {
    for (let attempt = 0; attempt < 6; attempt++) {
        const delay = computeRetryDelayMs(attempt);
        assert(delay >= 0, `delay negativo na tentativa ${attempt}: ${delay}`);
        assert(delay <= 30_000, `delay acima do teto default na tentativa ${attempt}: ${delay}`);
    }
});
