import { useState, useEffect } from 'react';
import {
  Users, UserPlus, Mail, Shield, MoreVertical, RefreshCw,
  Loader2, CheckCircle2, XCircle, Clock, Copy, Check,
  Trash2, UserX, UserCheck, ChevronDown,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useTenant } from '../../contexts/TenantContext';
import { useToast } from '../../contexts/ToastContext';
import { useLocaleFormat } from '../../hooks/useLocaleFormat';
import { memberService, type Member } from '../../services/memberService';
import { invitationService, type Invitation } from '../../services/invitationService';

// ─── Constants ────────────────────────────────────────────────────────────────

export const ROLE_META: Record<string, { label: string; color: string; bg: string }> = {
  owner:     { label: 'Proprietário', color: 'text-purple-700', bg: 'bg-purple-100' },
  admin:     { label: 'Administrador', color: 'text-blue-700',   bg: 'bg-blue-100'   },
  manager:   { label: 'Gerente',       color: 'text-indigo-700', bg: 'bg-indigo-100' },
  doctor:    { label: 'Profissional',  color: 'text-green-700',  bg: 'bg-green-100'  },
  attendant: { label: 'Atendente',     color: 'text-amber-700',  bg: 'bg-amber-100'  },
  staff:     { label: 'Auxiliar',      color: 'text-gray-600',   bg: 'bg-gray-100'   },
};

const INVITABLE_ROLES = ['admin', 'manager', 'doctor', 'attendant', 'staff'] as const;

const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  pending:  { label: 'Aguardando', color: 'text-amber-600 bg-amber-50',   icon: Clock       },
  accepted: { label: 'Aceito',     color: 'text-green-600 bg-green-50',   icon: CheckCircle2 },
  expired:  { label: 'Expirado',   color: 'text-red-500 bg-red-50',       icon: XCircle     },
  revoked:  { label: 'Revogado',   color: 'text-gray-400 bg-gray-100',    icon: XCircle     },
};

// ─── Main Component ───────────────────────────────────────────────────────────

interface TeamManagementProps {
  currentUserRole: string;
  currentUserId: string;
}

