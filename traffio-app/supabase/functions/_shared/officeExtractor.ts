/**
 * officeExtractor — extrai texto de .docx, .xlsx e arquivos de texto puro
 * (Fase 2 — Arquivos, Onda 3, 2026-08-13), pra que o agente possa ler o
 * CONTEÚDO desses formatos (o Claude só lê PDF nativamente — Word/Excel
 * precisam de extração feita por nós antes de virar contexto do modelo).
 *
 * .docx/.xlsx são ZIP + XML por baixo. Em vez de trazer uma dependência
 * externa pro caminho crítico de receita, este arquivo implementa um leitor
 * de ZIP mínimo usando `DecompressionStream("deflate-raw")` — nativo do
 * runtime Deno/V8, sem npm/esm.sh. Cobre o caso real (arquivo gerado por
 * Word/Excel/LibreOffice, sem ZIP64, sem senha) — não é um parser de ZIP
 * genérico completo.
 *
 * Filosofia igual ao resto do pipeline de mídia: nunca lança. Qualquer falha
 * (ZIP corrompido, entrada ausente, XML inesperado) retorna null — quem
 * chama trata como "sem extração" e segue o caminho de hoje (fila humana).
 */

// Teto de caracteres devolvidos — documento administrativo real (carteirinha,
// comprovante, formulário) nunca chega perto disso; protege contra um
// .docx/.xlsx anormalmente grande virar um payload caro pro modelo.
export const MAX_EXTRACTED_CHARS = 20_000;

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIR_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const EOCD_SEARCH_WINDOW = 66_000; // 22 (EOCD fixo) + 65535 (comment máximo)

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Descompacta um bloco `deflate-raw` usando a API nativa de streams — sem dependência externa. */
async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  // Cópia pra um ArrayBuffer "normal" — bytes.subarray() pode devolver uma
  // view sobre um buffer que o typechecker não aceita como BlobPart.
  const owned = new Uint8Array(bytes);
  const stream = new Blob([owned]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}
function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

/**
 * Lê as entradas de um ZIP a partir do bytes cru. Só decompacta as entradas
 * cujo nome bate em `wanted` (economia — .docx/.xlsx reais têm dezenas de
 * entradas, só 1-2 interessam pra extração de texto). Nunca lança: ZIP
 * inválido/truncado retorna um Map vazio.
 */
export async function parseZipEntries(bytes: Uint8Array, wanted: Set<string>): Promise<Map<string, Uint8Array>> {
  const result = new Map<string, Uint8Array>();
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // 1. Achar o End Of Central Directory — procura o assinatura de trás pra
    // frente dentro da janela onde ele pode estar (fixo + comentário opcional).
    const searchStart = Math.max(0, bytes.length - EOCD_SEARCH_WINDOW);
    let eocdOffset = -1;
    for (let i = bytes.length - EOCD_MIN_SIZE; i >= searchStart; i--) {
      if (readU32(view, i) === ZIP_EOCD_SIGNATURE) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) return result;

    const centralDirOffset = readU32(view, eocdOffset + 16);
    const totalEntries = readU16(view, eocdOffset + 10);

    // 2. Percorrer a Central Directory — é ela (não o Local File Header) que
    // tem os tamanhos confiáveis quando o ZIP usa data descriptor.
    let ptr = centralDirOffset;
    for (let i = 0; i < totalEntries; i++) {
      if (ptr + 46 > bytes.length || readU32(view, ptr) !== ZIP_CENTRAL_DIR_SIGNATURE) break;

      const compressionMethod = readU16(view, ptr + 10);
      const compressedSize = readU32(view, ptr + 20);
      const nameLen = readU16(view, ptr + 28);
      const extraLen = readU16(view, ptr + 30);
      const commentLen = readU16(view, ptr + 32);
      const localHeaderOffset = readU32(view, ptr + 42);
      const name = new TextDecoder("utf-8").decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));

      if (wanted.has(name)) {
        const entryBytes = readLocalFileData(view, bytes, localHeaderOffset, compressedSize);
        if (entryBytes) {
          result.set(name, compressionMethod === 0 ? entryBytes : await inflateRaw(entryBytes));
        }
      }

      ptr += 46 + nameLen + extraLen + commentLen;
    }
  } catch (error: any) {
    console.warn(`[officeExtractor] falha ao ler ZIP (${error?.message ?? error}) — nenhuma entrada extraída`);
  }
  return result;
}

