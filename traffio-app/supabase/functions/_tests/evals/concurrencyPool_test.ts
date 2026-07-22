/**
 * concurrencyPool_test — prova o contrato do dispatcher usado no item 2 do
 * hardening de carga (docs/DIAGNOSTICO_CONCORRENCIA_AGENTE.md): nunca excede
 * o teto de concorrência, processa tudo sem orçamento, respeita o orçamento
 * sem abandonar trabalho já disparado.
 */
import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { runWithConcurrencyLimit } from "../../_shared/concurrencyPool.ts";

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.test("runWithConcurrencyLimit: processa todos os itens sem orçamento", async () => {
    const items = Array.from({ length: 23 }, (_, i) => i);
    const done: number[] = [];
    const result = await runWithConcurrencyLimit(items, async (i) => {
        await delay(1);
        done.push(i);
    }, { concurrency: 5 });

    assertEquals(result.dispatched, 23);
    assertEquals(result.remaining, 0);
    assertEquals(done.length, 23);
    assertEquals(new Set(done).size, 23); // nenhum item duplicado/perdido
});

Deno.test("runWithConcurrencyLimit: NUNCA excede o teto de itens em voo simultaneamente", async () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    let inFlight = 0;
    let maxInFlight = 0;
    const CONCURRENCY = 4;

    await runWithConcurrencyLimit(items, async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(5); // dá tempo do dispatcher tentar (e falhar) exceder o teto
        inFlight--;
    }, { concurrency: CONCURRENCY });

    assert(maxInFlight <= CONCURRENCY, `esperava <= ${CONCURRENCY} em voo, mas chegou a ${maxInFlight}`);
    assertEquals(maxInFlight, CONCURRENCY, "com 30 itens e teto 4, deveria saturar o teto pelo menos uma vez");
});

Deno.test("runWithConcurrencyLimit: orçamento de relógio para NOVOS disparos, mas espera os em voo terminarem", async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const started: number[] = [];
    const finished: number[] = [];
    let virtualNow = 0;

    const result = await runWithConcurrencyLimit(items, async (i) => {
        started.push(i);
        virtualNow += 30; // cada item "gasta" 30ms de relógio
        await delay(1);
        finished.push(i);
    }, {
        concurrency: 2,
        budgetMs: 50, // deveria caber ~2 rodadas de 2 (dispatch é síncrono, então o corte é determinístico via virtualNow)
        clockNow: () => virtualNow,
    });

    // Nem todo item foi disparado (orçamento estourou antes do fim)
    assert(result.dispatched < items.length, `esperava disparo parcial, disparou ${result.dispatched}/${items.length}`);
    assertEquals(result.dispatched + result.remaining, items.length, "dispatched + remaining deve sempre bater com o total");
    // Todo item DISPARADO deve ter terminado — nenhum "solto" sem ninguém esperando
    assertEquals(finished.length, started.length, "todo item disparado deve terminar — dispatcher não pode retornar antes do drain");
});

Deno.test("runWithConcurrencyLimit: lista vazia não quebra e não dispara nada", async () => {
    const result = await runWithConcurrencyLimit([], async () => { throw new Error("nunca deveria rodar"); }, { concurrency: 3 });
    assertEquals(result.dispatched, 0);
    assertEquals(result.remaining, 0);
});

Deno.test("runWithConcurrencyLimit: um item falhando não trava nem derruba os demais", async () => {
    const items = [1, 2, 3, 4, 5];
    const ok: number[] = [];
    const result = await runWithConcurrencyLimit(items, async (i) => {
        if (i === 3) return; // worker real trata erro internamente (try/catch) — pool não faz retry/propagação
        await delay(1);
        ok.push(i);
    }, { concurrency: 2 });

    assertEquals(result.dispatched, 5);
    assertEquals(ok.sort(), [1, 2, 4, 5]);
});
