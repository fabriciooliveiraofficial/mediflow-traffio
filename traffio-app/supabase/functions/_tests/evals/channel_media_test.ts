/**
 * channel_media_test — E-5 (2026-08-02). A confirmação de agendamento com
 * imagem chegava sem a imagem em Instagram, Messenger e Live Chat, mesmo já
 * corrigida (E-2) para vir sempre com `media_url` quando o tenant configura
 * uma capa. As peças para enviar a imagem já existiam no código — só nunca
 * eram chamadas:
 *
 * - Instagram/Messenger: `MetaSocialClient.sendInstagramAttachment` /
 *   `sendFacebookAttachment` já existiam; `OutboxDispatcher.sendNow` só
 *   chamava as variantes de texto puro.
 * - Live Chat: o widget (`public/livechat-widget.js`) já sabe renderizar
 *   `message_type:"image"` + `media_url` na MESMA bolha da mensagem; o
 *   broadcast do backend nunca preenchia esses campos.
 *
 * A API da Meta (Messenger/Instagram) NÃO aceita anexo+texto no mesmo
 * "message" object (confirmado na documentação oficial) — diferente do
 * WhatsApp. Por isso nesses dois canais a imagem sai como mensagem separada,
 * IMEDIATAMENTE antes do texto (o mais próximo possível de bloco único que a
 * plataforma permite); no Live Chat, texto e imagem vão na mesma bolha.
 */
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { OutboxDispatcher } from "../../_shared/outboxDispatcher.ts";

const GRAPH_API_HOST = "graph.facebook.com";

/** Troca globalThis.fetch por um mock que registra cada chamada à Graph API da Meta. */
function withFetchMock(calls: { url: string; body: any }[], impl?: (url: string, body: any) => any) {
    const original = globalThis.fetch;
    (globalThis as any).fetch = async (input: any, init?: any) => {
        const url = String(input);
        const body = init?.body ? JSON.parse(init.body) : null;
        calls.push({ url, body });
        const data = impl ? impl(url, body) : { message_id: "mid-mock", recipient_id: "rid-mock" };
        return { json: async () => data } as any;
    };
    return () => { (globalThis as any).fetch = original; };
}

function chainable(data: any) {
    const obj: any = {
        select: () => obj, eq: () => obj, not: () => obj, limit: () => obj,
        maybeSingle: async () => ({ data, error: null }),
    };
    return obj;
}

function mockSupabaseForMeta(metaPage: any) {
    return { from: (_table: string) => chainable(metaPage) };
}

// ── Instagram/Messenger: imagem enviada ANTES do texto, como mensagens separadas ──

Deno.test("sendNow (instagram): com media_url, envia a imagem (attachment) e DEPOIS o texto — duas chamadas, nessa ordem", async () => {
    const calls: { url: string; body: any }[] = [];
    const restore = withFetchMock(calls);
    try {
        const supabase = mockSupabaseForMeta({ page_access_token: "tok-1", instagram_account_id: "ig-1" });
        const dispatcher = new OutboxDispatcher(supabase as any);
        const tenant = { id: "tenant-1" };
        await dispatcher.sendNow(tenant, "igsid-123", { text: "Confirmação personalizada do tenant", media_url: "https://cdn.example.com/capa.png", media_type: "image", channel: "instagram" });

        assertEquals(calls.length, 2, "esperava 2 chamadas: imagem + texto");
        assert(calls[0].body.message.attachment, "a PRIMEIRA chamada deveria ser o anexo de imagem");
        assertEquals(calls[0].body.message.attachment.type, "image");
        assertEquals(calls[0].body.message.attachment.payload.url, "https://cdn.example.com/capa.png");
        assertEquals(calls[0].body.recipient.id, "igsid-123");

        assert(calls[1].body.message.text, "a SEGUNDA chamada deveria ser o texto");
        assertEquals(calls[1].body.message.text, "Confirmação personalizada do tenant");
    } finally {
        restore();
    }
});

