import { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { formatPhone, phoneFlag } from '../lib/formatPhone'
import { formatDisplayDate } from '../lib/dateUtils'
import {
  MessageCircle, Clock, User, Send, Inbox,
  Loader2, PhoneCall, CheckCircle2, XCircle, Bot, Search,
  StickyNote, Info, X, Calendar, CreditCard,
  AlertTriangle, MoreVertical, ArrowRightLeft, UserCircle2,
  UserPlus, Users, Building2, Tag, CalendarSearch, DollarSign,
  Mic, Paperclip, Camera, Smile, Play, Pause,
  FileText, Download, Reply, Pencil, Copy, Forward, Trash2, Zap, ArrowRight, Instagram, Facebook, ChevronDown, ArrowLeft, Settings, Plus
} from 'lucide-react'
import data from '@emoji-mart/data'
import Picker from '@emoji-mart/react'
import { clsx } from 'clsx'
import { motion, AnimatePresence } from 'framer-motion'
import { useToast } from '../contexts/ToastContext'
import { KANBAN_STAGES } from '../lib/kanbanStages'
import { SidebarRegisterView } from '../components/SidebarRegisterView'
import { SidebarLookupView } from '../components/SidebarLookupView'
import { SidebarBookingView } from '../components/SidebarBookingView'
import { SidebarAppointmentsView } from '../components/SidebarAppointmentsView'
import { SidebarAvailabilityView } from '../components/SidebarAvailabilityView'
import { SidebarPaymentView } from '../components/SidebarPaymentView'
import { SidebarDirectoryView } from '../components/SidebarDirectoryView'
import { SidebarLeadClassifyView } from '../components/SidebarLeadClassifyView'
import { SidebarPatientEditView } from '../components/SidebarPatientEditView'
import { ChannelPreferenceSelector } from '../components/channel/ChannelPreferenceSelector'
import { salesScriptService, type SalesScript } from '../services/salesScriptService'
import { ScriptManagerDrawer } from '../components/ScriptManagerDrawer'

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type OmnichannelStatus = 'bot_active' | 'queued' | 'human_active' | 'closed'

interface ConversationSession {
  id: string
  tenant_id: string
  patient_phone: string
  current_state: string
  omnichannel_status: OmnichannelStatus
  assigned_to_user_id: string | null
  claimed_at: string | null
  human_handoff: boolean
  kanban_stage?: string
  tags?: any
  revenue_estimated?: number
  updated_at: string
  unread_count?: number
  last_read_at?: string
  recent_messages: Array<{ role: string; content: string; timestamp: string }>
  context?: any
  channel?: string
}

interface Message {
  id: string
  session_id: string
  role: 'user' | 'assistant' | 'human' | 'internal'
  content: string
  created_at: string
  message_type?: 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'gif' | 'internal'
  media_url?:    string
  file_name?:    string
  mime_type?:    string
  file_size?:    number
  caption?:      string
  duration_s?:   number
  replied_to_id?: string
  is_edited?:    boolean
}

interface PatientInfo {
  id: string
  full_name: string | null
  cpf: string | null
  email: string | null
  birth_date: string | null
  notes: string | null
}

interface Appointment {
  date: string
  start_time: string
  doctors: { full_name: string } | null
  locations: { name: string } | null
  appointment_types: { name: string } | null
  status: string
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

/*
const QUICK_REPLIES = [
  { label: 'Saudação', text: 'Olá! 😊 Aqui é a equipe da clínica. Posso ajudar?' },
  { label: 'Aguardar', text: 'Só um momento, estou verificando as informações para você! 🔍' },
  { label: 'Horário', text: 'Nosso horário de atendimento é de segunda a sexta, das 8h às 18h, e sábados das 8h às 12h.' },
  { label: 'Confirmação', text: 'Perfeito! Seu agendamento está confirmado. A equipe aguarda você! 🎉' },
  { label: 'Encerramento', text: 'Obrigado pelo contato! 😊 Se precisar de mais alguma coisa, é só nos chamar.' },
  { label: 'Remarca', text: 'Claro! Posso verificar os horários disponíveis para remarcação. Qual data seria melhor para você?' },
]
*/

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────


// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function maskCpf(cpf: string | null | undefined) {
  if (!cpf) return '—'
  const d = cpf.replace(/\D/g, '')
  if (d.length < 11) return cpf
  return `${d.slice(0, 3)}.***.***-${d.slice(9, 11)}`
}

function slaColor(updatedAt: string) {
  const min = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 60000)
  if (min >= 10) return 'text-red-600 font-bold'
  if (min >= 5)  return 'text-amber-600 font-semibold'
  return 'text-gray-400'
}

function slaLabel(updatedAt: string) {
  const min = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 60000)
  if (min === 0) return 'agora'
  return `${min}m`
}

// ─────────────────────────────────────────────
// StatusBadge
// ─────────────────────────────────────────────

function StatusBadge({ status }: { status: OmnichannelStatus }) {
  const map: Record<OmnichannelStatus, { label: string; className: string }> = {
    bot_active:   { label: 'Bot Ativo',       className: 'bg-blue-100 text-blue-700' },
    queued:       { label: 'Aguardando',       className: 'bg-amber-100 text-amber-700 animate-pulse' },
    human_active: { label: 'Em Atendimento',   className: 'bg-green-100 text-green-700' },
    closed:       { label: 'Encerrado',        className: 'bg-gray-100 text-gray-500' },
  }
  const { label, className } = map[status]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${className}`}>
      {label}
    </span>
  )
}

const TEMPERATURE_MAP: Record<string, { label: string; icon: string; className: string }> = {
  cold: { label: 'Frio',   icon: '❄️', className: 'bg-blue-50 text-blue-700 border-blue-100' },
  warm: { label: 'Morno',  icon: '🌤️', className: 'bg-amber-50 text-amber-700 border-amber-100' },
  hot:  { label: 'Quente', icon: '🔥', className: 'bg-red-50 text-red-700 border-red-100' },
}

const PRIORITY_MAP: Record<string, { label: string; className: string }> = {
  low:    { label: 'Baixa',   className: 'bg-gray-50 text-gray-600 border-gray-100' },
  medium: { label: 'Média',   className: 'bg-blue-50 text-blue-600 border-blue-100' },
  high:   { label: 'Alta',    className: 'bg-orange-50 text-orange-600 border-orange-100' },
  urgent: { label: 'Urgente', className: 'bg-red-50 text-red-600 border-red-100' },
}

// ─────────────────────────────────────────────
// ConversationRow
// ─────────────────────────────────────────────

function ConversationRow({
  session, selected, patientName, onClick,
}: {
  session: ConversationSession
  selected: boolean
  patientName: string | null
  onClick: () => void
}) {
  const lastMsg = session.recent_messages?.at(-1)
  const isQueued = session.omnichannel_status === 'queued'
  const unreadCount = session.unread_count ?? 0

  return (
    <motion.div
      layout
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="overflow-hidden"
    >
      <button
        onClick={onClick}
        className={clsx(
          'w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors flex items-start gap-3 relative',
          selected && 'bg-blue-50 border-l-[3px] border-l-blue-500',
          isQueued && !selected && 'border-l-[3px] border-l-amber-400',
        )}
      >
        <div className={clsx(
          'w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5',
          isQueued ? 'bg-amber-100' : 'bg-gray-100',
        )}>
          {session.channel === 'livechat' ? (
            <MessageCircle className={clsx('w-4 h-4', isQueued ? 'text-amber-600' : 'text-gray-500')} />
          ) : session.channel === 'instagram' ? (
            <Instagram className={clsx('w-4 h-4', isQueued ? 'text-amber-600' : 'text-gray-500')} />
          ) : session.channel === 'facebook' ? (
            <Facebook className={clsx('w-4 h-4', isQueued ? 'text-amber-600' : 'text-gray-500')} />
          ) : (
            <User className={clsx('w-4 h-4', isQueued ? 'text-amber-600' : 'text-gray-500')} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="text-sm font-semibold text-gray-900 truncate">
              {patientName
                ? patientName
                : (session.channel === 'livechat' || session.channel === 'instagram' || session.channel === 'facebook')
                ? (session.context?.visitor_name || session.context?.username || session.context?.name || (session.channel === 'instagram' ? 'Usuário do Instagram' : session.channel === 'facebook' ? 'Usuário do Messenger' : 'Visitante Web'))
                : `${phoneFlag(session.patient_phone)} ${formatPhone(session.patient_phone)}`}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <span className={clsx('text-[11px]', slaColor(session.updated_at))}>
                {slaLabel(session.updated_at)}
              </span>
            </div>
          </div>
          {session.channel === 'livechat' ? (
            <p className="text-[11px] text-gray-400 truncate mt-0.5">
              {session.context?.visitor_phone || session.context?.visitor_email || 'Live Chat'}
            </p>
          ) : (session.channel === 'instagram' || session.channel === 'facebook') ? (
            <p className="text-[11px] text-gray-400 truncate mt-0.5 flex items-center gap-1">
              {session.channel === 'instagram' ? '@' : ''}{session.context?.username || session.context?.visitor_name || (session.channel === 'instagram' ? 'Instagram Direct' : 'Facebook Messenger')}
            </p>
          ) : (
            patientName && (
              <p className="text-[11px] text-gray-400 truncate mt-0.5">{formatPhone(session.patient_phone)}</p>
            )
          )}

          {(session.kanban_stage || session.tags?.temperature || session.tags?.priority) && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              {session.tags?.temperature && TEMPERATURE_MAP[session.tags.temperature] && (
                <span className={clsx("flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-bold uppercase shrink-0", TEMPERATURE_MAP[session.tags.temperature].className)}>
                  <span>{TEMPERATURE_MAP[session.tags.temperature].icon}</span>
                  <span>{TEMPERATURE_MAP[session.tags.temperature].label}</span>
                </span>
              )}
              {session.kanban_stage && (
                <span className="px-1.5 py-0.5 rounded-md bg-gray-100 border border-gray-200 text-gray-500 text-[9px] font-bold uppercase truncate max-w-[100px]" title={`Estágio: ${session.kanban_stage}`}>
                  {session.kanban_stage}
                </span>
              )}
              {session.tags?.priority && PRIORITY_MAP[session.tags.priority] && (
                <span className={clsx("px-1.5 py-0.5 rounded-md border text-[9px] font-bold uppercase shrink-0", PRIORITY_MAP[session.tags.priority].className)}>
                  {PRIORITY_MAP[session.tags.priority].label}
                </span>
              )}
            </div>
          )}
          <div className="flex items-end justify-between gap-2 mt-0.5">
            <p className={clsx(
               'text-xs truncate flex-1 leading-tight',
               unreadCount > 0 ? 'text-gray-900 font-bold' : 'text-gray-500'
            )}>
              {lastMsg?.content ?? 'Sem mensagens'}
            </p>
            {unreadCount > 0 && !selected && (
              <span className="flex items-center justify-center h-5 min-w-[20px] px-1 rounded-full bg-blue-600 text-white text-[10px] font-bold shadow-sm animate-in fade-in zoom-in duration-300">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <StatusBadge status={session.omnichannel_status} />
            <span className={clsx(
              "inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold border",
              session.channel === 'livechat'
                ? "bg-indigo-50 text-indigo-700 border-indigo-100"
                : session.channel === 'instagram'
                ? "bg-pink-50 text-pink-700 border-pink-100"
                : session.channel === 'facebook'
                ? "bg-blue-50 text-blue-700 border-blue-100"
                : "bg-green-50 text-green-700 border-green-100"
            )}>
              {session.channel === 'livechat'
                ? 'Live Chat'
                : session.channel === 'instagram'
                ? 'Instagram'
                : session.channel === 'facebook'
                ? 'Messenger'
                : 'WhatsApp'}
            </span>
            {isQueued && (
              <span className="flex items-center gap-0.5 text-[10px] text-amber-600 font-medium">
                <AlertTriangle className="w-3 h-3" /> aguardando
              </span>
            )}
          </div>
        </div>
      </button>
    </motion.div>
  )
}

// ── Componente de Áudio Customizado ──────────────────────────────
const AudioPlayer = memo(function AudioPlayer({ url, duration }: { url: string, duration?: number }) {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)

  const togglePlay = () => {
    if (playing) audioRef.current?.pause()
    else audioRef.current?.play()
    setPlaying(!playing)
  }

  return (
    <div className="flex items-center gap-3 bg-gray-100/50 rounded-xl px-3 py-2 min-w-[200px]">
      <button onClick={togglePlay} className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white shrink-0">
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
      </button>
      <div className="flex-1">
        <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 transition-all duration-100" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex justify-between mt-1 text-[10px] text-gray-500 font-medium">
          <span>{duration ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}` : '0:00'}</span>
          <span>WhatsApp Audio</span>
        </div>
      </div>
      <audio
        ref={audioRef}
        src={url}
        onTimeUpdate={() => {
          if (audioRef.current) {
            const p = (audioRef.current.currentTime / audioRef.current.duration) * 100
            setProgress(p)
          }
        }}
        onEnded={() => { setPlaying(false); setProgress(0) }}
        hidden
      />
    </div>
  )
})

// ─────────────────────────────────────────────
// MessageBubble
// ─────────────────────────────────────────────

