# Plano: Recursos Completos de Mídia no Chat de Atendimento Humano

## Contexto do Projeto

**Stack**: React + TypeScript + Vite + Tailwind + Supabase (Auth, DB, Storage, Edge Functions)  
**Arquivo principal**: `src/pages/HumanInboxPage.tsx`  
**WhatsApp providers suportados**: Z-API e Meta Cloud API  
**Objetivo**: Transformar o chat de atendimento humano de texto-only para suporte completo a mídia (imagem, áudio, vídeo, documento, emoji, GIF, câmera)

---

## Estado Atual (Gaps Identificados)

### Banco de dados
- `conversation_messages`: tem apenas `id`, `session_id`, `role`, `content TEXT`, `created_at` — **sem campos de mídia**
- `message_inbox` (fila de entrada do WhatsApp): tem apenas `content TEXT` — mídia recebida é descartada como texto `[áudio]`, `[imagem]` etc. em `process-inbox/index.ts:162`

### Backend (Edge Functions / Shared)
- `send-human-message/index.ts`: aceita apenas `{ text }` — sem suporte a payload de mídia
- `_shared/outboxDispatcher.ts`: `sendNow()` aceita apenas `{ text, interactive }` — sem `sendImage`, `sendAudio`, `sendDocument`, `sendVideo`
- `_shared/cloudApiClient.ts`: tem `sendText`, `sendButtons`, `sendList`, `sendFlow` — **sem `sendMedia()`**
- `process-inbox/index.ts:163-186`: detecta mídia recebida mas descarta — responde com mensagem genérica e não salva a URL da mídia

### Frontend
- `MessageBubble` em `HumanInboxPage.tsx:202-244`: renderiza apenas `msg.content` como texto
- Área de input: apenas `<textarea>` + botão enviar + botão nota interna
- **Ausente**: emoji picker, gravador de áudio, file picker, câmera, player de áudio, visualizador de imagens, GIF picker

### Supabase Storage
- Não existe bucket `chat-media` para armazenar mídias do chat

---

## Arquitetura da Solução

```
┌─────────────────────────────────────────────────────────────────────┐
│  FRONTEND — HumanInboxPage                                           │
│  ├── MediaToolbar: emoji, áudio, arquivo, câmera, GIF               │
│  ├── AudioRecorder: MediaRecorder API nativa → blob → upload         │
│  ├── FilePicker: input[type=file] → preview → upload                 │
│  ├── EmojiPicker: biblioteca emoji-mart                              │
│  ├── GifPicker: Tenor API (fetch direto, gratuito)                   │
│  ├── CameraCapture: getUserMedia + canvas snapshot                   │
│  └── MessageBubble: renderiza por message_type                       │
│                                                                      │
│  UPLOAD FLOW:                                                        │
│  arquivo local → supabase.storage.upload('chat-media', path)        │
│  → URL pública → POST /send-human-media                              │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  EDGE FUNCTION — send-human-media (NOVO)                             │
│  Recebe: { session_id, tenant_id, media_url, media_type,            │
│            caption?, file_name?, mime_type? }                        │
│  1. Valida sessão e autenticação (igual send-human-message)          │
│  2. INSERT em conversation_messages com media_url + message_type     │
│  3. Chama OutboxDispatcher.sendMedia()                               │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  _shared/outboxDispatcher.ts — sendMedia() (EXPANDIR)                │
│  ├── Z-API:     POST /send-image | /send-audio | /send-document |   │
│  │              /send-video | /send-sticker                          │
│  └── Cloud API: CloudApiClient.sendMedia(type, url/id, caption)     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Dependências a Instalar

```bash
cd traffio-app
npm install emoji-mart @emoji-mart/data @emoji-mart/react
```

> **GIF**: usar Tenor API diretamente via fetch (gratuita, sem pacote)  
> **Áudio**: `MediaRecorder` API nativa do browser (sem pacote)  
> **Câmera**: `getUserMedia` API nativa do browser (sem pacote)  
> **Upload**: Supabase Storage JS SDK (já no projeto via `@supabase/supabase-js`)

---

## Variáveis de Ambiente Necessárias

```bash
# Supabase project settings > API
VITE_TENOR_API_KEY=your_tenor_api_key   # Gratuito em developers.google.com/tenor
```

---

## TAREFA 1 — Migration SQL + Bucket Storage

**Criar arquivo**: `supabase/migrations/20260409000001_chat_media.sql`

```sql
-- ##########################################################
-- TRAFFIO — Chat Media Support
-- Migration: 20260409000001
-- ##########################################################

-- 1. Expandir conversation_messages com campos de mídia
ALTER TABLE conversation_messages
    ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'text'
        CHECK (message_type IN ('text', 'image', 'audio', 'video', 'document', 'sticker', 'gif', 'internal')),
    ADD COLUMN IF NOT EXISTS media_url    TEXT,
    ADD COLUMN IF NOT EXISTS file_name   TEXT,
    ADD COLUMN IF NOT EXISTS mime_type   TEXT,
    ADD COLUMN IF NOT EXISTS file_size   INTEGER,
    ADD COLUMN IF NOT EXISTS caption     TEXT,
    ADD COLUMN IF NOT EXISTS duration_s  INTEGER;  -- para áudios: duração em segundos

