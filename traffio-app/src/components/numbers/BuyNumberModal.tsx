import React, { useState } from 'react';
import {
  X, Hash, RefreshCw, ChevronRight, ChevronLeft,
  Phone, FileText, User, Building2, CheckCheck, Info,
  Bug, ChevronDown, ChevronUp, Copy, Check,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  getCountryRequirement, DOCUMENT_LABELS,
  type DocumentType, type HolderType,
} from '../../constants/numberOrderRequirements';
import { DocumentUploadField } from './DocumentUploadField';
import {
  validateCPF, validateCNPJ,
  formatCPF, formatCNPJ, formatZip,
} from '../../lib/validators/brazilianDocs';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

interface AvailableNumber {
  phoneNumber: string;
  city:        string;
  regionCode:  string;
  countryCode: string;
  monthlyCost: string;
  features:    string[];
}

interface DiagEntry {
  ts:      string;
  level:   'info' | 'warn' | 'error' | 'ok';
  message: string;
  data?:   unknown;
}

interface Props {
  tenantId:    string;
  onClose:     () => void;
  onPurchased: (phoneNumber: string) => void;
  showToast:   (type: 'success' | 'error', msg: string) => void;
}

type Step = 1 | 2 | 3 | 4;

const COUNTRY_FLAGS: Record<string, string> = {
  BR: '🇧🇷', US: '🇺🇸', CA: '🇨🇦', GB: '🇬🇧',
  AU: '🇦🇺', MX: '🇲🇽', NZ: '🇳🇿', AR: '🇦🇷',
  CO: '🇨🇴', PT: '🇵🇹', ES: '🇪🇸',
};

