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

Deno.test("computeRetryDelayMs: full jitter nunca desce abaixo do piso — retry sem espera não é retry", () => {
    const random = () => 0; // pior caso do jitter
    assertEquals(computeRetryDelayMs(2, { random, baseMs: 1000, maxMs: 30_000, minMs: 750 }), 750);
});

// ── Bug de produção 2026-08-12 (HTTP 529 da Anthropic) ────────────────────
// A Anthropic responde 529 "overloaded_error" COM `retry-after: 0`. O código
// honrava esse 0 e disparava as 4 tentativas coladas ("retry 1/4 em 0ms" …
// "retry 4/4 em 0ms"), martelando um servidor já sobrecarregado e desistindo
// em ~12s — o paciente ficava sem resposta numa instabilidade de segundos.

Deno.test("computeRetryDelayMs: retry-after '0' NÃO zera a espera — cai no backoff exponencial", () => {
    const random = () => 1;
    const delay = computeRetryDelayMs(1, { retryAfterHeader: "0", random, baseMs: 1000, maxMs: 30_000 });
    assertEquals(delay, 2000);
});

Deno.test("computeRetryDelayMs: retry-after negativo também cai no backoff exponencial", () => {
    const random = () => 1;
    const delay = computeRetryDelayMs(0, { retryAfterHeader: "-5", random, baseMs: 1000, maxMs: 30_000 });
    assertEquals(delay, 1000);
});

Deno.test("computeRetryDelayMs: retry-after muito curto (0,1s) é elevado ao piso mínimo", () => {
    const delay = computeRetryDelayMs(0, { retryAfterHeader: "0.1", minMs: 750, maxMs: 30_000 });
    assertEquals(delay, 750);
});

Deno.test("computeRetryDelayMs: as 4 tentativas do 529 somam espera real (nunca a sequência 0,0,0,0 do bug)", () => {
    const random = () => 0; // pior caso: jitter sempre no mínimo
    const delays = [0, 1, 2, 3].map(attempt =>
        computeRetryDelayMs(attempt, { retryAfterHeader: "0", random, baseMs: 1000, maxMs: 30_000, minMs: 750 })
    );
    for (const d of delays) assert(d > 0, `tentativa sem espera: ${delays.join(", ")}`);
    const total = delays.reduce((a, b) => a + b, 0);
    assert(total >= 3000, `espera total insuficiente para absorver um 529: ${total}ms`);
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