-- 2. Expandir message_inbox com campos de mídia (mensagens recebidas do WhatsApp)
ALTER TABLE message_inbox
    ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'text',
    ADD COLUMN IF NOT EXISTS media_url    TEXT,
    ADD COLUMN IF NOT EXISTS file_name   TEXT,
    ADD COLUMN IF NOT EXISTS mime_type   TEXT,
    ADD COLUMN IF NOT EXISTS caption     TEXT;

-- 3. Índice para buscar mensagens com mídia de uma sessão
CREATE INDEX IF NOT EXISTS idx_conv_messages_media
    ON conversation_messages(session_id, message_type)
    WHERE message_type != 'text';

-- 4. Supabase Storage bucket: chat-media
-- ATENÇÃO: executar via Supabase Dashboard > Storage OU via API abaixo
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES (
--   'chat-media',
--   'chat-media',
--   true,                    -- público para Z-API conseguir acessar a URL
--   16777216,                -- 16MB limit
--   ARRAY['image/*', 'audio/*', 'video/*', 'application/pdf',
--          'application/msword', 'application/vnd.openxmlformats-officedocument.*',
--          'text/plain']
-- )
-- ON CONFLICT (id) DO NOTHING;

-- 5. RLS para storage bucket chat-media
-- Usuários autenticados do tenant podem fazer upload
-- Leitura pública (necessário para Z-API acessar a URL)
-- CREATE POLICY "authenticated_upload_chat_media"
--     ON storage.objects FOR INSERT TO authenticated
--     WITH CHECK (bucket_id = 'chat-media');

-- CREATE POLICY "public_read_chat_media"
--     ON storage.objects FOR SELECT TO anon, authenticated
--     USING (bucket_id = 'chat-media');
```

> **Nota para o agente**: As políticas de Storage estão comentadas pois precisam ser criadas via Supabase Dashboard > Storage > Policies, ou via Management API. Crie o bucket `chat-media` como **público** com limite de 16MB.

---

## TAREFA 2 — Expandir `_shared/cloudApiClient.ts`

**Arquivo**: `supabase/functions/_shared/cloudApiClient.ts`

Adicionar os seguintes métodos à classe `CloudApiClient`, **após o método `markAsRead()`** e **antes** do método `formatPhone()`:

```typescript
/**
 * Upload de mídia para os servidores da Meta (obrigatório antes de sendMedia)
 * Retorna o media_id para uso no sendMedia()
 */
async uploadMedia(fileUrl: string, mimeType: string): Promise<string> {
  // Baixar o arquivo da URL pública (Supabase Storage)
  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) throw new Error(`Failed to fetch media from ${fileUrl}`);
  const fileBlob = await fileRes.blob();

  const formData = new FormData();
  formData.append('messaging_product', 'whatsapp');
  formData.append('file', fileBlob, 'media');
  formData.append('type', mimeType);

  const url = `${this.baseUrl}/${this.apiVersion}/${this.phoneNumberId}/media`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${this.accessToken}` },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Media upload failed: ${err.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.id as string;
}

/**
 * Enviar mídia (image, audio, video, document, sticker)
 * Para Cloud API: faz upload primeiro para obter media_id
 */
async sendMedia(
  to: string,
  mediaType: 'image' | 'audio' | 'video' | 'document' | 'sticker',
  mediaUrl: string,
  mimeType: string,
  caption?: string,
  fileName?: string
): Promise<any> {
  // Cloud API requer upload prévio para obter media_id
  const mediaId = await this.uploadMedia(mediaUrl, mimeType);

  const mediaObject: any = { id: mediaId };
  if (caption && (mediaType === 'image' || mediaType === 'video' || mediaType === 'document')) {
    mediaObject.caption = caption;
  }
  if (fileName && mediaType === 'document') {
    mediaObject.filename = fileName;
  }

  return this.postRequest('messages', {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: this.formatPhone(to),
    type: mediaType,
    [mediaType]: mediaObject,
  });
}
```

---

## TAREFA 3 — Expandir `_shared/outboxDispatcher.ts`

**Arquivo**: `supabase/functions/_shared/outboxDispatcher.ts`

### 3a. Adicionar método `sendMedia()` à classe `OutboxDispatcher`

Adicionar após o método `enqueue()`:

```typescript
/**
 * Envia mídia imediatamente via Z-API ou Cloud API.
 */
async sendMedia(
  tenant: any,
  phone: string,
  payload: {
    media_url:   string;
    media_type:  'image' | 'audio' | 'video' | 'document' | 'sticker' | 'gif';
    mime_type?:  string;
    caption?:    string;
    file_name?:  string;
  }
): Promise<void> {
  if (tenant.whatsapp_provider === 'cloud_api' &&
      tenant.cloud_api_phone_number_id &&
      tenant.cloud_api_access_token) {
    await sendCloudApiMedia(tenant, phone, payload);
  } else {
    await sendZapiMedia(tenant, phone, payload);
  }
}
```

### 3b. Adicionar funções helper no final do arquivo (fora da classe)