/** Localiza e devolve os bytes compactados de uma entrada via seu Local File Header. */
function readLocalFileData(view: DataView, bytes: Uint8Array, localOffset: number, compressedSize: number): Uint8Array | null {
  if (localOffset + 30 > bytes.length || readU32(view, localOffset) !== ZIP_LOCAL_FILE_SIGNATURE) return null;
  const nameLen = readU16(view, localOffset + 26);
  const extraLen = readU16(view, localOffset + 28);
  const dataStart = localOffset + 30 + nameLen + extraLen;
  if (dataStart + compressedSize > bytes.length) return null;
  return bytes.subarray(dataStart, dataStart + compressedSize);
}

const XML_ENTITY_MAP: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/**
 * Reduz um bloco XML a texto legível: preserva quebra de parágrafo/linha
 * (word/document.xml usa `</w:p>` como fronteira), remove todas as tags,
 * decodifica entidades XML e colapsa espaço em excesso. Pura — sem I/O.
 */
export function stripXmlToText(xml: string): string {
  if (!xml) return "";
  const withBreaks = xml
    .replace(/<\/w:p>/gi, "\n")
    .replace(/<\/(row|tr)>/gi, "\n");
  const noTags = withBreaks.replace(/<[^>]+>/g, "");
  const decoded = noTags.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_match, ent: string) => {
    if (XML_ENTITY_MAP[ent]) return XML_ENTITY_MAP[ent];
    if (ent.startsWith("#x")) return String.fromCodePoint(parseInt(ent.slice(2), 16));
    if (ent.startsWith("#")) return String.fromCodePoint(parseInt(ent.slice(1), 10));
    return `&${ent};`;
  });
  return decoded
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** .docx: o texto vive inteiro em word/document.xml. Nunca lança. */
export async function extractDocxText(bytes: Uint8Array): Promise<string | null> {
  try {
    const entries = await parseZipEntries(bytes, new Set(["word/document.xml"]));
    const xml = entries.get("word/document.xml");
    if (!xml) return null;
    const text = stripXmlToText(new TextDecoder("utf-8").decode(xml));
    return text || null;
  } catch (error: any) {
    console.warn(`[officeExtractor] extractDocxText falhou (${error?.message ?? error})`);
    return null;
  }
}

/**
 * .xlsx: lê xl/sharedStrings.xml — as strings únicas referenciadas pelas
 * células. Aproximação deliberada (não resolve célula-a-célula nem fórmulas)
 * — suficiente pra dar à IA o CONTEÚDO textual de uma planilha simples
 * (ex.: lista de convênios aceitos), não uma leitura exata da grade.
 */
export async function extractXlsxText(bytes: Uint8Array): Promise<string | null> {
  try {
    const entries = await parseZipEntries(bytes, new Set(["xl/sharedStrings.xml"]));
    const xml = entries.get("xl/sharedStrings.xml");
    if (!xml) return null;
    const text = stripXmlToText(new TextDecoder("utf-8").decode(xml));
    return text || null;
  } catch (error: any) {
    console.warn(`[officeExtractor] extractXlsxText falhou (${error?.message ?? error})`);
    return null;
  }
}

/** .txt/.csv/.md: decodificação direta, sem ZIP nenhum. Nunca lança. */
export function extractPlainText(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
    return text || null;
  } catch (error: any) {
    console.warn(`[officeExtractor] extractPlainText falhou (${error?.message ?? error})`);
    return null;
  }
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PLAIN_TEXT_MIMES = new Set(["text/plain", "text/csv", "text/markdown"]);

/**
 * Ponto de entrada único: dado os bytes crus e o mime type, devolve o texto
 * extraído (truncado em MAX_EXTRACTED_CHARS) ou null se o formato não é
 * suportado ou a extração falhou. Nunca lança.
 */
export async function extractDocumentText(bytes: Uint8Array, mimeType: string | null | undefined): Promise<string | null> {
  let text: string | null = null;
  if (mimeType === DOCX_MIME) {
    text = await extractDocxText(bytes);
  } else if (mimeType === XLSX_MIME) {
    text = await extractXlsxText(bytes);
  } else if (mimeType && PLAIN_TEXT_MIMES.has(mimeType)) {
    text = extractPlainText(bytes);
  }
  if (!text) return null;
  return text.length > MAX_EXTRACTED_CHARS ? text.slice(0, MAX_EXTRACTED_CHARS) : text;
}