export function BuyNumberModal({ tenantId, onClose, onPurchased, showToast }: Props) {
  const [step, setStep]               = useState<Step>(1);
  const [country, setCountry]         = useState('BR');
  const [ndc, setNdc]                 = useState('');
  const [friendlyName, setFriendlyName] = useState('');
  const [results, setResults]         = useState<AvailableNumber[]>([]);
  const [searching, setSearching]     = useState(false);
  const [selected, setSelected]       = useState<AvailableNumber | null>(null);

  const [holderType, setHolderType]   = useState<HolderType>('individual');
  const [holderInfo, setHolderInfo]   = useState<Record<string, string>>({});
  const [holderErrors, setHolderErrors] = useState<Record<string, string>>({});

  const [orderId, setOrderId]         = useState<string | null>(null);
  const [uploadedDocs, setUploadedDocs] = useState<Record<DocumentType, { name: string; path: string } | null>>({} as any);

  const [submitting, setSubmitting]   = useState(false);
  const [done, setDone]               = useState(false);

  // ── Diagnóstico ─────────────────────────────────────────────────────────────
  const [diagLogs, setDiagLogs]       = useState<DiagEntry[]>([]);
  const [diagOpen, setDiagOpen]       = useState(false);
  const [diagRaw, setDiagRaw]         = useState<unknown>(null);
  const [copied, setCopied]           = useState(false);

  const log = (level: DiagEntry['level'], message: string, data?: unknown) => {
    const entry: DiagEntry = { ts: new Date().toISOString().slice(11, 23), level, message, data };
    console[level === 'ok' ? 'log' : level](`[TelnyxDiag ${entry.ts}] ${message}`, data ?? '');
    setDiagLogs((prev) => [...prev, entry]);
  };

  const req = getCountryRequirement(country);
  const requiredDocs: DocumentType[] = req.needsDocs ? (req.requiredDocs[holderType] ?? []) : [];
  const allDocsUploaded = requiredDocs.every((d) => uploadedDocs[d]);

  const getSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  };

  // ── Busca com diagnóstico completo ───────────────────────────────────────────
  const searchNumbers = async () => {
    setSearching(true);
    setResults([]);
    setDiagLogs([]);
    setDiagRaw(null);

    const t0 = Date.now();
    log('info', `Iniciando busca — país: ${country}, DDD: ${ndc || '(todos)'}`);

    try {
      const session = await getSession();
      if (!session) {
        log('error', 'Sem sessão autenticada. Faça login novamente.');
        return;
      }
      log('ok', `Sessão OK — user: ${session.user.email}`);

      const ndcParam = ndc.trim() ? `&ndc=${encodeURIComponent(ndc.trim())}` : '';
      const url = `${SUPABASE_URL}/functions/v1/telnyx-numbers?action=search&country=${country}&limit=20${ndcParam}`;
      log('info', `GET ${url}`);

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      const elapsed = Date.now() - t0;
      log('info', `Resposta: HTTP ${res.status} em ${elapsed}ms`);

      let json: any;
      const rawText = await res.text();
      try {
        json = JSON.parse(rawText);
      } catch {
        log('error', 'Resposta não é JSON válido', rawText.slice(0, 500));
        setDiagOpen(true);
        showToast('error', 'Resposta inválida do servidor');
        return;
      }

      setDiagRaw(json);
      log('info', 'Resposta JSON completa salva em "Raw Response" abaixo');

      if (!res.ok) {
        log('error', `Servidor retornou ${res.status}: ${json.error ?? rawText.slice(0, 200)}`);
        setDiagOpen(true);
        showToast('error', json.error ?? `Erro ${res.status}`);
        return;
      }

      if (json.error) {
        log('error', `Erro da Edge Function: ${json.error}`);
        setDiagOpen(true);
        showToast('error', json.error);
        return;
      }

      const rawNumbers: AvailableNumber[] = json.data ?? [];
      log('info', `Total retornado pela API: ${rawNumbers.length} números`);

      if (rawNumbers.length === 0) {
        log('warn', `Nenhum número disponível para ${country}${ndc ? ` DDD ${ndc}` : ''}`);
        if (json.message) log('info', `Mensagem da API: ${json.message}`);
        setDiagOpen(true);
        return;
      }

      // Inspecionar formato dos números
      const masked  = rawNumbers.filter((n) => n.phoneNumber?.includes('-'));
      const valid   = rawNumbers.filter((n) => n.phoneNumber && !n.phoneNumber.includes('-'));
      log('info', `Números com formato E.164 válido: ${valid.length}`);
      if (masked.length > 0) {
        log('warn', `Números mascarados (placeholders não-compráveis): ${masked.length}`, masked.map((n) => n.phoneNumber));
        setDiagOpen(true);
      }

      // Deduplicar por phoneNumber
      const uniqueMap = new Map<string, AvailableNumber>();
      for (const n of valid) uniqueMap.set(n.phoneNumber, n);
      const deduped = Array.from(uniqueMap.values());

      if (deduped.length < valid.length) {
        log('warn', `Removidos ${valid.length - deduped.length} duplicatas`);
      }

      log('ok', `Exibindo ${deduped.length} números válidos`);
      setResults(deduped);

      if (deduped.length === 0 && masked.length > 0) {
        log('error', 'Todos os números retornados são placeholders mascarados. A Telnyx não tem números compráveis para esta combinação de país/DDD.');
        showToast('error', `Nenhum número disponível para compra em ${country}${ndc ? ` DDD ${ndc}` : ''}. Tente outro país ou DDD.`);
      }

    } catch (err: any) {
      log('error', `Exceção não tratada: ${err.message}`, err.stack);
      setDiagOpen(true);
      showToast('error', `Erro inesperado: ${err.message}`);
    } finally {
      setSearching(false);
    }
  };

  const selectNumber = (num: AvailableNumber) => {
    setSelected(num);
    if (!req.needsDocs) setStep(4);
    else setStep(2);
  };

  const validateHolder = (): boolean => {
    const errors: Record<string, string> = {};
    if (!holderInfo.full_name && holderType === 'individual') errors.full_name = 'Nome obrigatório';
    if (!holderInfo.company_name && holderType === 'business') errors.company_name = 'Razão social obrigatória';

    if (holderType === 'individual') {
      if (!holderInfo.cpf) errors.cpf = 'CPF obrigatório';
      else if (!validateCPF(holderInfo.cpf)) errors.cpf = 'CPF inválido';
    } else {
      if (!holderInfo.cnpj) errors.cnpj = 'CNPJ obrigatório';
      else if (!validateCNPJ(holderInfo.cnpj)) errors.cnpj = 'CNPJ inválido';
    }

    if (!holderInfo.address_street)  errors.address_street  = 'Endereço obrigatório';
    if (!holderInfo.address_city)    errors.address_city    = 'Cidade obrigatória';
    if (!holderInfo.address_zip)     errors.address_zip     = 'CEP obrigatório';

    setHolderErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const goToDocuments = async () => {
    if (!validateHolder()) return;
    if (!orderId) {
      const session = await getSession();
      if (!session) return;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/telnyx-number-orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:        'create_order',
          phone_number:  selected!.phoneNumber,
          country_code:  country,
          holder_type:   holderType,
          holder_info:   holderInfo,
          friendly_name: friendlyName || undefined,
        }),
      });
      const json = await res.json();
      if (json.error) { showToast('error', json.error); return; }
      if (json.data?.instant) {
        showToast('success', `Número ${selected!.phoneNumber} adquirido com sucesso!`);
        onPurchased(selected!.phoneNumber);
        onClose();
        return;
      }
      setOrderId(json.data.order_id);
    }
    setStep(3);
  };

  const submitOrder = async () => {
    if (!orderId) return;
    setSubmitting(true);
    try {
      const session = await getSession();
      if (!session) return;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/telnyx-number-orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit_docs', order_id: orderId }),
      });
      const json = await res.json();
      if (json.error) { showToast('error', json.error); return; }
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  };

  const purchaseImmediate = async () => {
    setSubmitting(true);
    try {
      const session = await getSession();
      if (!session) return;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/telnyx-number-orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:        'create_order',
          phone_number:  selected!.phoneNumber,
          country_code:  country,
          friendly_name: friendlyName || undefined,
        }),
      });
      const json = await res.json();
      if (json.error) {
        showToast('error', json.error);
        return;
      }
      showToast('success', `Número ${selected!.phoneNumber} adquirido com sucesso!`);
      onPurchased(selected!.phoneNumber);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const field = (key: string, label: string, placeholder: string, formatter?: (v: string) => string, type = 'text') => (
    <div>
      <label className="text-[10px] font-black text-graphite-400 uppercase tracking-wide">{label}</label>
      <input
        type={type}
        value={holderInfo[key] ?? ''}
        onChange={(e) => {
          const v = formatter ? formatter(e.target.value) : e.target.value;
          setHolderInfo((h) => ({ ...h, [key]: v }));
          if (holderErrors[key]) setHolderErrors((e) => { const c = { ...e }; delete c[key]; return c; });
        }}
        placeholder={placeholder}
        className={`w-full mt-1 bg-ice-50 border rounded-xl px-3 py-2 text-sm text-graphite-700 focus:outline-none focus:border-brand-primary ${holderErrors[key] ? 'border-red-300' : 'border-ice-200'}`}
      />
      {holderErrors[key] && <p className="text-[10px] text-red-500 mt-0.5">{holderErrors[key]}</p>}
    </div>
  );

  const STEPS = req.needsDocs
    ? ['Buscar', 'Titular', 'Documentos', 'Confirmar']
    : ['Buscar', 'Confirmar'];

  const displayStep = req.needsDocs ? step : (step === 4 ? 2 : 1);

  const diagLevelColor: Record<DiagEntry['level'], string> = {
    info:  'text-graphite-400',
    ok:    'text-green-600',
    warn:  'text-yellow-600',
    error: 'text-red-500',
  };

  const hasErrors = diagLogs.some((e) => e.level === 'error');
  const hasWarns  = diagLogs.some((e) => e.level === 'warn');

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-ice-100 shrink-0">
          <div>
            <h2 className="text-base font-black text-graphite-800">Comprar Número</h2>
            {selected && (
              <p className="text-xs text-graphite-400 mt-0.5 font-mono">{selected.phoneNumber}</p>
            )}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-ice-100 rounded-xl transition-colors border-none cursor-pointer bg-transparent">
            <X size={18} className="text-graphite-400" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-6 py-3 flex items-center gap-2 border-b border-ice-50 shrink-0">
          {STEPS.map((label, i) => {
            const stepNum = i + 1;
            const active  = displayStep === stepNum;
            const done_s  = displayStep > stepNum;
            return (
              <React.Fragment key={label}>
                <div className={`flex items-center gap-1.5 text-[11px] font-bold transition-colors ${active ? 'text-brand-primary' : done_s ? 'text-green-500' : 'text-graphite-300'}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${active ? 'bg-brand-primary text-white' : done_s ? 'bg-green-100 text-green-600' : 'bg-ice-100 text-graphite-300'}`}>
                    {done_s ? '✓' : stepNum}
                  </span>
                  {label}
                </div>
                {i < STEPS.length - 1 && <div className="flex-1 h-px bg-ice-100" />}
              </React.Fragment>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {/* ETAPA 1 — Busca */}
          {step === 1 && (
            <>
              <div>
                <label className="text-[10px] font-black text-graphite-400 uppercase tracking-wide">Nome amigável (opcional)</label>
                <input
                  value={friendlyName}
                  onChange={(e) => setFriendlyName(e.target.value)}
                  placeholder="Ex: Recepção, WhatsApp, Suporte..."
                  className="w-full mt-1 bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm text-graphite-700 focus:outline-none focus:border-brand-primary"
                />
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[10px] font-black text-graphite-400 uppercase tracking-wide">País</label>
                  <select
                    value={country}
                    onChange={(e) => { setCountry(e.target.value); setNdc(''); setResults([]); setSelected(null); setDiagLogs([]); }}
                    className="w-full mt-1 bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm text-graphite-700 focus:outline-none focus:border-brand-primary"
                  >
                    {Object.entries(COUNTRY_FLAGS).map(([code, flag]) => (
                      <option key={code} value={code}>{flag} {code}</option>
                    ))}
                  </select>
                </div>
                <div style={{ width: 90 }}>
                  <label className="text-[10px] font-black text-graphite-400 uppercase tracking-wide">DDD</label>
                  <input
                    value={ndc}
                    onChange={(e) => setNdc(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={(e) => e.key === 'Enter' && searchNumbers()}
                    placeholder="ex: 41"
                    maxLength={5}
                    className="w-full mt-1 bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm font-mono text-graphite-700 focus:outline-none focus:border-brand-primary"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={searchNumbers}
                    disabled={searching}
                    className="px-4 py-2 bg-brand-primary text-white text-sm font-bold rounded-xl hover:bg-brand-primary/90 disabled:opacity-50 border-none cursor-pointer flex items-center gap-2"
                  >
                    {searching ? <RefreshCw size={14} className="animate-spin" /> : <Hash size={14} />}
                    Buscar
                  </button>
                </div>
              </div>

              {req.needsDocs && (
                <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-xl">
                  <Info size={14} className="text-yellow-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-yellow-700">
                    <strong>Validação necessária:</strong> {req.notes} Você precisará enviar documentos antes da ativação.
                  </p>
                </div>
              )}

              {searching && (
                <div className="flex flex-col items-center py-8 gap-2">
                  <RefreshCw size={22} className="animate-spin text-brand-primary" />
                  <p className="text-sm text-graphite-400">Buscando números disponíveis...</p>
                </div>
              )}

              {!searching && results.length === 0 && diagLogs.length === 0 && (
                <div className="text-center py-8 text-graphite-300">
                  <Hash size={30} className="mx-auto mb-2 opacity-40" />
                  <p className="text-sm font-bold">Selecione um país e clique em Buscar</p>
                </div>
              )}

              <div className="space-y-2">
                {results.map((num, idx) => {
                  const hasSms   = num.features.includes('sms');
                  const hasVoice = num.features.includes('voice');
                  return (
                    <button
                      key={`${num.phoneNumber}-${idx}`}
                      onClick={() => selectNumber(num)}
                      className="w-full flex items-center justify-between p-3 bg-ice-50 border border-ice-100 rounded-2xl hover:border-brand-primary/50 hover:bg-brand-primary/5 transition-all cursor-pointer text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-black text-graphite-800 font-mono">{num.phoneNumber}</p>
                        <p className="text-xs text-graphite-400 mt-0.5">
                          {num.city || num.regionCode || num.countryCode}
                        </p>
                        <div className="flex gap-1 mt-1">
                          {hasVoice && (
                            <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-bold rounded-full">Voz</span>
                          )}
                          {hasSms ? (
                            <span className="px-1.5 py-0.5 bg-green-50 text-green-600 text-[10px] font-bold rounded-full">SMS</span>
                          ) : (
                            <span className="px-1.5 py-0.5 bg-yellow-50 text-yellow-600 text-[10px] font-bold rounded-full">Sem SMS</span>
                          )}
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-brand-primary shrink-0 ml-2" />
                    </button>
                  );
                })}
              </div>

              {/* ── Painel de Diagnóstico ───────────────────────────────────── */}
              {diagLogs.length > 0 && (
                <div className={`rounded-2xl border overflow-hidden ${hasErrors ? 'border-red-200 bg-red-50' : hasWarns ? 'border-yellow-200 bg-yellow-50' : 'border-graphite-100 bg-graphite-50'}`}>
                  <div className="flex items-center justify-between px-3 py-2">
                    <button
                      onClick={() => setDiagOpen((o) => !o)}
                      className="flex items-center gap-1.5 border-none cursor-pointer bg-transparent p-0"
                    >
                      <span className={`flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide ${hasErrors ? 'text-red-500' : hasWarns ? 'text-yellow-600' : 'text-graphite-400'}`}>
                        <Bug size={12} />
                        Diagnóstico
                        {hasErrors && <span className="bg-red-100 text-red-500 rounded-full px-1.5">erro</span>}
                        {!hasErrors && hasWarns && <span className="bg-yellow-100 text-yellow-600 rounded-full px-1.5">aviso</span>}
                      </span>
                      {diagOpen ? <ChevronUp size={14} className="text-graphite-400 ml-1" /> : <ChevronDown size={14} className="text-graphite-400 ml-1" />}
                    </button>
                    <button
                      onClick={() => {
                        const lines = diagLogs.map((e) => `[${e.ts}] ${e.level.toUpperCase().padEnd(5)} ${e.message}`).join('\n');
                        const raw   = diagRaw !== null ? '\n\n--- Raw Response ---\n' + JSON.stringify(diagRaw, null, 2) : '';
                        navigator.clipboard.writeText(lines + raw);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      title="Copiar log"
                      className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border-none cursor-pointer transition-colors ${copied ? 'bg-green-100 text-green-600' : 'bg-white/60 text-graphite-400 hover:text-graphite-600'}`}
                    >
                      {copied ? <Check size={11} /> : <Copy size={11} />}
                      {copied ? 'Copiado!' : 'Copiar'}
                    </button>
                  </div>

                  {diagOpen && (
                    <div className="px-3 pb-3 space-y-3">
                      {/* Log lines */}
                      <div className="bg-graphite-900 rounded-xl p-3 font-mono text-[10px] space-y-0.5 max-h-48 overflow-y-auto">
                        {diagLogs.map((e, i) => (
                          <div key={i} className={`flex gap-2 ${diagLevelColor[e.level]}`}>
                            <span className="text-graphite-500 shrink-0">{e.ts}</span>
                            <span className={`shrink-0 uppercase font-black w-8 ${e.level === 'error' ? 'text-red-400' : e.level === 'warn' ? 'text-yellow-400' : e.level === 'ok' ? 'text-green-400' : 'text-graphite-400'}`}>
                              {e.level}
                            </span>
                            <span className="text-graphite-200 break-all">{e.message}</span>
                          </div>
                        ))}
                      </div>

                      {/* Raw response */}
                      {diagRaw !== null && (
                        <div>
                          <p className="text-[10px] font-black text-graphite-400 uppercase tracking-wide mb-1">Raw Response</p>
                          <pre className="bg-graphite-900 text-green-300 rounded-xl p-3 text-[10px] overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
                            {JSON.stringify(diagRaw, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ETAPA 2 — Dados do Titular */}
          {step === 2 && (
            <>
              <div className="flex gap-2">
                {(['individual', 'business'] as HolderType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setHolderType(t)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold border-2 transition-all cursor-pointer ${holderType === t ? 'border-brand-primary bg-brand-primary/5 text-brand-primary' : 'border-ice-200 bg-ice-50 text-graphite-500'}`}
                  >
                    {t === 'individual' ? <User size={15} /> : <Building2 size={15} />}
                    {t === 'individual' ? 'Pessoa Física' : 'Pessoa Jurídica'}
                  </button>
                ))}
              </div>

              {holderType === 'individual' ? (
                <div className="space-y-3">
                  {field('full_name', 'Nome completo', 'João da Silva')}
                  {field('cpf', 'CPF', '000.000.000-00', formatCPF)}
                  {field('email', 'E-mail', 'joao@email.com', undefined, 'email')}
                  {field('phone', 'Telefone pessoal', '+55 (41) 99999-9999')}
                </div>
              ) : (
                <div className="space-y-3">
                  {field('company_name', 'Razão social', 'Empresa LTDA')}
                  {field('cnpj', 'CNPJ', '00.000.000/0001-00', formatCNPJ)}
                  {field('full_name', 'Nome do responsável', 'João da Silva')}
                  {field('email', 'E-mail corporativo', 'contato@empresa.com', undefined, 'email')}
                  {field('phone', 'Telefone corporativo', '+55 (41) 3333-3333')}
                </div>
              )}

              <div className="border-t border-ice-100 pt-3 space-y-3">
                <p className="text-[10px] font-black text-graphite-400 uppercase tracking-wide">Endereço</p>
                <div className="flex gap-2">
                  <div className="flex-1">{field('address_street', 'Rua', 'Av. Paulista')}</div>
                  <div style={{ width: 80 }}>{field('address_number', 'Número', '100')}</div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">{field('address_city', 'Cidade', 'São Paulo')}</div>
                  <div style={{ width: 60 }}>{field('address_state', 'Estado', 'SP')}</div>
                </div>
                {field('address_zip', 'CEP', '01310-100', formatZip)}
              </div>
            </>
          )}

          {/* ETAPA 3 — Documentos */}
          {step === 3 && orderId && (
            <div className="space-y-4">
              <p className="text-xs text-graphite-500">
                Envie os documentos abaixo para validar o pedido. Máx. 10 MB por arquivo (PDF, JPG ou PNG).
              </p>
              {requiredDocs.map((docType) => (
                <DocumentUploadField
                  key={docType}
                  documentType={docType}
                  tenantId={tenantId}
                  orderId={orderId}
                  uploadedFile={uploadedDocs[docType] ?? null}
                  onUploaded={(path, name) => setUploadedDocs((d) => ({ ...d, [docType]: { path, name } }))}
                  onRemove={() => setUploadedDocs((d) => { const c = { ...d }; delete c[docType]; return c; })}
                />
              ))}
            </div>
          )}

          {/* ETAPA 4 — Confirmação */}
          {step === 4 && !done && (
            <div className="space-y-4">
              <div className="p-4 bg-ice-50 border border-ice-200 rounded-2xl space-y-2">
                <p className="text-[10px] font-black text-graphite-400 uppercase tracking-wide">Número selecionado</p>
                <p className="text-lg font-black text-graphite-800 font-mono">{selected?.phoneNumber}</p>
                <p className="text-xs text-graphite-400">
                  {COUNTRY_FLAGS[country]} {country}
                  {selected?.city && ` · ${selected.city}`}
                  {selected?.features.includes('voice') && ' · Voz'}
                  {selected?.features.includes('sms') && ' · SMS'}
                </p>
              </div>

              {req.needsDocs ? (
                <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                  <Info size={14} className="text-blue-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-blue-700">
                    Seus documentos serão analisados em até <strong>{req.processingDays} dias úteis</strong>.
                    Você receberá uma notificação quando o número for ativado.
                  </p>
                </div>
              ) : (
                <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-xl">
                  <CheckCheck size={14} className="text-green-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-green-700">
                    Nenhuma documentação necessária. O número será ativado em instantes.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Concluído */}
          {done && (
            <div className="flex flex-col items-center py-8 gap-3 text-center">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCheck size={28} className="text-green-500" />
              </div>
              <div>
                <p className="font-black text-graphite-800">Pedido enviado!</p>
                <p className="text-sm text-graphite-400 mt-1">
                  Análise em até <strong>{req.processingDays} dias úteis</strong>.<br />
                  Você será notificado quando o número for ativado.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!done && (
          <div className="px-6 py-4 border-t border-ice-100 flex items-center justify-between shrink-0">
            <button
              onClick={() => step > 1 ? setStep((s) => (s - 1) as Step) : onClose()}
              className="flex items-center gap-1.5 text-sm text-graphite-400 hover:text-graphite-600 transition-colors border-none cursor-pointer bg-transparent"
            >
              <ChevronLeft size={16} />
              {step === 1 ? 'Cancelar' : 'Voltar'}
            </button>

            {step === 1 && selected && (
              <button
                onClick={() => req.needsDocs ? setStep(2) : setStep(4)}
                className="flex items-center gap-2 px-5 py-2 bg-brand-primary text-white text-sm font-bold rounded-xl hover:bg-brand-primary/90 transition-colors border-none cursor-pointer"
              >
                Continuar <ChevronRight size={16} />
              </button>
            )}

            {step === 2 && (
              <button
                onClick={goToDocuments}
                className="flex items-center gap-2 px-5 py-2 bg-brand-primary text-white text-sm font-bold rounded-xl hover:bg-brand-primary/90 transition-colors border-none cursor-pointer"
              >
                Próximo: Documentos <ChevronRight size={16} />
              </button>
            )}

            {step === 3 && (
              <button
                onClick={() => setStep(4)}
                disabled={!allDocsUploaded}
                className="flex items-center gap-2 px-5 py-2 bg-brand-primary text-white text-sm font-bold rounded-xl hover:bg-brand-primary/90 disabled:opacity-50 transition-colors border-none cursor-pointer"
              >
                Revisar pedido <ChevronRight size={16} />
              </button>
            )}

            {step === 4 && !req.needsDocs && (
              <button
                onClick={purchaseImmediate}
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2 bg-brand-primary text-white text-sm font-bold rounded-xl hover:bg-brand-primary/90 disabled:opacity-50 transition-colors border-none cursor-pointer"
              >
                {submitting ? <RefreshCw size={14} className="animate-spin" /> : <Phone size={14} />}
                Comprar número
              </button>
            )}

            {step === 4 && req.needsDocs && (
              <button
                onClick={submitOrder}
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2 bg-brand-primary text-white text-sm font-bold rounded-xl hover:bg-brand-primary/90 disabled:opacity-50 transition-colors border-none cursor-pointer"
              >
                {submitting ? <RefreshCw size={14} className="animate-spin" /> : <FileText size={14} />}
                Enviar para análise
              </button>
            )}
          </div>
        )}

        {done && (
          <div className="px-6 py-4 border-t border-ice-100 flex justify-end shrink-0">
            <button
              onClick={onClose}
              className="px-5 py-2 bg-graphite-100 text-graphite-700 text-sm font-bold rounded-xl hover:bg-graphite-200 transition-colors border-none cursor-pointer"
            >
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
