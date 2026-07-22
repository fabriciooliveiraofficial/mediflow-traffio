/**
 * concurrencyPool — dispatcher genérico de concorrência limitada.
 *
 * Extraído do process-inbox (item 2 do hardening de carga,
 * docs/DIAGNOSTICO_CONCORRENCIA_AGENTE.md) para ser testável isoladamente —
 * a lógica de "N em voo, respeitar orçamento de relógio, nunca abandonar
 * trabalho já disparado" é fácil de acertar errado de forma sutil (off-by-one
 * no cap, dispatch após o orçamento, retornar antes do drain completo).
 *
 * Contrato: NUNCA excede `concurrency` itens em voo ao mesmo tempo; para de
 * DISPARAR itens novos após `budgetMs` (se informado), mas sempre espera os já
 * disparados terminarem antes de resolver — nenhum trabalho fica "solto" sem
 * ninguém aguardando.
 */

export interface ConcurrencyPoolOptions {
    /** Máximo de itens em voo ao mesmo tempo. */
    concurrency: number;
    /** Se definido, para de disparar itens NOVOS após este tempo (ms) desde o início. Itens já em voo sempre terminam. */
    budgetMs?: number;
    /** Injeção de relógio para teste determinístico. Default: Date.now. */
    clockNow?: () => number;
}

export interface ConcurrencyPoolResult {
    /** Quantos itens foram efetivamente disparados (processados ou em erro). */
    dispatched: number;
    /** Quantos itens ficaram sem disparar por causa do orçamento de relógio. */
    remaining: number;
}

export async function runWithConcurrencyLimit<T>(
    items: readonly T[],
    worker: (item: T) => Promise<void>,
    opts: ConcurrencyPoolOptions,
): Promise<ConcurrencyPoolResult> {
    const now = opts.clockNow ?? Date.now;
    const start = now();
    let nextIndex = 0;
    const inFlight = new Set<Promise<void>>();
    let budgetHit = false;

    while (nextIndex < items.length || inFlight.size > 0) {
        if (!budgetHit && opts.budgetMs !== undefined && now() - start > opts.budgetMs) {
            budgetHit = true;
        }
        while (!budgetHit && nextIndex < items.length && inFlight.size < opts.concurrency) {
            const item = items[nextIndex++];
            const p: Promise<void> = worker(item).finally(() => { inFlight.delete(p); });
            inFlight.add(p);
        }
        if (inFlight.size === 0) break; // nada em voo e orçamento estourado (ou lista vazia) — encerra
        await Promise.race(inFlight);
    }

    return { dispatched: nextIndex, remaining: items.length - nextIndex };
}
