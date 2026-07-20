import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { getOpenAiApiKey } from "./masterConfig.ts";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const EMBEDDING_TIMEOUT_MS = 3_000;

interface EmbedTextOptions {
  /** Injeções usadas somente pelos testes; produção usa fetch e master_config. */
  fetchFn?: typeof fetch;
  resolveApiKey?: (supabase: SupabaseClient) => Promise<string>;
  timeoutMs?: number;
}

/**
 * Gera embedding sem jamais propagar falha ao atendimento.
 * Credencial ausente, HTTP inválido, payload inesperado e timeout retornam null.
 */
export async function embedText(
  supabase: SupabaseClient,
  text: string,
  options: EmbedTextOptions = {},
): Promise<number[] | null> {
  const cleanText = text.trim();
  if (!cleanText) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? EMBEDDING_TIMEOUT_MS);

  try {
    const apiKey = (await (options.resolveApiKey ?? getOpenAiApiKey)(supabase)).trim();
    if (!apiKey) {
      console.warn("[embeddings] OPENAI_API_KEY ausente; RAG indisponível");
      return null;
    }

    const response = await (options.fetchFn ?? fetch)(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: cleanText,
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`[embeddings] OpenAI respondeu HTTP ${response.status}; seguindo sem RAG`);
      return null;
    }

    const payload = await response.json();
    const embedding = payload?.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS ||
      !embedding.every((value: unknown) => typeof value === "number" && Number.isFinite(value))) {
      console.warn("[embeddings] payload de embedding inválido; seguindo sem RAG");
      return null;
    }
    return embedding;
  } catch (error: any) {
    const reason = error?.name === "AbortError" ? "timeout" : (error?.message || "erro desconhecido");
    console.warn(`[embeddings] falha isolada (${reason}); seguindo sem RAG`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
