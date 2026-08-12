/**
 * documentClassifier — Camada 1 do framework de segurança contra alucinação em
 * arquivo (Fase 2 — Arquivos, 2026-08-13). Decide, ANTES de qualquer coisa, se
 * um documento é seguro pra mostrar ao agente de IA. Mesmo molde de
 * imageClassifier.ts (Fase 1 — Visão).
 *
 * Três categorias, não duas:
 * - "administrative": documento seguro pra IA ler (carteirinha, comprovante,
 *   print de agendamento, encaminhamento simples). Só esta passa.
 * - "clinical": laudo, exame, radiografia, receita, qualquer coisa que mostre
 *   condição de saúde. A IA NUNCA vê.
 * - "financial": orçamento (inclusive de outra clínica), tabela de preços,
 *   proposta comercial. A IA NUNCA vê — decisão deliberada: a POLÍTICA DE
 *   PREÇO do produto é absoluta (ver AUTONOMOUS_ADDENDUM em copilot.ts), e o
 *   preço aqui estaria DENTRO do arquivo, fora do alcance do validador de
 *   texto de saída. A defesa é o arquivo nunca chegar, igual às outras duas.
 *
 * Fail-safe: qualquer dúvida, erro de rede, timeout ou resposta que não seja
 * exatamente "administrative" vira "clinical" — nunca lança, nunca arrisca.
 *
 * Diferença estrutural em relação a imageClassifier: documento tem um PORTÃO
 * DETERMINÍSTICO antes do LLM (mime fora da allowlist, tamanho grande demais,
 * ou PDF com páginas demais) — filtra o caso comum (financial/clinical de
 * arquivo grande) sem gastar nenhuma chamada de modelo.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { claudeJson } from "./llmProvider.ts";

export type DocumentCategory = "administrative" | "clinical" | "financial";

export interface DocumentRef {
  url: string;
  filename?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  /**
   * Texto já extraído (Onda 3 — officeExtractor.ts), pra .docx/.xlsx/.txt/.csv/.md.
   * O Claude só lê documento nativamente como PDF — qualquer outro formato só
   * é classificável quando o chamador já extraiu o texto e passa aqui; sem
   * isso, classifyDocument nunca tenta (ver deterministicGate).
   */
  extractedText?: string | null;
}

export interface ClassifyDocumentDeps {
  /** Injeção pra teste — em produção nunca é passado. */
  claudeJsonFn?: typeof claudeJson;
  fetchFn?: typeof fetch;
}

// Tudo que NÃO suportamos nesta fase (áudio/vídeo já têm caminho próprio;
// .doc/.xls binários legados ficam de fora do escopo) é rejeitado aqui sem
// gastar LLM. Mime ausente/desconhecido NÃO é rejeitado por este portão —
// segue para a classificação real, que tem seu próprio fail-safe.
const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
]);

// 4MB — bem abaixo do teto de 16MB do bucket chat-media; documento
// administrativo real (carteirinha, comprovante, print) nunca chega perto
// disso. Acima daqui, custo/latência de mandar pro modelo não compensa —
// vira clinical (fila humana) sem chamar o LLM. Exportado porque process-inbox
// usa o mesmo teto pra decidir se baixa bytes pra extração de texto (Onda 3).
export const MAX_DOC_BYTES_FOR_AI = 4 * 1024 * 1024;

// Sniff best-effort de páginas de PDF — conta ocorrências do marcador de
// objeto `/Type /Page` no bytes cru. NÃO é um parser de PDF de verdade (PDFs
// com object streams comprimidos escondem o marcador, e o sniff subconta
// nesse caso) — por isso só APERTA, nunca AFROUXA: se o sniff achar um número
// claramente acima do teto, rejeita; se o sniff falhar ou não achar nada
// conclusivo, segue para a classificação normal (nunca usa "0 achado" como
// aprovação implícita).
const MAX_PDF_PAGES = 20;
const PDF_SNIFF_TIMEOUT_MS = 5_000;
const PDF_PAGE_MARKER = /\/Type\s*\/Page(?!s)\b/g;

const CLASSIFIER_SYSTEM_PROMPT = [
  "Você categoriza documentos recebidos por uma clínica de saúde. NUNCA descreva, resuma ou opine sobre o conteúdo do documento — sua única tarefa é categorizar.",
  'Responda APENAS com JSON válido, neste formato: {"category":"administrative"|"clinical"|"financial"}',
  "administrative = documento administrativo simples: carteirinha de convênio, comprovante de pagamento, print de tela (agendamento, conversa, formulário), documento de identidade, encaminhamento SEM detalhe clínico (só nome do especialista/motivo em 1 linha).",
  "clinical = laudo, resultado de exame, radiografia, receita médica, prontuário, relatório de procedimento, ou qualquer documento que descreva ou mostre uma condição de saúde.",
  "financial = orçamento (inclusive de outra clínica), tabela de preços, proposta comercial, nota fiscal de procedimento com valores.",
  "Se houver QUALQUER dúvida sobre a categoria, responda 'clinical' — nunca arrisque classificar como administrative por engano.",
].join("\n");

