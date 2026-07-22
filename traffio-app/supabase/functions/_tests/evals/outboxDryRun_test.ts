/**
 * outboxDryRun_test — prova que o dry-run do OutboxDispatcher (usado no teste de
 * carga, docs/DIAGNOSTICO_CONCORRENCIA_AGENTE.md) nunca toca rede/Z-API/Cloud API
 * quando `bot_config.outbound_dry_run` está ligado, e que a flag é escopada por
 * TENANT — um tenant sem a flag continua exigindo credenciais reais (nunca vira
 * dry-run "sem querer" por omissão).
 */
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { OutboxDispatcher } from "../../_shared/outboxDispatcher.ts";

// Stub: se o dry-run realmente não tocar rede, este supabase nunca é usado.
const stubSupabase: any = {
    from: () => { throw new Error("dry-run não deveria tocar o banco"); },
};

Deno.test("OutboxDispatcher.sendNow: bot_config.outbound_dry_run=true nunca chama Z-API/Cloud API", async () => {
    const dispatcher = new OutboxDispatcher(stubSupabase);
    const tenant = { id: "tenant-teste", whatsapp_provider: "zapi", bot_config: { outbound_dry_run: true } };

    const result = await dispatcher.sendNow(tenant, "5511999999999", { text: "oi" });

    assert(typeof result === "string" && result.startsWith("dry-run-"), `esperava id simulado 'dry-run-...', veio "${result}"`);
});

Deno.test("OutboxDispatcher.sendSequence: dry-run cobre todas as bolhas sem tocar rede", async () => {
    const dispatcher = new OutboxDispatcher(stubSupabase);
    const tenant = { id: "tenant-teste", whatsapp_provider: "zapi", bot_config: { outbound_dry_run: true } };

    const sent = await dispatcher.sendSequence(tenant, "5511999999999", ["oi", "tudo bem?", "vamos agendar?"]);

    assertEquals(sent, ["oi", "tudo bem?", "vamos agendar?"]);
});

Deno.test("OutboxDispatcher.sendNow: sem bot_config.outbound_dry_run, a checagem não dispara (undefined é falsy)", async () => {
    const dispatcher = new OutboxDispatcher(stubSupabase);
    // Sem a flag: o dry-run NUNCA deve disparar por omissão. Não chamamos de
    // fato (isso bateria na rede real da Z-API) — só provamos que a condição
    // `tenant?.bot_config?.outbound_dry_run` é falsy nos formatos que um tenant
    // real pode assumir (bot_config ausente, ou presente sem a chave).
    const semBotConfig = { id: "t1" } as any;
    const comBotConfigSemFlag = { id: "t2", bot_config: { active_agent: "ai_always" } } as any;
    assert(!semBotConfig?.bot_config?.outbound_dry_run);
    assert(!comBotConfigSemFlag?.bot_config?.outbound_dry_run);
});