export function TeamManagement({ currentUserRole, currentUserId }: TeamManagementProps) {
  const { tenant } = useTenant();
  const { showToast } = useToast();
  const { formatDate } = useLocaleFormat();

  const [tab, setTab]                   = useState<'members' | 'invites'>('members');
  const [members, setMembers]           = useState<Member[]>([]);
  const [invitations, setInvitations]   = useState<Invitation[]>([]);
  const [loadingMembers, setLoadingMembers]     = useState(true);
  const [loadingInvites, setLoadingInvites]     = useState(true);
  const [showInviteModal, setShowInviteModal]   = useState(false);
  const [actionMenu, setActionMenu]     = useState<string | null>(null);

  const canManage = ['owner', 'admin'].includes(currentUserRole);
  const canInvite = ['owner', 'admin', 'manager'].includes(currentUserRole);

  useEffect(() => {
    if (tenant?.id) {
      loadMembers();
      loadInvitations();
    }
  }, [tenant?.id]);

  const loadMembers = async () => {
    setLoadingMembers(true);
    try {
      setMembers(await memberService.list(tenant!.id));
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setLoadingMembers(false);
    }
  };

  const loadInvitations = async () => {
    setLoadingInvites(true);
    try {
      setInvitations(await invitationService.list(tenant!.id));
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setLoadingInvites(false);
    }
  };

  const handleRoleChange = async (memberId: string, newRole: string) => {
    try {
      await memberService.updateRole(memberId, newRole);
      showToast('success', 'Perfil atualizado');
      setActionMenu(null);
      loadMembers();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleDeactivate = async (memberId: string) => {
    if (!confirm('Desativar este membro? Ele perderá o acesso até ser reativado.')) return;
    try {
      await memberService.deactivate(memberId);
      showToast('success', 'Membro desativado');
      setActionMenu(null);
      loadMembers();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleReactivate = async (memberId: string) => {
    try {
      await memberService.reactivate(memberId);
      showToast('success', 'Membro reativado');
      setActionMenu(null);
      loadMembers();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleRevoke = async (inv: Invitation) => {
    if (!confirm(`Revogar convite de ${inv.email}?`)) return;
    try {
      await invitationService.revoke(inv.id);
      showToast('success', 'Convite revogado');
      loadInvitations();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const handleResend = async (inv: Invitation) => {
    try {
      await invitationService.resend(tenant!.id, inv.email, inv.role);
      showToast('success', `Convite reenviado para ${inv.email}`);
      loadInvitations();
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  const pendingCount = invitations.filter(i => i.status === 'pending').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-black text-gray-900">Equipe</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {members.filter(m => m.is_active).length} membros ativos
            {pendingCount > 0 && ` · ${pendingCount} convite${pendingCount > 1 ? 's' : ''} pendente${pendingCount > 1 ? 's' : ''}`}
          </p>
        </div>
        {canInvite && (
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-all shadow-sm shadow-blue-500/20"
          >
            <UserPlus size={16} /> Convidar Membro
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
        <button
          onClick={() => setTab('members')}
          className={clsx('px-4 py-1.5 rounded-lg text-sm font-bold transition-all',
            tab === 'members' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          )}
        >
          Membros Ativos
        </button>
        <button
          onClick={() => setTab('invites')}
          className={clsx('px-4 py-1.5 rounded-lg text-sm font-bold transition-all flex items-center gap-1.5',
            tab === 'invites' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          )}
        >
          Convites
          {pendingCount > 0 && (
            <span className="inline-flex items-center justify-center w-4 h-4 text-[9px] font-black bg-amber-500 text-white rounded-full">
              {pendingCount}
            </span>
          )}
        </button>
      </div>

      {/* Members list */}
      {tab === 'members' && (
        <div className="space-y-2">
          {loadingMembers ? (
            <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-blue-600" /></div>
          ) : members.length === 0 ? (
            <EmptyState icon={Users} message="Nenhum membro cadastrado" />
          ) : (
            members.map(member => {
              const meta   = ROLE_META[member.role] ?? ROLE_META.staff;
              const isMe   = member.user_id === currentUserId;
              const isOwner = member.role === 'owner';
              const canEdit = canManage && !isOwner && !isMe;

              return (
                <div key={member.id} className={clsx(
                  'flex items-center gap-3 p-4 bg-white border rounded-2xl transition-all',
                  member.is_active ? 'border-gray-100' : 'border-gray-100 opacity-60'
                )}>
                  {/* Avatar */}
                  <div className={clsx(
                    'w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-black',
                    meta.bg, meta.color
                  )}>
                    {(member.full_name || member.email || '?').charAt(0).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-gray-900 truncate">
                        {member.full_name ?? 'Sem nome'}
                        {isMe && <span className="text-gray-400 font-normal ml-1">(você)</span>}
                      </p>
                      <span className={clsx('text-[10px] font-bold px-2 py-0.5 rounded-full', meta.bg, meta.color)}>
                        {meta.label}
                      </span>
                      {!member.is_active && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600">
                          Inativo
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 truncate mt-0.5">{member.email}</p>
                  </div>

                  {/* Actions */}
                  {canEdit && (
                    <div className="relative shrink-0">
                      <button
                        onClick={() => setActionMenu(actionMenu === member.id ? null : member.id)}
                        className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors"
                      >
                        <MoreVertical size={16} />
                      </button>

                      {actionMenu === member.id && (
                        <div className="absolute right-0 top-10 z-30 bg-white border border-gray-200 rounded-2xl shadow-xl py-1 w-52">
                          {/* Change role */}
                          <div className="px-3 py-2 border-b border-gray-100">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Alterar Perfil</p>
                            {INVITABLE_ROLES.map(r => (
                              <button
                                key={r}
                                onClick={() => handleRoleChange(member.id, r)}
                                className={clsx(
                                  'w-full text-left px-2 py-1 text-xs rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2',
                                  member.role === r ? 'font-bold text-blue-600' : 'text-gray-700'
                                )}
                              >
                                <span className={clsx('w-1.5 h-1.5 rounded-full', ROLE_META[r].bg.replace('bg-', 'bg-'))} />
                                {ROLE_META[r].label}
                                {member.role === r && <Check size={11} className="ml-auto text-blue-600" />}
                              </button>
                            ))}
                          </div>
                          {/* Toggle active */}
                          {member.is_active ? (
                            <button
                              onClick={() => handleDeactivate(member.id)}
                              className="w-full text-left px-3 py-2 text-xs hover:bg-red-50 text-red-600 flex items-center gap-2"
                            >
                              <UserX size={13} /> Desativar Acesso
                            </button>
                          ) : (
                            <button
                              onClick={() => handleReactivate(member.id)}
                              className="w-full text-left px-3 py-2 text-xs hover:bg-green-50 text-green-600 flex items-center gap-2"
                            >
                              <UserCheck size={13} /> Reativar Acesso
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Invitations list */}
      {tab === 'invites' && (
        <div className="space-y-2">
          {loadingInvites ? (
            <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-blue-600" /></div>
          ) : invitations.length === 0 ? (
            <EmptyState icon={Mail} message="Nenhum convite enviado" />
          ) : (
            invitations.map(inv => {
              const st   = STATUS_META[inv.status] ?? STATUS_META.pending;
              const Icon = st.icon;
              const meta = ROLE_META[inv.role] ?? ROLE_META.staff;
              const isPending = inv.status === 'pending';

              return (
                <div key={inv.id} className="flex items-center gap-3 p-4 bg-white border border-gray-100 rounded-2xl">
                  <div className={clsx('w-10 h-10 rounded-full flex items-center justify-center shrink-0', meta.bg)}>
                    <Mail size={16} className={meta.color} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-gray-900 truncate">{inv.email}</p>
                      <span className={clsx('text-[10px] font-bold px-2 py-0.5 rounded-full', meta.bg, meta.color)}>
                        {meta.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400">
                      <Icon size={11} className={st.color.split(' ')[0]} />
                      <span className={clsx('font-medium', st.color.split(' ')[0])}>{st.label}</span>
                      <span>·</span>
                      <span>{formatDate(inv.created_at)}</span>
                      {isPending && (
                        <>
                          <span>·</span>
                          <span>expira {formatDate(inv.expires_at)}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {canInvite && isPending && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleResend(inv)}
                        title="Reenviar convite"
                        className="p-2 rounded-xl hover:bg-blue-50 text-blue-500 transition-colors"
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button
                        onClick={() => handleRevoke(inv)}
                        title="Revogar convite"
                        className="p-2 rounded-xl hover:bg-red-50 text-red-500 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <InviteModal
          tenantId={tenant!.id}
          currentRole={currentUserRole}
          onClose={() => setShowInviteModal(false)}
          onSuccess={() => {
            setShowInviteModal(false);
            loadInvitations();
            setTab('invites');
          }}
        />
      )}

      {/* Close action menu on outside click */}
      {actionMenu && (
        <div className="fixed inset-0 z-20" onClick={() => setActionMenu(null)} />
      )}
    </div>
  );
}

// ─── Invite Modal ─────────────────────────────────────────────────────────────

interface InviteModalProps {
  tenantId: string;
  currentRole: string;
  onClose: () => void;
  onSuccess: (inviteUrl?: string) => void;
}

const ROLE_OPTIONS_BY_CALLER: Record<string, string[]> = {
  owner:   ['admin', 'manager', 'doctor', 'attendant', 'staff'],
  admin:   ['manager', 'doctor', 'attendant', 'staff'],
  manager: ['attendant', 'staff'],
};

function InviteModal({ tenantId, currentRole, onClose, onSuccess }: InviteModalProps) {
  const { showToast } = useToast();
  const [email, setEmail]   = useState('');
  const [role, setRole]     = useState('attendant');
  const [sending, setSending] = useState(false);
  const [error, setError]   = useState('');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const availableRoles = ROLE_OPTIONS_BY_CALLER[currentRole] ?? [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !email.includes('@')) {
      setError('Informe um email válido.');
      return;
    }

    setSending(true);
    try {
      const result = await invitationService.invite(tenantId, email.trim(), role);
      setInviteUrl(result.invite_url ?? null);
      showToast('success', `Convite enviado para ${email}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleCopy = () => {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center">
              <UserPlus size={18} className="text-blue-600" />
            </div>
            <h3 className="text-base font-black text-gray-900">Convidar Membro</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 transition-colors">
            <XCircle size={18} />
          </button>
        </div>

        {inviteUrl ? (
          /* Success state */
          <div className="p-6 space-y-4">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                <CheckCircle2 size={28} className="text-green-600" />
              </div>
              <p className="font-bold text-gray-900">Convite enviado!</p>
              <p className="text-sm text-gray-500">
                Se o email não chegar, compartilhe o link abaixo diretamente.
              </p>
            </div>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl p-3">
              <span className="text-xs text-gray-500 truncate flex-1">{inviteUrl}</span>
              <button onClick={handleCopy} className="shrink-0 p-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
            <button
              onClick={() => onSuccess(inviteUrl)}
              className="w-full bg-blue-600 text-white rounded-xl py-3 text-sm font-bold hover:bg-blue-700 transition-all"
            >
              Fechar
            </button>
          </div>
        ) : (
          /* Form */
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Email do convidado</label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                <input
                  type="email"
                  placeholder="nome@exemplo.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoFocus
                  className="w-full pl-9 pr-4 py-3 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Perfil / Função</label>
              <div className="grid grid-cols-2 gap-2">
                {availableRoles.map(r => {
                  const meta = ROLE_META[r];
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className={clsx(
                        'py-2.5 px-3 rounded-xl border text-xs font-bold transition-all text-left flex items-center gap-2',
                        role === r
                          ? `${meta.bg} ${meta.color} border-current ring-2 ring-offset-1 ring-current/30`
                          : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'
                      )}
                    >
                      <Shield size={12} />
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                <XCircle size={14} className="shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={sending || !email.trim()}
              className="w-full bg-blue-600 text-white rounded-xl py-3 text-sm font-bold hover:bg-blue-700 transition-all shadow-sm shadow-blue-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {sending ? <><Loader2 size={16} className="animate-spin" /> Enviando...</> : <><Mail size={16} /> Enviar Convite</>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, message }: { icon: any; message: string }) {
  return (
    <div className="py-12 text-center">
      <Icon className="w-10 h-10 mx-auto text-gray-300 mb-2" />
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  );
}