```typescript
async function sendZapiMedia(tenant: any, phone: string, payload: any): Promise<void> {
  const { media_url, media_type, caption, file_name } = payload;
  const baseUrl     = `https://api.z-api.io/instances/${tenant.zapi_instance_id}/token/${tenant.zapi_token}`;
  const clientToken = tenant.zapi_client_token;

  // GIFs são enviados como imagem pela Z-API
  const effectiveType = media_type === 'gif' ? 'image' : media_type;

  const endpointMap: Record<string, string> = {
    image:    '/send-image',
    audio:    '/send-audio',
    video:    '/send-video',
    document: '/send-document',
    sticker:  '/send-sticker',
  };

  const endpoint = endpointMap[effectiveType];
  if (!endpoint) throw new Error(`Unsupported media type for Z-API: ${effectiveType}`);

  const bodyMap: Record<string, any> = {
    image:    { phone, image: media_url, caption: caption || '' },
    audio:    { phone, audio: media_url },
    video:    { phone, video: media_url, caption: caption || '' },
    document: { phone, document: media_url, fileName: file_name || 'arquivo', caption: caption || '' },
    sticker:  { phone, sticker: media_url },
  };

  await zapiPost(baseUrl, clientToken, endpoint, bodyMap[effectiveType]);
}

async function sendCloudApiMedia(tenant: any, phone: string, payload: any): Promise<void> {
  const { media_url, media_type, mime_type, caption, file_name } = payload;
  const client = new CloudApiClient(tenant.cloud_api_phone_number_id, tenant.cloud_api_access_token);

  const effectiveType = media_type === 'gif' ? 'image' : media_type;

  await client.sendMedia(
    phone,
    effectiveType as 'image' | 'audio' | 'video' | 'document' | 'sticker',
    media_url,
    mime_type || 'application/octet-stream',
    caption,
    file_name
  );
}
```

---

## TAREFA 4 — Nova Edge Function `send-human-media`

**Criar arquivo**: `supabase/functions/send-human-media/index.ts`

```typescript
/**
 * Edge Function: send-human-media
 *
 * Chamada quando um atendente envia mídia (imagem, áudio, vídeo, documento, GIF).
 * O arquivo já deve estar no Supabase Storage (bucket: chat-media) antes desta chamada.
 *
 * Recebe: {
 *   session_id: string,
 *   tenant_id:  string,
 *   media_url:  string,   // URL pública do Supabase Storage
 *   media_type: 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'gif',
 *   mime_type?: string,
 *   caption?:   string,
 *   file_name?: string,
 *   file_size?: number,
 *   duration_s?: number,
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";
import { OutboxDispatcher } from "../_shared/outboxDispatcher.ts";
import { SessionManager } from "../_shared/sessionManager.ts";

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl      = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase         = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();
    const { session_id, tenant_id, media_url, media_type, mime_type, caption, file_name, file_size, duration_s } = body;

    if (!session_id || !tenant_id || !media_url || !media_type) {
      return json({ error: 'session_id, tenant_id, media_url e media_type são obrigatórios' }, 400);
    }

    const VALID_TYPES = ['image', 'audio', 'video', 'document', 'sticker', 'gif'];
    if (!VALID_TYPES.includes(media_type)) {
      return json({ error: `media_type inválido: ${media_type}` }, 400);
    }

    // ── Autenticar atendente ─────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    let user_id = user?.id ?? body.user_id ?? null;
    if (!user_id) return json({ error: 'Não autenticado' }, 401);

    // ── Buscar sessão e credenciais WhatsApp ─────────────────────────────────
    const { data: session, error: sessionError } = await supabase
      .from('conversation_sessions')
      .select(`
        id, patient_phone, tenant_id, omnichannel_status, assigned_to_user_id,
        tenants (
          whatsapp_provider, zapi_instance_id, zapi_token, zapi_client_token,
          cloud_api_phone_number_id, cloud_api_access_token
        )
      `)
      .eq('id', session_id)
      .eq('tenant_id', tenant_id)
      .single();

    if (sessionError || !session) return json({ error: 'Sessão não encontrada' }, 404);

    const tenantDetails = (session as any).tenants;

    // ── Auto-handoff: atribuir atendente se necessário ───────────────────────
    if (session.omnichannel_status !== 'human_active' || session.assigned_to_user_id !== user_id) {
      await supabase.from('conversation_sessions').update({
        omnichannel_status: 'human_active',
        human_handoff: true,
        assigned_to_user_id: user_id,
        current_state: 'HUMAN_ACTIVE',
      }).eq('id', session_id);
    }

    // ── Inserir mensagem no histórico ────────────────────────────────────────
    const { error: insertError } = await supabase.from('conversation_messages').insert({
      session_id,
      role: 'human',
      content: caption || `[${media_type}]`,
      message_type: media_type,
      media_url,
      file_name:  file_name || null,
      mime_type:  mime_type || null,
      file_size:  file_size || null,
      caption:    caption   || null,
      duration_s: duration_s || null,
    });

    if (insertError) {
      console.error('[send-human-media] Insert error:', insertError);
    }

    // ── Enviar via WhatsApp ──────────────────────────────────────────────────
    const outbox = new OutboxDispatcher(supabase);
    try {
      await outbox.sendMedia(tenantDetails, session.patient_phone, {
        media_url,
        media_type,
        mime_type,
        caption,
        file_name,
      });
    } catch (dispatchErr: any) {
      console.error('[send-human-media] Dispatch failed:', dispatchErr.message);
      // Não retorna erro ao cliente — a mensagem foi salva no histórico
    }

    return json({ success: true });

  } catch (err: any) {
    console.error('[send-human-media] Fatal:', err);
    return json({ error: err.message ?? 'Erro interno' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
```

---

## TAREFA 5 — Expandir `process-inbox` para salvar mídia recebida

**Arquivo**: `supabase/functions/process-inbox/index.ts`

### Substituir o bloco de media guard (linhas ~158-187)

Localizar o comentário `// --- 5b. Media/voice guard` e substituir o bloco `if (isMediaOnly)` completo por:

```typescript
// --- 5b. Media/voice guard — salvar mídia recebida em vez de descartar ---
const MEDIA_TYPE_MAP: Record<string, string> = {
  áudio: 'audio', audio: 'audio',
  imagem: 'image', image: 'image',
  vídeo: 'video', video: 'video',
  documento: 'document', document: 'document',
  sticker: 'sticker', figurinha: 'sticker',
};

const isMediaOnly = !fusedContent?.trim() ||
  /^\[(áudio|audio|imagem|image|vídeo|video|documento|document|sticker|figurinha)\]$/i.test(fusedContent.trim());

if (isMediaOnly) {
  console.log(`[process-inbox] [${phone}] Media message detected`);

  const sessionMedia = await sessionManager.getOrCreateSession(tenantId, phone);

  // Detectar o tipo de mídia pelo conteúdo
  const mediaMatch = fusedContent.trim().match(/^\[(\w+)\]$/i);
  const rawType    = mediaMatch?.[1]?.toLowerCase() ?? 'image';
  const mediaType  = MEDIA_TYPE_MAP[rawType] ?? 'image';

  // Buscar URL de mídia do message_inbox (se disponível)
  const { data: inboxMsgs } = await supabase
    .from('message_inbox')
    .select('media_url, file_name, mime_type, caption')
    .in('id', messageIds)
    .not('media_url', 'is', null)
    .limit(1);

  const mediaUrl  = inboxMsgs?.[0]?.media_url ?? null;
  const fileName  = inboxMsgs?.[0]?.file_name ?? null;
  const mimeType  = inboxMsgs?.[0]?.mime_type ?? null;
  const caption   = inboxMsgs?.[0]?.caption ?? null;

  // Salvar mensagem com mídia no histórico
  await supabase.from('conversation_messages').insert({
    session_id:   sessionMedia.id,
    role:         'user',
    content:      caption || fusedContent.trim(),
    message_type: mediaType,
    media_url:    mediaUrl,
    file_name:    fileName,
    mime_type:    mimeType,
    caption,
  });

  // Acionar atendimento humano para o atendente ver a mídia
  if (sessionMedia.omnichannel_status !== 'human_active' && sessionMedia.omnichannel_status !== 'queued') {
    await sessionManager.triggerHumanHandoff(sessionMedia.id);
  }

  await markMessages(supabase, messageIds, 'skipped');
  return;
}
```

> **Nota**: O campo `media_url` em `message_inbox` só será preenchido se o webhook do WhatsApp (Z-API ou Cloud API) for atualizado para salvar a URL da mídia. Isso é uma melhoria incremental — mesmo sem a URL, a mensagem ficará visível com o tipo correto no chat.

---

## TAREFA 6 — Frontend: Tipos e Interfaces

**Arquivo**: `src/pages/HumanInboxPage.tsx`

### 6a. Expandir interface `Message`

Localizar e substituir:

```typescript
// ANTES:
interface Message {
  id: string
  session_id: string
  role: 'user' | 'assistant' | 'human' | 'internal'
  content: string
  created_at: string
}

// DEPOIS:
interface Message {
  id: string
  session_id: string
  role: 'user' | 'assistant' | 'human' | 'internal'
  content: string
  message_type?: 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'gif' | 'internal'
  media_url?: string
  file_name?: string
  mime_type?: string
  file_size?: number
  caption?: string
  duration_s?: number
  created_at: string
}
```

---

## TAREFA 7 — Frontend: Novo componente `MediaMessageBubble`

**Arquivo**: `src/pages/HumanInboxPage.tsx`

### 7a. Novos imports necessários no topo do arquivo

```typescript
import { Mic, Square, Paperclip, Camera, Smile, Film, Play, Pause, FileText, Download, Volume2 } from 'lucide-react'
import Picker from '@emoji-mart/react'
import data from '@emoji-mart/data'
```

### 7b. Substituir o componente `MessageBubble`

Localizar a função `MessageBubble` (linhas 202-244) e substituir completamente:

```typescript
// ─────────────────────────────────────────────
// MessageBubble — suporte completo a mídia
// ─────────────────────────────────────────────

function AudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)

  const toggle = () => {
    if (!audioRef.current) return
    if (playing) { audioRef.current.pause(); setPlaying(false) }
    else { audioRef.current.play(); setPlaying(true) }
  }

  return (
    <div className="flex items-center gap-2 min-w-[180px]">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={() => {
          if (!audioRef.current) return
          setProgress((audioRef.current.currentTime / audioRef.current.duration) * 100 || 0)
        }}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        onEnded={() => { setPlaying(false); setProgress(0) }}
      />
      <button onClick={toggle}
        className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0 hover:bg-white/30 transition-colors">
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <div className="flex-1 space-y-1">
        <div className="h-1 bg-white/30 rounded-full overflow-hidden">
          <div className="h-full bg-white/80 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-[10px] opacity-70">
          {duration ? `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}` : '—'}
        </p>
      </div>
      <Volume2 size={14} className="opacity-60 shrink-0" />
    </div>
  )
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser     = msg.role === 'user'
  const isHuman    = msg.role === 'human'
  const isInternal = msg.role === 'internal'
  const isBot      = msg.role === 'assistant'
  const isOutgoing = !isUser

  const time = new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const type = msg.message_type ?? 'text'

  const renderContent = () => {
    // Áudio
    if (type === 'audio' && msg.media_url) {
      return <AudioPlayer src={msg.media_url} />
    }
    // Imagem ou GIF
    if ((type === 'image' || type === 'gif') && msg.media_url) {
      return (
        <div className="space-y-1">
          <a href={msg.media_url} target="_blank" rel="noopener noreferrer">
            <img
              src={msg.media_url}
              alt={msg.caption || 'imagem'}
              className="rounded-xl max-w-[240px] max-h-[240px] object-cover cursor-pointer hover:opacity-90 transition-opacity"
            />
          </a>
          {msg.caption && <p className="text-xs mt-1 opacity-90">{msg.caption}</p>}
        </div>
      )
    }
    // Vídeo
    if (type === 'video' && msg.media_url) {
      return (
        <div className="space-y-1">
          <video
            src={msg.media_url}
            controls
            className="rounded-xl max-w-[240px] max-h-[240px]"
          />
          {msg.caption && <p className="text-xs mt-1 opacity-90">{msg.caption}</p>}
        </div>
      )
    }
    // Documento / arquivo
    if (type === 'document' && msg.media_url) {
      const sizeMB = msg.file_size ? (msg.file_size / 1024 / 1024).toFixed(1) : null
      return (
        <a
          href={msg.media_url}
          target="_blank"
          rel="noopener noreferrer"
          download={msg.file_name}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <FileText size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate max-w-[160px]">{msg.file_name || 'Arquivo'}</p>
            {sizeMB && <p className="text-[10px] opacity-70">{sizeMB} MB</p>}
          </div>
          <Download size={14} className="shrink-0 opacity-60" />
        </a>
      )
    }
    // Sticker
    if (type === 'sticker' && msg.media_url) {
      return <img src={msg.media_url} alt="sticker" className="w-20 h-20 object-contain" />
    }
    // Texto padrão
    return <span className="whitespace-pre-wrap break-words">{msg.content}</span>
  }

  return (
    <div className={clsx('flex mb-3', isOutgoing ? 'justify-end' : 'justify-start')}>
      {isUser && (
        <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center shrink-0 mr-2 mt-1">
          <User className="w-3.5 h-3.5 text-gray-500" />
        </div>
      )}

      <div className="max-w-[72%]">
        {isInternal && (
          <div className="flex items-center gap-1 mb-1">
            <StickyNote className="w-3 h-3 text-amber-500" />
            <span className="text-[10px] text-amber-600 font-semibold uppercase tracking-wide">Nota interna</span>
          </div>
        )}
        <div className={clsx(
          'px-3.5 py-2.5 rounded-2xl text-sm',
          isUser     && 'bg-white border border-gray-200 text-gray-800 rounded-tl-none',
          isHuman    && 'bg-blue-600 text-white rounded-tr-none',
          isBot      && 'bg-gray-700 text-white rounded-tr-none',
          isInternal && 'bg-amber-50 border border-amber-200 text-amber-900 rounded-tr-none italic',
        )}>
          {renderContent()}
        </div>
        <div className={clsx('flex items-center gap-1 mt-1', isOutgoing ? 'justify-end' : 'justify-start')}>
          {isBot      && <Bot       className="w-3 h-3 text-gray-400" />}
          {isHuman    && <PhoneCall className="w-3 h-3 text-blue-400" />}
          {isInternal && <StickyNote className="w-3 h-3 text-amber-400" />}
          <span className="text-[10px] text-gray-400">{time}</span>
        </div>
      </div>
    </div>
  )
}
```

---

## TAREFA 8 — Frontend: MediaToolbar e lógica de envio

**Arquivo**: `src/pages/HumanInboxPage.tsx`

### 8a. Novos estados na função `HumanInboxPage()`

Adicionar após os estados existentes:

```typescript
// ── Estados de mídia ──────────────────────────────────────────────
const [showEmojiPicker, setShowEmojiPicker] = useState(false)
const [showGifPicker, setShowGifPicker]     = useState(false)
const [gifSearch, setGifSearch]             = useState('')
const [gifResults, setGifResults]           = useState<any[]>([])
const [isRecording, setIsRecording]         = useState(false)
const [recordingSeconds, setRecordingSeconds] = useState(0)
const [mediaRecorder, setMediaRecorder]     = useState<MediaRecorder | null>(null)
const [uploadingMedia, setUploadingMedia]   = useState(false)
const fileInputRef  = useRef<HTMLInputElement>(null)
const cameraInputRef = useRef<HTMLInputElement>(null)
const recordingTimerRef = useRef<NodeJS.Timeout | null>(null)
```

### 8b. Função `uploadToStorage()`

Adicionar após os handlers existentes (`handleSend`, `handleSidebarSendMessage`):

```typescript
// ── Upload de arquivo para Supabase Storage ───────────────────────
const uploadToStorage = async (file: File, folder: string): Promise<string> => {
  const ext      = file.name.split('.').pop() ?? 'bin'
  const path     = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  
  const { error } = await supabase.storage
    .from('chat-media')
    .upload(path, file, { contentType: file.type, upsert: false })
  
  if (error) throw new Error(`Upload falhou: ${error.message}`)
  
  const { data: { publicUrl } } = supabase.storage
    .from('chat-media')
    .getPublicUrl(path)
  
  return publicUrl
}
```

### 8c. Função `handleSendMedia()`

```typescript
// ── Enviar mídia via Edge Function ────────────────────────────────
const handleSendMedia = async (
  mediaUrl: string,
  mediaType: string,
  opts: { mimeType?: string; caption?: string; fileName?: string; fileSize?: number; durationS?: number } = {}
) => {
  if (!selected || !tenantId) return
  setUploadingMedia(true)
  try {
    const { data, error } = await supabase.functions.invoke('send-human-media', {
      body: {
        session_id: selected.id,
        tenant_id:  tenantId,
        media_url:  mediaUrl,
        media_type: mediaType,
        mime_type:  opts.mimeType,
        caption:    opts.caption,
        file_name:  opts.fileName,
        file_size:  opts.fileSize,
        duration_s: opts.durationS,
      }
    })
    if (error) throw new Error(error.message)
    if (data?.error) throw new Error(data.error)
  } catch (err: any) {
    alert('Erro ao enviar mídia: ' + err.message)
  } finally {
    setUploadingMedia(false)
  }
}
```

### 8d. Função `handleFileSelect()`

```typescript
// ── Selecionar e enviar arquivo ───────────────────────────────────
const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0]
  if (!file || !selected) return

  setUploadingMedia(true)
  try {
    const isImage = file.type.startsWith('image/')
    const isVideo = file.type.startsWith('video/')
    const isAudio = file.type.startsWith('audio/')
    const folder  = isImage ? 'images' : isVideo ? 'videos' : isAudio ? 'audio' : 'documents'
    const type    = isImage ? 'image' : isVideo ? 'video' : isAudio ? 'audio' : 'document'

    const url = await uploadToStorage(file, folder)
    await handleSendMedia(url, type, {
      mimeType:  file.type,
      fileName:  file.name,
      fileSize:  file.size,
    })
  } catch (err: any) {
    alert('Erro ao enviar arquivo: ' + err.message)
  } finally {
    setUploadingMedia(false)
    e.target.value = ''
  }
}
```

### 8e. Funções de gravação de áudio

```typescript
// ── Gravação de áudio ─────────────────────────────────────────────
const startRecording = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
    const chunks: Blob[] = []

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      const blob = new Blob(chunks, { type: 'audio/webm' })
      const file = new File([blob], `audio-${Date.now()}.webm`, { type: 'audio/webm' })

      setUploadingMedia(true)
      try {
        const url = await uploadToStorage(file, 'audio')
        await handleSendMedia(url, 'audio', {
          mimeType:  'audio/webm',
          fileName:  file.name,
          fileSize:  file.size,
          durationS: recordingSeconds,
        })
      } catch (err: any) {
        alert('Erro ao enviar áudio: ' + err.message)
      } finally {
        setUploadingMedia(false)
        setRecordingSeconds(0)
      }
    }

    recorder.start()
    setMediaRecorder(recorder)
    setIsRecording(true)

    let sec = 0
    recordingTimerRef.current = setInterval(() => {
      sec++
      setRecordingSeconds(sec)
      if (sec >= 120) stopRecording() // limite 2 minutos
    }, 1000)
  } catch (err: any) {
    alert('Permissão de microfone negada: ' + err.message)
  }
}

const stopRecording = () => {
  if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
  mediaRecorder?.stop()
  setMediaRecorder(null)
  setIsRecording(false)
}
```

### 8f. Funções de GIF (Tenor API)

```typescript
// ── GIF picker via Tenor API ──────────────────────────────────────
const searchGifs = async (query: string) => {
  const TENOR_KEY = import.meta.env.VITE_TENOR_API_KEY
  if (!TENOR_KEY) { console.warn('VITE_TENOR_API_KEY não configurada'); return }
  
  const q   = encodeURIComponent(query || 'hello')
  const url = `https://tenor.googleapis.com/v2/search?q=${q}&key=${TENOR_KEY}&limit=12&media_filter=gif`
  const res = await fetch(url)
  const data = await res.json()
  setGifResults(data.results ?? [])
}

const handleGifSelect = async (gifUrl: string) => {
  setShowGifPicker(false)
  setUploadingMedia(true)
  try {
    // Download GIF e re-upload para Supabase Storage (necessário para Z-API)
    const res  = await fetch(gifUrl)
    const blob = await res.blob()
    const file = new File([blob], `gif-${Date.now()}.gif`, { type: 'image/gif' })
    const url  = await uploadToStorage(file, 'gifs')
    await handleSendMedia(url, 'gif', { mimeType: 'image/gif', fileName: file.name })
  } catch (err: any) {
    alert('Erro ao enviar GIF: ' + err.message)
  } finally {
    setUploadingMedia(false)
  }
}
```

### 8g. Substituir a área de input (seção `{/* Input area */}`)

Localizar o bloco `{/* Input area */}` (por volta da linha 1159 em `HumanInboxPage.tsx`) e substituir o `<div className="px-4 py-3 bg-white border-t border-gray-200 shrink-0">` **quando `isOwned`** pelo seguinte:

```tsx
{isOwned ? (
  <div className="px-4 py-3 bg-white border-t border-gray-200 shrink-0 space-y-2">
    {/* Tabs: Mensagem | Nota Interna */}
    <div className="flex items-center gap-1">
      <button onClick={() => setInputMode('message')} className={clsx(
        'flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-colors',
        inputMode === 'message' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100',
      )}>
        <Send className="w-3 h-3" /> Mensagem
      </button>
      <button onClick={() => setInputMode('note')} className={clsx(
        'flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-colors',
        inputMode === 'note' ? 'bg-amber-100 text-amber-700' : 'text-gray-500 hover:bg-gray-100',
      )}>
        <StickyNote className="w-3 h-3" /> Nota Interna
      </button>
    </div>

    {/* Barra de gravação (sobrepõe o textarea durante gravação) */}
    {isRecording ? (
      <div className="flex items-center gap-3 px-3 py-2 bg-red-50 border border-red-200 rounded-xl">
        <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
        <span className="text-sm text-red-600 font-semibold flex-1">
          Gravando... {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')}
        </span>
        <button onClick={stopRecording}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 text-white rounded-xl text-xs font-bold hover:bg-red-600 transition-colors">
          <Square size={12} /> Enviar
        </button>
        <button onClick={() => {
          if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
          mediaRecorder?.stop(); setMediaRecorder(null); setIsRecording(false); setRecordingSeconds(0)
          // Cancelar sem enviar: precisamos de flag — adicionar estado cancelRecording
        }} className="text-xs text-red-400 hover:text-red-600 transition-colors">
          Cancelar
        </button>
      </div>
    ) : (
      <div className="flex items-end gap-2">
        {/* Textarea */}
        <div className="relative flex-1">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder={inputMode === 'note'
              ? 'Nota interna (visível só para a equipe)...'
              : 'Digite... (Enter envia, Shift+Enter nova linha)'}
            rows={2}
            className={clsx(
              'w-full resize-none rounded-xl border px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 transition-all',
              inputMode === 'note'
                ? 'border-amber-200 bg-amber-50 focus:ring-amber-300 placeholder:text-amber-400'
                : 'border-gray-200 focus:ring-blue-400 focus:border-transparent',
            )}
          />
        </div>

        {/* Botão enviar texto */}
        <button onClick={handleSend} disabled={!input.trim() || sending}
          className={clsx(
            'w-10 h-10 rounded-xl flex items-center justify-center transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed',
            inputMode === 'note' ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-blue-600 text-white hover:bg-blue-700',
          )}>
          {sending
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : inputMode === 'note' ? <StickyNote className="w-4 h-4" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    )}

    {/* Media toolbar — apenas visível em modo mensagem */}
    {inputMode === 'message' && !isRecording && (
      <div className="flex items-center gap-1 pt-0.5 relative">
        {/* Emoji */}
        <button onClick={() => { setShowEmojiPicker(p => !p); setShowGifPicker(false) }}
          className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" title="Emoji">
          <Smile size={18} />
        </button>

        {/* Áudio */}
        <button onClick={startRecording}
          className="p-2 rounded-xl hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" title="Gravar áudio">
          <Mic size={18} />
        </button>

        {/* Arquivo */}
        <button onClick={() => fileInputRef.current?.click()}
          className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" title="Enviar arquivo">
          <Paperclip size={18} />
        </button>

        {/* Câmera */}
        <button onClick={() => cameraInputRef.current?.click()}
          className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors" title="Câmera / Foto">
          <Camera size={18} />
        </button>

        {/* GIF */}
        <button onClick={() => { setShowGifPicker(p => !p); setShowEmojiPicker(false); searchGifs('') }}
          className="p-2 rounded-xl hover:bg-purple-50 text-gray-400 hover:text-purple-500 transition-colors" title="GIF">
          <Film size={18} />
        </button>

        {/* Loading overlay */}
        {uploadingMedia && (
          <div className="flex items-center gap-1.5 ml-2 text-xs text-blue-500">
            <Loader2 size={13} className="animate-spin" /> Enviando...
          </div>
        )}

        {/* Inputs ocultos */}
        <input
          ref={fileInputRef}
          type="file"
          hidden
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
          onChange={handleFileSelect}
        />
        <input
          ref={cameraInputRef}
          type="file"
          hidden
          accept="image/*"
          capture="environment"
          onChange={handleFileSelect}
        />

        {/* Emoji Picker Popover */}
        {showEmojiPicker && (
          <div className="absolute bottom-10 left-0 z-50 shadow-2xl rounded-2xl overflow-hidden">
            <Picker
              data={data}
              locale="pt"
              theme="light"
              onEmojiSelect={(emoji: any) => {
                setInput(prev => prev + (emoji.native ?? ''))
                setShowEmojiPicker(false)
                inputRef.current?.focus()
              }}
            />
          </div>
        )}

        {/* GIF Picker Popover */}
        {showGifPicker && (
          <div className="absolute bottom-10 left-0 z-50 bg-white border border-gray-200 rounded-2xl shadow-2xl p-3 w-72">
            <input
              type="text"
              placeholder="Buscar GIF..."
              value={gifSearch}
              onChange={e => { setGifSearch(e.target.value); searchGifs(e.target.value) }}
              className="w-full px-3 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-400 mb-2"
            />
            <div className="grid grid-cols-3 gap-1.5 max-h-48 overflow-y-auto">
              {gifResults.map((gif: any) => {
                const url = gif.media_formats?.gif?.url ?? gif.media_formats?.tinygif?.url
                if (!url) return null
                return (
                  <button key={gif.id} onClick={() => handleGifSelect(url)}
                    className="rounded-xl overflow-hidden hover:ring-2 hover:ring-purple-400 transition-all">
                    <img src={url} alt={gif.content_description} className="w-full h-16 object-cover" />
                  </button>
                )
              })}
              {gifResults.length === 0 && (
                <p className="col-span-3 text-center text-xs text-gray-400 py-4">
                  {gifSearch ? 'Nenhum GIF encontrado' : 'Digite para buscar GIFs'}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    )}

    {inputMode === 'note' && (
      <p className="text-[10px] text-amber-600 flex items-center gap-1">
        <StickyNote className="w-3 h-3" />
        Esta nota é visível apenas para a equipe — não será enviada ao paciente.
      </p>
    )}
  </div>
) : (
  <div className="flex items-center justify-center py-2 text-sm text-gray-400 gap-2">
    {canClaim
      ? <><Clock className="w-4 h-4" /> Assuma a conversa para responder</>
      : isClosed
      ? <><CheckCircle2 className="w-4 h-4" /> Conversa encerrada</>
      : <><MoreVertical className="w-4 h-4" /> Em atendimento por outro vendedor. Apenas leitura permitida.</>}
  </div>
)}
```

### 8h. Fechar pickers ao clicar fora

Adicionar `useEffect` para fechar popups ao clicar fora:

```typescript
useEffect(() => {
  const close = () => { setShowEmojiPicker(false); setShowGifPicker(false) }
  if (showEmojiPicker || showGifPicker) {
    document.addEventListener('click', close, { once: true })
  }
  return () => document.removeEventListener('click', close)
}, [showEmojiPicker, showGifPicker])
```

### 8i. Adicionar `onClick` stop propagation nos pickers

Os containers dos pickers precisam de `onClick={e => e.stopPropagation()}` para não fecharem ao clicar dentro deles.

---

## TAREFA 9 — Deploy das Edge Functions

```bash
# Na raiz do projeto traffio-app:
supabase functions deploy send-human-media --project-ref <PROJECT_REF>

# Variáveis já existentes (injetadas automaticamente pelo Supabase):
# SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
```

---

## Checklist de Validação

- [ ] Migration SQL executada no Supabase SQL Editor
- [ ] Bucket `chat-media` criado como **público** no Supabase Storage
- [ ] RLS do bucket configurado (authenticated upload, public read)
- [ ] `npm install emoji-mart @emoji-mart/data @emoji-mart/react`
- [ ] `VITE_TENOR_API_KEY` adicionada no `.env.local`
- [ ] Edge Function `send-human-media` deployada
- [ ] `cloudApiClient.ts` com método `sendMedia()` adicionado
- [ ] `outboxDispatcher.ts` com método `sendMedia()` e `sendZapiMedia()` adicionado
- [ ] `process-inbox` com novo bloco de media guard salvando `media_url`
- [ ] Interface `Message` expandida com campos de mídia
- [ ] `MessageBubble` substituído pela versão com `renderContent()`
- [ ] `AudioPlayer` componente criado dentro de `HumanInboxPage.tsx`
- [ ] Todos os novos estados e handlers adicionados a `HumanInboxPage()`
- [ ] Área de input substituída pela nova com `MediaToolbar`
- [ ] Imports de ícones do Lucide expandidos (`Mic`, `Square`, `Paperclip`, `Camera`, `Smile`, `Film`, `Play`, `Pause`, `FileText`, `Download`, `Volume2`)
- [ ] Imports de `emoji-mart` adicionados
- [ ] Testar: envio de imagem
- [ ] Testar: gravação e envio de áudio
- [ ] Testar: envio de documento PDF
- [ ] Testar: emoji picker
- [ ] Testar: GIF picker
- [ ] Testar: câmera (mobile)
- [ ] Testar: visualização de mídia recebida do WhatsApp

---

## Limitações e Notas Técnicas

### Formato de áudio
O `MediaRecorder` no browser gera `audio/webm`. O WhatsApp aceita `audio/ogg;codecs=opus`. Para compatibilidade máxima:
- **Z-API**: aceita webm direto na maioria dos casos
- **Cloud API**: pode rejeitar webm — se houver erro, considerar conversão via `ffmpeg.wasm` no client ou server-side via Edge Function

### Z-API requer URL pública
O arquivo DEVE estar no Supabase Storage com URL pública antes de chamar `/send-image` ou `/send-audio`. Nunca enviar base64 diretamente para o dispatch via Z-API.

### Cloud API: upload obrigatório
A Meta exige que a mídia seja primeiro enviada para `/{phone_number_id}/media` para obter um `media_id`, e então esse ID é usado no envio. O método `CloudApiClient.sendMedia()` implementado na Tarefa 2 faz isso automaticamente.

### Mídia recebida (incoming)
Para exibir mídia recebida do paciente (fotos, áudios do WhatsApp):
- O webhook Z-API envia uma URL temporária no campo `image`, `audio`, etc.
- O webhook precisa ser atualizado para salvar essa URL no campo `media_url` de `message_inbox`
- Essa URL da Z-API expira — idealmente fazer download + re-upload para o Storage na hora do recebimento
- Esse fluxo (atualizar o webhook de entrada) é um passo adicional não coberto neste plano

### GIF e Tenor API
A Tenor API v2 requer uma API key gratuita. Registrar em `developers.google.com/tenor`. A key deve ficar em `VITE_TENOR_API_KEY` no `.env.local` (nunca no código).
