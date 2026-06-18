import React, { useState } from 'react';
import {
  X, Search, RefreshCw, ChevronRight, ChevronLeft,
  Phone, FileText, User, Building2, CheckCheck, Info,
  Bug, ChevronDown, ChevronUp, Copy, Check,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  getCountryRequirement,
  type DocumentType, type HolderType,
} from '../../constants/numberOrderRequirements';
import { DocumentUploadField } from './DocumentUploadField';
import {
  validateCPF, validateCNPJ,
  formatCPF, formatCNPJ, formatZip,
} from '../../lib/validators/brazilianDocs';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

interface AvailableNumber {
  phoneNumber:     string;
  city:            string;
  regionCode:      string;
  countryCode:     string;
  monthlyCost:     string;
  features:        string[];
  phoneNumberType: string;
}

// ── Requisitos regulatórios da Telnyx (formulário dinâmico) ──────────────────
interface RegulatoryRequirementType {
  id:          string;
  name:        string;
  type:        'textual' | 'address' | 'document';
  description: string;
  example:     string;
  acceptanceCriteria: {
    minLength?:            number;
    maxLength?:            number;
    acceptableValues?:     string[];
    acceptableCharacters?: string;
  };
}

interface RegulatoryAddress {
  firstName:          string;
  lastName:           string;
  businessName:       string;
  streetAddress:      string;
  locality:           string;
  administrativeArea: string;
  postalCode:         string;
}

const EMPTY_REGULATORY_ADDRESS: RegulatoryAddress = {
  firstName: '', lastName: '', businessName: '', streetAddress: '',
  locality: '', administrativeArea: '', postalCode: '',
};

function isAddressInCountry(addressStr: string, countryCode: string): boolean {
  const normalized = addressStr.toLowerCase();
  const code = countryCode.toUpperCase();
  if (code === 'NZ') {
    const nzKeywords = ['nz', 'new zealand', 'nova zelandia', 'nova zelândia', 'auckland', 'wellington', 'christchurch', 'hamilton', 'tauranga', 'dunedin'];
    return nzKeywords.some(kw => normalized.includes(kw));
  }
  if (code === 'BR') {
    const brKeywords = ['brasil', 'brazil', 'curitiba', 'são paulo', 'rio de janeiro', 'bh', 'porto alegre', 'fortaleza', 'recife', 'salvador'];
    return brKeywords.some(kw => normalized.includes(kw));
  }
  return normalized.includes(code.toLowerCase());
}

function parseAddressForSuggestion(
  addressStr: string | null | undefined,
  tenantName: string,
  contactName: string,
  countryCode: string
): RegulatoryAddress {
  const code = countryCode.toUpperCase();
  const nameParts = contactName.split(' ').map(p => p.trim()).filter(Boolean);
  const firstName = nameParts[0] || 'Clinic';
  const lastName = nameParts.slice(1).join(' ') || 'Owner';

  const nzDefault: RegulatoryAddress = {
    firstName,
    lastName,
    businessName: tenantName || 'Traffio Clinic',
    streetAddress: '101 Queen Street',
    locality: 'Auckland',
    administrativeArea: 'Auckland',
    postalCode: '1010',
  };

  const parsed: RegulatoryAddress = {
    firstName,
    lastName,
    businessName: tenantName || 'Traffio Clinic',
    streetAddress: 'Main Street 123',
    locality: 'Auckland',
    administrativeArea: 'Auckland',
    postalCode: '1010',
  };

  const defaultForCountry = code === 'NZ' ? nzDefault : parsed;

  if (addressStr && isAddressInCountry(addressStr, code)) {
    const parts = addressStr.split(/,|\u2014|-|;/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 1) parsed.streetAddress = parts[0];
    if (code === 'NZ') {
      if (parts.length >= 4) {
        parsed.locality = parts[1];
        parsed.administrativeArea = parts[2];
        parsed.postalCode = parts[3];
      } else {
        if (parts.length >= 2) parsed.locality = parts[1];
        if (parts.length >= 3) parsed.administrativeArea = parts[2];
      }
    } else {
      if (parts.length >= 2) parsed.locality = parts[1];
      if (parts.length >= 3) parsed.administrativeArea = parts[2];
      if (parts.length >= 4) parsed.postalCode = parts[3];
    }
    return parsed;
  }

  return defaultForCountry;
}

function parseContactInfo(value: string | null | undefined) {
  const safeVal = value || '';
  let contact = '';
  let business = '';
  let phone = '';

  const contactMatch = safeVal.match(/Contact:\s*([^|]+)/i);
  const businessMatch = safeVal.match(/Business:\s*([^|]+)/i);
  const phoneMatch = safeVal.match(/Phone:\s*([^|]+)/i);

  if (contactMatch) contact = contactMatch[1].trim();
  if (businessMatch) business = businessMatch[1].trim();
  if (phoneMatch) phone = phoneMatch[1].trim();

  // Se não bater no regex padrão, tentar split por pipe
  if (!contact && !business && !phone && safeVal) {
    const parts = safeVal.split('|').map(p => p.trim());
    if (parts.length >= 1) contact = parts[0];
    if (parts.length >= 2) business = parts[1];
    if (parts.length >= 3) phone = parts[2];
  }

  return { contact, business, phone };
}

