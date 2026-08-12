/**
 * audioTranscriber — transcreve nota de voz via OpenAI Whisper, pra que o
 * agente de atendimento consiga entender e responder ao que o paciente falou
 * (Erro 3, 2026-08-13: hoje todo áudio caía direto em reconhecimento
 * automático + fila humana, a IA nunca via o conteúdo).
 *
 * Filosofia: nunca lança. Qualquer falha (chave ausente, rede, timeout,
 * HTTP não-ok, transcrição vazia OU de baixa confiança) retorna null — quem
 * chama NUNCA deve deixar a IA responder a partir de um texto incerto; o
 * fallback é sempre o mesmo caminho de hoje (Camada 3 + fila humana).
 *
 * Mesmo molde de _shared/embeddings.ts#embedText: AbortController, deps
 * injetáveis pra teste, warn+null em vez de lançar.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { getOpenAiApiKey } from "./masterConfig.ts";

const WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";
const TRANSCRIBE_TIMEOUT_MS = 15_000; // áudio é mais lento que texto/embedding — mais folga
// Acima deste limiar de "probabilidade média de não ter fala" nos segmentos
// devolvidos pelo Whisper, a transcrição é descartada — mais vale cair pra
// fila humana do que arriscar a IA responder a um texto inventado por ruído.
const NO_SPEECH_PROB_THRESHOLD = 0.6;

export interface TranscribeResult {
  text: string;
  language: string | null;
}

export interface TranscribeDeps {
  resolveApiKey?: (supabase: SupabaseClient) => Promise<string>;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Baixa o áudio (URL pública, já re-hospedada por resolveInboundMedia) e
 * transcreve via Whisper. Retorna null em qualquer falha ou baixa confiança.
 */
export async function transcribeAudio(
  supabase: SupabaseClient,
  audioUrl: string,
  filename: string,
  deps: TranscribeDeps = {},
): Promise<TranscribeResult | null> {
  const resolveApiKey = deps.resolveApiKey ?? getOpenAiApiKey;
  const fetchFn = deps.fetchFn ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? TRANSCRIBE_TIMEOUT_MS);

  try {
    const apiKey = (await resolveApiKey(supabase)).trim();
    if (!apiKey) {
      console.warn("[audioTranscriber] OPENAI_API_KEY ausente; transcrição indisponível");
      return null;
    }

    const audioRes = await fetchFn(audioUrl, { signal: controller.signal });
    if (!audioRes.ok) {
      console.warn(`[audioTranscriber] download do áudio falhou: HTTP ${audioRes.status}`);
      return null;
    }
    const audioBlob = await audioRes.blob();
    if (audioBlob.size === 0) {
      console.warn("[audioTranscriber] áudio baixado veio vazio");
      return null;
    }

    const form = new FormData();
    form.append("file", audioBlob, filename);
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");

    const res = await fetchFn(WHISPER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[audioTranscriber] Whisper respondeu HTTP ${res.status}`);
      return null;
    }

    const payload = await res.json();
    const text = String(payload?.text ?? "").trim();
    if (!text) {
      console.warn("[audioTranscriber] transcrição veio vazia");
      return null;
    }

    const segments = Array.isArray(payload?.segments) ? payload.segments : [];
    if (segments.length > 0) {
      const avgNoSpeech =
        segments.reduce((sum: number, s: any) => sum + (Number(s?.no_speech_prob) || 0), 0) / segments.length;
      if (avgNoSpeech > NO_SPEECH_PROB_THRESHOLD) {
        console.warn(`[audioTranscriber] baixa confiança (no_speech_prob médio ${avgNoSpeech.toFixed(2)}) — descartada`);
        return null;
      }
    }

    return { text, language: payload?.language ?? null };
  } catch (error: any) {
    const reason = error?.name === "AbortError" ? "timeout" : (error?.message || "erro desconhecido");
    console.warn(`[audioTranscriber] falha isolada (${reason})`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
