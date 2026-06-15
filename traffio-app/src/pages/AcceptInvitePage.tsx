import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Activity, Mail, Lock, Loader2, User, Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

const ROLE_LABELS: Record<string, string> = {
  admin:     'Administrador',
  manager:   'Gerente',
  doctor:    'Profissional de Saúde',
  attendant: 'Atendente',
  staff:     'Auxiliar',
};

const ROLE_COLORS: Record<string, string> = {
  admin:     'bg-blue-100 text-blue-700',
  manager:   'bg-indigo-100 text-indigo-700',
  doctor:    'bg-green-100 text-green-700',
  attendant: 'bg-amber-100 text-amber-700',
  staff:     'bg-gray-100 text-gray-600',
};

export const AcceptInvitePage = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [step, setStep]             = useState<'loading' | 'form' | 'success' | 'error'>('loading');
  const [invite, setInvite]         = useState<any>(null);
  const [errorMsg, setErrorMsg]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPass, setShowPass]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [form, setForm] = useState({ full_name: '', password: '', confirmPassword: '' });
  const [formErrors, setFormErrors] = useState({ full_name: '', password: '' });

  // ── Carregar dados do convite ──────────────────────────────────────────────
  useEffect(() => {
    if (!token) {
      setErrorMsg('Link de convite inválido.');
      setStep('error');
      return;
    }

    supabase
      .from('invitations')
      .select('id, email, role, status, expires_at, tenant_id, tenants(name, logo_url)')
      .eq('token', token)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) {
          setErrorMsg('Convite não encontrado. Verifique o link e tente novamente.');
          setStep('error');
          return;
        }

        if (data.status === 'accepted') {
          setErrorMsg('Este convite já foi aceito. Faça login normalmente.');
          setStep('error');
          return;
        }

        if (data.status === 'revoked') {
          setErrorMsg('Este convite foi revogado. Solicite um novo convite ao administrador.');
          setStep('error');
          return;
        }

        if (data.status === 'expired' || new Date(data.expires_at) < new Date()) {
          setErrorMsg('Este convite expirou. Solicite um novo convite ao administrador.');
          setStep('error');
          return;
        }

        setInvite(data);
        setStep('form');
      });
  }, [token]);

  const validate = () => {
    const errs = { full_name: '', password: '' };
    let ok = true;

    if (!form.full_name.trim()) {
      errs.full_name = 'Nome completo é obrigatório.';
      ok = false;
    }
    if (form.password.length < 6) {
      errs.password = 'A senha deve ter no mínimo 6 caracteres.';
      ok = false;
    } else if (form.password !== form.confirmPassword) {
      errs.password = 'As senhas não conferem.';
      ok = false;
    }

    setFormErrors(errs);
    return ok;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || !token) return;

    setSubmitting(true);
    setErrorMsg('');

    try {
      const { data, error } = await supabase.functions.invoke('accept-invite', {
        body: {
          token,
          full_name: form.full_name.trim(),
          password:  form.password,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      // Auto-login se a função retornou session
      if (data?.session) {
        await supabase.auth.setSession({
          access_token:  data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
      } else {
        // Usuário já existia — fazer login normalmente
        const { error: loginError } = await supabase.auth.signInWithPassword({
          email:    invite.email,
          password: form.password,
        });
        if (loginError) {
          // Login manual necessário
          setStep('success');
          return;
        }
      }

      // Remove o token de sessão antigo para forçar o registro de uma nova sessão no dashboard (Last Login Wins)
      localStorage.removeItem('traffio_session_token');

      setStep('success');
      setTimeout(() => navigate('/dashboard'), 2500);

    } catch (err: any) {
      setErrorMsg(err.message ?? 'Erro ao aceitar convite. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render: Loading ────────────────────────────────────────────────────────
  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  // ── Render: Erro ──────────────────────────────────────────────────────────
  if (step === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-white flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-red-100 p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-xl font-black text-gray-900">Convite Inválido</h2>
          <p className="text-sm text-gray-500 leading-relaxed">{errorMsg}</p>
          <a href="/login" className="inline-block mt-2 text-sm text-blue-600 font-semibold hover:underline">
            Ir para o Login →
          </a>
        </div>
      </div>
    );
  }

  // ── Render: Sucesso ───────────────────────────────────────────────────────
  if (step === 'success') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-white flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-green-100 p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-green-500" />
          </div>
          <h2 className="text-xl font-black text-gray-900">Conta Criada!</h2>
          <p className="text-sm text-gray-500">
            Bem-vindo(a) à <strong>{(invite?.tenants as any)?.name ?? 'clínica'}</strong>!<br />
            Você será redirecionado para o painel em instantes...
          </p>
          <Loader2 className="w-5 h-5 text-green-500 animate-spin mx-auto" />
        </div>
      </div>
    );
  }

  // ── Render: Formulário ────────────────────────────────────────────────────
  const tenantName = (invite?.tenants as any)?.name ?? 'sua clínica';
  const roleLabel  = ROLE_LABELS[invite?.role] ?? invite?.role;
  const roleColor  = ROLE_COLORS[invite?.role] ?? 'bg-gray-100 text-gray-600';

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Card */}
        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-7 text-white text-center">
            <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center mx-auto mb-3">
              <Activity className="w-7 h-7" />
            </div>
            <p className="text-sm font-medium opacity-80">Você foi convidado para</p>
            <h1 className="text-xl font-black mt-0.5">{tenantName}</h1>
            <span className={`inline-block mt-2 px-3 py-1 rounded-full text-xs font-bold bg-white/20 text-white`}>
              {roleLabel}
            </span>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="px-8 py-7 space-y-5">
            <p className="text-sm text-gray-500 text-center -mt-1">
              Complete seu cadastro para começar
            </p>

            {/* Email (read-only) */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Email</label>
              <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-500">
                <Mail className="w-4 h-4 shrink-0 text-gray-400" />
                <span className="truncate">{invite?.email}</span>
              </div>
            </div>

            {/* Nome completo */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Nome Completo</label>
              <div className="relative">
                <User className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Seu nome completo"
                  value={form.full_name}
                  onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                  className="w-full pl-9 pr-4 py-3 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  autoFocus
                />
              </div>
              {formErrors.full_name && (
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle size={11} /> {formErrors.full_name}
                </p>
              )}
            </div>

            {/* Senha */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Senha</label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                <input
                  type={showPass ? 'text' : 'password'}
                  placeholder="Mínimo 6 caracteres"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="w-full pl-9 pr-10 py-3 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
                <button type="button" onClick={() => setShowPass(p => !p)}
                  className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Confirmar senha */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Confirmar Senha</label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                <input
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="Repita a senha"
                  value={form.confirmPassword}
                  onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))}
                  className="w-full pl-9 pr-10 py-3 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
                <button type="button" onClick={() => setShowConfirm(p => !p)}
                  className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {formErrors.password && (
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle size={11} /> {formErrors.password}
                </p>
              )}
            </div>

            {/* Erro global */}
            {errorMsg && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                <AlertCircle size={14} className="shrink-0" />
                {errorMsg}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl py-3.5 text-sm font-bold hover:from-blue-700 hover:to-indigo-700 transition-all shadow-lg shadow-blue-500/25 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {submitting
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Criando conta...</>
                : 'Aceitar Convite e Entrar'}
            </button>

            <p className="text-center text-xs text-gray-400">
              Já tem conta?{' '}
              <a href="/login" className="text-blue-600 font-semibold hover:underline">
                Fazer login
              </a>
            </p>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          Traffio — Gestão Inteligente para Clínicas
        </p>
      </div>
    </div>
  );
};