function formatContactInfo(contact: string, business: string, phone: string): string {
  return `Contact: ${contact.trim()} | Business: ${business.trim() || 'N/A'} | Phone: ${phone.trim()}`;
}

type RegulatoryFieldValue =
  | { type: 'textual'; value: string }
  | { type: 'address'; address: RegulatoryAddress }
  | { type: 'document'; documentId?: string; fileName?: string };

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
  showToast:   (type: 'success' | 'error' | 'info' | 'warning', msg: string) => void;
  resubmitOrderId?: string;
}

type Step = 1 | 2 | 3 | 4 | 5;
type PhoneType = 'all' | 'local' | 'toll_free';
type SearchBy  = 'area_code' | 'city' | 'state';

const COUNTRY_FLAGS: Record<string, string> = {
  BR: '🇧🇷', US: '🇺🇸', CA: '🇨🇦', GB: '🇬🇧',
  AU: '🇦🇺', MX: '🇲🇽', NZ: '🇳🇿', AR: '🇦🇷',
  CO: '🇨🇴', PT: '🇵🇹', ES: '🇪🇸',
};

const SEARCH_BY_CONFIG: Record<SearchBy, { label: string; placeholder: string }> = {
  area_code: { label: 'Código de área / DDD', placeholder: 'Ex: 11, 415, 21...' },
  city:      { label: 'Cidade / Região',       placeholder: 'Ex: São Paulo, Auckland...' },
  state:     { label: 'Estado / Província',    placeholder: 'Ex: SP, CA, ON...' },
};