Deno.test("sendNow (facebook): com media_url, envia a imagem e depois o texto", async () => {
    const calls: { url: string; body: any }[] = [];
    const restore = withFetchMock(calls);
    try {
        const supabase = mockSupabaseForMeta({ page_access_token: "tok-1" });
        const dispatcher = new OutboxDispatcher(supabase as any);
        await dispatcher.sendNow({ id: "tenant-1" }, "psid-456", { text: "Confirmação do tenant", media_url: "https://cdn.example.com/capa.png", channel: "facebook" });

        assertEquals(calls.length, 2);
        assert(calls[0].body.message.attachment);
        assert(calls[1].body.message.text);
    } finally {
        restore();
    }
});

Deno.test("sendNow (instagram/facebook): SEM media_url, envia só o texto — comportamento anterior preservado", async () => {
    const calls: { url: string; body: any }[] = [];
    const restore = withFetchMock(calls);
    try {
        const supabase = mockSupabaseForMeta({ page_access_token: "tok-1", instagram_account_id: "ig-1" });
        const dispatcher = new OutboxDispatcher(supabase as any);
        await dispatcher.sendNow({ id: "tenant-1" }, "igsid-123", { text: "Olá!", channel: "instagram" });

        assertEquals(calls.length, 1, "sem imagem configurada, não deveria haver chamada de anexo");
        assert(calls[0].body.message.text);
    } finally {
        restore();
    }
});

Deno.test("sendNow (instagram): imagem falha (Graph API retorna erro) — o texto AINDA assim é enviado, nunca perde a confirmação", async () => {
    const calls: { url: string; body: any }[] = [];
    // Code 190 = token inválido — erro real e distinto do "fora da janela de
    // 24h" (que dispara retry automático dentro de sendInstagramAttachment).
    const restore = withFetchMock(calls, (_url, body) => {
        if (body.message?.attachment) return { error: { code: 190, message: "token inválido" } };
        return { message_id: "mid-mock", recipient_id: "rid-mock" };
    });
    try {
        const supabase = mockSupabaseForMeta({ page_access_token: "tok-1", instagram_account_id: "ig-1" });
        const dispatcher = new OutboxDispatcher(supabase as any);
        const result = await dispatcher.sendNow({ id: "tenant-1" }, "igsid-123", { text: "Confirmação do tenant", media_url: "https://cdn.example.com/capa-quebrada.png", channel: "instagram" });

        assertEquals(result, "mid-mock", "o texto deveria ter sido enviado com sucesso mesmo com a imagem falhando");
        assertEquals(calls.length, 2, "tentou a imagem (falhou) e ainda assim enviou o texto");
    } finally {
        restore();
    }
});

// ── Live Chat: texto + imagem na MESMA bolha (broadcast único) ──

function mockSupabaseForLivechat(sessionId: string | null, captured: any[]) {
    return {
        from: (_table: string) => chainable(sessionId ? { id: sessionId } : null),
        channel: (_name: string) => ({
            send: async (msg: any) => { captured.push(msg); return "ok"; },
        }),
    };
}

Deno.test("sendNow (livechat): com media_url, o broadcast inclui message_type:'image' e media_url NA MESMA mensagem", async () => {
    const captured: any[] = [];
    const supabase = mockSupabaseForLivechat("session-1", captured);
    const dispatcher = new OutboxDispatcher(supabase as any);
    await dispatcher.sendNow({ id: "tenant-1", name: "Clínica" }, "livechat-abc", { text: "Confirmação personalizada do tenant", media_url: "https://cdn.example.com/capa.png", channel: "livechat" });

    assertEquals(captured.length, 1, "deveria ser UMA única mensagem/bolha, não duas");
    const payload = captured[0].payload;
    assertEquals(payload.content, "Confirmação personalizada do tenant");
    assertEquals(payload.message_type, "image");
    assertEquals(payload.media_url, "https://cdn.example.com/capa.png");
});

Deno.test("sendNow (livechat): SEM media_url, não inclui message_type/media_url no broadcast", async () => {
    const captured: any[] = [];
    const supabase = mockSupabaseForLivechat("session-1", captured);
    const dispatcher = new OutboxDispatcher(supabase as any);
    await dispatcher.sendNow({ id: "tenant-1", name: "Clínica" }, "livechat-abc", { text: "Olá!", channel: "livechat" });

    const payload = captured[0].payload;
    assertEquals(payload.message_type, undefined);
    assertEquals(payload.media_url, undefined);
});