const MessageBubble = memo(function MessageBubble({
  msg,
  allMessages,
  onReply,
  onEdit,
  onForward,
  onDelete,
  canEdit,
}: {
  msg: Message
  allMessages: Message[]
  onReply: (m: Message) => void
  onEdit: (m: Message) => void
  onForward: (m: Message) => void
  onDelete: (m: Message) => void
  canEdit: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const isUser     = msg.role === 'user'
  const isHuman    = msg.role === 'human'
  const isInternal = msg.role === 'internal'
  const isBot      = msg.role === 'assistant'
  const isOutgoing = !isUser

  const time = new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  const repliedMsg = msg.replied_to_id ? allMessages.find(m => m.id === msg.replied_to_id) : null

  const handleCopy = () => {
    const text = msg.content || msg.caption || msg.file_name || ''
    navigator.clipboard.writeText(text)
  }

  const renderContent = () => {
    const type = msg.message_type || 'text'

    switch (type) {
      case 'image':
        return (
          <div className="space-y-1.5">
            <img
              src={msg.media_url}
              alt="Mídia"
              className="rounded-lg max-w-full max-h-72 object-cover cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => window.open(msg.media_url, '_blank')}
            />
            {msg.caption && <p className="text-sm px-1 leading-relaxed whitespace-pre-wrap break-all">{msg.caption}</p>}
          </div>
        )
      case 'video':
        return (
          <div className="space-y-1.5">
            <video
              src={msg.media_url}
              controls
              className="rounded-lg max-w-full max-h-72 object-cover"
            />
            {msg.caption && <p className="text-sm px-1 leading-relaxed whitespace-pre-wrap break-all">{msg.caption}</p>}
          </div>
        )
      case 'audio':
        return <AudioPlayer url={msg.media_url!} duration={msg.duration_s} />

      case 'document':
        return (
          <a
            href={msg.media_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 p-2 bg-gray-50 border border-gray-100 rounded-xl hover:bg-gray-100 transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
              <FileText size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-700 truncate">{msg.file_name || 'Documento'}</p>
              <p className="text-[10px] text-gray-400 uppercase">{msg.mime_type?.split('/')[1] || 'PDF'} • {msg.file_size ? `${(msg.file_size / 1024 / 1024).toFixed(1)}MB` : 'Arquivo'}</p>
            </div>
            <Download size={16} className="text-gray-400" />
          </a>
        )
      case 'gif':
        return (
          <img
            src={msg.media_url}
            alt="GIF"
            className="rounded-lg max-w-full max-h-60 object-cover"
          />
        )
      default:
        return <div className="break-words whitespace-pre-wrap">{msg.content}</div>
    }
  }

  return (
    <div
      className={clsx('flex w-full mb-3 group', isOutgoing ? 'justify-end' : 'justify-start')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {isUser && (
        <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center shrink-0 mr-2 mt-1">
          <User className="w-3.5 h-3.5 text-gray-500" />
        </div>
      )}

      <div 
        className={clsx('max-w-[75%] min-w-0 flex flex-col', isOutgoing ? 'items-end' : 'items-start')}
        style={{ width: 'fit-content' }}
      >
        {isInternal && (
          <div className="flex items-center gap-1 mb-1">
            <StickyNote className="w-3 h-3 text-amber-500" />
            <span className="text-[10px] text-amber-600 font-semibold uppercase tracking-wide">Nota interna</span>
          </div>
        )}

        {/* Hover action bar */}
        <div className={clsx(
          'flex items-center gap-0.5 mb-1 transition-opacity duration-150',
          isOutgoing ? 'justify-end' : 'justify-start',
          hovered ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}>
          <button
            onClick={handleCopy}
            title="Copiar"
            className="w-7 h-7 rounded-lg bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-500 hover:text-blue-600 hover:border-blue-300 transition-colors"
          >
            <Copy size={13} />
          </button>
          <button
            onClick={() => onReply(msg)}
            title="Responder"
            className="w-7 h-7 rounded-lg bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-500 hover:text-blue-600 hover:border-blue-300 transition-colors"
          >
            <Reply size={13} />
          </button>
          {canEdit && isHuman && (msg.message_type === 'text' || !msg.message_type) && (
            <button
              onClick={() => onEdit(msg)}
              title="Editar"
              className="w-7 h-7 rounded-lg bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-500 hover:text-amber-600 hover:border-amber-300 transition-colors"
            >
              <Pencil size={13} />
            </button>
          )}
          <button
            onClick={() => onForward(msg)}
            title="Encaminhar"
            className="w-7 h-7 rounded-lg bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-500 hover:text-green-600 hover:border-green-300 transition-colors"
          >
            <Forward size={13} />
          </button>
          <button
            onClick={() => onDelete(msg)}
            title="Apagar para todos"
            className="w-7 h-7 rounded-lg bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-500 hover:text-red-600 hover:border-red-300 transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>

        <div 
          className={clsx(
            'px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap shadow-sm',
            isUser     && 'bg-white border border-gray-200 text-gray-800 rounded-tl-none',
            isHuman    && 'bg-blue-600 text-white rounded-tr-none',
            isBot      && 'bg-gray-700 text-white rounded-tr-none',
            isInternal && 'bg-amber-50 border border-amber-200 text-amber-900 rounded-tr-none italic',
            (msg.message_type === 'image' || msg.message_type === 'video') && 'p-1',
          )}
          style={{ 
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
            maxWidth: '100%' 
          }}
        >
          {/* Reply quote */}
          {repliedMsg && (
            <div className={clsx(
              'flex items-start gap-2 px-2 py-1.5 rounded-lg mb-2 border-l-4 text-xs overflow-hidden',
              isUser ? 'bg-gray-100 border-gray-400 text-gray-600' : 'bg-white/20 border-white/60 text-white/80'
            )}>
              <Reply size={11} className="shrink-0 mt-0.5 opacity-70" />
              <div className="flex-1 min-w-0 flex items-center gap-2">
                {repliedMsg.media_url && (repliedMsg.message_type === 'image' || repliedMsg.message_type === 'video') && (
                  <img src={repliedMsg.media_url} className="w-8 h-8 rounded object-cover shrink-0" alt="quoted" />
                )}
                <span className="truncate leading-relaxed">
                  {repliedMsg.content || repliedMsg.caption || repliedMsg.file_name || (repliedMsg.media_url ? `[${repliedMsg.message_type}]` : '[mídia]')}
                </span>
              </div>
            </div>
          )}
          {renderContent()}
        </div>
        <div className={clsx('flex items-center gap-1 mt-1', isOutgoing ? 'justify-end' : 'justify-start')}>
          {isBot      && <Bot       className="w-3 h-3 text-gray-400" />}
          {isHuman    && <PhoneCall className="w-3 h-3 text-blue-400" />}
          {isInternal && <StickyNote className="w-3 h-3 text-amber-400" />}
          {msg.is_edited && <span className="text-[9px] text-gray-400 italic">editada</span>}
          <span className="text-[10px] text-gray-400">{time}</span>
        </div>
      </div>
    </div>
  )
})

// ─────────────────────────────────────────────
// ChatInput — isolated so typing doesn't re-render the page
// ─────────────────────────────────────────────

interface ChatInputProps {
  isOwned: boolean
  canClaim: boolean
  isClosed: boolean
  onSend: (content: string, mode: 'message' | 'note') => void
  onSendMedia: (url: string, type: string, extra?: any) => Promise<void>
  onUploadFile: (file: File) => Promise<string>
  sending: boolean
  uploadingMedia: boolean
  setUploadingMedia: (val: boolean) => void
  replyingTo: any
  editingMsg: any
  onCancelContext: () => void
  salesScripts?: any[]
  patient?: any
  currentUserName?: string
  clinicName?: string
  onOpenScriptManager: (editingId?: string | null) => void
  onDeleteScript?: (id: string) => Promise<void>
}

export const ChatInput = memo(({ 
  isOwned, canClaim, isClosed, onSend, onSendMedia, onUploadFile, sending, 
  uploadingMedia, setUploadingMedia, replyingTo, editingMsg, onCancelContext,
  salesScripts = [], patient, currentUserName = '', clinicName = '',
  onOpenScriptManager, onDeleteScript
}: ChatInputProps) => {
  const { showToast } = useToast()
  const [input, setInput]           = useState('')
  const [inputMode, setInputMode]   = useState<'message' | 'note'>('message')
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showGifPicker, setShowGifPicker]     = useState(false)
  const [isRecording, setIsRecording]         = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [mediaRecorder, setMediaRecorder]     = useState<MediaRecorder | null>(null)

  const inputRef          = useRef<HTMLTextAreaElement>(null)
  const fileInputRef      = useRef<HTMLInputElement>(null)
  const cameraInputRef    = useRef<HTMLInputElement>(null)
  const recordingTimerRef = useRef<any>(null)

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl]     = useState<string | null>(null)

  // Slash menu state
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)

  // Variables prompt state
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptVars, setPromptVars] = useState<string[]>([])
  const [promptValues, setPromptValues] = useState<Record<string, string>>({})
  const [pendingScriptText, setPendingScriptText] = useState('')
  const [pendingScript, setPendingScript] = useState<SalesScript | null>(null)

  // Sync input when editing
  useEffect(() => {
    if (editingMsg) {
      setInput(editingMsg.content)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [editingMsg?.id])

  // Close pickers on outside click
  useEffect(() => {
    const close = () => { setShowEmojiPicker(false); setShowGifPicker(false) }
    if (showEmojiPicker || showGifPicker) {
      document.addEventListener('click', close, { once: true })
    }
    return () => document.removeEventListener('click', close)
  }, [showEmojiPicker, showGifPicker])

  // Quick reply event
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<string>).detail
      setInput(prev => prev ? prev + ' ' + text : text)
      setInputMode('message')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
    window.addEventListener('quick-reply', handler)
    return () => window.removeEventListener('quick-reply', handler)
  }, [])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      const chunks: Blob[] = []
      rec.ondataavailable = e => chunks.push(e.data)
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunks, { type: 'audio/webm' })
        const file = new File([blob], `audio-${Date.now()}.webm`, { type: 'audio/webm' })
        setUploadingMedia(true)
        try {
          const url = await onUploadFile(file)
          await onSendMedia(url, 'audio', { mimeType: 'audio/webm', durationS: recordingSeconds })
        } catch (err: any) {
          showToast('error', 'Erro ao enviar áudio: ' + err.message)
        }
        setRecordingSeconds(0)
      }
      rec.start()
      setMediaRecorder(rec)
      setIsRecording(true)
      let sec = 0
      recordingTimerRef.current = setInterval(() => {
        sec++
        setRecordingSeconds(sec)
        if (sec >= 120) stopRecording()
      }, 1000)
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        showToast('warning', 'Permissão de microfone negada. Verifique as configurações do seu navegador.')
      } else {
        showToast('error', 'Erro ao acessar microfone: ' + err.message)
      }
    }
  }

  const stopRecording = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
    mediaRecorder?.stop()
    setMediaRecorder(null)
    setIsRecording(false)
  }

  // Clear preview on cancel or send
  const clearMediaFile = useCallback(() => {
    setSelectedFile(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setInput('')
  }, [previewUrl])

  // Scripts logic
  const filteredScripts = useMemo(() => {
    if (!salesScripts || !slashMenuOpen) return [];
    const lower = slashFilter.toLowerCase();
    return salesScripts.filter(s => 
      s.shortcut.toLowerCase().includes(lower) || 
      (s.title && s.title.toLowerCase().includes(lower))
    ).slice(0, 10);
  }, [salesScripts, slashFilter, slashMenuOpen]);

  const insertTextIntoInput = (textToInsert: string) => {
    const lastSlashIndex = input.lastIndexOf('/');
    let newText = textToInsert;
    if (lastSlashIndex !== -1) {
      const before = input.slice(0, lastSlashIndex);
      newText = before + textToInsert;
    } else {
      newText = input + textToInsert;
    }
    setInput(newText);
    setSlashMenuOpen(false);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newText.length, newText.length);
    }, 50);
  }

  const handleSelectScript = (script: any) => {
    let content = script.content;
    const patientName = patient?.full_name || patient?.name || 'Paciente';
    const effectiveClinicName = clinicName || 'Nossa Clínica';

    // Auto Variables - Multi-format support
    const autoVars = [
      { key: /\{\{paciente_nome\}\}/gi, value: patientName },
      { key: /\{\{patient\.name\}\}/gi, value: patientName },
      { key: /\{\{patient\.first_name\}\}/gi, value: patientName.split(' ')[0] },
      { key: /\*\*\[Nome Paciente\]\*\*/gi, value: patientName },
      { key: /\[Nome Paciente\]/gi, value: patientName },
      
      { key: /\{\{clinica_nome\}\}/gi, value: effectiveClinicName },
      { key: /\{\{clinic\.name\}\}/gi, value: effectiveClinicName },
      { key: /\*\*\[Nome da Clínica\]\*\*/gi, value: effectiveClinicName },
      { key: /\[Nome da Clínica\]/gi, value: effectiveClinicName },
      
      { key: /\{\{atendente_nome\}\}/gi, value: currentUserName },
      { key: /\{\{user\.name\}\}/gi, value: currentUserName },
      { key: /\{\{user\.first_name\}\}/gi, value: currentUserName.split(' ')[0] },
      { key: /\*\*\[Seu Nome\/atendente\]\*\*/gi, value: currentUserName },
      { key: /\[Seu Nome\/atendente\]/gi, value: currentUserName },
      
      { key: /\{\{clinica_nome\}\}/gi, value: clinicName },
      { key: /\{\{clinic\.name\}\}/gi, value: clinicName },
      { key: /\*\*\[Nome da Clínica\]\*\*/gi, value: clinicName },
      { key: /\[Nome da Clínica\]/gi, value: clinicName },
    ];

    autoVars.forEach(v => {
      content = content.replace(v.key, v.value);
    });

    // Extract manual variables
    // Matches [[Var Name]], [Var Name], and **[Var Name]** as long as they aren't one of the auto-vars above
    const manualMatches: string[] = [];
    const manualRegex = /\*\*\[(.*?)\]\*\*|\[\[(.*?)\]\]|\[([^\]]+?)\]/g;
    
    let match;
    const reservedNames = ['Nome Paciente', 'Seu Nome/atendente', 'Nome da Clínica', 'Nome', 'Seu Nome'];

    while ((match = manualRegex.exec(content)) !== null) {
      const varName = match[1] || match[2] || match[3];
      if (varName && !manualMatches.includes(varName)) {
        if (varName === ' ' || varName.toLowerCase() === 'x') continue;
        if (reservedNames.includes(varName)) continue;
        manualMatches.push(varName);
      }
    }

    if (manualMatches.length > 0) {
      setPromptVars(manualMatches);
      setPromptValues({});
      setPendingScriptText(content);
      setPendingScript(script);
      setPromptOpen(true);
      setSlashMenuOpen(false);
    } else {
      let finalContent = content;
      if (script.attachments && script.attachments.length > 0) {
        script.attachments.forEach((att: any) => {
          if (att.type === 'link') {
            finalContent += `\n\n${att.name}: ${att.url}`;
          } else {
            onSendMedia(att.url, att.type, {
              fileName: att.name,
              mimeType: att.mimeType,
              fileSize: att.fileSize
            });
          }
        });
      }
      insertTextIntoInput(finalContent);
    }
  }

  const handlePromptSubmit = () => {
    let finalContent = pendingScriptText;
    promptVars.forEach(v => {
      const val = promptValues[v] || `[${v}]`;
      const safeVar = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex1 = new RegExp(`\\*\\*\\[${safeVar}\\]\\*\\*`, 'gi');
      const regex2 = new RegExp(`\\[\\[${safeVar}\\]\\]`, 'gi');
      const regex3 = new RegExp(`\\[${safeVar}\\]`, 'gi');
      finalContent = finalContent.replace(regex1, val).replace(regex2, val).replace(regex3, val);
    });

    if (pendingScript && pendingScript.attachments && pendingScript.attachments.length > 0) {
      pendingScript.attachments.forEach((att: any) => {
        if (att.type === 'link') {
          finalContent += `\n\n${att.name}: ${att.url}`;
        } else {
          onSendMedia(att.url, att.type, {
            fileName: att.name,
            mimeType: att.mimeType,
            fileSize: att.fileSize
          });
        }
      });
    }

    insertTextIntoInput(finalContent);
    setPromptOpen(false);
    setPendingScript(null);
  }

  const handleInputText = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

    const lastSlashIndex = val.lastIndexOf('/');
    const isAtStart = lastSlashIndex === 0;
    const isAfterWhitespace = lastSlashIndex > 0 && (val[lastSlashIndex - 1] === ' ' || val[lastSlashIndex - 1] === '\n');

    if (lastSlashIndex !== -1 && (isAtStart || isAfterWhitespace)) {
      const match = val.slice(lastSlashIndex + 1);
      if (!match.includes(' ')) {
        setSlashMenuOpen(true);
        setSlashFilter(match);
        setSlashSelectedIndex(0);
        return;
      }
    }
    setSlashMenuOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMenuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashSelectedIndex(prev => Math.min(prev + 1, filteredScripts.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashSelectedIndex(prev => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredScripts[slashSelectedIndex]) {
          handleSelectScript(filteredScripts[slashSelectedIndex]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashMenuOpen(false);
        return;
      }
    }
    
    // Normal chat enter behavior
    if (e.key === 'Enter' && !e.shiftKey) { 
      e.preventDefault(); 
      handleSend(); 
    }
  }

  const handleSend = async () => {
    if (selectedFile) {
      setUploadingMedia(true)
      try {
        const url = await onUploadFile(selectedFile)
        const isImage = selectedFile.type.startsWith('image/')
        const isVideo = selectedFile.type.startsWith('video/')
        const type = isImage ? 'image' : isVideo ? 'video' : 'document'
        await onSendMedia(url, type, {
          caption: input.trim(),
          mode: inputMode === 'note' ? 'internal' : 'message',
          fileName: selectedFile.name,
          mimeType: selectedFile.type,
          fileSize: selectedFile.size
        })
        clearMediaFile()
      } catch (err: any) {
        showToast('error', 'Erro ao enviar arquivo: ' + err.message)
      } finally {
        setUploadingMedia(false)
      }
      return
    }

    const text = input.trim()
    if (!text || sending) return
    setInput('')
    onSend(text, inputMode)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement> | File) => {
    const file = e instanceof File ? e : e.target.files?.[0]
    if (!(e instanceof File)) e.target.value = ''
    if (!file) return

    if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
      setSelectedFile(file)
      setPreviewUrl(URL.createObjectURL(file))
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      // Direct upload for docs/audio
      processDirectUpload(file)
    }
  }

  const processDirectUpload = async (file: File) => {
    setUploadingMedia(true)
    try {
      const url = await onUploadFile(file)
      const type = file.type.startsWith('audio/') ? 'audio' : 'document'
      await onSendMedia(url, type, {
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size
      })
    } catch (err: any) {
      showToast('error', 'Erro ao enviar arquivo: ' + err.message)
    } finally {
      setUploadingMedia(false)
    }
  }

  const onPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile()
        if (blob) handleFileSelect(blob)
      }
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }

  if (!isOwned) {
    return (
      <div className="px-4 py-3 bg-white border-t border-gray-200 shrink-0">
        <div className="flex items-center justify-center py-2 text-sm text-gray-400 gap-2">
          {canClaim
            ? <><Clock className="w-4 h-4" /> Assuma a conversa para responder</>
            : isClosed
            ? <><CheckCircle2 className="w-4 h-4" /> Conversa encerrada</>
            : <><MoreVertical className="w-4 h-4" /> Em atendimento por outro vendedor. Apenas leitura permitida.</>}
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 bg-white border-t border-gray-200 shrink-0">
      <div className="space-y-2 relative">
        {/* Hidden File Inputs */}
        <input type="file" ref={fileInputRef} hidden onChange={handleFileSelect}
          accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip" />
        <input type="file" ref={cameraInputRef} hidden onChange={handleFileSelect}
          accept="image/*" capture="environment" />

        {/* Slash Command Menu */}
        <AnimatePresence>
          {slashMenuOpen && filteredScripts.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: 15, scale: 0.98 }} 
              animate={{ opacity: 1, y: 0, scale: 1 }} 
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              className="absolute bottom-full left-0 z-50 mb-3 w-80 bg-white border border-gray-100 rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.15)] overflow-hidden max-h-[400px] flex flex-col backdrop-blur-xl bg-white/95"
            >
              <div className="bg-gray-50/50 border-b border-gray-100 px-4 py-2.5 flex items-center justify-between">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                  Scripts Inteligentes
                </p>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={(e) => { e.stopPropagation(); onOpenScriptManager(); setSlashMenuOpen(false); }}
                    className="p-1 hover:bg-gray-200/50 rounded text-gray-500 hover:text-gray-900 border-none bg-transparent cursor-pointer"
                    title="Gerenciar Scripts"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[10px] text-gray-400 font-medium">↑↓ Navegar</span>
                </div>
              </div>
              <div className="overflow-y-auto flex-1 p-1.5 custom-scrollbar">
                {filteredScripts.length === 0 ? (
                  <div className="p-4 text-center">
                    <p className="text-xs text-gray-400 mb-2 font-medium">Nenhum script encontrado</p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenScriptManager();
                        setSlashMenuOpen(false);
                      }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[10px] font-black uppercase tracking-wider border-none cursor-pointer flex items-center gap-1.5 mx-auto"
                    >
                      <Plus size={12} />
                      Criar Script
                    </button>
                  </div>
                ) : (
                  filteredScripts.map((script, idx) => (
                    <div
                      key={script.id}
                      onMouseEnter={() => setSlashSelectedIndex(idx)}
                      className={clsx(
                        "w-full text-left px-3 py-2 rounded-xl transition-all flex flex-col gap-1 border border-transparent group/item",
                        idx === slashSelectedIndex ? "bg-blue-50/80 border-blue-100 shadow-sm" : "hover:bg-gray-50"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                         <div className="flex items-center gap-2 min-w-0 cursor-pointer" onClick={() => handleSelectScript(script)}>
                            <span className="font-bold text-[10px] text-blue-600 bg-blue-50 border border-blue-100 rounded-md px-1.5 py-0.5 min-w-[32px] text-center shrink-0">
                              {script.icon || '💬'}
                            </span>
                            <span className="font-bold text-[10px] text-slate-500 shrink-0">/{script.shortcut}</span>
                            <span className="text-[11px] font-bold text-gray-800 truncate">{script.title}</span>
                         </div>
                         <div className="flex items-center gap-1 shrink-0">
                            <span className="text-[9px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full uppercase tracking-tighter shrink-0">{script.category}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenScriptManager(script.id);
                                setSlashMenuOpen(false);
                              }}
                              className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-blue-50 text-slate-500 hover:text-blue-600 hover:border-blue-200 transition-all cursor-pointer shadow-sm flex items-center justify-center shrink-0"
                              title={(!script.tenant_id || script.tenant_id === 'null') ? "Personalizar (Editar)" : "Editar script"}
                            >
                              <Pencil size={11} />
                            </button>
                            {(script.tenant_id && script.tenant_id !== 'null') && (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (window.confirm(`Deseja excluir o script "${script.title}"?`)) {
                                    try {
                                      if (onDeleteScript) {
                                        await onDeleteScript(script.id);
                                      }
                                    } catch(err) {
                                      console.error("Erro ao excluir script", err);
                                    }
                                  }
                                }}
                                className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-red-50 text-slate-500 hover:text-red-600 hover:border-red-200 transition-all cursor-pointer shadow-sm flex items-center justify-center shrink-0"
                                title="Excluir script"
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                         </div>
                      </div>
                      <span className="text-[11px] text-gray-500 line-clamp-2 leading-relaxed italic cursor-pointer" title={script.content} onClick={() => handleSelectScript(script)}>
                        {script.content}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Variables Prompt Modal */}
        <AnimatePresence>
          {promptOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-gray-900/60 backdrop-blur-md"
                onClick={() => setPromptOpen(false)}
              />
              <motion.div 
                initial={{ scale: 0.95, opacity: 0, y: 20 }} 
                animate={{ scale: 1, opacity: 1, y: 0 }} 
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                className="bg-white rounded-3xl shadow-2xl border border-white/20 w-full max-w-md relative z-10 flex flex-col overflow-hidden"
              >
                <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-blue-50 to-white">
                  <div className="flex flex-col gap-0.5">
                    <h3 className="font-black text-gray-900 flex items-center gap-2 text-lg">
                      <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-200">
                        <Zap size={18} fill="currentColor" />
                      </div>
                      Personalizar Script
                    </h3>
                    <p className="text-xs text-gray-500 font-medium ml-10">Preencha os campos para um envio perfeito</p>
                  </div>
                  <button onClick={() => setPromptOpen(false)} className="p-2 text-gray-400 hover:text-gray-950 hover:bg-gray-100 rounded-full transition-all border-none bg-transparent cursor-pointer"><X size={20} /></button>
                </div>

                <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                  <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex gap-3">
                     <div className="text-amber-500 shrink-0"><Info size={18} /></div>
                     <p className="text-[11px] text-amber-800 leading-relaxed font-medium">Os campos abaixo ajudam a tornar o atendimento mais humanizado. Cada detalhe importa!</p>
                  </div>
                  
                  <form className="space-y-5">
                    {promptVars.map((v, i) => (
                      <div key={i} className="flex flex-col gap-2 group">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 group-focus-within:text-blue-600 transition-colors">{v}</label>
                        <div className="relative">
                          <input
                            autoFocus={i === 0}
                            type="text"
                            value={promptValues[v] || ''}
                            onFocus={(e) => e.target.select()}
                            onChange={e => setPromptValues(prev => ({ ...prev, [v]: e.target.value }))}
                            className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-500 focus:bg-white transition-all shadow-inner"
                            placeholder={`Ex: Terça-feira às 14h...`}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                if (i === promptVars.length - 1) {
                                  handlePromptSubmit();
                                } else {
                                  const form = e.currentTarget.form;
                                  if (form) {
                                    const elements = Array.from(form.elements).filter(el => (el as any).tagName === 'INPUT');
                                    const index = elements.indexOf(e.currentTarget);
                                    if (elements[index + 1]) {
                                      (elements[index + 1] as HTMLElement).focus();
                                    }
                                  }
                                }
                              }
                            }}
                          />
                          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300">
                             <Pencil size={14} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </form>
                </div>

                <div className="p-6 bg-gray-50/50 border-t border-gray-100 flex items-center justify-end gap-3">
                  <button onClick={() => setPromptOpen(false)} className="px-5 py-2.5 text-xs font-black text-gray-500 hover:text-gray-900 transition-colors border-none bg-transparent cursor-pointer uppercase tracking-widest">Cancelar</button>
                  <button 
                    onClick={handlePromptSubmit} 
                    className="px-6 py-3 text-xs font-black text-white bg-blue-600 hover:bg-blue-700 rounded-2xl shadow-xl shadow-blue-200 transition-all hover:scale-[1.02] active:scale-[0.98] focus:ring-4 focus:ring-blue-100 border-none cursor-pointer uppercase tracking-widest flex items-center gap-2"
                  >
                    Usar Script
                    <ArrowRight size={14} />
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Emoji Picker */}
        <AnimatePresence>
          {showEmojiPicker && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
              className="absolute bottom-full left-0 z-50 mb-2" onClick={(e) => e.stopPropagation()}>
              <Picker data={data} onEmojiSelect={(emoji: any) => { setInput(prev => prev + emoji.native); inputRef.current?.focus() }}
                theme="light" locale="pt" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* GIF Picker stub */}
        <AnimatePresence>
          {showGifPicker && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
              className="absolute bottom-full left-0 z-50 mb-2 w-80 bg-white border border-gray-200 rounded-2xl shadow-xl p-4"
              onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-gray-700">GIFs do Tenor</span>
                <button onClick={() => setShowGifPicker(false)}><X size={14} /></button>
              </div>
              <p className="text-xs text-gray-400 italic">Pesquisa de GIFs em breve...</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Recording overlay */}
        <AnimatePresence>
          {isRecording && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="absolute inset-0 bg-white z-40 flex items-center justify-between px-4">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm font-bold text-gray-700 font-mono">
                  {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')}
                </span>
                <span className="text-xs text-gray-400 italic">Gravando áudio...</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { stopRecording(); }}
                  className="px-3 py-1.5 text-xs text-red-600 font-bold hover:bg-red-50 rounded-lg transition-colors">
                  Cancelar
                </button>
                <button onClick={stopRecording}
                  className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-lg">
                  <Send size={18} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Media Preview Overlay */}
        <AnimatePresence>
          {previewUrl && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
              className="absolute bottom-full left-0 right-0 z-50 mb-4 mx-2">
              <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[400px]">
                <div className="p-3 border-b border-gray-50 flex items-center justify-between bg-white/80 backdrop-blur-md">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{selectedFile?.type.startsWith('image/') ? 'Enviar Imagem' : 'Enviar Vídeo'}</span>
                  <button onClick={clearMediaFile} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors"><X size={18} className="text-gray-400" /></button>
                </div>
                <div className="flex-1 bg-gray-900/5 flex items-center justify-center p-4">
                  {selectedFile?.type.startsWith('image/') ? (
                    <img src={previewUrl} className="max-w-full max-h-[240px] rounded-xl shadow-lg object-contain" alt="preview" />
                  ) : (
                    <video src={previewUrl} className="max-w-full max-h-[240px] rounded-xl shadow-lg" controls />
                  )}
                </div>
                <div className="p-4 bg-gray-50/50">
                  <p className="text-[10px] text-gray-400 font-bold uppercase mb-2">Legenda da mídia</p>
                  <div className="flex items-end gap-2">
                     <textarea
                        value={input}
                        onChange={handleInputText}
                        placeholder="Adicione uma legenda..."
                        rows={2}
                        className="flex-1 bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm resize-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all shadow-sm"
                        onKeyDown={handleKeyDown}
                        autoFocus
                     />
                     <button 
                        onClick={handleSend}
                        disabled={sending || uploadingMedia}
                        className={clsx(
                          "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all shadow-lg active:scale-95 border-none cursor-pointer",
                          inputMode === 'note' ? "bg-amber-500 text-white" : "bg-blue-600 text-white"
                        )}
                      >
                        {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                      </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Reply / Edit context bar */}
        {(replyingTo || editingMsg) && (
          <div className={clsx('flex items-center gap-2 px-3 py-2 rounded-xl border-l-4 text-xs',
            editingMsg ? 'bg-amber-50 border-amber-400' : 'bg-blue-50 border-blue-400')}>
            {editingMsg ? <Pencil size={13} className="text-amber-500 shrink-0" /> : <Reply size={13} className="text-blue-500 shrink-0" />}
            <div className="flex-1 min-w-0 flex items-center gap-2">
              {replyingTo?.media_url && (replyingTo.message_type === 'image' || replyingTo.message_type === 'video') && (
                <img src={replyingTo.media_url} className="w-8 h-8 rounded object-cover shrink-0" alt="reply-thumb" />
              )}
              <div className="min-w-0">
                <p className={clsx('font-bold uppercase tracking-tight', editingMsg ? 'text-amber-600' : 'text-blue-600')} style={{ fontSize: 10 }}>
                  {editingMsg ? 'Editando mensagem' : 'Respondendo'}
                </p>
                <p className="text-gray-600 truncate">{(editingMsg || replyingTo)?.content || (replyingTo?.media_url ? `[${replyingTo.message_type}]` : '[mídia]')}</p>
              </div>
            </div>
            <button onClick={onCancelContext} className="text-gray-400 hover:text-gray-600"><X size={13} /></button>
          </div>
        )}

        {/* Mode tabs & Input box - Hidden when previewing to avoid confusion */}
        {!previewUrl && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <button onClick={() => setInputMode('message')}
                  className={clsx('flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold transition-colors uppercase tracking-tight',
                    inputMode === 'message' ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:bg-gray-100')}>
                  <Send className="w-3 h-3" /> Transmitir
                </button>
                <button onClick={() => setInputMode('note')}
                  className={clsx('flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold transition-colors uppercase tracking-tight',
                    inputMode === 'note' ? 'bg-amber-100 text-amber-700' : 'text-gray-400 hover:bg-gray-100')}>
                  <StickyNote className="w-3 h-3" /> Nota Interna
                </button>
              </div>
              {uploadingMedia && (
                <div className="flex items-center gap-2 text-blue-600 animate-pulse">
                  <Loader2 size={12} className="animate-spin" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Enviando Mídia...</span>
                </div>
              )}
            </div>

            <div className="flex flex-col border border-gray-200 rounded-2xl overflow-hidden focus-within:ring-2 focus-within:ring-blue-400 focus-within:border-transparent transition-all shadow-sm">
              <div className="flex items-center justify-between px-2 py-1.5 bg-gray-50/50 border-b border-gray-100">
                <div className="flex items-center gap-0.5">
                  <button onClick={(e) => { e.stopPropagation(); setShowEmojiPicker(!showEmojiPicker) }}
                    className={clsx("p-2 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-white transition-all", showEmojiPicker && "text-blue-600 bg-white")} title="Emojis">
                    <Smile size={18} />
                  </button>
                  <button onClick={() => fileInputRef.current?.click()}
                    className="p-2 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-white transition-all" title="Anexar Arquivo">
                    <Paperclip size={18} />
                  </button>
                  <button onClick={() => cameraInputRef.current?.click()}
                    className="p-2 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-white transition-all hidden sm:flex" title="Câmera">
                    <Camera size={18} />
                  </button>
                </div>
                <div className="flex items-center gap-0.5">
                  {inputMode === 'message' && (
                    <button onClick={startRecording}
                      className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-all" title="Gravar Áudio">
                      <Mic size={18} />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-end gap-2 p-1.5 bg-white">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={handleInputText}
                  onKeyDown={handleKeyDown}
                  onPaste={onPaste}
                  onDragOver={e => e.preventDefault()}
                  onDrop={onDrop}
                  placeholder={inputMode === 'note' ? 'Escreva uma nota interna privada...' : 'Clique para digitar... (Enter envia)'}
                  rows={2}
                  className={clsx('flex-1 resize-none bg-transparent border-none px-3 py-2 text-sm focus:ring-0 placeholder:text-gray-300',
                    inputMode === 'note' ? 'text-amber-900' : 'text-gray-800')}
                />
                <button onClick={handleSend}
                  disabled={(!input.trim() && !uploadingMedia) || sending}
                  className={clsx('w-9 h-9 rounded-xl flex items-center justify-center transition-all shrink-0 shadow-sm border-none cursor-pointer',
                    inputMode === 'note' ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-blue-600 text-white hover:bg-blue-700',
                    (!input.trim() && !sending) && 'opacity-30 scale-95 grayscale')}>
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
            </div>

            {inputMode === 'note' && (
              <div className="flex items-center gap-1.5 px-1">
                <StickyNote size={12} className="text-amber-500" />
                <span className="text-[10px] font-bold text-amber-600 uppercase tracking-tighter">Nota invisível para o paciente</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
})

// ─────────────────────────────────────────────
// PatientPanel
// ─────────────────────────────────────────────

interface PatientPanelProps {
  session: ConversationSession
  patient: PatientInfo | null
  appointments: Appointment[]
  onClose: () => void
  onUpdateStage: (stage: string) => void
  onTransferClick: () => void
  onNewPatient: () => void
  onLookupPatient: () => void
  onQuickBook: () => void
  onViewAppointments: () => void
  onSendMessage: (text: string) => Promise<void>
  isOwned: boolean
  view: 'profile' | 'register' | 'lookup' | 'booking' | 'appointments' | 'edit' | 'availability' | 'payment' | 'directory' | 'classify'
  onViewChange: (view: 'profile' | 'register' | 'lookup' | 'booking' | 'appointments' | 'edit' | 'availability' | 'payment' | 'directory' | 'classify') => void
  onPatientSelected: (p: any) => void
  onReschedule: (appt: any) => void
  onAddToWaitlist: () => void
  onResetReschedule: () => void
  rescheduleData: any | null
}

function PatientPanel({
  session, patient, appointments, onClose, onUpdateStage, onTransferClick, isOwned, onNewPatient, onLookupPatient, onQuickBook,
  view, onViewChange, onPatientSelected, onViewAppointments, onSendMessage, onReschedule, onAddToWaitlist, onResetReschedule, rescheduleData
}: PatientPanelProps) {
  
  if (view === 'register') {
    return (
      <div className="w-full flex flex-col h-full border-l border-gray-200">
        <SidebarRegisterView 
          onBack={() => onViewChange('profile')} 
          onSuccess={(p: any) => {
            onPatientSelected(p);
            onViewChange('profile');
          }}
          initialPhone={session.patient_phone}
        />
      </div>
    );
  }

  if (view === 'lookup') {
    return (
      <div className="w-full flex flex-col h-full border-l border-gray-100">
        <SidebarLookupView 
          onBack={() => onViewChange('profile')}
          onSelect={async (p: any) => {
             onPatientSelected(p);
             onViewChange('profile');
          }}
        />
      </div>
    );
  }

  if (view === 'booking' && patient) {
    return (
      <div className="w-full flex flex-col h-full border-l border-gray-200">
        <SidebarBookingView 
          onBack={() => {
            onResetReschedule();
            onViewChange('profile');
          }}
          patientId={patient.id}
          patientName={patient.full_name || 'Paciente'}
          onSendMessage={onSendMessage}
          rescheduleFrom={rescheduleData}
          onSuccess={() => {
            onResetReschedule();
            onViewChange('profile');
          }}
        />
      </div>
    );
  }

  if (view === 'appointments' && patient) {
    return (
      <div className="w-full flex flex-col h-full border-l border-gray-200">
        <SidebarAppointmentsView 
          onBack={() => onViewChange('profile')}
          patientId={patient.id}
          patientName={patient.full_name || 'Paciente'}
          patientPhone={session.patient_phone}
          onSendMessage={onSendMessage}
          onReschedule={onReschedule}
        />
      </div>
    );
  }

  if (view === 'edit' && patient) {
    return (
      <div className="w-full flex flex-col h-full border-l border-gray-200">
        <SidebarPatientEditView
          onBack={() => onViewChange('profile')}
          patient={patient}
          session={session}
          onSuccess={(p: any) => {
            onPatientSelected(p);
            onViewChange('profile');
          }}
          onSessionUpdate={(_s: any) => {
            // Local update of session context can be handled via onPatientSelected or similar if needed
          }}
        />
      </div>
    );
  }

  if (view === 'availability') {
    return (
      <div className="w-full flex flex-col h-full border-l border-gray-200">
        <SidebarAvailabilityView
          onBack={() => onViewChange('profile')}
          onBookSlot={() => onViewChange('booking')}
        />
      </div>
    );
  }

  if (view === 'payment' && patient) {
    return (
      <div className="w-full flex flex-col h-full border-l border-gray-200">
        <SidebarPaymentView
          onBack={() => onViewChange('profile')}
          patientId={patient.id}
          patientName={patient.full_name || 'Paciente'}
          onSendLink={onSendMessage}
        />
      </div>
    );
  }

  if (view === 'directory') {
    return (
      <div className="w-full flex flex-col h-full border-l border-gray-200">
        <SidebarDirectoryView onBack={() => onViewChange('profile')} />
      </div>
    );
  }

  if (view === 'classify') {
    return (
      <div className="w-full flex flex-col h-full border-l border-gray-200">
        <SidebarLeadClassifyView
          onBack={() => onViewChange('profile')}
          session={session}
          onUpdate={(_updates) => {
            // Propagate updates locally
          }}
        />
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-white border-l border-gray-200 overflow-y-auto">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">Info do Paciente</span>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 border-b border-gray-100 flex items-center justify-between group">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
            <User className="w-5 h-5 text-blue-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-900 truncate">
              {patient?.full_name ?? 'Paciente não cadastrado'}
            </p>
            <p className="text-xs text-gray-500">{formatPhone(session.patient_phone)}</p>
          </div>
        </div>
        {patient && (
          <button 
            onClick={() => onViewChange('edit')}
            className="p-2 rounded-xl text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-all opacity-0 group-hover:opacity-100 border-none bg-transparent cursor-pointer"
            title="Editar Perfil"
          >
            <UserPlus className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Dual Identity Sub-header (Interlocutor) */}
      {session.context?.interlocutor && !session.context.interlocutor.isPatient && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <p className="text-[10px] text-amber-800 font-medium">
            Falando com: <span className="font-bold">{session.context.interlocutor.name}</span> ({session.context.interlocutor.relationship})
          </p>
        </div>
      )}

      {/* Sticky Notes Section */}
      {patient?.notes && (
        <div className="px-4 py-3 bg-amber-50/50 border-b border-amber-100 relative group">
          <div className="flex items-center gap-1.5 mb-1.5">
            <StickyNote className="w-3.5 h-3.5 text-amber-600" />
            <span className="text-[10px] font-black text-amber-700 uppercase tracking-widest">Notas do Front-Desk</span>
          </div>
          <p className="text-xs text-amber-900 leading-relaxed font-medium">
            {patient.notes}
          </p>
        </div>
      )}

      {/* Canal de Notificação (No-Show + NPS) */}
      <div className="p-4 border-b border-gray-100">
        <ChannelPreferenceSelector
          tenantId={session.tenant_id}
          patientPhone={session.patient_phone}
          compact
        />
      </div>

      {/* Additional Identity Details */}
      <div className="p-4 border-b border-gray-100 space-y-2">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <CreditCard className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <span>CPF: <span className="font-medium">{maskCpf(patient?.cpf)}</span></span>
          </div>
          {patient?.birth_date && (
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <span>
                Nasc.: <span className="font-medium">
                  {patient.birth_date && typeof patient.birth_date === 'string' && patient.birth_date.includes('-') 
                    ? formatDisplayDate(patient.birth_date)
                    : (patient.birth_date || '—')}
                </span>
              </span>
            </div>
          )}
      </div>

      {/* Upcoming appointments */}
      <div className="p-4 border-b border-gray-100">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Próximas Consultas</p>
        {appointments.length === 0 ? (
          <p className="text-xs text-gray-400 italic">Nenhuma consulta agendada</p>
        ) : (
          <div className="space-y-2">
            {appointments.map((appt: Appointment, i: number) => (
              <div key={i} className="bg-blue-50 rounded-xl p-2.5 text-xs">
                <p className="font-semibold text-blue-800">{appt.appointment_types?.name ?? 'Consulta'}</p>
                <p className="text-blue-600 mt-0.5">
                  {appt.doctors?.full_name ?? 'Médico'} · {appt.locations?.name ?? ''}
                </p>
                <p className="text-blue-500 mt-0.5">
                  {appt.date && typeof appt.date === 'string' && appt.date.includes('-') 
                    ? new Date(appt.date + 'T12:00:00').toLocaleDateString('pt-BR') 
                    : (appt.date || '')}
                  {appt.start_time ? ` às ${String(appt.start_time).substring(0, 5)}` : ''}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action Toolbar */}
      <div className="p-4 border-b border-gray-100 bg-blue-50/30">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Ações Rápidas</p>
        <div className="grid grid-cols-3 gap-2">
          {!patient ? (
            <>
              <button onClick={onNewPatient} className="flex flex-col items-center gap-1 p-2 rounded-xl transition-all bg-blue-50 text-blue-600 hover:bg-blue-100">
                <UserPlus size={18} />
                <span className="text-[9px] font-bold uppercase tracking-tight">Cadastrar</span>
              </button>
              <button onClick={onLookupPatient} className="flex flex-col items-center gap-1 p-2 rounded-xl transition-all bg-gray-50 text-gray-600 hover:bg-gray-100">
                <Search size={18} />
                <span className="text-[9px] font-bold uppercase tracking-tight">Vincular</span>
              </button>
            </>
          ) : (
            <>
              <button onClick={onQuickBook} className="flex flex-col items-center gap-1 p-2 rounded-xl transition-all bg-blue-50 text-blue-600 hover:bg-blue-100">
                <Calendar size={18} />
                <span className="text-[9px] font-bold uppercase tracking-tight">Agendar</span>
              </button>
              <button onClick={onViewAppointments} className="flex flex-col items-center gap-1 p-2 rounded-xl transition-all bg-gray-50 text-gray-600 hover:bg-gray-100">
                <Clock size={18} />
                <span className="text-[9px] font-bold uppercase tracking-tight">Consultas</span>
              </button>
              <button onClick={() => onViewChange('payment')} className="flex flex-col items-center gap-1 p-2 rounded-xl transition-all bg-green-50 text-green-600 hover:bg-green-100">
                <DollarSign size={18} />
                <span className="text-[9px] font-bold uppercase tracking-tight">Pagamento</span>
              </button>
            </>
          )}
          <button onClick={() => onViewChange('availability')} className="flex flex-col items-center gap-1 p-2 rounded-xl transition-all bg-indigo-50 text-indigo-600 hover:bg-indigo-100">
            <CalendarSearch size={18} />
            <span className="text-[9px] font-bold uppercase tracking-tight">Disponib.</span>
          </button>
          <button onClick={() => onViewChange('directory')} className="flex flex-col items-center gap-1 p-2 rounded-xl transition-all bg-slate-50 text-slate-600 hover:bg-slate-100">
            <Building2 size={18} />
            <span className="text-[9px] font-bold uppercase tracking-tight">Diretório</span>
          </button>
          <button onClick={() => onViewChange('classify')} className="flex flex-col items-center gap-1 p-2 rounded-xl transition-all bg-amber-50 text-amber-600 hover:bg-amber-100">
            <Tag size={18} />
            <span className="text-[9px] font-bold uppercase tracking-tight">Classificar</span>
          </button>
          {patient && (
            <button onClick={onAddToWaitlist} className="flex flex-col items-center gap-1 p-2 rounded-xl transition-all bg-purple-50 text-purple-600 hover:bg-purple-100">
              <Clock size={18} />
              <span className="text-[9px] font-bold uppercase tracking-tight">Espera</span>
            </button>
          )}
        </div>
      </div>

      {/* Kanban Classification */}
      <div className="p-4 border-b border-gray-100">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Classificação Kanban</p>
        <select
          value={session.kanban_stage || 'Novos Leads'}
          onChange={(e) => onUpdateStage(e.target.value)}
          className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium text-gray-800 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
        >
          {KANBAN_STAGES.map(stage => (
            <option key={stage} value={stage}>{stage}</option>
          ))}
        </select>
        <p className="text-[10px] text-gray-400 mt-1.5 leading-tight">
          Altere o estágio do funil aqui para refletir no Painel de Follow-up (Kanban).
        </p>
      </div>

      {/* Transfer Action */}
      {isOwned && (
        <div className="p-4 pt-0">
          <button 
              onClick={onTransferClick}
              className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors text-xs text-gray-800 font-bold"
          >
              <ArrowRightLeft className="w-4 h-4 text-indigo-600" />
              Transferir Atendimento
          </button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────

export function HumanInboxPage() {
  const { showToast, showConfirm } = useToast()
  const [tenantId, setTenantId]       = useState<string | null>(null)
  const [userId, setUserId]           = useState<string | null>(null)
  const [tab, setTab]                 = useState<'all' | 'queued' | 'mine'>('queued')
  const [search, setSearch]           = useState('')
  const [sessions, setSessions]       = useState<ConversationSession[]>([])
  const [queuedCount, setQueuedCount] = useState(0)
  const [myCount, setMyCount]         = useState(0)
  const [allCount, setAllCount]       = useState(0)
  const [selected, setSelected]       = useState<ConversationSession | null>(null)
  const [messages, setMessages]       = useState<Message[]>([])
  const [sending, setSending]         = useState(false)
  const [claiming, setClaiming]       = useState(false)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [showPatientPanel, setShowPatientPanel] = useState(true)
  const [patient, setPatient]         = useState<PatientInfo | null>(null)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [patientNames, setPatientNames] = useState<Record<string, string>>({})
  const [teamUsers, setTeamUsers] = useState<any[]>([]);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [selectedUserToTransfer, setSelectedUserToTransfer] = useState<string | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [selectedStage, setSelectedStage] = useState<string>('Todos')
  const [stageDropdownOpen, setStageDropdownOpen] = useState(false)
  const [rescheduleData, setRescheduleData] = useState<any | null>(null);
  const [channelFilter, setChannelFilter] = useState<'all' | 'whatsapp' | 'livechat' | 'instagram' | 'facebook'>('all');
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Attempt to grab the slot immediately and also set up an observer or interval just in case
    const el = document.getElementById('inbox-header-slot');
    if (el) setHeaderSlot(el);
    else {
      // Retry after a short delay since it might render slightly after
      const timeout = setTimeout(() => {
        setHeaderSlot(document.getElementById('inbox-header-slot'));
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, []);

  // Scripts state
  const [salesScripts, setSalesScripts] = useState<any[]>([]);
  const [clinicName, setClinicName] = useState<string>('');
  const [isScriptManagerOpen, setIsScriptManagerOpen] = useState(false);
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);

  // CRM Inline Sidebar Views
  const [sidebarView, setSidebarView] = useState<'profile' | 'register' | 'lookup' | 'booking' | 'appointments' | 'edit' | 'availability' | 'payment' | 'directory' | 'classify'>('profile');
  const [, setTick] = useState(0)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)

  // ── Handlers ──────────────────────────────────
  const markAsRead = useCallback(async (sessionId: string) => {
    // Optimistic update
    setSessions(prev => prev.map(s => 
      s.id === sessionId ? { ...s, unread_count: 0 } : s
    ))
    
    try {
      await supabase.rpc('mark_session_as_read', { p_session_id: sessionId })
    } catch (err) {
      console.error('Failed to mark session as read', err)
    }
  }, [tenantId])

  const handleSelectSession = useCallback((s: ConversationSession) => {
    setSelected(s)
    if ((s.unread_count ?? 0) > 0) {
      markAsRead(s.id)
    }
  }, [markAsRead])

  // ── Message Actions ─────────────────────────────────────────────
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [editingMsg, setEditingMsg]   = useState<Message | null>(null)
  const [forwardMsg, setForwardMsg]   = useState<Message | null>(null)

  const isOwned  = selected?.assigned_to_user_id === userId && selected?.omnichannel_status === 'human_active'
  const canClaim = selected?.omnichannel_status === 'queued' || selected?.omnichannel_status === 'bot_active'
  const isClosed = selected?.omnichannel_status === 'closed'

  const onCancelContext = useCallback(() => {
    setReplyingTo(null)
    setEditingMsg(null)
  }, [])

  const bottomRef      = useRef<HTMLDivElement>(null)
  const lastSelectedId = useRef<string | null>(null)

  // ── Upload para o bucket chat-media ──────────
  const uploadToStorage = useCallback(async (file: File) => {
    const ext      = file.name.split('.').pop()
    const isImage  = file.type.startsWith('image/')
    const isVideo  = file.type.startsWith('video/')
    const isAudio  = file.type.startsWith('audio/')
    const folder   = isImage ? 'images' : isVideo ? 'videos' : isAudio ? 'audios' : 'documents'
    const fileName = `${tenantId}/${folder}/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`
    const { data, error } = await supabase.storage
      .from('chat-media')
      .upload(fileName, file, { cacheControl: '3600', upsert: false })
    if (error) throw error
    const { data: { publicUrl } } = supabase.storage.from('chat-media').getPublicUrl(data.path)
    return publicUrl
  }, [tenantId])

  // ── Send media via edge function ──────────────
  const handleSendMedia = useCallback(async (url: string, type: any, opts: any = {}) => {
    if (!selected) return
    const capturedReplyId = replyingTo?.id
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const { data, error } = await supabase.functions.invoke('send-human-media', {
        body: {
          session_id: selected.id,
          tenant_id:  tenantId,
          user_id:    userId,
          media_url:  url,
          media_type: type,
          mime_type:  opts.mimeType,
          caption:    opts.caption,
          file_name:  opts.fileName,
          file_size:  opts.fileSize,
          duration_s: opts.durationS,
          replied_to_id: capturedReplyId || null,
        },
        headers: { Authorization: `Bearer ${authSession?.access_token}` }
      })
      if (error) throw new Error(error.message)
      if (data?.error) throw new Error(data.error)
      onCancelContext() // Clear reply/edit context after successful send
    } catch (err: any) {
      showToast('error', 'Erro ao enviar mídia: ' + err.message)
    } finally {
      setUploadingMedia(false)
    }
  }, [selected, tenantId, userId, replyingTo, onCancelContext])

  const [currentUserName, setCurrentUserName] = useState<string>('');

  // ── Bootstrap ─────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const user = session.user
      
      // Prioritize name from profiles table, fallback to metadata
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single()
      
      const displayName = profile?.full_name || user.user_metadata?.full_name || user.user_metadata?.name || 'Atendente'
      setCurrentUserName(displayName);

      const { data: memberData } = await supabase
        .from('members').select('tenant_id').eq('user_id', user.id).single()
      
      if (memberData) {
        setTenantId(memberData.tenant_id)
        setUserId(user.id)
        loadSessions(memberData.tenant_id, user.id)
        loadTeamUsers(memberData.tenant_id, user.id)
        loadSalesScripts(memberData.tenant_id) // Fetch scripts on load
      }
    })
  }, [])

  const loadSalesScripts = async (tId: string) => {
    // Fetch tenant name for variable resolution
    const { data: tenantData } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', tId)
      .single();
    
    if (tenantData) setClinicName(tenantData.name);

    const { data } = await supabase
      .from('sales_scripts')
      .select('*')
      .or(`tenant_id.eq.${tId},tenant_id.is.null`)
      .order('title', { ascending: true });
    
    if (data) setSalesScripts(data);
  }

  // ── SLA tick ──────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  // ── Load team users ───────────────────────────
  const loadTeamUsers = async (tId: string, currentId: string) => {
    try {
      const { data: mems } = await supabase.from('members').select('user_id').eq('tenant_id', tId);
      if (mems && mems.length > 0) {
        const ids = mems.map(m => m.user_id).filter(id => id !== currentId);
        if (ids.length > 0) {
          const { data: profs } = await supabase.from('profiles').select('id, full_name, role').in('id', ids);
          setTeamUsers(profs || []);
        }
      }
    } catch (e) {
      console.warn('Failed to load team users', e);
    }
  }

  // ── Load sessions ─────────────────────────────
  const loadSessions = useCallback(async (tId?: string, uId?: string, silent = false) => {
    const targetTenant = tId || tenantId
    const targetUser = uId || userId
    if (!targetTenant || !targetUser) return
    
    // Only show loading if NOT a silent update
    if (!silent) setLoadingSessions(true)

    const [queuedRes, mineRes, allRes] = await Promise.all([
      supabase.from('conversation_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', targetTenant)
        .eq('omnichannel_status', 'queued'),
      supabase.from('conversation_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', targetTenant)
        .eq('omnichannel_status', 'human_active')
        .eq('assigned_to_user_id', targetUser),
      supabase.from('conversation_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', targetTenant)
        .neq('omnichannel_status', 'closed'),
    ])
    setQueuedCount(queuedRes.count ?? 0)
    setMyCount(mineRes.count ?? 0)
    setAllCount(allRes.count ?? 0)

    let query = supabase
      .from('conversation_sessions')
      .select('*')
      .eq('tenant_id', targetTenant)
      .order('updated_at', { ascending: false })

    if (tab === 'queued') {
      query = query.eq('omnichannel_status', 'queued')
    } else if (tab === 'mine') {
      query = query
        .eq('omnichannel_status', 'human_active')
        .eq('assigned_to_user_id', targetUser)
    } else {
      query = query.neq('omnichannel_status', 'closed')
    }

    const { data } = await query
    const list = (data as ConversationSession[]) ?? []
    
    // Surgical update if silent
    if (silent) {
      setSessions(prev => {
        // Compare lists to see if we actually need a state update to prevent over-renders
        if (JSON.stringify(prev) === JSON.stringify(list)) return prev
        return list
      })
    } else {
      setSessions(list)
    }

    if (list.length > 0) {
      const phones = [...new Set(list.map(s => s.patient_phone))]
      const { data: pts } = await supabase
        .from('patients')
        .select('phone, full_name, notes')
        .in('phone', phones)
        .eq('tenant_id', targetTenant)
      if (pts) {
        const map: Record<string, string> = {}
        pts.forEach((p: any) => { if (p.full_name) map[p.phone] = p.full_name })
        setPatientNames(map)
      }
    }

    if (!silent) setLoadingSessions(false)
  }, [tenantId, tab, userId])

  useEffect(() => { loadSessions() }, [loadSessions])

  // ── Realtime: session list ────────────────────
  useEffect(() => {
    if (!tenantId) return
    const ch = supabase
      .channel(`inbox:sessions:${tenantId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'conversation_sessions',
        filter: `tenant_id=eq.${tenantId}`,
      }, (payload) => {
        // Silent refresh of the list to update counts and badges
        loadSessions(tenantId || undefined, userId || undefined, true)
        
        // Handle audio alerts based on event type
        const newStatus = (payload.new as any)?.omnichannel_status;
        const oldStatus = (payload.old as any)?.omnichannel_status;
        if (payload.eventType === 'INSERT' || (payload.eventType === 'UPDATE' && newStatus === 'queued')) {
           if (newStatus === 'queued' && oldStatus !== 'queued') {
             // New Queue Entry Bell
             const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3')
             audio.play().catch(e => console.warn('Queue alert failed:', e))
           }
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [tenantId, loadSessions, userId])

  // ── Polling fallback (Reduced frequency for safety) ──
  useEffect(() => {
    if (!tenantId) return
    const interval = setInterval(async () => {
      // Use silent load to avoid flickering
      await loadSessions(tenantId || undefined, userId || undefined, true)
    }, 15000) // 15s is enough as a fallback
    return () => clearInterval(interval)
  }, [tenantId, loadSessions, userId])

  // ── Load patient info when session selected ───
  useEffect(() => {
    setPatient(null)
    setAppointments([])
    setSidebarView('profile')
    if (!selected || !tenantId) return

    const phone = selected.patient_phone
    supabase.from('patients')
      .select('id, full_name, cpf, email, birth_date, notes')
      .eq('tenant_id', tenantId)
      .eq('phone', phone)
      .maybeSingle()
      .then(({ data }) => {
        setPatient(data as PatientInfo | null)
        if (data?.id) {
          supabase.from('appointments')
            .select('date, start_time, status, doctors(full_name), locations(name), appointment_types(name)')
            .eq('tenant_id', tenantId)
            .eq('patient_id', data.id)
            .in('status', ['scheduled', 'confirmed'])
            .gte('date', new Date().toISOString().split('T')[0])
            .order('date', { ascending: true })
            .limit(3)
            .then(({ data: appts }) => setAppointments((appts ?? []) as any as Appointment[]))
        }
      })
  }, [selected?.id, tenantId])

  // ── Load messages when session selected ───────
  useEffect(() => {
    if (!selected) return
    setSidebarView('profile') // Reset sidebar view when changing conversation
    setMessages([]) // Clear previous messages immediately
    setLoadingMessages(true)
    supabase
      .from('conversation_messages')
      .select('*')
      .eq('session_id', selected.id)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setMessages((data as Message[]) ?? [])
        setLoadingMessages(false)
      })
  }, [selected?.id])

  // ── Realtime: messages ────────────────────────
  useEffect(() => {
    if (!selected) return
    const ch = supabase
      .channel(`inbox:msgs:${selected.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'conversation_messages',
        filter: `session_id=eq.${selected.id}`,
      }, (payload) => {
        const newMsg = payload.new as Message;
        
        // Play Pop sound for human messages or incoming user messages
        if (newMsg.role === 'user' || newMsg.role === 'human') {
          const soundUrl = 'https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3';
          const audio = new Audio(soundUrl);
          audio.play().catch(e => console.warn('Message sound play failed:', e));
        }

        setMessages(prev => {
          const exists = prev.find(m => m.id === newMsg.id);
          if (exists) return prev;

          const tempMatch = prev.find(m =>
            m.id.startsWith('temp-') &&
            m.content === newMsg.content &&
            m.role === newMsg.role
          );

          if (tempMatch) {
            return prev.map(m => m.id === tempMatch.id ? newMsg : m);
          }

          return [...prev, newMsg];
        });
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [selected?.id])

  // ── Polling fallback: fetch new messages every 5s ──
  useEffect(() => {
    if (!selected) return
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('conversation_messages')
        .select('*')
        .eq('session_id', selected.id)
        .order('created_at', { ascending: true })
      
      if (data) {
        setMessages(prev => {
          const currentNonTempCount = prev.filter(m => !m.id.startsWith('temp-')).length
          if (data.length === currentNonTempCount) return prev

          const tempMsgs = prev.filter(m => m.id.startsWith('temp-'))
          const merged = [...(data as Message[])]
          for (const temp of tempMsgs) {
            const match = merged.find(m => m.content === temp.content && m.role === temp.role)
            if (!match) merged.push(temp)
          }
          return merged
        })
      }
    }, 5000) // 5s fallback
    return () => clearInterval(interval)
  }, [selected?.id])

  // ── Realtime: Global Notifications (Sound Alert) ──
  useEffect(() => {
    if (!tenantId) return

    const channel = supabase
      .channel(`tenant-messages-${tenantId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'patient_funnel_stage',
        filter: `tenant_id=eq.${tenantId}`
      }, () => {
        // Trigger sound alert on any funnel stage update (which happens on message reception)
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3')
        audio.play().catch(e => console.warn('Sound play failed:', e))
        
        // Refresh sidebar
        loadSessions()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [tenantId, loadSessions])

  // ── Auto-scroll ───────────────────────────────
  useEffect(() => {
    if (!selected) {
      lastSelectedId.current = null
      return
    }

    const isNewSelection = selected.id !== lastSelectedId.current

    if (messages.length > 0) {
      bottomRef.current?.scrollIntoView({ 
        behavior: isNewSelection ? 'auto' : 'smooth' 
      })
      lastSelectedId.current = selected.id
    }
  }, [messages, selected?.id])

  // ── Claim ─────────────────────────────────────
  const handleClaim = async () => {
    if (!selected || !userId || !tenantId) return
    setClaiming(true)
    const { data, error } = await supabase.rpc('claim_conversation', {
      p_session_id: selected.id, p_user_id: userId, p_tenant_id: tenantId,
    })
    if (error || !data?.success) {
      showToast('error', data?.reason === 'already_being_claimed'
        ? 'Outro atendente está assumindo esta conversa.'
        : `Erro: ${data?.reason ?? error?.message}`)
    } else {
      setSelected(prev => prev
        ? { ...prev, omnichannel_status: 'human_active', assigned_to_user_id: userId }
        : prev)
      await loadSessions()
    }
    setClaiming(false)
  }

  // ── Send message / internal note ──────────────
  const handleSend = useCallback(async (text: string, mode: 'message' | 'note') => {
    if (!selected || sending) return
    setSending(true)

    // ── EDIT mode: update existing message ────────
    if (editingMsg) {
      const { error } = await supabase
        .from('conversation_messages')
        .update({ content: text, is_edited: true })
        .eq('id', editingMsg.id)
      if (!error) {
        setMessages(prev => prev.map(m => m.id === editingMsg.id ? { ...m, content: text, is_edited: true } : m))
      } else {
        showToast('error', 'Erro ao editar: ' + error.message)
      }
      setEditingMsg(null)
      setSending(false)
      return
    }

    // OPTIMISTIC UI
    const tempId = `temp-${Date.now()}`
    const capturedReplyId = replyingTo?.id
    setMessages(prev => [...prev, {
      id: tempId,
      session_id: selected.id,
      role: mode === 'note' ? 'internal' : 'human',
      content: text,
      created_at: new Date().toISOString(),
      replied_to_id: capturedReplyId,
    }])
    setReplyingTo(null)

    if (mode === 'message' && selected.omnichannel_status !== 'human_active') {
      setSelected(prev => prev ? { ...prev, omnichannel_status: 'human_active', assigned_to_user_id: userId } : prev)
    }

    if (mode === 'note') {
      if (!patient) {
        showToast('warning', 'Vincule o paciente primeiro para salvar notas no Perfil.')
        setMessages(prev => prev.filter(m => m.id !== tempId))
        setSending(false)
        return
      }
      const { error: pError } = await supabase.from('patients').update({ notes: text }).eq('id', patient.id)
      if (!pError) setPatient(prev => prev ? { ...prev, notes: text } : prev)
      const { error } = await supabase.from('conversation_messages').insert({ session_id: selected.id, role: 'internal', content: text })
      if (error) {
        showToast('error', 'Erro ao salvar nota: ' + error.message)
        setMessages(prev => prev.filter(m => m.id !== tempId))
      }
    } else {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const res = await supabase.functions.invoke('send-human-message', {
        body: { session_id: selected.id, text, tenant_id: tenantId, user_id: userId, replied_to_id: capturedReplyId },
        headers: { Authorization: `Bearer ${authSession?.access_token}` }
      })
      if (res.error || res.data?.error) {
        showToast('error', 'Erro ao enviar: ' + (res.error?.message || res.data?.error))
        setMessages(prev => prev.filter(m => m.id !== tempId))
      }
    }
    setSending(false)
  }, [selected, sending, editingMsg, replyingTo, patient, tenantId, userId])

  // ── Forward message to another session ────────
  const handleForward = async (targetSessionId: string) => {
    if (!forwardMsg || !tenantId || !userId) return
    const { data: { session: authSession } } = await supabase.auth.getSession()
    
    // Check if it's a media message
    if (forwardMsg.media_url) {
      await supabase.functions.invoke('send-human-media', {
        body: {
          session_id: targetSessionId,
          media_url:  forwardMsg.media_url,
          media_type: forwardMsg.message_type || 'image',
          mime_type:  forwardMsg.mime_type,
          caption:    forwardMsg.caption,
          file_name:  forwardMsg.file_name,
          tenant_id:  tenantId,
          user_id:    userId,
        },
        headers: { Authorization: `Bearer ${authSession?.access_token}` }
      })
    } else {
      await supabase.functions.invoke('send-human-message', {
        body: {
          session_id: targetSessionId,
          text: forwardMsg.content || '[Mídia]',
          tenant_id: tenantId,
          user_id: userId,
        },
        headers: { Authorization: `Bearer ${authSession?.access_token}` }
      })
    }
    setForwardMsg(null)
    await loadSessions()
  }

  // ── Stage Management ──────────────────────────
  /*
  const handleUpdateStage = async (sessionId: string, stage: string) => {
    const { error } = await supabase
      .from('conversation_sessions')
      .update({ kanban_stage: stage })
      .eq('id', sessionId)
    if (error) showToast('error', 'Erro ao atualizar etapa: ' + error.message)
    await loadSessions()
  }
  */

  // ── Send message from Sidebar ─────────────────
  const handleSidebarSendMessage = async (text: string) => {
    if (!selected) return
    console.log('[HumanInbox] Sidebar invoking send-human-message:', { session_id: selected.id, text, userId })
    const { data: { session: authSession } } = await supabase.auth.getSession()
    const { error } = await supabase.functions.invoke('send-human-message', {
      body: { session_id: selected.id, text, tenant_id: tenantId, user_id: userId },
      headers: { Authorization: `Bearer ${authSession?.access_token}` }
    })
    if (error) {
      showToast('error', 'Erro ao enviar link: ' + error.message)
    }
  }

  // ── Transfer ──────────────────────────────────
  const handleTransfer = async () => {
    if (!selected || !selectedUserToTransfer || !userId || !tenantId) return;
    setTransferring(true);
    const { data, error } = await supabase.rpc('transfer_conversation', {
        p_session_id: selected.id,
        p_from_user_id: userId,
        p_to_user_id: selectedUserToTransfer,
        p_tenant_id: tenantId
    });
    
    setTransferring(false);
    
    if (data?.success) {
        setShowTransferModal(false);
        setSelected(null);
        await loadSessions();
        showToast('success', 'Atendimento transferido com sucesso!');
    } else {
        showToast('error', 'Erro ao transferir: ' + (data?.reason || error?.message));
    }
  }

  // ── Close ─────────────────────────────────────
  const handleClose = async () => {
    if (!selected) return
    await supabase.from('conversation_sessions')
      .update({ omnichannel_status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', selected.id)
    setSelected(null)
    loadSessions()
  }

  // ── Delete Message ────────────────────────────
  const handleDeleteMessage = useCallback(async (msg: Message) => {
    if (!selected || !tenantId || !userId) return
    
    const confirmDelete = await showConfirm("Deseja realmente apagar esta mensagem para todos?");
    if (!confirmDelete) return;

    // Optimistic UI update
    const previousMessages = [...messages];
    setMessages(prev => prev.filter(m => m.id !== msg.id));

    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const { data, error } = await supabase.functions.invoke('delete-human-message', {
        body: {
          message_id: msg.id,
          tenant_id: tenantId,
          user_id: userId,
          delete_on_whatsapp: msg.role !== 'internal'
        },
        headers: { Authorization: `Bearer ${authSession?.access_token}` }
      });

      if (error || data?.error) {
        throw new Error(error?.message || data?.error);
      }

      showToast('success', 'Mensagem apagada com sucesso');
    } catch (err: any) {
      console.error('Delete message error:', err);
      showToast('error', 'Erro ao apagar mensagem: ' + err.message);
      // Revert optimistic update on error
      setMessages(previousMessages);
    }
  }, [selected, tenantId, userId, messages, showToast]);



  const channelCounts = useMemo(() => {
    const counts = { all: 0, whatsapp: 0, livechat: 0, instagram: 0, facebook: 0 }
    sessions.forEach(s => {
      const chan = s.channel || 'whatsapp'
      if (chan === 'whatsapp' || chan === 'livechat' || chan === 'instagram' || chan === 'facebook') {
        counts[chan]++
      }
    })
    counts.all = sessions.length
    return counts
  }, [sessions])

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = { Todos: sessions.length }
    KANBAN_STAGES.forEach(s => {
      counts[s] = 0
    })
    sessions.forEach(s => {
      const stage = s.kanban_stage || 'Novos Leads'
      if (stage in counts) {
        counts[stage]++
      } else {
        counts[stage] = 1
      }
    })
    return counts
  }, [sessions])

  const filtered = sessions.filter(s => {
    const matchesSearch = !search ||
      s.patient_phone.includes(search) ||
      (patientNames[s.patient_phone] ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (s.kanban_stage ?? '').toLowerCase().includes(search.toLowerCase()) ||
      ((s.channel === 'livechat' || s.channel === 'instagram' || s.channel === 'facebook') && (
        (s.context?.visitor_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (s.context?.visitor_email ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (s.context?.visitor_phone ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (s.context?.username ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (s.context?.name ?? '').toLowerCase().includes(search.toLowerCase())
      ))

    const matchesStage = selectedStage === 'Todos' || (s.kanban_stage || 'Novos Leads') === selectedStage
    const matchesChannel = channelFilter === 'all' || (s.channel || 'whatsapp') === channelFilter

    return matchesSearch && matchesStage && matchesChannel
  })

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-120px)] bg-white rounded-2xl overflow-hidden border border-gray-200 shadow-sm">
      {headerSlot && createPortal(
        <div className="flex items-center justify-between w-full h-full px-1 lg:px-2 gap-2 lg:gap-4">
          {/* Left: Channels segmented control */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar flex-1 min-w-0">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 select-none hidden lg:block shrink-0">Canais:</span>
            <div className="flex bg-slate-100/90 border border-slate-200/60 p-0.5 rounded-xl shrink-0 gap-0.5">
               <button
                  onClick={() => setChannelFilter('all')}
                  className={clsx(
                    "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                    channelFilter === 'all'
                      ? "bg-white text-slate-900 shadow-sm border border-slate-200/50"
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-200/50"
                  )}
                >
                  Todos
                  <span className={clsx(
                    "px-1.5 py-0.5 rounded-full text-[9px] font-extrabold transition-all",
                    channelFilter === 'all' ? "bg-slate-100 text-slate-600" : "bg-slate-200/50 text-slate-500"
                  )}>
                    {channelCounts.all}
                  </span>
                </button>
               <button
                  onClick={() => setChannelFilter('whatsapp')}
                  className={clsx(
                    "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                    channelFilter === 'whatsapp'
                      ? "bg-emerald-600 text-white shadow-sm shadow-emerald-600/10 border border-emerald-500/50"
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-200/50"
                  )}
                >
                  WhatsApp
                  <span className={clsx(
                    "px-1.5 py-0.5 rounded-full text-[9px] font-extrabold transition-all",
                    channelFilter === 'whatsapp' ? "bg-white/20 text-white" : "bg-slate-200/50 text-slate-500"
                  )}>
                    {channelCounts.whatsapp}
                  </span>
                </button>
               <button
                  onClick={() => setChannelFilter('livechat')}
                  className={clsx(
                    "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                    channelFilter === 'livechat'
                      ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/10 border border-indigo-500/50"
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-200/50"
                  )}
                >
                  Live Chat
                  <span className={clsx(
                    "px-1.5 py-0.5 rounded-full text-[9px] font-extrabold transition-all",
                    channelFilter === 'livechat' ? "bg-white/20 text-white" : "bg-slate-200/50 text-slate-500"
                  )}>
                    {channelCounts.livechat}
                  </span>
                </button>
               <button
                  onClick={() => setChannelFilter('instagram')}
                  className={clsx(
                    "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                    channelFilter === 'instagram'
                      ? "bg-gradient-to-r from-purple-600 to-pink-500 text-white shadow-sm shadow-pink-600/10 border border-pink-500/50"
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-200/50"
                  )}
                >
                  Instagram
                  <span className={clsx(
                    "px-1.5 py-0.5 rounded-full text-[9px] font-extrabold transition-all",
                    channelFilter === 'instagram' ? "bg-white/20 text-white" : "bg-slate-200/50 text-slate-500"
                  )}>
                    {channelCounts.instagram}
                  </span>
                </button>
               <button
                  onClick={() => setChannelFilter('facebook')}
                  className={clsx(
                    "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                    channelFilter === 'facebook'
                      ? "bg-blue-600 text-white shadow-sm shadow-blue-600/10 border border-blue-500/50"
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-200/50"
                  )}
                >
                  Messenger
                  <span className={clsx(
                    "px-1.5 py-0.5 rounded-full text-[9px] font-extrabold transition-all",
                    channelFilter === 'facebook' ? "bg-white/20 text-white" : "bg-slate-200/50 text-slate-500"
                  )}>
                    {channelCounts.facebook}
                  </span>
                </button>
            </div>
          </div>

          {/* Right: Dropdown for Kanban Stages */}
          <div className="relative shrink-0">
            <button 
              onClick={() => setStageDropdownOpen(!stageDropdownOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 transition-all font-bold text-xs cursor-pointer shadow-sm"
            >
              <span className="text-slate-400 font-extrabold text-[9px] uppercase tracking-wider hidden lg:inline-block">Estágio:</span>
              <span className={clsx(
                "px-1 py-0.5 rounded-lg text-xs font-bold",
                selectedStage === 'Todos' ? "text-indigo-600" :
                selectedStage === 'Perdido' ? "text-slate-600" :
                selectedStage === 'Vendido/Procedimento' ? "text-emerald-600" :
                selectedStage === 'Avaliação' ? "text-violet-600" : "text-blue-600"
              )}>{selectedStage}</span>
              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-extrabold bg-slate-100 text-slate-600">
                {stageCounts[selectedStage]}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-1" />
            </button>

            {stageDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setStageDropdownOpen(false)} />
                <div className="absolute right-0 mt-2 w-64 bg-white/95 backdrop-blur-xl border border-slate-200/80 rounded-2xl shadow-xl py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="px-3 py-1 text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2 mb-1">Selecionar Estágio</div>
                  <button
                    onClick={() => { setSelectedStage('Todos'); setStageDropdownOpen(false); }}
                    className={clsx(
                      "w-full flex items-center justify-between px-4 py-2.5 text-left text-xs font-bold hover:bg-slate-50 cursor-pointer transition-colors",
                      selectedStage === 'Todos' ? "text-indigo-600 bg-indigo-50/50" : "text-slate-700"
                    )}
                  >
                    <span>Todos</span>
                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-extrabold bg-slate-100 text-slate-500">{stageCounts.Todos}</span>
                  </button>
                  <div className="h-px bg-slate-100 my-1" />
                  <div className="max-h-[300px] overflow-y-auto no-scrollbar">
                    {KANBAN_STAGES.map(s => (
                      <button
                        key={s}
                        onClick={() => { setSelectedStage(s); setStageDropdownOpen(false); }}
                        className={clsx(
                          "w-full flex items-center justify-between px-4 py-2.5 text-left text-xs font-bold hover:bg-slate-50 cursor-pointer transition-colors",
                          selectedStage === s ? "text-blue-600 bg-blue-50/50" : "text-slate-700"
                        )}
                      >
                        <span className="truncate pr-2">{s}</span>
                        {stageCounts[s] > 0 ? (
                          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-extrabold bg-slate-100 text-slate-500">{stageCounts[s]}</span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold text-slate-300">0</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>,
        headerSlot
      )}

      {/* ══════════════════════════════════════════
          LEFT — Queue / Session list
      ══════════════════════════════════════════ */}
      <div className={clsx(
        "w-full lg:w-[280px] shrink-0 flex flex-col bg-white border-r border-gray-200 h-full",
        selected ? "hidden lg:flex" : "flex"
      )}>

        {/* Header */}
        <div className="px-4 py-4 border-b border-gray-100 space-y-3">
          <div className="flex items-center gap-2">
            <Inbox className="w-4 h-4 text-blue-600" />
            <h1 className="text-sm font-bold text-gray-900">Atendimento Humano</h1>
          </div>

          {/* Search */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5">
              <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar paciente..."
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-gray-400"
              />
            </div>
            {/* Filters moved to Header Portal */}
          </div>

          {/* Tabs */}
          <div className="flex rounded-xl overflow-hidden border border-gray-200 text-[11px]">
            <button
              onClick={() => setTab('all')}
              className={clsx(
                'flex-1 py-1.5 font-semibold transition-colors flex items-center justify-center gap-1.5',
                tab === 'all' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              Todos
              {allCount > 0 && (
                <span className={clsx(
                  'inline-flex items-center justify-center h-4 px-1.5 rounded-full text-[9px] font-black',
                  tab === 'all' ? 'bg-white/30 text-white' : 'bg-gray-200 text-gray-600',
                )}>
                  {allCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setTab('queued')}
              className={clsx(
                'flex-1 py-1.5 font-semibold transition-colors flex items-center justify-center gap-1.5 border-l border-r border-gray-200',
                tab === 'queued' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              Fila
              {queuedCount > 0 && (
                <span className={clsx(
                  'inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-black',
                  tab === 'queued' ? 'bg-white/30 text-white' : 'bg-red-500 text-white animate-pulse',
                )}>
                  {queuedCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setTab('mine')}
              className={clsx(
                'flex-1 py-1.5 font-semibold transition-colors flex items-center justify-center gap-1.5',
                tab === 'mine' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              Meus
              {myCount > 0 && (
                <span className={clsx(
                  'inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-black',
                  tab === 'mine' ? 'bg-white/30 text-white' : 'bg-blue-500 text-white',
                )}>
                  {myCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto">
          {loadingSessions ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="w-5 h-5 text-gray-300 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-400 gap-2">
              <MessageCircle className="w-7 h-7 opacity-40" />
              <p className="text-xs">
                {search ? 'Nenhum resultado' : tab === 'queued' ? 'Fila vazia' : 'Sem atendimentos ativos'}
              </p>
            </div>
          ) : (
            <AnimatePresence mode="popLayout" initial={false}>
              {filtered.map(s => (
                <ConversationRow
                  key={s.id}
                  session={s}
                  selected={selected?.id === s.id}
                  patientName={patientNames[s.patient_phone] ?? null}
                  onClick={() => handleSelectSession(s)}
                />
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════
          CENTER — Chat area
      ══════════════════════════════════════════ */}
      {selected ? (
        <div className="flex-1 flex flex-col min-w-0">

          {/* Chat header */}
          <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-gray-200 shrink-0">
            <div className="flex items-center gap-3">
              {/* Mobile Back Button */}
              <button
                onClick={() => setSelected(null)}
                className="lg:hidden p-1 mr-1 hover:bg-slate-100 rounded-lg text-slate-500 cursor-pointer"
                title="Voltar para a lista"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>

              <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                {selected.channel === 'livechat' ? (
                  <MessageCircle className="w-4 h-4 text-blue-600" />
                ) : selected.channel === 'instagram' ? (
                  <Instagram className="w-4 h-4 text-blue-600" />
                ) : selected.channel === 'facebook' ? (
                  <Facebook className="w-4 h-4 text-blue-600" />
                ) : (
                  <User className="w-4 h-4 text-blue-600" />
                )}
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">
                  {patient?.full_name
                    ? patient.full_name
                    : (selected.channel === 'livechat' || selected.channel === 'instagram' || selected.channel === 'facebook')
                    ? (selected.context?.visitor_name || selected.context?.username || selected.context?.name || (selected.channel === 'instagram' ? 'Usuário do Instagram' : selected.channel === 'facebook' ? 'Usuário do Messenger' : 'Visitante Web'))
                    : `${phoneFlag(selected.patient_phone)} ${formatPhone(selected.patient_phone)}`}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <StatusBadge status={selected.omnichannel_status} />
                  {selected.omnichannel_status === 'queued' && (
                    <span className={clsx('text-[11px]', slaColor(selected.updated_at))}>
                      <Clock className="w-3 h-3 inline mr-0.5" />
                      aguardando {slaLabel(selected.updated_at)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {canClaim && (
                <button
                  onClick={handleClaim}
                  disabled={claiming}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-60 transition-colors"
                >
                  {claiming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PhoneCall className="w-3.5 h-3.5" />}
                  Assumir
                </button>
              )}
              {isOwned && (
                <button
                  onClick={handleClose}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50 transition-colors"
                >
                  <XCircle className="w-3.5 h-3.5" /> Encerrar
                </button>
              )}
              <button
                onClick={() => setShowPatientPanel(p => !p)}
                className={clsx(
                  'w-8 h-8 rounded-xl flex items-center justify-center transition-colors border',
                  showPatientPanel
                    ? 'bg-blue-50 border-blue-200 text-blue-600'
                    : 'border-gray-200 text-gray-400 hover:bg-gray-50',
                )}
                title="Painel do paciente"
              >
                <Info className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-5 py-4 bg-gray-50/50">
            {loadingMessages ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="w-5 h-5 text-gray-300 animate-spin" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-gray-400 gap-2">
                <MessageCircle className="w-8 h-8 opacity-30" />
                <p className="text-xs">Sem mensagens anteriores</p>
              </div>
            ) : (
              <>
                {messages.map(msg => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    allMessages={messages}
                    canEdit={isOwned}
                    onReply={m => { setReplyingTo(m); setEditingMsg(null) }}
                    onEdit={m => { setEditingMsg(m); setReplyingTo(null) }}
                    onForward={m => setForwardMsg(m)}
                    onDelete={handleDeleteMessage}
                  />
                ))}
                <div ref={bottomRef} />
              </>
            )}
          </div>

          <ChatInput
            isOwned={isOwned}
            canClaim={canClaim}
            isClosed={isClosed}
            replyingTo={replyingTo}
            editingMsg={editingMsg}
            onCancelContext={() => { setReplyingTo(null); setEditingMsg(null) }}
            onSend={handleSend}
            onSendMedia={handleSendMedia}
            onUploadFile={uploadToStorage}
            sending={sending}
            uploadingMedia={uploadingMedia}
            setUploadingMedia={setUploadingMedia}
            salesScripts={salesScripts}
            patient={patient}
            currentUserName={currentUserName}
            clinicName={clinicName}
            onOpenScriptManager={(editingId) => {
              setEditingScriptId(editingId || null);
              setIsScriptManagerOpen(true);
            }}
            onDeleteScript={async (id) => {
              if (tenantId) {
                await salesScriptService.delete(id);
                loadSalesScripts(tenantId);
              }
            }}
          />
        </div>
      ) : (
        <div className="hidden lg:flex flex-1 items-center justify-center text-gray-400 bg-gray-50/30">
          <div className="text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto">
              <MessageCircle className="w-8 h-8 opacity-30" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-500">Selecione uma conversa</p>
              <p className="text-xs text-gray-400 mt-1">
                {queuedCount > 0
                  ? `${queuedCount} conversa${queuedCount > 1 ? 's' : ''} aguardando atendimento`
                  : 'Nenhuma conversa na fila'}
              </p>
            </div>
            {queuedCount > 0 && (
              <div className="flex items-center justify-center gap-1.5 text-xs text-amber-600 animate-pulse">
                <AlertTriangle className="w-3.5 h-3.5" />
                Atendimento necessário
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          RIGHT — Patient info panel
      ══════════════════════════════════════════ */}
      <AnimatePresence>
        {selected && showPatientPanel && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ 
              width: sidebarView === 'profile' ? 288 : 360, 
              opacity: 1 
            }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="shrink-0 overflow-hidden bg-white border-l border-gray-200 shadow-xl relative z-20"
          >
            <PatientPanel
              session={selected}
              patient={patient}
              appointments={appointments}
              onClose={() => setShowPatientPanel(false)}
              onUpdateStage={async (stage: any) => {
                // Update DB
                await supabase.from('conversation_sessions').update({ kanban_stage: stage }).eq('id', selected.id);
                // Update local session immediately
                setSelected(prev => prev ? { ...prev, kanban_stage: stage } : prev);
                // Update sessions array to avoid flicker on re-fetch
                setSessions(prev => prev.map(s => s.id === selected.id ? { ...s, kanban_stage: stage } : s));
                // Reload list to sync with DB
                loadSessions();
              }}
              onTransferClick={() => setShowTransferModal(true)}
              onNewPatient={() => setSidebarView('register')}
              onLookupPatient={() => setSidebarView('lookup')}
              onQuickBook={() => setSidebarView('booking')}
              onViewAppointments={() => setSidebarView('appointments')}
              onSendMessage={handleSidebarSendMessage}
              isOwned={isOwned}
              view={sidebarView}
              onViewChange={setSidebarView}
              onPatientSelected={async (p) => {
                if (!selected) return;
                setPatient(p);
                await supabase.from('conversation_sessions').update({ patient_id: p.id }).eq('id', selected.id);
                loadSessions();
              }}
              onReschedule={(appt) => {
                setRescheduleData(appt);
                setSidebarView('booking');
              }}
              onResetReschedule={() => setRescheduleData(null)}
              rescheduleData={rescheduleData}
              onAddToWaitlist={async () => {
                if (!patient || !tenantId) return;
                const { error } = await supabase.from('waitlist').insert({
                  tenant_id: tenantId,
                  patient_id: patient.id,
                  status: 'active'
                });
                if (error) {
                  showToast('error', 'Erro ao adicionar à lista de espera: ' + error.message);
                } else {
                  showToast('success', 'Paciente adicionado à lista de espera com sucesso! ✅');
                }
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Forward Modal */}
      <AnimatePresence>
        {forwardMsg && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
              onClick={() => setForwardMsg(null)}
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-sm relative z-10 overflow-hidden"
            >
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <Forward className="w-4 h-4 text-green-600" />
                  Encaminhar Mensagem
                </h3>
                <button onClick={() => setForwardMsg(null)} className="text-gray-400 hover:text-gray-600 border-none bg-transparent cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Message preview */}
              <div className="px-4 pt-3">
                <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-600 truncate italic">
                  "{forwardMsg.content || forwardMsg.caption || forwardMsg.file_name || '[mídia]'}"
                </div>
              </div>

              <div className="p-4">
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">
                  Encaminhar para conversa
                </label>
                <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
                  {sessions.filter(s => s.id !== selected?.id && s.omnichannel_status !== 'closed').length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-4 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                      Nenhuma outra conversa ativa.
                    </p>
                  ) : (
                    sessions
                      .filter(s => s.id !== selected?.id && s.omnichannel_status !== 'closed')
                      .map(s => (
                        <button
                          key={s.id}
                          onClick={() => handleForward(s.id)}
                          className="w-full flex items-center gap-3 p-3 text-left rounded-xl border border-gray-200 hover:border-green-300 hover:bg-green-50/30 transition-all cursor-pointer bg-white"
                        >
                          <div className="w-7 h-7 rounded-full bg-green-100 text-green-700 flex items-center justify-center shrink-0">
                            <User size={14} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-gray-800 truncate">
                              {patientNames[s.patient_phone] ?? formatPhone(s.patient_phone)}
                            </p>
                            <p className="text-[10px] text-gray-400 truncate">{s.patient_phone}</p>
                          </div>
                        </button>
                      ))
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Transfer Modal */}
      <AnimatePresence>
        {showTransferModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
              onClick={() => setShowTransferModal(false)}
            />
            
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-sm relative z-10 overflow-hidden"
            >
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <ArrowRightLeft className="w-4 h-4 text-indigo-600" />
                  Transferir Atendimento
                </h3>
                <button onClick={() => setShowTransferModal(false)} className="text-gray-400 hover:text-gray-600 border-none bg-transparent cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-5">
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">
                  Selecione o membro da equipe
                </label>
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {teamUsers.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-4 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                      Nenhum outro usuário disponível.
                    </p>
                  ) : (
                    teamUsers.map(user => (
                      <button
                        key={user.id}
                        onClick={() => setSelectedUserToTransfer(user.id)}
                        className={clsx(
                          "w-full flex items-center gap-3 p-3 text-left rounded-xl border transition-all cursor-pointer bg-white",
                          selectedUserToTransfer === user.id ? "border-indigo-500 ring-1 ring-indigo-500 bg-indigo-50/30" : "border-gray-200 hover:border-indigo-300"
                        )}
                      >
                        <div className={clsx("w-8 h-8 rounded-full flex items-center justify-center shrink-0", selectedUserToTransfer === user.id ? "bg-indigo-100 text-indigo-600" : "bg-gray-100 text-gray-500")}>
                          <UserCircle2 className="w-4 h-4" />
                        </div>
                        <div>
                          <p className={clsx("text-xs font-bold", selectedUserToTransfer === user.id ? "text-indigo-900" : "text-gray-800")}>{user.full_name}</p>
                          <p className="text-[10px] text-gray-500 capitalize">{user.role || 'Membro'}</p>
                        </div>
                      </button>
                    ))
                  )}
                </div>

                <div className="mt-5 flex gap-2">
                  <button 
                    onClick={() => setShowTransferModal(false)}
                    className="flex-1 py-2 text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors border-none cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleTransfer}
                    disabled={!selectedUserToTransfer || transferring}
                    className="flex-1 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors border-none cursor-pointer flex justify-center items-center gap-2"
                  >
                    {transferring ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Confirmar'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ScriptManagerDrawer
        tenantId={tenantId || ''}
        isOpen={isScriptManagerOpen}
        initialEditingId={editingScriptId}
        onClose={() => setIsScriptManagerOpen(false)}
        onScriptsUpdated={setSalesScripts}
      />
    </div>
  )
}
