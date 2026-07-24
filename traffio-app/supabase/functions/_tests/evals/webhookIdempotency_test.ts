/**
 * webhookIdempotency_test.ts — guarda a compensação de idempotência do webhook
 * (whatsapp-bot/index.ts). Rodar (na pasta supabase/functions):
 *   npx deno test -A _tests/evals/webhookIdempotency_test.ts
 *
 * Bug de produção (2026-07-23): falha transitória no INSERT de message_inbox
 * deixava o marcador processed_webhooks committado para sempre — a
 * retentativa do provedor batia em 23505 e a mensagem nunca chegava a existir
 * em lugar nenhum (perda silenciosa e permanente). Se estes testes quebrarem,
 * o bug está voltando.
 */
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { compensateIdempotencyMarker } from "../../_shared/webhookIdempotency.ts";

function createMockSupabase(deleteError: { message: string } | null = null) {
    const calls: { table: string; tenantId?: string; messageId?: string }[] = [];
    return {
        calls,
        client: {
            from: (table: string) => ({
                delete: () => ({
                    eq: (col1: string, val1: string) => ({
                        eq: (col2: string, val2: string) => {
                            calls.push({
                                table,
                                tenantId: col1 === "tenant_id" ? val1 : val2,
                                messageId: col1 === "message_id" ? val1 : val2,
                            });
                            return Promise.resolve({ error: deleteError });
                        },
                    }),
                }),
            }),
        },
    };
}

Deno.test("compensateIdempotencyMarker: deleta o marcador exato (tenant_id + message_id) da conversa que falhou", async () => {
    const mock = createMockSupabase();
    await compensateIdempotencyMarker(mock.client as any, "tenant-1", "wamid-123", "Z-API");
    assertEquals(mock.calls.length, 1);
    assertEquals(mock.calls[0].table, "processed_webhooks");
    assertEquals(mock.calls[0].tenantId, "tenant-1");
    assertEquals(mock.calls[0].messageId, "wamid-123");
});

Deno.test("compensateIdempotencyMarker: falha do delete é best-effort — não lança", async () => {
    const mock = createMockSupabase({ message: "connection reset" });
    // Não deve lançar mesmo com erro no delete — é best-effort por design.
    await compensateIdempotencyMarker(mock.client as any, "tenant-1", "wamid-123", "Cloud API");
    assertEquals(mock.calls.length, 1);
});

Deno.test("compensateIdempotencyMarker: exceção do client (rede) nunca propaga", async () => {
    const throwingClient = {
        from: () => ({
            delete: () => ({
                eq: () => ({
                    eq: () => { throw new Error("network down"); },
                }),
            }),
        }),
    };
    // Não deve lançar — o fail-safe do turno não pode depender do compensador.
    await compensateIdempotencyMarker(throwingClient as any, "tenant-1", "wamid-123", "Z-API");
});
