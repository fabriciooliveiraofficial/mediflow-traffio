/**
 * llmCircuitBreaker — deduplica o alerta de falha de INFRA do LLM (chave
 * errada/revogada, Anthropic fora do ar, rede) para gerar UM alerta por
 * incidente, nunca um por conversa.
 *
 * Bug de produção (2026-07-23, ver memory/incident_api_key_wrong_slot.md): uma
 * chave Anthropic errada no slot de config derruba TODA chamada de TODAS as
 * conversas ao mesmo tempo. Sem isto, cada conversa simultânea acionava o
 * mesmo alerta de novo — o operador via uma "enxurrada" em vez de UM incidente
 * claro, e o sinal real (a chave está errada) se perdia no ruído.
 *
 * Armazenamento: reaproveita master_config (mesma tabela KV já usada por
 * masterConfig.ts para credenciais/flags da plataforma) — nenhuma migration
 * nova. Concorrência é best-effort: um alerta duplicado ocasional sob corrida
 * é aceitável; o que importa é não gerar um por turno.
 */
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const ALERT_KEY = "LLM_INFRA_ALERT_LAST_SENT_AT";
/** Detalhe do último incidente (JSON {at, kind, message}) — lido pelo banner
 * do painel Master → Intelligence, pra que "chave inválida" apareça como
 * incidente nomeado na tela, não como conversas misteriosamente travadas. */
const ALERT_DETAIL_KEY = "LLM_INFRA_ALERT_LAST_DETAIL";
const ALERT_COOLDOWN_MS = 10 * 60 * 1000; // 10 min: 1 alerta por incidente, não por turno

/**
 * true se ESTE chamador deve emitir o alerta agora (primeira falha do
 * incidente, ou o cooldown do último alerta já expirou). Marca o timestamp
 * antes de retornar para que chamadas concorrentes no mesmo tick não dupliquem.
 */
export async function shouldRaiseLlmInfraAlert(supabase: SupabaseClient): Promise<boolean> {
    try {
        const { data } = await supabase.from("master_config").select("value").eq("key", ALERT_KEY).maybeSingle();
        const lastSentAt = data?.value ? Date.parse(data.value as string) : NaN;
        if (Number.isFinite(lastSentAt) && Date.now() - lastSentAt < ALERT_COOLDOWN_MS) return false;
        await supabase.from("master_config").upsert({ key: ALERT_KEY, value: new Date().toISOString() }, { onConflict: "key" });
        return true;
    } catch {
        // Nunca deixar o dedupe do alerta bloquear o fail-safe do turno.
        return true;
    }
}

/**
 * Persiste o detalhe do incidente pro banner do painel Master. Best-effort —
 * chamado junto com o console.error do alerta (já deduplicado pelo cooldown
 * acima), nunca no caminho quente de cada turno.
 */
export async function recordLlmInfraAlertDetail(
    supabase: SupabaseClient,
    kind: string,
    message: string,
): Promise<void> {
    try {
        await supabase.from("master_config").upsert({
            key: ALERT_DETAIL_KEY,
            value: JSON.stringify({ at: new Date().toISOString(), kind, message: message.slice(0, 400) }),
        }, { onConflict: "key" });
    } catch {
        // Best-effort: o alerta no log já saiu; nunca falhar o fail-safe por isso.
    }
}
