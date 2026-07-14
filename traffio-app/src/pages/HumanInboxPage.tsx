import { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatPhone, phoneFlag } from '../lib/formatPhone'
import { formatDisplayDate } from '../lib/dateUtils'
import { formatDoc, docLabel } from '../lib/i18n/doc'
import { DEFAULT_COUNTRY, type CountryCode } from '../lib/i18n/countryFormats'
import {
  MessageCircle, Clock, User, Send, Inbox,
  Loader2, PhoneCall, CheckCircle2, XCircle, Bot, Search,
  StickyNote, Info, X, Calendar, CreditCard,
  AlertTriangle, MoreVertical, ArrowRightLeft, UserCircle2,
  UserPlus, UserMinus, Users, Building2, Tag, CalendarSearch, DollarSign,
  Mic, Paperclip, Camera, Smile, Play, Pause,
  FileText, Download, Reply, Pencil, Copy, Forward, Trash2, Zap, ArrowRight, Instagram, Facebook, ChevronDown, ArrowLeft, Settings, Plus,
  MessageSquare, Sparkles
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
import { SidebarWaitlistView } from '../components/SidebarWaitlistView'
import { waitlistService } from '../services/waitlistService'
import { ChannelPreferenceSelector } from '../components/channel/ChannelPreferenceSelector'
import { ConfirmationChannelModal, type ConfirmationChannelId, type ConfirmationChannelOption } from '../components/channel/ConfirmationChannelModal'
import { salesScriptService, type SalesScript } from '../services/salesScriptService'
import { ScriptManagerDrawer } from '../components/ScriptManagerDrawer'
import { useTenant } from '../contexts/TenantContext'

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type OmnichannelStatus = 'bot_active' | 'queued' | 'human_active' | 'closed'

interface ConversationSession {
  id: string
  tenant_id: string
  patient_phone: string
  patient_id?: string | null
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
  national_id?: string | null
  national_id_type?: string | null
  country?: string | null
  email: string | null
  birth_date: string | null
  notes: string | null
  phone?: string | null
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

/** Masks the middle of a formatted document number for privacy in the inbox list. */
function maskDoc(formatted: string): string {
  if (!formatted || formatted.length <= 6) return formatted || '—'
  return `${formatted.slice(0, 4)}***${formatted.slice(-3)}`
}

function slaColor(updatedAt: string) {
  const min = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 60000)
  if (min >= 10) return 'text-red-600 font-bold'
  if (min >= 5)  return 'text-amber-600 font-semibold'
  return 'text-gray-400'
}

function slaLabel(updatedAt: string, nowLabel: string) {
  const min = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 60000)
  if (min === 0) return nowLabel
  return `${min}m`
}

// ─────────────────────────────────────────────
// StatusBadge
// ─────────────────────────────────────────────