/**
 * Portão determinístico — roda ANTES de qualquer chamada de modelo. Retorna
 * uma categoria (sempre "clinical", o lado cauteloso) quando o documento não
 * deve nem tentar chegar à IA, ou `null` quando deve seguir para a
 * classificação real.
 */
function deterministicGate(doc: DocumentRef): DocumentCategory | null {
  if (doc.mimeType && !ALLOWED_DOCUMENT_MIME_TYPES.has(doc.mimeType)) {
    console.warn(`[documentClassifier] mime fora da allowlist (${doc.mimeType}) — clinical sem chamar modelo`);
    return "clinical";
  }
  if (doc.sizeBytes != null && doc.sizeBytes > MAX_DOC_BYTES_FOR_AI) {
    console.warn(`[documentClassifier] arquivo grande demais (${doc.sizeBytes} bytes) — clinical sem chamar modelo`);
    return "clinical";
  }
  return null;
}

/** Sniff best-effort de páginas — nunca lança, nunca afrouxa (ver comentário no topo do arquivo). */
async function sniffPdfExceedsPageLimit(url: string, fetchFn: typeof fetch): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PDF_SNIFF_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res.ok) return false;
    const bytes = new Uint8Array(await res.arrayBuffer());
    // latin1: preserva 1 byte = 1 char, suficiente pra achar marcadores ASCII
    // sem decodificar o PDF de verdade.
    const text = new TextDecoder("latin1").decode(bytes);
    const matches = text.match(PDF_PAGE_MARKER);
    return !!matches && matches.length > MAX_PDF_PAGES;
  } catch (error: any) {
    console.warn(`[documentClassifier] sniff de páginas falhou isoladamente (${error?.message ?? error}) — não bloqueia`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Classifica um documento como "administrative" (seguro pra IA ler),
 * "clinical" ou "financial" (a IA nunca deve ver nenhum dos dois). Nunca
 * lança — qualquer falha vira "clinical", o lado cauteloso.
 */
export async function classifyDocument(
  supabase: SupabaseClient,
  tenantId: string,
  doc: DocumentRef,
  model: string,
  deps: ClassifyDocumentDeps = {},
): Promise<DocumentCategory> {
  const gated = deterministicGate(doc);
  if (gated) return gated;

  const isPdf = doc.mimeType === "application/pdf" || /\.pdf$/i.test(doc.filename || "");

  // Onda 3 (officeExtractor.ts): o Claude só lê documento nativamente como
  // PDF. Qualquer outro formato só é classificável quando o CHAMADOR já
  // extraiu o texto (process-inbox faz isso antes de chegar aqui) — sem
  // extractedText e sem ser PDF, não há como mostrar isto à IA com
  // segurança. clinical sem gastar LLM, mesmo espírito do portão determinístico.
  if (!isPdf && !doc.extractedText) {
    console.warn(`[documentClassifier] formato não-PDF sem texto extraído — clinical sem chamar modelo`);
    return "clinical";
  }

  if (isPdf) {
    const fetchFn = deps.fetchFn ?? fetch;
    const tooManyPages = await sniffPdfExceedsPageLimit(doc.url, fetchFn);
    if (tooManyPages) {
      console.warn(`[documentClassifier] PDF com mais de ${MAX_PDF_PAGES} páginas (sniff) — clinical sem chamar modelo`);
      return "clinical";
    }
  }

  const runClaudeJson = deps.claudeJsonFn ?? claudeJson;
  try {
    const attachmentBlock = doc.extractedText
      ? { type: "text", text: doc.extractedText }
      : { type: "document", source: { type: "url", url: doc.url } };
    const result = await runClaudeJson<{ category?: string }>(supabase, {
      tenantId,
      purpose: "agent_document_triage",
      model,
      maxTokens: 50,
      system: CLASSIFIER_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `Categorize este documento (nome: ${doc.filename || "desconhecido"}).` },
            attachmentBlock,
          ],
        },
      ],
    });
    if (result?.category === "administrative") return "administrative";
    if (result?.category === "financial") return "financial";
  } catch (error: any) {
    console.warn(`[documentClassifier] falha isolada (${error?.message ?? error}) — classificando como clinical (fail-safe)`);
  }
  return "clinical";
}

/**
 * Forma mínima de uma mensagem do lote fundido — usada por pickEligibleDocument.
 */
export interface DocumentEligibleMessage {
  message_type?: string | null;
  media_url?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  /** Marcado pelo pré-processamento em process-inbox após classifyDocument retornar "administrative". */
  _documentEligible?: boolean;
}

/**
 * Escolhe o primeiro documento do lote já classificado como administrativo —
 * o único que pode ser anexado como conteúdo pro agente. Se o lote tiver mais
 * de um documento elegível, só o primeiro é usado (mesma limitação de "1
 * mídia por turno" já documentada no resto do pipeline).
 */
export function pickEligibleDocument<T extends DocumentEligibleMessage>(messages: T[]): T | undefined {
  return messages.find(
    (m) => !!m._documentEligible && !!m.media_url && String(m.message_type || "").toLowerCase() === "document",
  );
}