export function BuyNumberModal({ tenantId, onClose, onPurchased, showToast, resubmitOrderId }: Props) {
  const [step, setStep]               = useState<Step>(1);
  const [country, setCountry]         = useState('BR');
  const [phoneType, setPhoneType]     = useState<PhoneType>('all');
  const [searchBy, setSearchBy]       = useState<SearchBy>('area_code');
  const [searchValue, setSearchValue] = useState('');
  const [friendlyName, setFriendlyName] = useState('');
  const [results, setResults]         = useState<AvailableNumber[]>([]);
  const [searching, setSearching]     = useState(false);
  const [selected, setSelected]       = useState<AvailableNumber | null>(null);
  const [searched, setSearched]       = useState(false);

  const [holderType, setHolderType]   = useState<HolderType>('individual');
  const [holderInfo, setHolderInfo]   = useState<Record<string, string>>({});
  const [holderErrors, setHolderErrors] = useState<Record<string, string>>({});

  const [orderId, setOrderId]         = useState<string | null>(null);
  const [uploadedDocs, setUploadedDocs] = useState<Record<DocumentType, { name: string; path: string } | null>>({} as any);

  const [submitting, setSubmitting]   = useState(false);
  const [done, setDone]               = useState(false);

  // ── Requisitos regulatórios da Telnyx (etapa 5, países não-KYC) ────────────
  // Re-submissão de exigências (NZ, etc.)
  const [loadingResubmit, setLoadingResubmit] = useState(false);
  const [subNumberOrderId, setSubNumberOrderId] = useState<string | null>(null);

  // Requisitos regulatórios da Telnyx (formulário dinâmico)
  const [checkingRequirements, setCheckingRequirements] = useState(false);
  const [hasRegulatoryStep, setHasRegulatoryStep]       = useState(false);
  const [regulatoryRequirements, setRegulatoryRequirements] = useState<RegulatoryRequirementType[]>([]);
  const [regulatoryData, setRegulatoryData]           = useState<Record<string, RegulatoryFieldValue>>({});
  const [regulatoryErrors, setRegulatoryErrors]       = useState<Record<string, string>>({});
  // Tipo efetivo (local|national|toll_free|...) determinado pela Telnyx via
  // get_requirements — pode diferir do phoneNumberType do resultado de busca
  // (a Telnyx não informa o tipo em /available_phone_numbers).
  const [effectivePhoneNumberType, setEffectivePhoneNumberType] = useState('local');
  const [requiresReview, setRequiresReview] = useState(false);

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

  // Efeito para carregar exigências rejeitadas/pendentes em caso de re-submissão
  React.useEffect(() => {
    if (!resubmitOrderId) return;

    const loadResubmitDetails = async () => {
      setLoadingResubmit(true);
      try {
        const session = await getSession();
        if (!session) return;

        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/telnyx-number-orders?action=get_resubmit_details&order_id=${resubmitOrderId}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } }
        );
        const json = await res.json();
        if (json.error) {
          showToast('error', json.error);
          onClose();
          return;
        }

        const data = json.data;
        if (data) {
          setOrderId(data.order_id);
          setSubNumberOrderId(data.sub_number_order_id);
          setCountry(data.country_code);

          setSelected({
            phoneNumber: data.phone_number,
            city: '',
            regionCode: '',
            countryCode: data.country_code,
            monthlyCost: '0',
            features: ['voice', 'sms'],
            phoneNumberType: 'local',
          });

          const reqs = data.requirements || [];
          const initial: Record<string, RegulatoryFieldValue> = {};
          
          for (const r of reqs) {
            if (r.type === 'address') {
              const resAddr = data.resolved_addresses?.[r.id];
              initial[r.id] = {
                type: 'address',
                address: resAddr ? { ...EMPTY_REGULATORY_ADDRESS, ...resAddr } : { ...EMPTY_REGULATORY_ADDRESS }
              };
            } else if (r.type === 'document') {
              initial[r.id] = { type: 'document', documentId: r.field_value || undefined };
            } else {
              initial[r.id] = { type: 'textual', value: r.field_value || '' };
            }
          }

          setRegulatoryRequirements(reqs);
          setRegulatoryData(initial);
          setRegulatoryErrors({});
          setHasRegulatoryStep(true);
          setStep(5); // Pula direto para a etapa do formulário de exigências
        }
      } catch (err: any) {
        showToast('error', `Falha ao carregar detalhes do pedido: ${err.message}`);
        onClose();
      } finally {
        setLoadingResubmit(false);
      }
    };

    loadResubmitDetails();
  }, [resubmitOrderId]);

  // ── Descrição legível dos filtros ativos (para logs/toasts) ─────────────────
  const describeFilters = () => {
    const parts = [`país: ${country}`];
    if (phoneType !== 'all') parts.push(`tipo: ${phoneType === 'local' ? 'local' : 'toll-free'}`);
    const val = searchValue.trim();
    if (val) parts.push(`${SEARCH_BY_CONFIG[searchBy].label.toLowerCase()}: ${val}`);
    return parts.join(', ');
  };

  // ── Busca com diagnóstico completo ───────────────────────────────────────────
  const searchNumbers = async () => {
    setSearching(true);
    setResults([]);
    setDiagLogs([]);
    setDiagRaw(null);
    setSearched(false);

    const t0 = Date.now();
    log('info', `Iniciando busca — ${describeFilters()}`);

    try {
      const session = await getSession();
      if (!session) {
        log('error', 'Sem sessão autenticada. Faça login novamente.');
        return;
      }
      log('ok', `Sessão OK — user: ${session.user.email}`);

      const params = new URLSearchParams({ action: 'search', country, limit: '20' });
      if (phoneType !== 'all') params.set('type', phoneType);
      const val = searchValue.trim();
      if (val) {
        if (searchBy === 'area_code') params.set('ndc', val);
        else if (searchBy === 'city') params.set('locality', val);
        else if (searchBy === 'state') params.set('state', val);
      }
      const url = `${SUPABASE_URL}/functions/v1/telnyx-numbers?${params.toString()}`;
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
        log('warn', `Nenhum número disponível para ${describeFilters()}`);
        if (json.message) log('info', `Mensagem da API: ${json.message}`);
        setSearched(true);
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
      setSearched(true);

      if (deduped.length === 0 && masked.length > 0) {
        log('error', 'Todos os números retornados são placeholders mascarados. A Telnyx não tem números compráveis para esta combinação de filtros.');
        showToast('error', `Nenhum número disponível para compra (${describeFilters()}). Tente outros filtros.`);
      }

    } catch (err: any) {
      log('error', `Exceção não tratada: ${err.message}`, err.stack);
      setDiagOpen(true);
      showToast('error', `Erro inesperado: ${err.message}`);
    } finally {
      setSearching(false);
    }
  };

  const selectNumber = async (num: AvailableNumber) => {
    setSelected(num);
    if (req.needsDocs) { setStep(2); return; }
    await checkRegulatoryRequirements(num);
  };

  // Consulta a Telnyx para saber se este país/tipo exige dados regulatórios
  // (endereço, contato, documentos). Se o tenant já tiver um requirement_group
  // preenchido para essa combinação, ou se não houver exigências, segue direto
  // para a confirmação — totalmente silencioso.
  const checkRegulatoryRequirements = async (num: AvailableNumber) => {
    setCheckingRequirements(true);
    log('info', `Verificando requisitos regulatórios — país: ${country}, tipo (palpite): ${num.phoneNumberType || 'local'}`);
    try {
      const session = await getSession();
      if (!session) {
        log('error', 'Sem sessão autenticada ao verificar requisitos regulatórios.');
        setDiagOpen(true);
        setHasRegulatoryStep(false);
        setEffectivePhoneNumberType(num.phoneNumberType || 'local');
        setStep(4);
        return;
      }

      const params = new URLSearchParams({
        action: 'get_requirements',
        country,
        type:   num.phoneNumberType || 'local',
      });
      const res = await fetch(`${SUPABASE_URL}/functions/v1/telnyx-number-orders?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      log('info', `get_requirements → HTTP ${res.status}`);
      setDiagRaw(json);

      if (json.error) {
        log('error', `Não foi possível verificar requisitos regulatórios: ${json.error}`);
        setDiagOpen(true);
        setHasRegulatoryStep(false);
        setEffectivePhoneNumberType(num.phoneNumberType || 'local');
        setStep(4);
        return;
      }

      const requirements: RegulatoryRequirementType[] = json.data?.requirements ?? [];
      const cached = json.data?.cached ?? null;
      const effType = json.data?.phone_number_type || num.phoneNumberType || 'local';
      setEffectivePhoneNumberType(effType);

      log(
        requirements.length > 0 ? 'ok' : 'info',
        `Requisitos retornados pela Telnyx: ${requirements.length} | cache: ${cached ? 'encontrado' : 'nenhum'} | tipo efetivo: ${effType}`
      );
      if (requirements.length === 0) setDiagOpen(true);

      setRequiresReview(requirements.length > 0);
      
      if (requirements.length > 0) {
        // 1. Carregar dados do tenant e proprietário para sugestões de auto-complete
        let tenantInfo: any = null;
        let ownerProfile: any = null;
        try {
          const { data: tenant } = await supabase
            .from('tenants')
            .select('name, address')
            .eq('id', tenantId)
            .maybeSingle();
          tenantInfo = tenant;

          const { data: ownerMember } = await supabase
            .from('members')
            .select('user_id')
            .eq('tenant_id', tenantId)
            .eq('role', 'owner')
            .eq('is_active', true)
            .limit(1)
            .maybeSingle();

          if (ownerMember?.user_id) {
            const { data } = await supabase
              .from('profiles')
              .select('full_name, phone, email')
              .eq('id', ownerMember.user_id)
              .maybeSingle();
            ownerProfile = data;
          }
        } catch (err) {
          log('warn', 'Erro ao carregar dados do tenant/proprietário para auto-complete.', err);
        }

        const contactName = ownerProfile?.full_name || tenantInfo?.name || '';
        const contactPhone = ownerProfile?.phone || '';
        const contactEmail = ownerProfile?.email || '';

        const initial: Record<string, RegulatoryFieldValue> = {};
        for (const r of requirements) {
          if (r.type === 'address') {
            // Verificar se temos o endereço resolvido vindo da API no cache
            const cachedAddress = json.data?.resolved_addresses?.[r.id];
            if (cachedAddress) {
              initial[r.id] = { type: 'address', address: cachedAddress };
            } else {
              const suggestedAddr = parseAddressForSuggestion(tenantInfo?.address, tenantInfo?.name || '', contactName, country);
              initial[r.id] = { type: 'address', address: suggestedAddr };
            }
          } else if (r.type === 'document') {
            const cachedDocVal = cached?.regulatory_requirements?.find((cv: any) => cv.requirement_id === r.id)?.field_value;
            initial[r.id] = { 
              type: 'document', 
              documentId: cachedDocVal || undefined, 
              fileName: cachedDocVal ? 'Documento salvo anteriormente' : undefined 
            };
          } else {
            // Textual
            const cachedTextVal = cached?.regulatory_requirements?.find((cv: any) => cv.requirement_id === r.id)?.field_value;
            if (cachedTextVal) {
              initial[r.id] = { type: 'textual', value: cachedTextVal };
            } else {
              let val = '';
              const name = (r.name || '').toLowerCase();
              if (name.includes('contact') && name.includes('business')) {
                val = `Contact: ${contactName} | Business: ${tenantInfo?.name || 'N/A'} | Phone: ${contactPhone}`;
              } else if (name.includes('name') || name.includes('nome') || name.includes('contact')) {
                val = contactName;
              } else if (name.includes('email')) {
                val = contactEmail;
              } else if (name.includes('phone') || name.includes('telef')) {
                val = contactPhone;
              } else {
                val = tenantInfo?.name || '';
              }
              initial[r.id] = { type: 'textual', value: val };
            }
          }
        }

        setRegulatoryRequirements(requirements);
        setRegulatoryData(initial);
        setRegulatoryErrors({});
        setHasRegulatoryStep(true);
        setStep(5);
      } else {
        setHasRegulatoryStep(false);
        setStep(4);
      }
    } catch (err: any) {
      log('error', `Erro ao verificar requisitos regulatórios: ${err.message}`, err.stack);
      setDiagOpen(true);
      setHasRegulatoryStep(false);
      setEffectivePhoneNumberType(num.phoneNumberType || 'local');
      setStep(4);
    } finally {
      setCheckingRequirements(false);
    }
  };

  const updateRegulatoryTextual = (requirementId: string, value: string) => {
    setRegulatoryData((d) => ({ ...d, [requirementId]: { type: 'textual', value } }));
    if (regulatoryErrors[requirementId]) setRegulatoryErrors((e) => { const c = { ...e }; delete c[requirementId]; return c; });
  };

  const updateRegulatoryAddress = (requirementId: string, key: keyof RegulatoryAddress, value: string) => {
    setRegulatoryData((d) => {
      const current = d[requirementId];
      const addr = current?.type === 'address' ? current.address : EMPTY_REGULATORY_ADDRESS;
      return { ...d, [requirementId]: { type: 'address', address: { ...addr, [key]: value } } };
    });
    if (regulatoryErrors[requirementId]) setRegulatoryErrors((e) => { const c = { ...e }; delete c[requirementId]; return c; });
  };

  const uploadRegulatoryDocument = async (requirementId: string, file: File) => {
    const session = await getSession();
    if (!session) return;

    const form = new FormData();
    form.append('action', 'upload_regulatory_document');
    form.append('file', file);

    const res = await fetch(`${SUPABASE_URL}/functions/v1/telnyx-number-orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: form,
    });
    const json = await res.json();
    if (json.error) { showToast('error', json.error); return; }

    setRegulatoryData((d) => ({ ...d, [requirementId]: { type: 'document', documentId: json.data.document_id, fileName: json.data.file_name } }));
    if (regulatoryErrors[requirementId]) setRegulatoryErrors((e) => { const c = { ...e }; delete c[requirementId]; return c; });
  };

  const validateRegulatoryInfo = (): boolean => {
    const errors: Record<string, string> = {};
    for (const r of regulatoryRequirements) {
      const val = regulatoryData[r.id];
      if (r.type === 'textual') {
        const text = (val?.type === 'textual' ? val.value : '').trim();
        const isContactInfo = (r.name || '').toLowerCase().includes('contact') && (r.name || '').toLowerCase().includes('business');
        if (isContactInfo) {
          const { contact, phone } = parseContactInfo(text);
          if (!contact.trim() || !phone.trim()) {
            errors[r.id] = 'Nome do contato e telefone de contato são obrigatórios';
          }
        } else {
          if (!text) {
            errors[r.id] = 'Campo obrigatório';
          } else if (r.acceptanceCriteria.minLength && text.length < r.acceptanceCriteria.minLength) {
            errors[r.id] = `Mínimo de ${r.acceptanceCriteria.minLength} caracteres`;
          } else if (r.acceptanceCriteria.maxLength && text.length > r.acceptanceCriteria.maxLength) {
            errors[r.id] = `Máximo de ${r.acceptanceCriteria.maxLength} caracteres`;
          }
        }
      } else if (r.type === 'address') {
        const addr = val?.type === 'address' ? val.address : null;
        if (!addr?.streetAddress || !addr?.locality || !addr?.postalCode) {
          errors[r.id] = 'Preencha o endereço completo (Rua, Cidade e CEP)';
        }
      } else if (r.type === 'document') {
        const doc = val?.type === 'document' ? val : null;
        if (!doc?.documentId) errors[r.id] = 'Envie o documento';
      }
    }
    setRegulatoryErrors(errors);
    return Object.keys(errors).length === 0;
  };
 
  const submitRegulatoryInfo = async () => {
    if (!validateRegulatoryInfo()) return;
 
    setSubmitting(true);
    try {
      const session = await getSession();
      if (!session) return;
 
      // Localizar o ID do requisito de contato para extrair Nome e Empresa
      const contactInfoReq = regulatoryRequirements.find(
        (req) => req.type === 'textual' && (req.name || '').toLowerCase().includes('contact') && (req.name || '').toLowerCase().includes('business')
      );
 
      let parsedContact = { contact: '', business: '', phone: '' };
      if (contactInfoReq) {
        const contactVal = regulatoryData[contactInfoReq.id];
        if (contactVal?.type === 'textual') {
          parsedContact = parseContactInfo(contactVal.value);
        }
      }
 
      // Dividir o nome completo em primeiro nome e sobrenome
      const fullName = parsedContact.contact.trim() || 'Clinic Owner';
      const nameParts = fullName.split(' ').map((p) => p.trim()).filter(Boolean);
      const contactFirstName = nameParts[0] || 'Clinic';
      const contactLastName = nameParts.slice(1).join(' ') || 'Owner';
      const contactBusiness = parsedContact.business.trim() || 'N/A';
 
      const regulatory_data = regulatoryRequirements.map((r) => {
        const val = regulatoryData[r.id];
        if (r.type === 'address' && val?.type === 'address') {
          const updatedAddress = {
            ...val.address,
            firstName: contactFirstName,
            lastName: contactLastName,
            businessName: contactBusiness,
          };
          return { requirement_id: r.id, type: 'address', address: updatedAddress };
        }
        if (r.type === 'document' && val?.type === 'document') {
          return { requirement_id: r.id, type: 'document', document_id: val.documentId };
        }
        return { requirement_id: r.id, type: 'textual', value: val?.type === 'textual' ? val.value : '' };
      });

      const res = await fetch(`${SUPABASE_URL}/functions/v1/telnyx-number-orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:             'submit_regulatory_info',
          country_code:       country,
          phone_number_type:  effectivePhoneNumberType || selected!.phoneNumberType || 'local',
          regulatory_data,
          sub_number_order_id: subNumberOrderId || undefined,
          order_id:           resubmitOrderId || undefined,
        }),
      });
      const json = await res.json();
      if (json.error) { showToast('error', json.error); return; }
      
      if (resubmitOrderId) {
        setDone(true);
        showToast('success', 'Exigências enviadas com sucesso!');
        onPurchased(selected!.phoneNumber);
      } else {
        setStep(4);
      }
    } finally {
      setSubmitting(false);
    }
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
          action:            'create_order',
          phone_number:      selected!.phoneNumber,
          country_code:      country,
          phone_number_type: effectivePhoneNumberType || selected!.phoneNumberType || 'local',
          friendly_name:     friendlyName || undefined,
        }),
      });
      const json = await res.json();
      if (json.error) {
        if (json.error === 'DOCUMENT_UPLOAD_REQUIRED') {
          log('info', 'Upload de documento é obrigatório para este país/número. Redirecionando para o formulário regulatório.', json);
          showToast('info', 'Por favor, envie o documento regulatório exigido pelas operadoras.');

          const requirements = json.requirements || [];
          const initial: Record<string, RegulatoryFieldValue> = {};
          for (const r of requirements) {
            if (r.type === 'address') initial[r.id] = { type: 'address', address: { ...EMPTY_REGULATORY_ADDRESS } };
            else if (r.type === 'document') initial[r.id] = { type: 'document' };
            else initial[r.id] = { type: 'textual', value: '' };
          }
          setRegulatoryRequirements(requirements);
          setRegulatoryData(initial);
          setRegulatoryErrors({});
          setEffectivePhoneNumberType(json.phone_number_type || selected!.phoneNumberType || 'local');
          setHasRegulatoryStep(true);
          setStep(5);
          return;
        }
        showToast('error', json.error);
        return;
      }
      if (json.data?.pending_review) {
        showToast('success', `Número ${selected!.phoneNumber} adquirido! Aguardando revisão da Telnyx.`);
      } else {
        showToast('success', `Número ${selected!.phoneNumber} adquirido com sucesso!`);
      }
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

  const goBack = () => {
    if (resubmitOrderId) { onClose(); return; }
    if (step === 5) { setStep(1); return; }
    if (step === 4) {
      if (hasRegulatoryStep) { setStep(5); return; }
      if (!req.needsDocs) { setStep(1); return; }
      setStep(3);
      return;
    }
    if (step > 1) { setStep((s) => (s - 1) as Step); return; }
    onClose();
  };

  const regAddressField = (requirementId: string, key: keyof RegulatoryAddress, label: string, placeholder: string) => {
    const val  = regulatoryData[requirementId];
    const addr = val?.type === 'address' ? val.address : EMPTY_REGULATORY_ADDRESS;
    return (
      <div>
        <label className="text-[10px] font-black text-graphite-400 uppercase tracking-wide">{label}</label>
        <input
          type="text"
          value={addr[key] ?? ''}
          onChange={(e) => updateRegulatoryAddress(requirementId, key, e.target.value)}
          placeholder={placeholder}
          className="w-full mt-1 bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm text-graphite-700 focus:outline-none focus:border-brand-primary"
        />
      </div>
    );
  };

  const STEPS = req.needsDocs
    ? ['Buscar', 'Titular', 'Documentos', 'Confirmar']
    : hasRegulatoryStep
      ? ['Buscar', 'Dados', 'Confirmar']
      : ['Buscar', 'Confirmar'];

  const displayStep = req.needsDocs
    ? step
    : hasRegulatoryStep
      ? (step === 5 ? 2 : step === 4 ? 3 : 1)
      : (step === 4 ? 2 : 1);

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
            <h2 className="text-base font-black text-graphite-800">
              {resubmitOrderId ? 'Completar Cadastro' : 'Comprar Número'}
            </h2>
            {selected && (
              <p className="text-xs text-graphite-400 mt-0.5 font-mono">{selected.phoneNumber}</p>
            )}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-ice-100 rounded-xl transition-colors border-none cursor-pointer bg-transparent">
            <X size={18} className="text-graphite-400" />
          </button>
        </div>

        {/* Step indicator */}
        {!resubmitOrderId && (
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
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {loadingResubmit && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-graphite-400">
              <RefreshCw size={24} className="animate-spin text-brand-primary" />
              <span className="text-sm font-medium">Carregando exigências pendentes...</span>
            </div>
          )}

          {/* ETAPA 1 — Busca */}
          {!loadingResubmit && step === 1 && (
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
                    onChange={(e) => {
                      const next = e.target.value;
                      setCountry(next);
                      if (searchBy === 'state' && next !== 'US' && next !== 'CA') setSearchBy('area_code');
                      setSearchValue('');
                      setResults([]); setSelected(null); setDiagLogs([]); setSearched(false);
                      setHasRegulatoryStep(false); setRegulatoryRequirements([]); setRegulatoryData({}); setRegulatoryErrors({}); setEffectivePhoneNumberType('');
                    }}
                    className="w-full mt-1 bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm text-graphite-700 focus:outline-none focus:border-brand-primary"
                  >
                    {Object.entries(COUNTRY_FLAGS).map(([code, flag]) => (
                      <option key={code} value={code}>{flag} {code}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-black text-graphite-400 uppercase tracking-wide">Tipo</label>
                  <select
                    value={phoneType}
                    onChange={(e) => setPhoneType(e.target.value as PhoneType)}
                    className="w-full mt-1 bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm text-graphite-700 focus:outline-none focus:border-brand-primary"
                  >
                    <option value="all">Todos os tipos</option>
                    <option value="local">Local</option>
                    <option value="toll_free">Toll-Free (0800)</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-2">
                <div style={{ width: 160 }}>
                  <label className="text-[10px] font-black text-graphite-400 uppercase tracking-wide">Buscar por</label>
                  <select
                    value={searchBy}
                    onChange={(e) => { setSearchBy(e.target.value as SearchBy); setSearchValue(''); }}
                    className="w-full mt-1 bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm text-graphite-700 focus:outline-none focus:border-brand-primary"
                  >
                    <option value="area_code">Código de área</option>
                    <option value="city">Cidade/Região</option>
                    {(country === 'US' || country === 'CA') && (
                      <option value="state">Estado/Província</option>
                    )}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-black text-graphite-400 uppercase tracking-wide">{SEARCH_BY_CONFIG[searchBy].label}</label>
                  <input
                    value={searchValue}
                    onChange={(e) => setSearchValue(searchBy === 'area_code' ? e.target.value.replace(/\D/g, '') : e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchNumbers()}
                    placeholder={SEARCH_BY_CONFIG[searchBy].placeholder}
                    maxLength={searchBy === 'area_code' ? 5 : 40}
                    className={`w-full mt-1 bg-ice-50 border border-ice-200 rounded-xl px-3 py-2 text-sm text-graphite-700 focus:outline-none focus:border-brand-primary ${searchBy === 'area_code' ? 'font-mono' : ''}`}
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={searchNumbers}
                    disabled={searching}
                    className="px-4 py-2 bg-brand-primary text-white text-sm font-bold rounded-xl hover:bg-brand-primary/90 disabled:opacity-50 border-none cursor-pointer flex items-center gap-2"
                  >
                    {searching ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
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

              {!searching && !searched && (
                <div className="text-center py-8 text-graphite-300">
                  <Search size={30} className="mx-auto mb-2 opacity-40" />
                  <p className="text-sm font-bold">Selecione um país e clique em Buscar</p>
                </div>
              )}

              {!searching && searched && results.length === 0 && !hasErrors && (
                <div className="text-center py-10 px-4 bg-ice-50 border border-ice-100 rounded-3xl space-y-2">
                  <Info size={32} className="mx-auto text-graphite-400" />
                  <div>
                    <p className="text-sm font-black text-graphite-800">Nenhum número disponível</p>
                    <p className="text-xs text-graphite-500 mt-1 max-w-sm mx-auto leading-relaxed">
                      Não encontramos números para os filtros selecionados.
                      Tente buscar usando apenas o Código de Área (DDD) ou utilize outra Cidade/Região.
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {results.map((num, idx) => {
                  const hasSms   = num.features.includes('sms');
                  const hasVoice = num.features.includes('voice');
                  return (
                    <button
                      key={`${num.phoneNumber}-${idx}`}
                      onClick={() => !checkingRequirements && selectNumber(num)}
                      disabled={checkingRequirements}
                      className="w-full flex items-center justify-between p-3 bg-ice-50 border border-ice-100 rounded-2xl hover:border-brand-primary/50 hover:bg-brand-primary/5 transition-all cursor-pointer text-left disabled:opacity-50 disabled:cursor-default"
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
                      {checkingRequirements && selected?.phoneNumber === num.phoneNumber ? (
                        <RefreshCw size={16} className="text-brand-primary shrink-0 ml-2 animate-spin" />
                      ) : (
                        <ChevronRight size={16} className="text-brand-primary shrink-0 ml-2" />
                      )}
                    </button>
                  );
                })}
              </div>

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
              ) : requiresReview ? (
                <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                  <Info size={14} className="text-blue-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-blue-700">
                    Este número requer aprovação regulatória local. Os dados preenchidos na etapa anterior serão enviados, mas a ativação depende da aprovação pelas operadoras locais (geralmente concluída em poucas horas).
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

          {/* ETAPA 5 — Dados regulatórios */}
          {step === 5 && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                <Info size={14} className="text-blue-500 mt-0.5 shrink-0" />
                <p className="text-xs text-blue-700">
                  A Telnyx exige algumas informações adicionais para números de {COUNTRY_FLAGS[country]} {country}.
                  Esses dados ficam salvos e serão reutilizados automaticamente nas próximas compras deste país.
                </p>
              </div>

              {regulatoryRequirements.map((r) => {
                const isContactInfo = r.type === 'textual' && (r.name || '').toLowerCase().includes('contact') && (r.name || '').toLowerCase().includes('business');
                const fieldVal = regulatoryData[r.id];
                const textVal = fieldVal?.type === 'textual' ? fieldVal.value : '';
                const isDoc = fieldVal?.type === 'document';
                const docFileName = isDoc ? fieldVal.fileName : undefined;

                return (
                  <div key={r.id} className="space-y-1.5">
                    <label className="text-[10px] font-black text-graphite-400 uppercase tracking-wide">{r.name}</label>
                    {r.description && <p className="text-xs text-graphite-400">{r.description}</p>}

                    {r.type === 'textual' && (
                      isContactInfo ? (
                        <div className="space-y-3 p-3 bg-ice-50 border border-ice-200 rounded-xl">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] font-black text-graphite-400 uppercase tracking-wide">Nome do Contato</label>
                              <input
                                type="text"
                                value={parseContactInfo(textVal).contact}
                                onChange={(e) => {
                                  const { business, phone } = parseContactInfo(textVal);
                                  updateRegulatoryTextual(r.id, formatContactInfo(e.target.value, business, phone));
                                }}
                                placeholder="Nome e Sobrenome"
                                className="w-full mt-1 bg-white border border-ice-100 rounded-xl px-3 py-2 text-sm text-graphite-700 focus:outline-none focus:border-brand-primary"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-black text-graphite-400 uppercase tracking-wide">Telefone de Contato</label>
                              <input
                                type="text"
                                value={parseContactInfo(textVal).phone}
                                onChange={(e) => {
                                  const { contact, business } = parseContactInfo(textVal);
                                  updateRegulatoryTextual(r.id, formatContactInfo(contact, business, e.target.value));
                                }}
                                placeholder="Ex: +6498890000"
                                className="w-full mt-1 bg-white border border-ice-100 rounded-xl px-3 py-2 text-sm text-graphite-700 focus:outline-none focus:border-brand-primary"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="text-[10px] font-black text-graphite-400 uppercase tracking-wide">Nome da Empresa (opcional)</label>
                            <input
                              type="text"
                              value={parseContactInfo(textVal).business}
                              onChange={(e) => {
                                const { contact, phone } = parseContactInfo(textVal);
                                updateRegulatoryTextual(r.id, formatContactInfo(contact, e.target.value, phone));
                              }}
                              placeholder="Razão Social ou N/A se Pessoa Física"
                              className="w-full mt-1 bg-white border border-ice-100 rounded-xl px-3 py-2 text-sm text-graphite-700 focus:outline-none focus:border-brand-primary"
                            />
                          </div>
                        </div>
                      ) : r.acceptanceCriteria.acceptableValues?.length ? (
                        <select
                          value={textVal}
                          onChange={(e) => updateRegulatoryTextual(r.id, e.target.value)}
                          className={`w-full bg-ice-50 border rounded-xl px-3 py-2 text-sm text-graphite-700 focus:outline-none focus:border-brand-primary ${regulatoryErrors[r.id] ? 'border-red-300' : 'border-ice-200'}`}
                        >
                          <option value="">Selecione...</option>
                          {r.acceptanceCriteria.acceptableValues.map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={textVal}
                          onChange={(e) => updateRegulatoryTextual(r.id, e.target.value)}
                          placeholder={r.example || undefined}
                          maxLength={r.acceptanceCriteria.maxLength}
                          className={`w-full bg-ice-50 border rounded-xl px-3 py-2 text-sm text-graphite-700 focus:outline-none focus:border-brand-primary ${regulatoryErrors[r.id] ? 'border-red-300' : 'border-ice-200'}`}
                        />
                      )
                    )}

                    {r.type === 'address' && (
                      <div className="space-y-2 p-3 bg-ice-50 border border-ice-200 rounded-xl">
                        {regAddressField(r.id, 'streetAddress', 'Endereço', 'Rua / Av., número')}
                        <div className="flex gap-2 flex-wrap sm:flex-nowrap">
                          <div className="flex-1 min-w-[120px]">{regAddressField(r.id, 'locality', 'Cidade', 'Auckland')}</div>
                          <div className="flex-1 min-w-[100px]">{regAddressField(r.id, 'administrativeArea', 'Estado/Região', '')}</div>
                          <div className="w-full sm:w-[100px]">{regAddressField(r.id, 'postalCode', 'CEP', '')}</div>
                        </div>
                      </div>
                    )}

                    {r.type === 'document' && (
                      <div>
                        <label className="flex items-center gap-2 px-3 py-2 bg-ice-50 border border-ice-200 rounded-xl cursor-pointer hover:border-brand-primary/50 transition-colors text-sm text-graphite-500">
                          <FileText size={14} />
                          {docFileName
                            ? docFileName
                            : 'Selecionar arquivo (PDF, JPG ou PNG)'}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,application/pdf"
                            onChange={(e) => e.target.files?.[0] && uploadRegulatoryDocument(r.id, e.target.files[0])}
                            className="hidden"
                          />
                        </label>
                        {docFileName && (
                          <p className="text-[10px] text-green-600 mt-1">✓ Documento enviado</p>
                        )}
                      </div>
                    )}

                    {regulatoryErrors[r.id] && <p className="text-[10px] text-red-500">{regulatoryErrors[r.id]}</p>}
                  </div>
                );
              })}
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

          {/* ── Painel de Diagnóstico ───────────────────────────────────── */}
          {!done && diagLogs.length > 0 && (
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
        </div>

        {/* Footer */}
        {!done && !loadingResubmit && (
          <div className="px-6 py-4 border-t border-ice-100 flex items-center justify-between shrink-0">
            <button
              onClick={goBack}
              className="flex items-center gap-1.5 text-sm text-graphite-400 hover:text-graphite-600 transition-colors border-none cursor-pointer bg-transparent"
            >
              <ChevronLeft size={16} />
              {resubmitOrderId ? 'Voltar' : step === 1 ? 'Cancelar' : 'Voltar'}
            </button>

            {step === 1 && selected && (
              <button
                onClick={() => req.needsDocs ? setStep(2) : hasRegulatoryStep ? setStep(5) : setStep(4)}
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

            {step === 5 && (
              <button
                onClick={submitRegulatoryInfo}
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2 bg-brand-primary text-white text-sm font-bold rounded-xl hover:bg-brand-primary/90 disabled:opacity-50 transition-colors border-none cursor-pointer"
              >
                {submitting ? <RefreshCw size={14} className="animate-spin" /> : null}
                {resubmitOrderId ? 'Reenviar Informações' : 'Continuar'} <ChevronRight size={16} />
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
