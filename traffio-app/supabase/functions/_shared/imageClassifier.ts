/**
 * imageClassifier — Camada 1 do framework de segurança contra alucinação em
 * imagem (Fase 1 — Visão, 2026-08-13). Decide, ANTES de qualquer coisa, se
 * uma imagem é segura pra mostrar ao agente de IA.
 *
 * Regra central: a IA NUNCA vê uma foto de conteúdo clínico (boca, dente,
 * pele, radiografia, qualquer coisa que mostre uma condição de saúde) — só
 * documentos administrativos (carteirinha de convênio, comprovante, print de
 * agendamento). Isto não é uma instrução pra IA "não comentar" — é a imagem
 * literalmente nunca chegando até o modelo principal quando for clínica.
 *
 * Fail-safe: qualquer dúvida, erro de rede, timeout ou resposta que não seja
 * exatamente "administrative" vira "clinical" — nunca o contrário. Nunca lança.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { claudeJson } from "./llmProvider.ts";

export type ImageCategory = "administrative" | "clinical";

export interface ClassifyImageDeps {
  /** Injeção pra teste — em produção nunca é passado. */
  claudeJsonFn?: typeof claudeJson;
}

const CLASSIFIER_SYSTEM_PROMPT = [
  "Você categoriza imagens recebidas por uma clínica de saúde. NUNCA descreva, interprete ou opine sobre o conteúdo da imagem — sua única tarefa é categorizar.",
  'Responda APENAS com JSON válido, neste formato: {"category":"administrative"|"clinical"}',
  "administrative = documento: carteirinha de convênio, comprovante de pagamento, print de tela (agendamento, conversa, formulário), documento de identidade, boleto.",
  "clinical = qualquer foto de parte do corpo, boca, dente, pele, radiografia, exame, ferimento, ou qualquer coisa que mostre (ou possa mostrar) uma condição de saúde.",
  "Se houver QUALQUER dúvida, ou a imagem não for CLARAMENTE um documento administrativo, responda 'clinical' — nunca arrisque classificar como administrative por engano.",
].join("\n");

/**
 * Classifica uma imagem como "administrative" (segura pra IA processar) ou
 * "clinical" (a IA nunca deve vê-la). Nunca lança — qualquer falha vira
 * "clinical", o lado cauteloso.
 */
export async function classifyImage(
  supabase: SupabaseClient,
  tenantId: string,
  imageUrl: string,
  model: string,
  deps: ClassifyImageDeps = {},
): Promise<ImageCategory> {
  const runClaudeJson = deps.claudeJsonFn ?? claudeJson;
  try {
    const result = await runClaudeJson<{ category?: string }>(supabase, {
      tenantId,
      purpose: "agent_image_triage",
      model,
      maxTokens: 50,
      system: CLASSIFIER_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Categorize esta imagem." },
            { type: "image", source: { type: "url", url: imageUrl } },
          ],
        },
      ],
    });
    if (result?.category === "administrative") return "administrative";
  } catch (error: any) {
    console.warn(`[imageClassifier] falha isolada (${error?.message ?? error}) — classificando como clinical (fail-safe)`);
  }
  return "clinical";
}

/**
 * Forma mínima de uma mensagem do lote fundido — usada por pickVisionEligibleImage.
 */
export interface VisionEligibleMessage {
  message_type?: string | null;
  media_url?: string | null;
  /** Marcado pelo pré-processamento em process-inbox após classifyImage retornar "administrative". */
  _visionEligible?: boolean;
}

/**
 * Escolhe a primeira imagem do lote já classificada como administrativa —
 * essa é a única imagem que pode ser anexada como conteúdo de visão pro
 * agente. Se o lote tiver mais de uma imagem elegível, só a primeira é usada
 * (mesma limitação de "1 mídia por turno" já documentada no resto do pipeline).
 */
export function pickVisionEligibleImage<T extends VisionEligibleMessage>(messages: T[]): T | undefined {
  return messages.find(
    (m) => !!m._visionEligible && !!m.media_url && String(m.message_type || "").toLowerCase() === "image",
  );
}
