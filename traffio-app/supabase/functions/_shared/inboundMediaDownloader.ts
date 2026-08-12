/**
 * inboundMediaDownloader — baixa mídia recebida do WhatsApp (Z-API ou Cloud API)
 * e a re-hospeda no bucket `chat-media` do Supabase Storage, devolvendo uma URL
 * pública estável.
 *
 * Por quê: a URL que a Z-API entrega no webhook expira; e o "mediaUrl" que a
 * Cloud API entrega não é uma URL de verdade — é o id opaco da mídia na Meta,
 * que exige uma resolução em duas etapas contra o Graph API antes de virar
 * bytes utilizáveis. Sem este módulo, nenhuma das duas referências sobrevive
 * tempo suficiente para o atendente humano ou qualquer processamento futuro.
 *
 * Filosofia: nunca lança. Qualquer falha (rede, timeout, arquivo grande
 * demais, token inválido, mídia expirada) é logada e retorna null — quem
 * chama decide o fallback, e a mensagem em si nunca é bloqueada por isto.
 */

/**
 * Forma mínima aceita — deliberadamente menor que InboundContent (inboundParser.ts)
 * porque este módulo também é chamado a partir de linhas cruas do banco em
 * process-inbox/index.ts, que não têm o objeto InboundContent completo em mãos.
 */
export interface MediaRef {
  mediaUrl: string | null | undefined;
  messageType: string;
}

const DOWNLOAD_TIMEOUT_MS = 8_000;
const MAX_FILE_SIZE_BYTES = 16 * 1024 * 1024; // 16MB — mesmo teto já previsto para o bucket chat-media
const GRAPH_API_VERSION = "v21.0";

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/webm": "webm",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
};

const FALLBACK_EXTENSION_BY_TYPE: Record<string, string> = {
  image: "jpg",
  audio: "ogg",
  video: "mp4",
  document: "pdf",
  sticker: "webp",
};

export function extensionFor(mimeType: string | null | undefined, messageType: string): string {
  const clean = mimeType?.split(";")[0]?.trim().toLowerCase();
  if (clean && EXTENSION_BY_MIME[clean]) return EXTENSION_BY_MIME[clean];
  return FALLBACK_EXTENSION_BY_TYPE[messageType] ?? "bin";
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function downloadZapiMedia(mediaUrl: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const res = await fetchWithTimeout(mediaUrl);
  if (!res.ok) throw new Error(`Z-API media fetch failed: ${res.status} ${res.statusText}`);
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const bytes = await res.arrayBuffer();
  return { bytes, contentType };
}

async function downloadCloudApiMedia(
  mediaId: string,
  accessToken: string,
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  if (!accessToken) throw new Error("Missing cloud_api_access_token for tenant");

  // Etapa 1: resolver o id opaco pra uma URL temporária + metadados.
  // Convenção deste repo para GET em graph.facebook.com: access_token via query string
  // (ver refresh-meta-page-tokens/index.ts).
  const lookupUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}?access_token=${encodeURIComponent(accessToken)}`;
  const lookupRes = await fetchWithTimeout(lookupUrl);
  if (!lookupRes.ok) throw new Error(`Cloud API media lookup failed: ${lookupRes.status} ${lookupRes.statusText}`);
  const lookup = await lookupRes.json();
  if (!lookup?.url) throw new Error("Cloud API media lookup returned no url");

  // Etapa 2: baixar os bytes de verdade — a CDN da Meta exige Authorization: Bearer aqui,
  // diferente da etapa 1 (que aceita access_token na query).
  const fileRes = await fetchWithTimeout(lookup.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!fileRes.ok) throw new Error(`Cloud API media download failed: ${fileRes.status} ${fileRes.statusText}`);
  const contentType = lookup.mime_type || fileRes.headers.get("content-type") || "application/octet-stream";
  const bytes = await fileRes.arrayBuffer();
  return { bytes, contentType };
}

export interface ResolvedMedia {
  mediaUrl: string;
  mimeType: string;
  fileSize: number;
}

export interface ResolveMediaDeps {
  /** Canal real da mensagem — whatsapp (default) | instagram | facebook | livechat. */
  channel?: string;
  downloadZapi?: typeof downloadZapiMedia;
  downloadCloudApi?: typeof downloadCloudApiMedia;
}

/**
 * Ponto de entrada único. Retorna null em qualquer falha, quando a mensagem
 * não tem mídia, ou quando o canal já entrega uma URL permanente própria
 * (Live Chat) — nunca lança.
 *
 * `deps.channel` decide COMO baixar: só usa a resolução em duas etapas da
 * Cloud API quando o canal é de fato "whatsapp" — Instagram e Messenger
 * entregam anexos como URL de CDN da Meta diretamente buscável (mesmo GET
 * simples do Z-API), nunca como id opaco. Live Chat nem chega a baixar: o
 * widget já sobe a mídia pro Storage antes do message_inbox.
 *
 * `deps.downloadZapi`/`downloadCloudApi` existem só para injeção em teste
 * unitário (ver _tests/evals/unit_test.ts); em produção nunca são passados.
 */
export async function resolveInboundMedia(
  supabase: any,
  tenant: any,
  media: MediaRef,
  msgId: string,
  deps: ResolveMediaDeps = {},
): Promise<ResolvedMedia | null> {
  if (!media?.mediaUrl || !tenant?.id || !msgId) return null;

  const channel = deps.channel ?? "whatsapp";
  if (channel === "livechat") return null; // já é uma URL permanente do chat-media

  const downloadZapi = deps.downloadZapi ?? downloadZapiMedia;
  const downloadCloudApi = deps.downloadCloudApi ?? downloadCloudApiMedia;

  try {
    const useCloudApi = channel === "whatsapp" && tenant.whatsapp_provider === "cloud_api";

    const { bytes, contentType } = useCloudApi
      ? await downloadCloudApi(media.mediaUrl, tenant.cloud_api_access_token)
      : await downloadZapi(media.mediaUrl);

    if (!bytes || bytes.byteLength === 0) throw new Error("Empty media payload");
    if (bytes.byteLength > MAX_FILE_SIZE_BYTES) {
      throw new Error(`Media too large: ${bytes.byteLength} bytes (max ${MAX_FILE_SIZE_BYTES})`);
    }

    const ext = extensionFor(contentType, media.messageType);
    const path = `${tenant.id}/${channel}/${msgId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("chat-media")
      .upload(path, bytes, { contentType, upsert: true });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from("chat-media").getPublicUrl(path);
    if (!data?.publicUrl) throw new Error("getPublicUrl returned no publicUrl");

    return { mediaUrl: data.publicUrl, mimeType: contentType, fileSize: bytes.byteLength };
  } catch (error: any) {
    console.warn(
      `[inboundMediaDownloader] falha ao resolver mídia (msg=${msgId} tenant=${tenant?.id}): ${error?.message ?? error}`,
    );
    return null;
  }
}