function StatusBadge({ status }: { status: OmnichannelStatus }) {
  const { t } = useTranslation('communications')
  const map: Record<OmnichannelStatus, { label: string; className: string; icon?: any }> = {
    bot_active:   { label: t('humanInbox.statusBadge.botActive'),     className: 'bg-violet-100 text-violet-700', icon: Sparkles },
    queued:       { label: t('humanInbox.statusBadge.queued'),        className: 'bg-amber-100 text-amber-700 animate-pulse' },
    human_active: { label: t('humanInbox.statusBadge.humanActive'),   className: 'bg-green-100 text-green-700' },
    closed:       { label: t('humanInbox.statusBadge.closed'),        className: 'bg-gray-100 text-gray-500' },
  }
  // Sessões recém-criadas podem chegar sem status — tratar como fila (precisa de gente)
  const entry = map[status] ?? map['queued']
  const Icon = entry.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${entry.className}`}>
      {Icon && <Icon className="w-3 h-3" />}
      {entry.label}
    </span>
  )
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
  const { t } = useTranslation('communications')
  const TEMPERATURE_MAP: Record<string, { label: string; icon: string; className: string }> = {
    cold: { label: t('humanInbox.temperature.cold'),   icon: '❄️', className: 'bg-blue-50 text-blue-700 border-blue-100' },
    warm: { label: t('humanInbox.temperature.warm'),   icon: '🌤️', className: 'bg-amber-50 text-amber-700 border-amber-100' },
    hot:  { label: t('humanInbox.temperature.hot'),    icon: '🔥', className: 'bg-red-50 text-red-700 border-red-100' },
  }
  const PRIORITY_MAP: Record<string, { label: string; className: string }> = {
    low:    { label: t('humanInbox.priority.low'),     className: 'bg-gray-50 text-gray-600 border-gray-100' },
    medium: { label: t('humanInbox.priority.medium'),  className: 'bg-blue-50 text-blue-600 border-blue-100' },
    high:   { label: t('humanInbox.priority.high'),    className: 'bg-orange-50 text-orange-600 border-orange-100' },
    urgent: { label: t('humanInbox.priority.urgent'),  className: 'bg-red-50 text-red-600 border-red-100' },
  }
  const fallbackName = (channel?: string) =>
    channel === 'instagram' ? t('humanInbox.fallbackNames.instagramUser')
      : channel === 'facebook' ? t('humanInbox.fallbackNames.messengerUser')
      : t('humanInbox.fallbackNames.webVisitor')
  const lastMsg = session.recent_messages?.at(-1)
  const isQueued = session.omnichannel_status === 'queued'
  const unreadCount = session.unread_count ?? 0
  // Última palavra é do paciente: ou a IA está gerando (bot_active), ou é
  // responsabilidade HUMANA e precisa ficar visualmente inescapável
  const lastFromPatient = lastMsg?.role === 'user'
  const aiWorking = lastFromPatient && session.omnichannel_status === 'bot_active'
  const needsReply = lastFromPatient && session.omnichannel_status !== 'bot_active' && session.omnichannel_status !== 'closed'

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
          'w-full text-left px-4 py-3 border-b border-ice-100 hover:bg-ice-50 transition-colors flex items-start gap-3 relative',
          selected && 'bg-blue-50 border-l-[3px] border-l-blue-500',
          (isQueued || needsReply) && !selected && 'border-l-[3px] border-l-amber-400 bg-amber-50/40',
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
          ) : session.channel === 'sms' ? (
            <MessageSquare className={clsx('w-4 h-4', isQueued ? 'text-amber-600' : 'text-gray-500')} />
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
                ? (session.context?.visitor_name || session.context?.username || session.context?.name || fallbackName(session.channel))
                : `${phoneFlag(session.patient_phone)} ${formatPhone(session.patient_phone)}`}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <span className={clsx('text-[11px]', slaColor(session.updated_at))}>
                {slaLabel(session.updated_at, t('humanInbox.sla.now'))}
              </span>
            </div>
          </div>
          {session.channel === 'livechat' ? (
            <p className="text-[11px] text-gray-400 truncate mt-0.5">
              {session.context?.visitor_phone || session.context?.visitor_email || t('humanInbox.channels.liveChat')}
            </p>
          ) : (session.channel === 'instagram' || session.channel === 'facebook') ? (
            <p className="text-[11px] text-gray-400 truncate mt-0.5 flex items-center gap-1">
              {session.channel === 'instagram' ? '@' : ''}{session.context?.username || session.context?.visitor_name || (session.channel === 'instagram' ? t('humanInbox.channels.instagramDirect') : t('humanInbox.channels.facebookMessenger'))}
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
                <span className="px-1.5 py-0.5 rounded-md bg-ice-50 border border-ice-100 text-graphite-500 text-[9px] font-bold uppercase truncate max-w-[100px]" title={`${t('humanInbox.conversationRow.stageTitlePrefix')} ${session.kanban_stage}`}>
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
              {lastMsg?.content ?? t('humanInbox.conversationRow.noMessages')}
            </p>
            {unreadCount > 0 && !selected && (
              <span className="flex items-center justify-center h-5 min-w-[20px] px-1 rounded-full bg-blue-600 text-white text-[10px] font-bold shadow-sm animate-in fade-in zoom-in duration-300">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={session.omnichannel_status} />
            <span className={clsx(
              "inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold border shrink-0",
              session.channel === 'livechat'
                ? "bg-indigo-50 text-indigo-700 border-indigo-100"
                : session.channel === 'instagram'
                ? "bg-pink-50 text-pink-700 border-pink-100"
                : session.channel === 'facebook'
                ? "bg-blue-50 text-blue-700 border-blue-100"
                : session.channel === 'sms'
                ? "bg-teal-50 text-teal-700 border-teal-100"
                : "bg-green-50 text-green-700 border-green-100"
            )}>
              {session.channel === 'livechat'
                ? t('humanInbox.channels.liveChat')
                : session.channel === 'instagram'
                ? t('humanInbox.channels.instagram')
                : session.channel === 'facebook'
                ? t('humanInbox.channels.messenger')
                : session.channel === 'sms'
                ? t('humanInbox.channels.sms')
                : t('humanInbox.channels.whatsapp')}
            </span>
            {needsReply && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold shrink-0 animate-pulse">
                <AlertTriangle className="w-3 h-3" />
                {t('humanInbox.conversationRow.needsReply')} · {slaLabel(session.updated_at, t('humanInbox.sla.now'))}
              </span>
            )}
            {aiWorking && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-bold shrink-0">
                <Sparkles className="w-3 h-3 animate-pulse" />
                {t('humanInbox.conversationRow.aiReplying')}
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
  const { t } = useTranslation('communications')
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
          <span>{t('humanInbox.audioPlayer.label')}</span>
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
  const { t } = useTranslation('communications')
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
              alt={t('humanInbox.messageBubble.mediaAlt')}
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
              <p className="text-xs font-semibold text-gray-700 truncate">{msg.file_name || t('humanInbox.messageBubble.documentFallback')}</p>
              <p className="text-[10px] text-gray-400 uppercase">{msg.mime_type?.split('/')[1] || t('humanInbox.messageBubble.mimeFallback')} • {msg.file_size ? `${(msg.file_size / 1024 / 1024).toFixed(1)}MB` : t('humanInbox.messageBubble.sizeFallback')}</p>
            </div>
            <Download size={16} className="text-gray-400" />
          </a>
        )
      case 'gif':
        return (
          <img
            src={msg.media_url}
            alt={t('humanInbox.messageBubble.gifAlt')}
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
        className={clsx('max-w-[75%] min-w-0 flex flex-col cursor-pointer', isOutgoing ? 'items-end' : 'items-start')}
        style={{ width: 'fit-content' }}
        onClick={() => setHovered(prev => !prev)}
      >
        {isInternal && (
          <div className="flex items-center gap-1 mb-1">
            <StickyNote className="w-3 h-3 text-amber-500" />
            <span className="text-[10px] text-amber-600 font-semibold uppercase tracking-wide">{t('humanInbox.messageBubble.internalNote')}</span>
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
            title={t('humanInbox.messageBubble.copy')}
            className="w-7 h-7 rounded-lg bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-500 hover:text-blue-600 hover:border-blue-300 transition-colors"
          >
            <Copy size={13} />
          </button>
          <button
            onClick={() => onReply(msg)}
            title={t('humanInbox.messageBubble.reply')}
            className="w-7 h-7 rounded-lg bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-500 hover:text-blue-600 hover:border-blue-300 transition-colors"
          >
            <Reply size={13} />
          </button>
          {canEdit && isHuman && (msg.message_type === 'text' || !msg.message_type) && (
            <button
              onClick={() => onEdit(msg)}
              title={t('humanInbox.messageBubble.edit')}
              className="w-7 h-7 rounded-lg bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-500 hover:text-amber-600 hover:border-amber-300 transition-colors"
            >
              <Pencil size={13} />
            </button>
          )}
          <button
            onClick={() => onForward(msg)}
            title={t('humanInbox.messageBubble.forward')}
            className="w-7 h-7 rounded-lg bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-500 hover:text-green-600 hover:border-green-300 transition-colors"
          >
            <Forward size={13} />
          </button>
          <button
            onClick={() => onDelete(msg)}
            title={t('humanInbox.messageBubble.deleteForEveryone')}
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
            isBot      && 'bg-violet-600 text-white rounded-tr-none',
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
                  {repliedMsg.content || repliedMsg.caption || repliedMsg.file_name || (repliedMsg.media_url ? t('humanInbox.messageBubble.typePlaceholder', { type: repliedMsg.message_type }) : t('humanInbox.messageBubble.mediaPlaceholder'))}
                </span>
              </div>
            </div>
          )}
          {renderContent()}
        </div>
        <div className={clsx('flex items-center gap-1 mt-1', isOutgoing ? 'justify-end' : 'justify-start')}>
          {isBot      && (
            <span className="flex items-center gap-0.5">
              <Bot className="w-3 h-3 text-violet-400" />
              <span className="text-[9px] font-bold text-violet-400 uppercase">{t('humanInbox.messageBubble.aiLabel')}</span>
            </span>
          )}
          {isHuman    && <PhoneCall className="w-3 h-3 text-blue-400" />}
          {isInternal && <StickyNote className="w-3 h-3 text-amber-400" />}
          {msg.is_edited && <span className="text-[9px] text-gray-400 italic">{t('humanInbox.messageBubble.edited')}</span>}
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
  metaWindowTimeLeft?: number | null
  metaWindowExpired?: boolean
  /** F1 Copiloto — rascunho sugerido pela IA (context.ai_draft da sessão) */
  aiDraft?: { text: string; created_at: string } | null
  onDiscardAiDraft?: () => void
}

export const ChatInput = memo(({ 
  isOwned, canClaim, isClosed, onSend, onSendMedia, onUploadFile, sending, 
  uploadingMedia, setUploadingMedia, replyingTo, editingMsg, onCancelContext,
  salesScripts = [], patient, currentUserName = '', clinicName = '',
  onOpenScriptManager, onDeleteScript,
  metaWindowTimeLeft = null,
  metaWindowExpired = false,
  aiDraft = null,
  onDiscardAiDraft
}: ChatInputProps) => {
  const { t } = useTranslation('communications')
  const { showToast } = useToast()

  const formatCountdown = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000)
    const hours = Math.floor(totalSecs / 3600)
    const minutes = Math.floor((totalSecs % 3600) / 60)
    const seconds = totalSecs % 60
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

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
          showToast('error', t('humanInbox.chatInput.toasts.audioSendError', { message: err.message }))
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
        showToast('warning', t('humanInbox.chatInput.toasts.micPermissionDenied'))
      } else {
        showToast('error', t('humanInbox.chatInput.toasts.micAccessError', { message: err.message }))
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
    const patientName = patient?.full_name || patient?.name || t('humanInbox.fallbackNames.patient');
    const effectiveClinicName = clinicName || t('humanInbox.fallbackNames.clinicName');

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
      const fileToUpload = selectedFile
      const fileCaption = input.trim()
      const currentMode = inputMode
      const fileName = selectedFile.name
      const fileType = selectedFile.type
      const fileSize = selectedFile.size
      
      clearMediaFile()
      setUploadingMedia(true)
      
      try {
        const url = await onUploadFile(fileToUpload)
        const isImage = fileType.startsWith('image/')
        const isVideo = fileType.startsWith('video/')
        const type = isImage ? 'image' : isVideo ? 'video' : 'document'
        await onSendMedia(url, type, {
          caption: fileCaption,
          mode: currentMode === 'note' ? 'internal' : 'message',
          fileName: fileName,
          mimeType: fileType,
          fileSize: fileSize
        })
      } catch (err: any) {
        showToast('error', t('humanInbox.chatInput.toasts.fileSendError', { message: err.message }))
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
      showToast('error', t('humanInbox.chatInput.toasts.fileSendError', { message: err.message }))
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
            ? <><Clock className="w-4 h-4" /> {t('humanInbox.chatInput.gateClaimToReply')}</>
            : isClosed
            ? <><CheckCircle2 className="w-4 h-4" /> {t('humanInbox.chatInput.gateClosed')}</>
            : <><MoreVertical className="w-4 h-4" /> {t('humanInbox.chatInput.gateReadOnly')}</>}
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
                  {t('humanInbox.chatInput.scripts.title')}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); onOpenScriptManager(); setSlashMenuOpen(false); }}
                    className="p-1 hover:bg-gray-200/50 rounded text-gray-500 hover:text-gray-900 border-none bg-transparent cursor-pointer"
                    title={t('humanInbox.chatInput.scripts.manageTitle')}
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[10px] text-gray-400 font-medium">{t('humanInbox.chatInput.scripts.navigateHint')}</span>
                </div>
              </div>
              <div className="overflow-y-auto flex-1 p-1.5 custom-scrollbar">
                {filteredScripts.length === 0 ? (
                  <div className="p-4 text-center">
                    <p className="text-xs text-gray-400 mb-2 font-medium">{t('humanInbox.chatInput.scripts.noneFound')}</p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenScriptManager();
                        setSlashMenuOpen(false);
                      }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[10px] font-black uppercase tracking-wider border-none cursor-pointer flex items-center gap-1.5 mx-auto"
                    >
                      <Plus size={12} />
                      {t('humanInbox.chatInput.scripts.create')}
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
                              title={(!script.tenant_id || script.tenant_id === 'null') ? t('humanInbox.chatInput.scripts.customizeEdit') : t('humanInbox.chatInput.scripts.editScript')}
                            >
                              <Pencil size={11} />
                            </button>
                            {(script.tenant_id && script.tenant_id !== 'null') && (
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (window.confirm(t('humanInbox.chatInput.scripts.deleteConfirm', { title: script.title }))) {
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
                                title={t('humanInbox.chatInput.scripts.deleteScript')}
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
                className="bg-white rounded-3xl shadow-2xl border border-ice-100 w-full max-w-md relative z-10 flex flex-col overflow-hidden"
              >
                <div className="p-6 border-b border-ice-100 flex items-center justify-between bg-gradient-to-r from-blue-50 to-white">
                  <div className="flex flex-col gap-0.5">
                    <h3 className="font-black text-gray-900 flex items-center gap-2 text-lg">
                      <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-200">
                        <Zap size={18} fill="currentColor" />
                      </div>
                      {t('humanInbox.chatInput.promptModal.title')}
                    </h3>
                    <p className="text-xs text-gray-500 font-medium ml-10">{t('humanInbox.chatInput.promptModal.subtitle')}</p>
                  </div>
                  <button onClick={() => setPromptOpen(false)} className="p-2 text-gray-400 hover:text-gray-950 hover:bg-gray-100 rounded-full transition-all border-none bg-transparent cursor-pointer"><X size={20} /></button>
                </div>

                <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                  <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex gap-3">
                     <div className="text-amber-500 shrink-0"><Info size={18} /></div>
                     <p className="text-[11px] text-amber-800 leading-relaxed font-medium">{t('humanInbox.chatInput.promptModal.hint')}</p>
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
                            placeholder={t('humanInbox.chatInput.promptModal.placeholderExample')}
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
                  <button onClick={() => setPromptOpen(false)} className="px-5 py-2.5 text-xs font-black text-gray-500 hover:text-gray-900 transition-colors border-none bg-transparent cursor-pointer uppercase tracking-widest">{t('humanInbox.chatInput.promptModal.cancel')}</button>
                  <button
                    onClick={handlePromptSubmit}
                    className="px-6 py-3 text-xs font-black text-white bg-blue-600 hover:bg-blue-700 rounded-2xl shadow-xl shadow-blue-200 transition-all hover:scale-[1.02] active:scale-[0.98] focus:ring-4 focus:ring-blue-100 border-none cursor-pointer uppercase tracking-widest flex items-center gap-2"
                  >
                    {t('humanInbox.chatInput.promptModal.useScript')}
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
                <span className="text-xs font-bold text-gray-700">{t('humanInbox.chatInput.gifPicker.title')}</span>
                <button onClick={() => setShowGifPicker(false)}><X size={14} /></button>
              </div>
              <p className="text-xs text-gray-400 italic">{t('humanInbox.chatInput.gifPicker.comingSoon')}</p>
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
                <span className="text-xs text-gray-400 italic">{t('humanInbox.chatInput.recording.inProgress')}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { stopRecording(); }}
                  className="px-3 py-1.5 text-xs text-red-600 font-bold hover:bg-red-50 rounded-lg transition-colors">
                  {t('humanInbox.chatInput.recording.cancel')}
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
                <div className="shrink-0 p-3 border-b border-gray-50 flex items-center justify-between bg-white/80 backdrop-blur-md">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{selectedFile?.type.startsWith('image/') ? t('humanInbox.chatInput.mediaPreview.sendImage') : t('humanInbox.chatInput.mediaPreview.sendVideo')}</span>
                  <button onClick={clearMediaFile} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors"><X size={18} className="text-gray-400" /></button>
                </div>
                <div className="flex-1 min-h-0 bg-gray-900/5 flex items-center justify-center p-4 overflow-hidden">
                  {selectedFile?.type.startsWith('image/') ? (
                    <img src={previewUrl} className="max-w-full max-h-[200px] rounded-xl shadow-lg object-contain" alt="preview" />
                  ) : (
                    <video src={previewUrl} className="max-w-full max-h-[200px] rounded-xl shadow-lg" controls />
                  )}
                </div>
                <div className="shrink-0 p-4 bg-gray-50/50">
                  <p className="text-[10px] text-gray-400 font-bold uppercase mb-2">{t('humanInbox.chatInput.mediaPreview.captionLabel')}</p>
                  <div className="flex items-end gap-2">
                     <textarea
                        value={input}
                        onChange={handleInputText}
                        placeholder={t('humanInbox.chatInput.mediaPreview.captionPlaceholder')}
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

        {/* F1 Copiloto — rascunho sugerido pela IA (o humano decide; nada é enviado automaticamente) */}
        {aiDraft?.text && !isClosed && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-xl border-l-4 text-xs bg-violet-50 border-violet-400">
            <Sparkles size={13} className="text-violet-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-bold uppercase tracking-tight text-violet-600" style={{ fontSize: 10 }}>
                {t('humanInbox.aiDraft.title')}
              </p>
              <p className="text-gray-600 whitespace-pre-wrap">{aiDraft.text}</p>
            </div>
            <button
              onClick={() => {
                setInput(aiDraft.text)
                inputRef.current?.focus()
                onDiscardAiDraft?.()
              }}
              className="shrink-0 px-2.5 py-1 rounded-lg bg-violet-600 text-white font-bold hover:bg-violet-500 transition-colors border-0 cursor-pointer"
            >
              {t('humanInbox.aiDraft.use')}
            </button>
            <button onClick={() => onDiscardAiDraft?.()} className="text-gray-400 hover:text-gray-600 bg-transparent border-0 cursor-pointer shrink-0">
              <X size={13} />
            </button>
          </div>
        )}

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
                  {editingMsg ? t('humanInbox.chatInput.replyBar.editing') : t('humanInbox.chatInput.replyBar.replying')}
                </p>
                <p className="text-gray-600 truncate">{(editingMsg || replyingTo)?.content || (replyingTo?.media_url ? t('humanInbox.messageBubble.typePlaceholder', { type: replyingTo.message_type }) : t('humanInbox.messageBubble.mediaPlaceholder'))}</p>
              </div>
            </div>
            <button onClick={onCancelContext} className="text-gray-400 hover:text-gray-600"><X size={13} /></button>
          </div>
        )}

        {/* Mode tabs & Input box - Hidden when previewing to avoid confusion */}
        {!previewUrl && (
          <div className="space-y-2">
            {/* Meta 24h window countdown timer */}
            {metaWindowTimeLeft !== null && metaWindowTimeLeft > 0 && !metaWindowExpired && (
              <div className="flex items-center justify-between px-3 py-1.5 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700 animate-fade-in">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-blue-500 animate-pulse" />
                  <span className="font-semibold">{t('humanInbox.chatInput.metaWindowOpenWarning')}</span>
                </div>
                <span className="font-mono font-bold tracking-wider bg-blue-100 px-2 py-0.5 rounded text-blue-800">
                  {formatCountdown(metaWindowTimeLeft)}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <button onClick={() => setInputMode('message')}
                  className={clsx('flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold transition-colors uppercase tracking-tight',
                    inputMode === 'message' ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:bg-gray-100')}>
                  <Send className="w-3 h-3" /> {t('humanInbox.chatInput.modeTabs.broadcast')}
                </button>
                <button onClick={() => setInputMode('note')}
                  className={clsx('flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold transition-colors uppercase tracking-tight',
                    inputMode === 'note' ? 'bg-amber-100 text-amber-700' : 'text-gray-400 hover:bg-gray-100')}>
                  <StickyNote className="w-3 h-3" /> {t('humanInbox.chatInput.modeTabs.internalNote')}
                </button>
              </div>
              {uploadingMedia && (
                <div className="flex items-center gap-2 text-blue-600 animate-pulse">
                  <Loader2 size={12} className="animate-spin" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">{t('humanInbox.chatInput.sendingMedia')}</span>
                </div>
              )}
            </div>

            {metaWindowExpired && inputMode === 'message' ? (
              <div className="flex flex-col border border-red-200 bg-red-50/50 rounded-2xl p-6 gap-3 items-center text-center animate-fade-in">
                <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center text-red-600 shadow-sm">
                  <AlertTriangle className="w-6 h-6 animate-pulse" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-bold text-sm text-red-800">{t('humanInbox.chatInput.metaWindowExpiredHeading')}</h4>
                  <p className="text-xs text-red-600 max-w-md leading-relaxed">{t('humanInbox.chatInput.metaWindowExpiredHint')}</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col border border-gray-200 rounded-2xl overflow-hidden focus-within:ring-2 focus-within:ring-blue-400 focus-within:border-transparent transition-all shadow-sm">
                <div className="flex items-center justify-between px-2 py-1.5 bg-gray-50/50 border-b border-gray-100">
                  <div className="flex items-center gap-0.5">
                    <button onClick={(e) => { e.stopPropagation(); setShowEmojiPicker(!showEmojiPicker) }}
                      className={clsx("p-2 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-white transition-all", showEmojiPicker && "text-blue-600 bg-white")} title={t('humanInbox.chatInput.titles.emojis')}>
                      <Smile size={18} />
                    </button>
                    <button onClick={() => fileInputRef.current?.click()}
                      className="p-2 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-white transition-all" title={t('humanInbox.chatInput.titles.attachFile')}>
                      <Paperclip size={18} />
                    </button>
                    <button onClick={() => cameraInputRef.current?.click()}
                      className="p-2 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-white transition-all hidden sm:flex" title={t('humanInbox.chatInput.titles.camera')}>
                      <Camera size={18} />
                    </button>
                  </div>
                  <div className="flex items-center gap-0.5">
                    {inputMode === 'message' && (
                      <button onClick={startRecording}
                        className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-all" title={t('humanInbox.chatInput.titles.recordAudio')}>
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
                    placeholder={inputMode === 'note' ? t('humanInbox.chatInput.placeholder.note') : t('humanInbox.chatInput.placeholder.message')}
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
            )}

            {inputMode === 'note' && (
              <div className="flex items-center gap-1.5 px-1">
                <StickyNote size={12} className="text-amber-500" />
                <span className="text-[10px] font-bold text-amber-600 uppercase tracking-tighter">{t('humanInbox.chatInput.noteHiddenHint')}</span>
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
  onViewAppointments: () => void
  onSendMessage: (text: string) => Promise<void>
  onSendConfirmation: (text: string) => void
  isOwned: boolean
  view: 'profile' | 'register' | 'lookup' | 'booking' | 'appointments' | 'edit' | 'availability' | 'payment' | 'directory' | 'classify' | 'waitlist'
  onViewChange: (view: 'profile' | 'register' | 'lookup' | 'booking' | 'appointments' | 'edit' | 'availability' | 'payment' | 'directory' | 'classify' | 'waitlist') => void
  onPatientSelected: (p: any) => void
  onUnlink: () => Promise<void>
  onReschedule: (appt: any) => void
  onResetReschedule: () => void
  rescheduleData: any | null
  preFill: any | null
  onPreFillChange: (data: any | null) => void
  enabledChannels?: Record<string, boolean>
  defaultChannel?: 'whatsapp' | 'sms' | 'email'
}

function PatientPanel({
  session, patient, appointments, onClose, onUpdateStage, onTransferClick, isOwned, onNewPatient, onLookupPatient,
  view, onViewChange, onPatientSelected, onUnlink, onViewAppointments, onSendMessage, onSendConfirmation, onReschedule, onResetReschedule, rescheduleData,
  preFill, onPreFillChange, enabledChannels, defaultChannel
}: PatientPanelProps) {
  const { t } = useTranslation('communications');
  const [waitlistCount, setWaitlistCount] = useState(0);

  useEffect(() => {
    let active = true;
    if (!patient?.id || !session.tenant_id) {
      setWaitlistCount(0);
      return;
    }
    waitlistService.listByPatient(session.tenant_id, patient.id)
      .then(list => { if (active) setWaitlistCount(list.length); })
      .catch(() => { if (active) setWaitlistCount(0); });
    return () => { active = false; };
  }, [patient?.id, session.tenant_id, view]);

  if (view === 'register') {
    const isWhatsApp = !['instagram', 'facebook', 'livechat'].includes(session.channel || '');
    const isValidPhone = isWhatsApp && !/[a-zA-Z]/.test(session.patient_phone || '');
    return (
      <div className="w-full flex flex-col h-full border-l border-ice-100">
        <SidebarRegisterView 
          onBack={() => onViewChange('profile')} 
          onSuccess={(p: any) => {
            onPatientSelected(p);
            onViewChange('profile');
          }}
          initialPhone={isValidPhone ? session.patient_phone : ''}
        />
      </div>
    );
  }

  if (view === 'lookup') {
    return (
      <div className="w-full flex flex-col h-full border-l border-ice-100">
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
      <div className="w-full flex flex-col h-full border-l border-ice-100">
        <SidebarBookingView 
          onBack={() => {
            onResetReschedule();
            onPreFillChange(null);
            onViewChange('profile');
          }}
          patientId={patient.id}
          patientName={patient.full_name || t('humanInbox.fallbackNames.patient')}
          onSendMessage={onSendMessage}
          onConfirmationReady={onSendConfirmation}
          rescheduleFrom={rescheduleData}
          preFill={preFill}
          onSuccess={() => {
            onResetReschedule();
            onPreFillChange(null);
            onViewChange('profile');
          }}
        />
      </div>
    );
  }

  if (view === 'appointments' && patient) {
    return (
      <div className="w-full flex flex-col h-full border-l border-ice-100">
        <SidebarAppointmentsView 
          onBack={() => onViewChange('profile')}
          patientId={patient.id}
          patientName={patient.full_name || t('humanInbox.fallbackNames.patient')}
          patientPhone={session.patient_phone}
          onSendMessage={onSendMessage}
          onReschedule={onReschedule}
        />
      </div>
    );
  }

  if (view === 'edit' && patient) {
    return (
      <div className="w-full flex flex-col h-full border-l border-ice-100">
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
      <div className="w-full flex flex-col h-full border-l border-ice-100">
        <SidebarAvailabilityView
          onBack={() => onViewChange('profile')}
          onBookSlot={(doctor, location, procedure, date, time) => {
            onPreFillChange({
              doctorId: doctor.id,
              locationId: location.id,
              service: procedure,
              date,
              slotTime: time
            });
            onViewChange('booking');
          }}
        />
      </div>
    );
  }

  if (view === 'payment' && patient) {
    return (
      <div className="w-full flex flex-col h-full border-l border-ice-100">
        <SidebarPaymentView
          onBack={() => onViewChange('profile')}
          patientId={patient.id}
          patientName={patient.full_name || t('humanInbox.fallbackNames.patient')}
          onSendLink={onSendMessage}
        />
      </div>
    );
  }

  if (view === 'directory') {
    return (
      <div className="w-full flex flex-col h-full border-l border-ice-100">
        <SidebarDirectoryView onBack={() => onViewChange('profile')} />
      </div>
    );
  }

  if (view === 'waitlist' && patient) {
    return (
      <div className="w-full flex flex-col h-full border-l border-ice-100">
        <SidebarWaitlistView
          onBack={() => onViewChange('profile')}
          patientId={patient.id}
          patientName={patient.full_name || t('humanInbox.fallbackNames.patient')}
        />
      </div>
    );
  }

  if (view === 'classify') {
    return (
      <div className="w-full flex flex-col h-full border-l border-ice-100">
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
    <div className="w-full h-full flex flex-col bg-white border-l border-ice-100 overflow-y-auto">
      <div className="px-4 py-3 border-b border-ice-100 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">{t('humanInbox.patientPanel.title')}</span>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 border-b border-ice-100 flex items-center justify-between group">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
            <User className="w-5 h-5 text-blue-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-900 truncate">
              {patient?.full_name ?? (
                ['instagram', 'facebook', 'livechat'].includes(session.channel || '')
                  ? (session.context?.visitor_name || session.context?.username || session.context?.name || (session.channel === 'instagram' ? t('humanInbox.fallbackNames.instagramUser') : session.channel === 'facebook' ? t('humanInbox.fallbackNames.messengerUser') : t('humanInbox.fallbackNames.webVisitor')))
                  : t('humanInbox.fallbackNames.unregisteredPatient')
              )}
            </p>
            <p className="text-xs text-gray-500">
              {['instagram', 'facebook', 'livechat'].includes(session.channel || '')
                ? (session.channel === 'instagram' ? `${t('humanInbox.channels.instagram')}: @${session.context?.username || 'Direct'}` : session.channel === 'facebook' ? t('humanInbox.channels.facebookMessenger') : t('humanInbox.channels.liveChat'))
                : formatPhone(session.patient_phone)}
            </p>
          </div>
        </div>
        {patient && (
          <div className="flex items-center gap-1 shrink-0">
            <button 
              onClick={() => onViewChange('edit')}
              className="p-2 rounded-xl text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-all border-none bg-transparent cursor-pointer"
              title={t('humanInbox.patientPanel.editProfileTitle')}
            >
              <UserPlus className="w-4 h-4" />
            </button>
            <button 
              onClick={onUnlink}
              className="p-2 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all border-none bg-transparent cursor-pointer"
              title={t('humanInbox.patientPanel.unlinkTitle')}
            >
              <UserMinus className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Dual Identity Sub-header (Interlocutor) */}
      {session.context?.interlocutor && !session.context.interlocutor.isPatient && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <p className="text-[10px] text-amber-800 font-medium">
            {t('humanInbox.patientPanel.talkingTo')} <span className="font-bold">{session.context.interlocutor.name}</span> ({session.context.interlocutor.relationship})
          </p>
        </div>
      )}

      {/* Waitlist indicator */}
      {patient && waitlistCount > 0 && (
        <button
          onClick={() => onViewChange('waitlist')}
          className="w-full px-4 py-2 bg-brand-primary/5 border-0 border-b border-ice-100 flex items-center gap-2 hover:bg-brand-primary/10 transition-colors cursor-pointer text-left"
        >
          <Clock className="w-3.5 h-3.5 text-brand-primary shrink-0" />
          <p className="text-[10px] text-brand-primary font-bold">
            {t('humanInbox.patientPanel.onWaitlist', { count: waitlistCount })}
          </p>
        </button>
      )}

      {/* Sticky Notes Section */}
      {patient?.notes && (
        <div className="px-4 py-3 bg-amber-50/50 border-b border-amber-100 relative group">
          <div className="flex items-center gap-1.5 mb-1.5">
            <StickyNote className="w-3.5 h-3.5 text-amber-600" />
            <span className="text-[10px] font-black text-amber-700 uppercase tracking-widest">{t('humanInbox.patientPanel.frontDeskNotes')}</span>
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
          enabledChannels={enabledChannels}
          defaultChannel={defaultChannel}
        />
      </div>

      {/* Additional Identity Details */}
      <div className="p-4 border-b border-gray-100 space-y-2">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <CreditCard className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <span>{docLabel((patient?.country as CountryCode) || (patient?.cpf ? 'BR' : DEFAULT_COUNTRY))}: <span className="font-medium">
              {patient?.national_id || patient?.cpf
                ? maskDoc(formatDoc(patient.national_id || patient.cpf || '', (patient?.country as CountryCode) || (patient?.cpf ? 'BR' : DEFAULT_COUNTRY)))
                : '—'}
            </span></span>
          </div>
          {patient?.birth_date && (
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <span>
                {t('humanInbox.patientPanel.birthDatePrefix')} <span className="font-medium">
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
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{t('humanInbox.patientPanel.upcomingAppointments')}</p>
        {appointments.length === 0 ? (
          <p className="text-xs text-gray-400 italic">{t('humanInbox.patientPanel.noAppointments')}</p>
        ) : (
          <div className="space-y-2">
            {appointments.map((appt: Appointment, i: number) => (
              <div key={i} className="bg-blue-50 rounded-xl p-2.5 text-xs">
                <p className="font-semibold text-blue-800">{appt.appointment_types?.name ?? t('humanInbox.fallbackNames.appointment')}</p>
                <p className="text-blue-600 mt-0.5">
                  {appt.doctors?.full_name ?? t('humanInbox.fallbackNames.doctor')} · {appt.locations?.name ?? ''}
                </p>
                <p className="text-blue-500 mt-0.5">
                  {appt.date && typeof appt.date === 'string' && appt.date.includes('-')
                    ? new Date(appt.date + 'T12:00:00').toLocaleDateString('pt-BR')
                    : (appt.date || '')}
                  {appt.start_time ? ` ${t('humanInbox.patientPanel.atTimePrefix')} ${String(appt.start_time).substring(0, 5)}` : ''}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action Toolbar */}
      <div className="p-4 border-b border-gray-100 bg-blue-50/30">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">{t('humanInbox.patientPanel.quickActions')}</p>
        <div className="grid grid-cols-3 gap-2">
          {!patient ? (
            <>
              <button onClick={onNewPatient} className="flex flex-col items-center gap-1 p-2 rounded-xl transition-all bg-blue-50 text-blue-600 hover:bg-blue-100">
                <UserPlus size={18} />
                <span className="text-[9px] font-bold uppercase tracking-tight">{t('humanInbox.patientPanel.actions.register')}</span>
              </button>
              <button onClick={onLookupPatient} className="flex flex-col items-center gap-1 p-2 rounded-xl transition-all bg-gray-50 text-gray-600 hover:bg-gray-100">
                <Search size={18} />
                <span className="text-[9px] font-bold uppercase tracking-tight">{t('humanInbox.patientPanel.actions.link')}</span>
              </button>
            </>
          ) : (
            <>
              <button onClick={onViewAppointments} className="flex flex-col items-center gap-1 p-2 rounded-xl transition-all bg-gray-50 text-gray-600 hover:bg-gray-100">
                <Clock size={18} />
                <span className="text-[9px] font-bold uppercase tracking-tight">{t('humanInbox.patientPanel.actions.appointments')}</span>
              </button>
              <button onClick={() => onViewChange('payment')} className="flex flex-col items-center gap-1 p-2 rounded-xl transition-all bg-green-50 text-green-600 hover:bg-green-100">
                <DollarSign size={18} />
                <span className="text-[9px] font-bold uppercase tracking-tight">{t('humanInbox.patientPanel.actions.payment')}</span>
              </button>
            </>
          )}
          <button onClick={() => onViewChange('availability')} className="flex flex-col items-center gap-1 p-2 rounded-xl transition-all bg-indigo-50 text-indigo-600 hover:bg-indigo-100">
            <CalendarSearch size={18} />
            <span className="text-[9px] font-bold uppercase tracking-tight">{t('humanInbox.patientPanel.actions.availability')}</span>
          </button>
          <button onClick={() => onViewChange('directory')} className="flex flex-col items-center gap-1 p-2 rounded-xl transition-all bg-slate-50 text-slate-600 hover:bg-slate-100">
            <Building2 size={18} />
            <span className="text-[9px] font-bold uppercase tracking-tight">{t('humanInbox.patientPanel.actions.directory')}</span>
          </button>
          <button onClick={() => onViewChange('classify')} className="flex flex-col items-center gap-1 p-2 rounded-xl transition-all bg-amber-50 text-amber-600 hover:bg-amber-100">
            <Tag size={18} />
            <span className="text-[9px] font-bold uppercase tracking-tight">{t('humanInbox.patientPanel.actions.classify')}</span>
          </button>
          {patient && (
            <button onClick={() => onViewChange('waitlist')} className="relative flex flex-col items-center gap-1 p-2 rounded-xl transition-all bg-purple-50 text-purple-600 hover:bg-purple-100">
              <Clock size={18} />
              <span className="text-[9px] font-bold uppercase tracking-tight">{t('humanInbox.patientPanel.actions.waitlist')}</span>
              {waitlistCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-purple-600 text-white text-[9px] font-black rounded-full flex items-center justify-center">
                  {waitlistCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Kanban Classification */}
      <div className="p-4 border-b border-gray-100">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{t('humanInbox.patientPanel.kanbanClassification')}</p>
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
          {t('humanInbox.patientPanel.kanbanHint')}
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
              {t('humanInbox.patientPanel.transferAction')}
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
  const { t } = useTranslation('communications')
  const { showToast, showConfirm } = useToast()
  const { tenant } = useTenant()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tenantId, setTenantId]       = useState<string | null>(null)
  const [userId, setUserId]           = useState<string | null>(null)
  // Padrão 'all': com a IA atendendo (bot_active), a Fila não é mais o quadro
  // completo — conversas da IA precisam estar visíveis ao abrir o Inbox
  const [tab, setTab]                 = useState<'all' | 'queued' | 'mine'>('all')
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
  const [bookingPreFill, setBookingPreFill] = useState<any | null>(null);
  const [channelFilter, setChannelFilter] = useState<'all' | 'whatsapp' | 'livechat' | 'instagram' | 'facebook' | 'sms'>('all');

  // ── Popup de canal para a mensagem de confirmação de agendamento ──
  const [confirmationMsg, setConfirmationMsg] = useState<string | null>(null);
  const [confirmationOptions, setConfirmationOptions] = useState<ConfirmationChannelOption[] | null>(null);
  const [confirmationSending, setConfirmationSending] = useState(false);
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
  const [sidebarView, setSidebarView] = useState<'profile' | 'register' | 'lookup' | 'booking' | 'appointments' | 'edit' | 'availability' | 'payment' | 'directory' | 'classify' | 'waitlist'>('profile');
  const [, setTick] = useState(0)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)

  // Meta Window countdown and expired states
  const [metaWindowTimeLeft, setMetaWindowTimeLeft] = useState<number | null>(null)
  const [metaWindowExpired, setMetaWindowExpired] = useState<boolean>(false)

  const isMetaChannel = selected?.channel === 'instagram' || selected?.channel === 'facebook'

  const lastUserMessageTime = useMemo(() => {
    if (!selected) return null

    // 1. Search in the active message list (latest first)
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === 'user') {
        return new Date(msg.created_at).getTime()
      }
    }

    // 2. Fallback to selected.recent_messages
    if (selected.recent_messages && selected.recent_messages.length > 0) {
      for (let i = selected.recent_messages.length - 1; i >= 0; i--) {
        const msg = selected.recent_messages[i]
        if (msg.role === 'user' && msg.timestamp) {
          return new Date(msg.timestamp).getTime()
        }
      }
    }

    return null
  }, [selected?.id, messages, selected?.recent_messages])

  useEffect(() => {
    if (!selected || !isMetaChannel || !lastUserMessageTime) {
      setMetaWindowTimeLeft(null)
      setMetaWindowExpired(false)
      return
    }

    const updateTimer = () => {
      const now = Date.now()
      const elapsed = now - lastUserMessageTime
      const limit = 7 * 24 * 60 * 60 * 1000 // 7 days in ms
      const remaining = limit - elapsed

      if (remaining <= 0) {
        setMetaWindowTimeLeft(0)
        setMetaWindowExpired(true)
      } else {
        setMetaWindowTimeLeft(remaining)
        setMetaWindowExpired(false)
      }
    }

    updateTimer()
    const intervalId = setInterval(updateTimer, 1000)
    return () => clearInterval(intervalId)
  }, [selected?.id, isMetaChannel, lastUserMessageTime])

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

  // Referência da sessão selecionada para uso dentro de callbacks realtime
  // (evita closures com estado desatualizado)
  const selectedRef = useRef<ConversationSession | null>(null)
  useEffect(() => { selectedRef.current = selected }, [selected])

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
      showToast('error', t('humanInbox.main.toasts.sendMediaError', { message: err.message }))
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
    const interval = setInterval(() => setTick(n => n + 1), 30_000)
    return () => clearInterval(interval)
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
      const phones = [...new Set(list.flatMap(s => {
        const raw = s.patient_phone || '';
        const clean = raw.replace(/\D/g, '');
        return [clean, `+${clean}`];
      }))]
      const patientIds = [...new Set(list.map(s => s.patient_id).filter(Boolean))] as string[];

      const [ptsPhoneRes, ptsIdRes] = await Promise.all([
        phones.length > 0
          ? supabase.from('patients').select('phone, full_name').in('phone', phones).eq('tenant_id', targetTenant)
          : { data: [] },
        patientIds.length > 0
          ? supabase.from('patients').select('id, full_name').in('id', patientIds).eq('tenant_id', targetTenant)
          : { data: [] }
      ]);

      const map: Record<string, string> = {};
      if (ptsPhoneRes.data) {
        ptsPhoneRes.data.forEach((p: any) => {
          if (p.full_name && p.phone) {
            const clean = p.phone.replace(/\D/g, '');
            map[clean] = p.full_name;
            map[`+${clean}`] = p.full_name;
          }
        });
      }

      if (ptsIdRes.data) {
        const idToName: Record<string, string> = {};
        ptsIdRes.data.forEach((p: any) => {
          idToName[p.id] = p.full_name;
        });

        list.forEach(s => {
          if (s.patient_id && idToName[s.patient_id]) {
            map[s.patient_phone] = idToName[s.patient_id];
          }
        });
      }

      setPatientNames(map);
    }

    if (!silent) setLoadingSessions(false)
  }, [tenantId, tab, userId])

  useEffect(() => { loadSessions() }, [loadSessions])

  // Auto-select session from handoff alert / CRM deep-link
  useEffect(() => {
    const handoffSessionId = searchParams.get('handoff_session')
    if (!handoffSessionId || sessions.length === 0) return

    // Limpa a URL imediatamente para não re-disparar o efeito
    const newParams = new URLSearchParams(searchParams)
    newParams.delete('handoff_session')
    setSearchParams(newParams, { replace: true })

    const sessionToSelect = sessions.find(s => s.id === handoffSessionId)
    if (sessionToSelect) {
      handleSelectSession(sessionToSelect)
      return
    }

    // Sessão fora da aba/lista atual (ex.: veio do CRM e a conversa está
    // fechada ou em outra aba) — busca direta pelo id e seleciona mesmo assim
    supabase
      .from('conversation_sessions')
      .select('*')
      .eq('id', handoffSessionId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) handleSelectSession(data as any)
      })
  }, [searchParams, sessions, handleSelectSession, setSearchParams])

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

        // F1 Copiloto: se a sessão aberta ganhou contexto novo (ai_draft,
        // lead_temperature, intake), refletir na conversa selecionada
        const updatedRow = payload.new as any
        if (payload.eventType === 'UPDATE' && updatedRow?.context && updatedRow?.id === selectedRef.current?.id) {
          setSelected(prev => prev && prev.id === updatedRow.id ? { ...prev, context: updatedRow.context } : prev)
        }

        // Sessão aberta no painel foi encerrada pelo visitante (livechat):
        // fecha a janela de conversa para impedir envio a uma sessão morta
        const current = selectedRef.current
        if (
          payload.eventType === 'UPDATE' &&
          newStatus === 'closed' &&
          current &&
          (payload.new as any)?.id === current.id &&
          current.channel === 'livechat'
        ) {
          setSelected(null)
          showToast('warning', t('humanInbox.main.toasts.sessionClosedRemotely'))
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

    const loadPatientDetails = async () => {
      let query;
      if (selected.patient_id) {
        query = supabase.from('patients')
          .select('id, full_name, cpf, national_id, national_id_type, country, email, birth_date, notes, phone')
          .eq('tenant_id', tenantId)
          .eq('id', selected.patient_id);
      } else {
        const phone = selected.patient_phone;
        const cleanPhone = phone.replace(/\D/g, '');
        query = supabase.from('patients')
          .select('id, full_name, cpf, national_id, national_id_type, country, email, birth_date, notes, phone')
          .eq('tenant_id', tenantId)
          .or(`phone.eq.${cleanPhone},phone.eq.+${cleanPhone}`);
      }

      const { data } = await query.maybeSingle();
      setPatient(data as PatientInfo | null);
      if (data?.id) {
        supabase.from('appointments')
          .select('date, start_time, status, doctors(full_name), locations(name), appointment_types(name)')
          .eq('tenant_id', tenantId)
          .eq('patient_id', data.id)
          .in('status', ['scheduled', 'confirmed'])
          .gte('date', new Date().toISOString().split('T')[0])
          .order('date', { ascending: true })
          .limit(3)
          .then(({ data: appts }) => setAppointments((appts ?? []) as any as Appointment[]));
      }
    };

    loadPatientDetails();
  }, [selected?.id, selected?.patient_id, tenantId])

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

  // ── Realtime: patient updates ──────────────────
  useEffect(() => {
    if (!patient?.id) return;
    
    const channel = supabase
      .channel(`inbox_patient_${patient.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'patients',
          filter: `id=eq.${patient.id}`,
        },
        (payload) => {
          setPatient(payload.new as PatientInfo);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [patient?.id]);

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
        ? t('humanInbox.main.toasts.alreadyClaimed')
        : t('humanInbox.main.toasts.genericError', { reason: data?.reason ?? error?.message }))
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
        showToast('error', t('humanInbox.main.toasts.editError', { message: error.message }))
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
        showToast('warning', t('humanInbox.main.toasts.linkPatientFirst'))
        setMessages(prev => prev.filter(m => m.id !== tempId))
        setSending(false)
        return
      }
      const { error: pError } = await supabase.from('patients').update({ notes: text }).eq('id', patient.id)
      if (!pError) setPatient(prev => prev ? { ...prev, notes: text } : prev)
      const { error } = await supabase.from('conversation_messages').insert({ session_id: selected.id, role: 'internal', content: text })
      if (error) {
        showToast('error', t('humanInbox.main.toasts.saveNoteError', { message: error.message }))
        setMessages(prev => prev.filter(m => m.id !== tempId))
      }
    } else {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const res = await supabase.functions.invoke('send-human-message', {
        body: { session_id: selected.id, text, tenant_id: tenantId, user_id: userId, replied_to_id: capturedReplyId },
        headers: { Authorization: `Bearer ${authSession?.access_token}` }
      })
      if (res.error || res.data?.error) {
        showToast('error', t('humanInbox.main.toasts.sendError', { message: res.error?.message || res.data?.error }))
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
          text: forwardMsg.content || t('humanInbox.main.forwardModal.mediaFallback'),
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
      showToast('error', t('humanInbox.main.toasts.sendLinkError', { message: error.message }))
    }
  }

  // ── Confirmação de agendamento: seleção de canal ──
  const openConfirmationModal = useCallback(async (message: string) => {
    if (!selected || !tenantId) return
    setConfirmationMsg(message)
    setConfirmationOptions(null)

    // Telefone real do paciente (sessões Meta guardam PSID/IGSID em patient_phone)
    const isMetaSession = ['instagram', 'facebook', 'livechat'].includes(selected.channel || '')
    let phone = patient?.phone || (!isMetaSession ? selected.patient_phone : '') || ''
    if (/[a-zA-Z]/.test(phone)) phone = ''
    const clean = phone.replace(/\D/g, '')

    // Canais onde já existe conversa com este paciente
    const orParts: string[] = [`id.eq.${selected.id}`]
    if (selected.patient_id) orParts.push(`patient_id.eq.${selected.patient_id}`)
    if (clean) orParts.push(`patient_phone.eq.${clean}`, `patient_phone.eq."+${clean}"`)
    const { data: related } = await supabase
      .from('conversation_sessions')
      .select('id, channel')
      .eq('tenant_id', tenantId)
      .or(orParts.join(','))
    const channelsWithSession = new Set((related ?? []).map(s => s.channel || 'whatsapp'))

    const smsEnabled = !!((tenant as any)?.telnyx_enabled || (tenant as any)?.sms_enabled)
    const hasEmail = !!patient?.email?.trim()

    const options: ConfirmationChannelOption[] = [
      { id: 'whatsapp', available: !!clean || channelsWithSession.has('whatsapp'), reasonKey: 'humanInbox.channelModal.reasons.noPhone' },
      { id: 'facebook', available: channelsWithSession.has('facebook'), reasonKey: 'humanInbox.channelModal.reasons.noConversation' },
      { id: 'instagram', available: channelsWithSession.has('instagram'), reasonKey: 'humanInbox.channelModal.reasons.noConversation' },
      {
        id: 'sms',
        available: smsEnabled && (!!clean || channelsWithSession.has('sms')),
        reasonKey: !smsEnabled ? 'humanInbox.channelModal.reasons.smsDisabled' : 'humanInbox.channelModal.reasons.noPhone',
      },
      { id: 'email', available: hasEmail, reasonKey: 'humanInbox.channelModal.reasons.noEmail' },
    ]
    // Conversa atual em Live Chat continua sendo uma opção válida de entrega
    if ((selected.channel || 'whatsapp') === 'livechat') {
      options.unshift({ id: 'livechat', available: true })
    }
    setConfirmationOptions(options)
  }, [selected, patient, tenantId, tenant])

  const handleConfirmationSend = async (channel: ConfirmationChannelId) => {
    if (!selected || !confirmationMsg || !tenantId || !userId) return
    setConfirmationSending(true)
    const currentChannel = selected.channel || 'whatsapp'
    const { data: { session: authSession } } = await supabase.auth.getSession()
    const res = await supabase.functions.invoke('send-human-message', {
      body: {
        session_id: selected.id,
        text: confirmationMsg,
        tenant_id: tenantId,
        user_id: userId,
        ...(channel !== currentChannel ? { target_channel: channel } : {}),
      },
      headers: { Authorization: `Bearer ${authSession?.access_token}` },
    })
    setConfirmationSending(false)
    if (res.error || res.data?.error) {
      showToast('error', t('humanInbox.channelModal.toasts.error', { message: res.error?.message || res.data?.error }))
    } else {
      showToast('success', t('humanInbox.channelModal.toasts.sent', { channel: t(`humanInbox.channels.${channel === 'facebook' ? 'messenger' : channel === 'livechat' ? 'liveChat' : channel}`) }))
      setConfirmationMsg(null)
      setConfirmationOptions(null)
      loadSessions()
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
        showToast('success', t('humanInbox.main.toasts.transferSuccess'));
    } else {
        showToast('error', t('humanInbox.main.toasts.transferError', { reason: data?.reason || error?.message }));
    }
  }

  // ── Close ─────────────────────────────────────
  const handleClose = async () => {
    if (!selected) return
    // Limpa a ref antes do update para o evento realtime do próprio fechamento
    // não ser tratado como encerramento remoto
    selectedRef.current = null
    await supabase.from('conversation_sessions')
      .update({ omnichannel_status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', selected.id)

    // Avisar o widget do visitante em tempo real que o atendimento foi encerrado
    if (selected.channel === 'livechat') {
      const closeChannel = supabase.channel(`livechat:${selected.id}`)
      await closeChannel.send({
        type: 'broadcast',
        event: 'session_closed',
        payload: { session_id: selected.id, closed_by: 'agent' }
      })
      supabase.removeChannel(closeChannel)
    }

    setSelected(null)
    loadSessions()
  }

  // ── Delete Message ────────────────────────────
  const handleDeleteMessage = useCallback(async (msg: Message) => {
    if (!selected || !tenantId || !userId) return
    
    const confirmDelete = await showConfirm(t('humanInbox.main.toasts.deleteMessageConfirm'));
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

      showToast('success', t('humanInbox.main.toasts.deleteMessageSuccess'));
    } catch (err: any) {
      console.error('Delete message error:', err);
      showToast('error', t('humanInbox.main.toasts.deleteMessageError', { message: err.message }));
      // Revert optimistic update on error
      setMessages(previousMessages);
    }
  }, [selected, tenantId, userId, messages, showToast]);



  const channelCounts = useMemo(() => {
    const counts = { all: 0, whatsapp: 0, livechat: 0, instagram: 0, facebook: 0, sms: 0 }
    sessions.forEach(s => {
      const chan = s.channel || 'whatsapp'
      if (chan === 'whatsapp' || chan === 'livechat' || chan === 'instagram' || chan === 'facebook' || chan === 'sms') {
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
    <div className="flex h-full w-full bg-white rounded-3xl overflow-hidden border border-ice-100 shadow-float">
      {headerSlot && createPortal(
        <div className="flex items-center justify-between w-full h-full px-1 lg:px-2 gap-2 lg:gap-4">
          {/* Left: Channels segmented control */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar flex-1 min-w-0">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 select-none hidden lg:block shrink-0">{t('humanInbox.main.channelsLabel')}</span>
            <div className="flex bg-ice-100 border border-ice-200/60 p-0.5 rounded-xl shrink-0 gap-0.5">
               <button
                  onClick={() => setChannelFilter('all')}
                  className={clsx(
                    "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                    channelFilter === 'all'
                      ? "bg-white text-slate-900 shadow-sm border border-ice-100"
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-200/50"
                  )}
                >
                  {t('humanInbox.main.all')}
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
                  {t('humanInbox.channels.whatsapp')}
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
                  {t('humanInbox.channels.liveChat')}
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
                  {t('humanInbox.channels.instagram')}
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
                  {t('humanInbox.channels.messenger')}
                  <span className={clsx(
                    "px-1.5 py-0.5 rounded-full text-[9px] font-extrabold transition-all",
                    channelFilter === 'facebook' ? "bg-white/20 text-white" : "bg-slate-200/50 text-slate-500"
                  )}>
                    {channelCounts.facebook}
                  </span>
                </button>
               <button
                  onClick={() => setChannelFilter('sms')}
                  className={clsx(
                    "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                    channelFilter === 'sms'
                      ? "bg-teal-600 text-white shadow-sm shadow-teal-600/10 border border-teal-500/50"
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-200/50"
                  )}
                >
                  {t('humanInbox.channels.sms')}
                  <span className={clsx(
                    "px-1.5 py-0.5 rounded-full text-[9px] font-extrabold transition-all",
                    channelFilter === 'sms' ? "bg-white/20 text-white" : "bg-slate-200/50 text-slate-500"
                  )}>
                    {channelCounts.sms}
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
              <span className="text-slate-400 font-extrabold text-[9px] uppercase tracking-wider hidden lg:inline-block">{t('humanInbox.main.stageLabel')}</span>
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
                  <div className="px-3 py-1 text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2 mb-1">{t('humanInbox.main.selectStage')}</div>
                  <button
                    onClick={() => { setSelectedStage('Todos'); setStageDropdownOpen(false); }}
                    className={clsx(
                      "w-full flex items-center justify-between px-4 py-2.5 text-left text-xs font-bold hover:bg-slate-50 cursor-pointer transition-colors",
                      selectedStage === 'Todos' ? "text-indigo-600 bg-indigo-50/50" : "text-slate-700"
                    )}
                  >
                    <span>{t('humanInbox.main.all')}</span>
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
        "w-full lg:w-[280px] shrink-0 flex flex-col bg-white border-r border-ice-100 h-full",
        selected ? "hidden lg:flex" : "flex"
      )}>

        {/* Header */}
        <div className="px-4 py-4 border-b border-ice-100 space-y-3">
          <div className="flex items-center gap-2">
            <Inbox className="w-4 h-4 text-blue-600" />
            <h1 className="text-sm font-bold text-gray-900">{t('humanInbox.main.headerTitle')}</h1>
          </div>

          {/* Search */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 bg-ice-50 border border-ice-100 rounded-xl px-3 py-1.5">
              <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('humanInbox.main.searchPlaceholder')}
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-gray-400"
              />
            </div>
            {/* Filters moved to Header Portal */}
          </div>

          {/* Tabs */}
          <div className="flex rounded-xl overflow-hidden border border-ice-100 text-[11px]">
            <button
              onClick={() => setTab('all')}
              className={clsx(
                'flex-1 py-1.5 font-semibold transition-colors flex items-center justify-center gap-1.5',
                tab === 'all' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              {t('humanInbox.main.tabs.all')}
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
                'flex-1 py-1.5 font-semibold transition-colors flex items-center justify-center gap-1.5 border-l border-r border-ice-100',
                tab === 'queued' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              {t('humanInbox.main.tabs.queue')}
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
              {t('humanInbox.main.tabs.mine')}
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
                {search ? t('humanInbox.main.list.noResults') : tab === 'queued' ? t('humanInbox.main.list.queueEmpty') : t('humanInbox.main.list.noActiveConversations')}
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
          <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-ice-100 shrink-0">
            <div className="flex items-center gap-3">
              {/* Mobile Back Button */}
              <button
                onClick={() => setSelected(null)}
                className="lg:hidden p-1 mr-1 hover:bg-slate-100 rounded-lg text-slate-500 cursor-pointer"
                title={t('humanInbox.main.backToList')}
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
                ) : selected.channel === 'sms' ? (
                  <MessageSquare className="w-4 h-4 text-blue-600" />
                ) : (
                  <User className="w-4 h-4 text-blue-600" />
                )}
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">
                  {patient?.full_name
                    ? patient.full_name
                    : (selected.channel === 'livechat' || selected.channel === 'instagram' || selected.channel === 'facebook')
                    ? (selected.context?.visitor_name || selected.context?.username || selected.context?.name || (selected.channel === 'instagram' ? t('humanInbox.fallbackNames.instagramUser') : selected.channel === 'facebook' ? t('humanInbox.fallbackNames.messengerUser') : t('humanInbox.fallbackNames.webVisitor')))
                    : `${phoneFlag(selected.patient_phone)} ${formatPhone(selected.patient_phone)}`}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <StatusBadge status={selected.omnichannel_status} />
                  {selected.omnichannel_status === 'queued' && (
                    <span className={clsx('text-[11px]', slaColor(selected.updated_at))}>
                      <Clock className="w-3 h-3 inline mr-0.5" />
                      aguardando {slaLabel(selected.updated_at, t('humanInbox.sla.now'))}
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
                  {t('humanInbox.main.claim')}
                </button>
              )}
              {isOwned && (
                <button
                  onClick={handleClose}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50 transition-colors"
                >
                  <XCircle className="w-3.5 h-3.5" /> {t('humanInbox.main.close')}
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
                title={t('humanInbox.main.patientPanelTitle')}
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
                <p className="text-xs">{t('humanInbox.main.noPreviousMessages')}</p>
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
            aiDraft={selected?.context?.ai_draft ?? null}
            onDiscardAiDraft={async () => {
              if (!selected) return
              const newContext = { ...(selected.context || {}) }
              delete newContext.ai_draft
              setSelected(prev => prev ? { ...prev, context: newContext } : prev)
              await supabase.from('conversation_sessions').update({ context: newContext }).eq('id', selected.id)
            }}
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
            metaWindowTimeLeft={metaWindowTimeLeft}
            metaWindowExpired={metaWindowExpired}
          />
        </div>
      ) : (
        <div className="hidden lg:flex flex-1 items-center justify-center text-gray-400 bg-gray-50/30">
          <div className="text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto">
              <MessageCircle className="w-8 h-8 opacity-30" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-500">{t('humanInbox.main.selectConversation')}</p>
              <p className="text-xs text-gray-400 mt-1">
                {queuedCount > 0
                  ? t('humanInbox.main.queueWaiting', { count: queuedCount })
                  : t('humanInbox.main.queueEmptyLong')}
              </p>
            </div>
            {queuedCount > 0 && (
              <div className="flex items-center justify-center gap-1.5 text-xs text-amber-600 animate-pulse">
                <AlertTriangle className="w-3.5 h-3.5" />
                {t('humanInbox.main.attendanceNeeded')}
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
            className="shrink-0 overflow-hidden bg-white border-l border-ice-100 shadow-xl relative z-20"
          >
            <PatientPanel
              session={selected}
              patient={patient}
              appointments={appointments}
              onClose={() => setShowPatientPanel(false)}
              enabledChannels={tenant?.bot_config?.enabled_channels}
              defaultChannel={tenant?.bot_config?.default_notification_channel}
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
              onViewAppointments={() => setSidebarView('appointments')}
              onSendMessage={handleSidebarSendMessage}
              onSendConfirmation={openConfirmationModal}
              isOwned={isOwned}
              view={sidebarView}
              onViewChange={setSidebarView}
              onPatientSelected={async (p) => {
                if (!selected) return;
                setPatient(p);
                try {
                  // 1. Link the current conversation session to the official patient ID
                  const { error: sessionUpdateError } = await supabase
                    .from('conversation_sessions')
                    .update({ patient_id: p.id })
                    .eq('id', selected.id);

                  if (sessionUpdateError) throw sessionUpdateError;

                  // 2. Permanently map this communication channel in patient_channel_preferences
                  const canonicalPhone = p.phone || selected.patient_phone;
                  const updatePayload: any = {
                    tenant_id: selected.tenant_id,
                    patient_phone: canonicalPhone,
                    updated_by: 'manual',
                    last_manual_updated_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                  };

                  if (selected.channel === 'instagram') {
                    updatePayload.instagram_user_id = selected.patient_phone;
                    if (selected.context?.username) {
                      updatePayload.instagram_username = selected.context.username;
                    }
                  } else if (selected.channel === 'facebook') {
                    updatePayload.facebook_user_id = selected.patient_phone;
                    if (selected.context?.name || selected.context?.visitor_name) {
                      updatePayload.facebook_name = selected.context.name || selected.context.visitor_name;
                    }
                  } else if (selected.channel === 'sms') {
                    updatePayload.sms_phone = selected.patient_phone;
                  } else if (selected.channel === 'whatsapp') {
                    updatePayload.whatsapp_phone = selected.patient_phone;
                  }

                  const { error: upsertError } = await supabase
                    .from('patient_channel_preferences')
                    .upsert(updatePayload, { onConflict: 'tenant_id,patient_phone' });

                  if (upsertError) throw upsertError;

                  // Update locally so header and child components adapt immediately
                  setSelected(prev => prev ? { ...prev, patient_id: p.id } : null);
                  showToast('success', t('humanInbox.main.toasts.channelLinkedSuccess'));
                } catch (err: any) {
                  console.error('Error linking patient details:', err);
                  showToast('error', t('humanInbox.main.toasts.channelLinkedError', { message: err.message }));
                }

                loadSessions();
              }}
              onUnlink={async () => {
                if (!selected) return;
                const confirm = await showConfirm(t('humanInbox.main.toasts.unlinkConfirm'));
                if (!confirm) return;

                try {
                  // 1. Remove patient_id relationship from current conversation session
                  const { error: sessionError } = await supabase
                    .from('conversation_sessions')
                    .update({ patient_id: null })
                    .eq('id', selected.id);

                  if (sessionError) throw sessionError;

                  // 2. Remove the channel mapping from patient_channel_preferences
                  if (patient && patient.phone) {
                    const updatePayload: any = {
                      updated_at: new Date().toISOString()
                    };

                    if (selected.channel === 'instagram') {
                      updatePayload.instagram_user_id = null;
                      updatePayload.instagram_username = null;
                    } else if (selected.channel === 'facebook') {
                      updatePayload.facebook_user_id = null;
                      updatePayload.facebook_name = null;
                    } else if (selected.channel === 'sms') {
                      updatePayload.sms_phone = null;
                    } else if (selected.channel === 'whatsapp') {
                      updatePayload.whatsapp_phone = null;
                    }

                    const { error: prefError } = await supabase
                      .from('patient_channel_preferences')
                      .update(updatePayload)
                      .eq('tenant_id', selected.tenant_id)
                      .eq('patient_phone', patient.phone);

                    if (prefError) {
                      console.warn('Non-blocking pref update error during unlink:', prefError);
                    }
                  }

                  // Update locally so header and child components adapt immediately
                  setSelected(prev => prev ? { ...prev, patient_id: null } : null);
                  setPatient(null);
                  showToast('success', t('humanInbox.main.toasts.unlinkSuccess'));
                } catch (err: any) {
                  console.error('Error unlinking channel:', err);
                  showToast('error', err.message || 'Erro ao desvincular canal.');
                }

                loadSessions();
              }}
              onReschedule={(appt) => {
                setRescheduleData(appt);
                setSidebarView('booking');
              }}
              onResetReschedule={() => setRescheduleData(null)}
              rescheduleData={rescheduleData}
              preFill={bookingPreFill}
              onPreFillChange={setBookingPreFill}
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
              className="bg-white rounded-3xl shadow-2xl border border-ice-100 w-full max-w-sm relative z-10 overflow-hidden"
            >
              <div className="p-4 border-b border-ice-100 flex items-center justify-between">
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <Forward className="w-4 h-4 text-green-600" />
                  {t('humanInbox.main.forwardModal.title')}
                </h3>
                <button onClick={() => setForwardMsg(null)} className="text-gray-400 hover:text-gray-600 border-none bg-transparent cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Message preview */}
              <div className="px-4 pt-3">
                <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-600 truncate italic">
                  "{forwardMsg.content || forwardMsg.caption || forwardMsg.file_name || t('humanInbox.messageBubble.mediaPlaceholder')}"
                </div>
              </div>

              <div className="p-4">
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">
                  {t('humanInbox.main.forwardModal.forwardTo')}
                </label>
                <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
                  {sessions.filter(s => s.id !== selected?.id && s.omnichannel_status !== 'closed').length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-4 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                      {t('humanInbox.main.forwardModal.noOtherConversations')}
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
                              {patientNames[s.patient_phone] ?? (
                                ['instagram', 'facebook', 'livechat'].includes(s.channel || '')
                                  ? (s.context?.visitor_name || s.context?.username || s.context?.name || (s.channel === 'instagram' ? t('humanInbox.fallbackNames.instagramUser') : s.channel === 'facebook' ? t('humanInbox.fallbackNames.messengerUser') : t('humanInbox.fallbackNames.webVisitor')))
                                  : formatPhone(s.patient_phone)
                              )}
                            </p>
                            <p className="text-[10px] text-gray-400 truncate">
                              {['instagram', 'facebook', 'livechat'].includes(s.channel || '')
                                ? (s.channel === 'instagram' ? `${t('humanInbox.channels.instagram')}: @${s.context?.username || 'Direct'}` : s.channel === 'facebook' ? t('humanInbox.channels.facebookMessenger') : t('humanInbox.channels.liveChat'))
                                : s.patient_phone}
                            </p>
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
              className="bg-white rounded-3xl shadow-2xl border border-ice-100 w-full max-w-sm relative z-10 overflow-hidden"
            >
              <div className="p-4 border-b border-ice-100 flex items-center justify-between">
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <ArrowRightLeft className="w-4 h-4 text-indigo-600" />
                  {t('humanInbox.patientPanel.transferAction')}
                </h3>
                <button onClick={() => setShowTransferModal(false)} className="text-gray-400 hover:text-gray-600 border-none bg-transparent cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-5">
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">
                  {t('humanInbox.main.transferModal.selectMember')}
                </label>
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {teamUsers.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-4 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                      {t('humanInbox.main.transferModal.noOtherUsers')}
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
                          <p className="text-[10px] text-gray-500 capitalize">{user.role || t('humanInbox.fallbackNames.member')}</p>
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
                    {t('humanInbox.main.transferModal.cancel')}
                  </button>
                  <button
                    onClick={handleTransfer}
                    disabled={!selectedUserToTransfer || transferring}
                    className="flex-1 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors border-none cursor-pointer flex justify-center items-center gap-2"
                  >
                    {transferring ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : t('humanInbox.main.transferModal.confirm')}
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

      {/* Seletor de canal da mensagem de confirmação de agendamento */}
      {confirmationMsg && selected && (
        <ConfirmationChannelModal
          message={confirmationMsg}
          currentChannel={(selected.channel || 'whatsapp') as ConfirmationChannelId}
          options={confirmationOptions}
          sending={confirmationSending}
          onConfirm={handleConfirmationSend}
          onSkip={() => { setConfirmationMsg(null); setConfirmationOptions(null) }}
        />
      )}
    </div>
  )
}