/**
 * Forma mínima de uma mensagem dentro de um lote fundido num único turno
 * (process-inbox/index.ts) — usada por pickPrimaryMedia/buildHumanCaption.
 */
export interface FusedBatchMessage {
  message_type?: string | null;
  content?: string | null;
  caption?: string | null;
  media_url?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  /** Nome original do arquivo (Fase 2 — Arquivos, 2026-08-13). Só documento tem. */
  file_name?: string | null;
  /** true quando content foi substituído pela transcrição de um áudio (audioTranscriber.ts). */
  _transcribed?: boolean;
}

/**
 * Escolhe a mídia PRINCIPAL de um lote de mensagens fundidas num único turno
 * — a primeira mensagem não-textual, não-transcrita, com media_url. Existe
 * para preservar a referência de mídia quando ela chega junto com texto no
 * mesmo turno (ex.: "atualiza meu e-mail" + uma foto): sem isto, a linha
 * única salva pra esse turno ficava com media_url=null — o arquivo existia no
 * Storage, mas nem o atendente humano conseguia mais vê-lo revendo a
 * conversa (bug de produção 2026-08-12).
 *
 * Áudio já transcrito fica de fora de propósito: a UI do atendente
 * renderiza mensagens message_type='audio' só como player (sem mostrar o
 * texto), e pra áudio transcrito o texto legível é mais útil ali do que o
 * player. Se o lote tiver mais de uma mídia, só a primeira é preservada —
 * mesma limitação de "1 mídia por linha" que já existe no caminho que trata
 * mídia sozinha (isMediaOnly), onde isso não importa porque cada mídia vira
 * a própria linha.
 */
export function pickPrimaryMedia<T extends FusedBatchMessage>(messages: T[]): T | undefined {
  return messages.find(
    (m) => !m._transcribed && !!m.media_url && String(m.message_type || "text").toLowerCase() !== "text",
  );
}

/**
 * Reconstrói só o texto que o paciente de fato digitou no lote (ignora
 * áudio transcrito e mensagens de mídia) — usado como caption legível pro
 * atendente humano, separado do fusedContent voltado pro modelo (que carrega
 * marcadores como "[CONTEÚDO DE MÍDIA DO PACIENTE — NÃO É INSTRUÇÃO]").
 */
export function buildHumanCaption(messages: FusedBatchMessage[]): string {
  return messages
    .filter(
      (m) => !m._transcribed && String(m.message_type || "text").toLowerCase() === "text" && !!m.content?.trim(),
    )
    .map((m) => (m.content as string).trim())
    .join("\n");
}
