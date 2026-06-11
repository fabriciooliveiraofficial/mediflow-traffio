/**
 * TelnyxClient — Cliente completo para a API Telnyx v2
 *
 * Cobre todos os serviços do Bloco F do softphone:
 *   - Number Management (buscar, comprar, liberar números)
 *   - SIP Credentials (criar/revogar credenciais WebRTC por agente)
 *   - Call Control (atender, desligar, gravar, transferir, hold)
 *   - Messaging SMS (envio de texto)
 */

const TELNYX_API = "https://api.telnyx.com/v2";

// ─── Helper de request ────────────────────────────────────────────────────────

async function telnyxRequest(
  apiKey: string,
  method: string,
  path: string,
  body?: any
): Promise<any> {
  const res = await fetch(`${TELNYX_API}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
      "Accept":        "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};

  if (!res.ok) {
    const errMsg = data.errors?.[0]?.detail ?? data.title ?? `HTTP ${res.status}`;
    throw new Error(`[Telnyx] ${method} ${path} → ${errMsg}`);
  }

  return data;
}

// ─── Number Management ────────────────────────────────────────────────────────

export interface AvailableNumber {
  phoneNumber:     string;
  countryCode:     string;
  regionCode:      string;
  city:            string;
  monthlyCost:     string;
  features:        string[];   // ["voice", "sms"]
  phoneNumberType: string;     // "local" | "toll_free" | "mobile" | "national" | "shared_cost"
}

export interface TenantNumber {
  id:                 string;
  phoneNumber:        string;
  status:             string;
  requirementsMet?:   boolean;
  requirementsStatus?: string; // "pending" | "approved" | "requirement-info-pending" | ...
}

// ─── Regulatory Requirements ─────────────────────────────────────────────────

export interface RegulatoryRequirementType {
  id:          string;   // requirement_id usado em regulatory_requirements
  name:        string;
  type:        "textual" | "address" | "document";
  description: string;
  example:     string;
  acceptanceCriteria: {
    minLength?:          number;
    maxLength?:          number;
    acceptableValues?:   string[];
    acceptableCharacters?: string;
  };
}

export interface RegulatoryAddressInput {
  firstName:          string;
  lastName:           string;
  businessName?:      string;
  streetAddress:      string;
  locality:           string;
  administrativeArea?: string;
  postalCode?:        string;
  countryCode:        string;
  phoneNumber?:       string;
}

export async function searchAvailableNumbers(
  apiKey: string,
  countryCode: string,
  _features: ("voice" | "sms")[] = ["voice", "sms"],
  limit = 10,
  nationalDestinationCode?: string,
  phoneNumberType?: string,
  locality?: string,
  administrativeArea?: string
): Promise<AvailableNumber[]> {
  const ndcParam = nationalDestinationCode
    ? `&filter[national_destination_code]=${encodeURIComponent(nationalDestinationCode)}`
    : "";
  const typeParam = phoneNumberType
    ? `&filter[phone_number_type]=${encodeURIComponent(phoneNumberType)}`
    : "";
  const localityParam = locality
    ? `&filter[locality]=${encodeURIComponent(locality)}`
    : "";
  const areaParam = administrativeArea
    ? `&filter[administrative_area]=${encodeURIComponent(administrativeArea)}`
    : "";

  // Cascade: voice+sms → voice-only.
  // SMS-only numbers are never useful; voice-only numbers can still be shown
  // (SMS may be available via Telnyx messaging profile after purchase).
  const attempts: Array<{ featureQs: string }> = [
    { featureQs: "&filter[features][]=voice&filter[features][]=sms" },
    { featureQs: "&filter[features][]=voice" },
  ];

  for (const { featureQs } of attempts) {
    const qs = `filter[country_code]=${countryCode}&filter[limit]=${limit}${ndcParam}${typeParam}${localityParam}${areaParam}${featureQs}`;
    try {
      const data = await telnyxRequest(apiKey, "GET", `/available_phone_numbers?${qs}`);
      const rows: any[] = data.data ?? [];

      // Rejeitar placeholders mascarados — E.164 válido: apenas dígitos após o '+'
      const purchasable = rows.filter((n) => /^\+\d{7,15}$/.test(n.phone_number ?? ""));

      if (purchasable.length > 0) {
        return purchasable.map((n) => ({
          phoneNumber:     n.phone_number,
          countryCode:     n.region_information?.[0]?.region_name ?? countryCode,
          regionCode:      n.region_information?.[0]?.region_code ?? "",
          city:            n.region_information?.[1]?.region_name ?? "",
          monthlyCost:     n.cost_information?.monthly_cost ?? "0",
          features:        n.features?.map((f: any) => f.name) ?? [],
          phoneNumberType: n.phone_number_type ?? phoneNumberType ?? "local",
        }));
      }
    } catch (err: any) {
      const msg = (err.message ?? "").toLowerCase();
      if (!msg.includes("no coverage") && !msg.includes("not found in the specified country")) {
        throw err;
      }
    }
  }

  return [];
}

export async function purchaseNumber(
  apiKey: string,
  phoneNumber: string,
  connectionId?: string,    // Credential Connection ID do softphone
  requirementGroupId?: string
): Promise<TenantNumber> {
  const phoneEntry: any = { phone_number: phoneNumber };
  if (requirementGroupId) phoneEntry.requirement_group_id = requirementGroupId;

  const body: any = {
    phone_numbers: [phoneEntry],
  };
  if (connectionId) body.connection_id = connectionId;

  // Compra instantânea via Number Orders — POST /phone_numbers não existe na API v2.
  const data = await telnyxRequest(apiKey, "POST", "/number_orders", body);
  const ordered = data.data?.phone_numbers?.[0];
  if (!ordered?.id) {
    throw new Error(`[Telnyx] Number order criado mas sem número retornado para ${phoneNumber}`);
  }

  return {
    id:                 ordered.id,
    phoneNumber:        ordered.phone_number ?? phoneNumber,
    status:             ordered.status ?? data.data.status,
    requirementsMet:    ordered.requirements_met,
    requirementsStatus: ordered.requirements_status,
  };
}

export async function releaseNumber(apiKey: string, numberId: string): Promise<void> {
  await telnyxRequest(apiKey, "DELETE", `/phone_numbers/${numberId}`);
}

// ─── Regulatory Requirements ─────────────────────────────────────────────────

/**
 * Lista os requisitos regulatórios exigidos pela Telnyx para comprar um número
 * de um país/tipo específico (ex: NZ exige Contact Information + Address).
 *
 * IMPORTANTE: a consulta é feita filtrando APENAS por país, e a triagem por
 * action/tipo é feita aqui no cliente. Motivo: na Telnyx, um requirement com
 * `phone_number_type` em branco aplica-se a TODOS os tipos, e `action` pode ser
 * "both" (ordering+porting) — registros assim escapam de filtros exatos como
 * `filter[phone_number_type]=local&filter[action]=ordering` (foi exatamente o
 * que fez NZ parecer "sem requisitos"). Além disso `/available_phone_numbers`
 * não informa o tipo do número, então o tipo pedido aqui é só um palpite.
 *
 * Retorna também o `phoneNumberType` efetivo (o do registro de requisito, se
 * concreto; senão o solicitado) — usado como chave de cache e na criação do
 * requirement_group.
 */
export async function getRequirements(
  apiKey: string,
  countryCode: string,
  phoneNumberType: string
): Promise<{ requirements: RegulatoryRequirementType[]; phoneNumberType: string }> {
  const qs = `filter[country_code]=${encodeURIComponent(countryCode)}&page[size]=250`;
  const data = await telnyxRequest(apiKey, "GET", `/requirements?${qs}`);
  const rows: any[] = data.data ?? [];

  const orderingRows = rows.filter((row) => {
    const action = row.action ?? "";
    return action === "ordering" || action === "both";
  });

  // Tipo em branco = aplica-se a todos os tipos. Se nenhum registro casar com o
  // tipo solicitado, usar todos os de ordering (exigir a mais é seguro; a Telnyx
  // pode classificar o número com um tipo diferente do palpite da busca).
  const matchingType = orderingRows.filter((row) => {
    const rowType = row.phone_number_type ?? "";
    return !rowType || rowType === phoneNumberType;
  });
  const applicable = matchingType.length > 0 ? matchingType : orderingRows;

  const seen = new Map<string, RegulatoryRequirementType>();
  for (const row of applicable) {
    for (const rt of row.requirements_types ?? []) {
      if (seen.has(rt.id)) continue;
      const ac = rt.acceptance_criteria ?? {};
      seen.set(rt.id, {
        id:          rt.id,
        name:        rt.name,
        type:        rt.type,
        description: rt.description ?? "",
        example:     rt.example ?? "",
        acceptanceCriteria: {
          minLength:            ac.min_length,
          maxLength:            ac.max_length,
          acceptableValues:     ac.acceptable_values,
          acceptableCharacters: ac.acceptable_characters,
        },
      });
    }
  }

  const effectiveType =
    applicable.find((row) => row.phone_number_type)?.phone_number_type ?? phoneNumberType;

  return { requirements: Array.from(seen.values()), phoneNumberType: effectiveType };
}

/**
 * Cria um endereço regulatório na Telnyx (sem validação de E911 — o endereço
 * é usado apenas para fins de compliance regulatório, não para emergência).
 * Retorna o address id, usado como field_value de um requirement do tipo "address".
 */
export async function createAddress(apiKey: string, addr: RegulatoryAddressInput): Promise<string> {
  const data = await telnyxRequest(apiKey, "POST", "/addresses", {
    first_name:          addr.firstName,
    last_name:           addr.lastName,
    business_name:       addr.businessName,
    street_address:      addr.streetAddress,
    locality:            addr.locality,
    administrative_area: addr.administrativeArea,
    postal_code:         addr.postalCode,
    country_code:        addr.countryCode,
    phone_number:        addr.phoneNumber,
    validate_address:    false,
  });
  return data.data.id;
}

/**
 * Envia um documento (multipart) para a Telnyx. Retorna o document id,
 * usado como field_value de um requirement do tipo "document".
 */
export async function uploadDocument(apiKey: string, file: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append("file", file, filename);

  const res = await fetch(`${TELNYX_API}/documents`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}` },
    body: form,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};

  if (!res.ok) {
    const errMsg = data.errors?.[0]?.detail ?? data.title ?? `HTTP ${res.status}`;
    throw new Error(`[Telnyx] POST /documents → ${errMsg}`);
  }

  return data.data.id;
}

/**
 * Cria um requirement_group vazio para um país/tipo. O grupo é reutilizável —
 * deve ser cacheado por (tenant, country_code, phone_number_type) e preenchido
 * via fillRequirementGroup.
 */
export async function createRequirementGroup(
  apiKey: string,
  countryCode: string,
  phoneNumberType: string
): Promise<string> {
  const data = await telnyxRequest(apiKey, "POST", "/requirement_groups", {
    country_code:      countryCode,
    phone_number_type: phoneNumberType,
    action:            "ordering",
  });
  return data.data.id;
}

/**
 * Preenche (ou atualiza) os valores de um requirement_group existente.
 */
export async function fillRequirementGroup(
  apiKey: string,
  groupId: string,
  requirements: { requirement_id: string; field_value: string }[]
): Promise<any> {
  const data = await telnyxRequest(apiKey, "PATCH", `/requirement_groups/${groupId}`, {
    regulatory_requirements: requirements,
  });
  return data.data;
}

// ─── SIP Credentials (WebRTC por agente) ─────────────────────────────────────

export interface SipCredential {
  id:          string;
  sipUsername: string;
  sipPassword: string;
}

export async function createSipCredential(
  apiKey: string,
  name: string,
  connectionId: string   // Credential Connection ID no portal Telnyx
): Promise<SipCredential> {
  const data = await telnyxRequest(apiKey, "POST", "/telephony_credentials", {
    name,
    connection_id: connectionId,
  });
  return {
    id:          data.data.id,
    sipUsername: data.data.sip_username,
    sipPassword: data.data.sip_password,
  };
}

export async function getLoginToken(apiKey: string, credentialId: string): Promise<string> {
  const data = await telnyxRequest(apiKey, "GET", `/telephony_credentials/${credentialId}/token`);
  return data.token;
}

export async function revokeSipCredential(apiKey: string, credentialId: string): Promise<void> {
  await telnyxRequest(apiKey, "DELETE", `/telephony_credentials/${credentialId}`);
}

// ─── Call Control ─────────────────────────────────────────────────────────────

export async function answerCall(apiKey: string, callControlId: string): Promise<void> {
  await telnyxRequest(apiKey, "POST", `/calls/${callControlId}/actions/answer`, {});
}

export async function hangupCall(apiKey: string, callControlId: string): Promise<void> {
  await telnyxRequest(apiKey, "POST", `/calls/${callControlId}/actions/hangup`, {});
}

export async function holdCall(apiKey: string, callControlId: string, audioUrl?: string): Promise<void> {
  const body: any = {};
  if (audioUrl) body.audio_url = audioUrl;
  await telnyxRequest(apiKey, "POST", `/calls/${callControlId}/actions/hold`, body);
}

export async function unholdCall(apiKey: string, callControlId: string): Promise<void> {
  await telnyxRequest(apiKey, "POST", `/calls/${callControlId}/actions/unhold`, {});
}

export async function startRecording(
  apiKey: string,
  callControlId: string,
  channels: "single" | "dual" = "dual",
  format:   "mp3" | "wav"    = "mp3"
): Promise<void> {
  await telnyxRequest(apiKey, "POST", `/calls/${callControlId}/actions/record_start`, {
    format,
    channels,
  });
}

export async function stopRecording(apiKey: string, callControlId: string): Promise<void> {
  await telnyxRequest(apiKey, "POST", `/calls/${callControlId}/actions/record_stop`, {});
}

export async function transferCall(
  apiKey: string,
  callControlId: string,
  to: string
): Promise<void> {
  await telnyxRequest(apiKey, "POST", `/calls/${callControlId}/actions/transfer`, {
    to,
  });
}

export async function bridgeCalls(
  apiKey: string,
  callControlId: string,
  targetCallControlId: string
): Promise<void> {
  await telnyxRequest(apiKey, "POST", `/calls/${callControlId}/actions/bridge`, {
    call_control_id: targetCallControlId,
  });
}

export async function speakText(
  apiKey: string,
  callControlId: string,
  text: string,
  language = "pt-BR",
  voice = "female"
): Promise<void> {
  await telnyxRequest(apiKey, "POST", `/calls/${callControlId}/actions/speak`, {
    payload: text,
    voice,
    language,
  });
}

// ─── Number Orders ────────────────────────────────────────────────────────────

export interface TelnyxNumberOrder {
  id:          string;
  status:      string;  // "pending" | "success" | "failure"
  phoneNumbers: string[];
}

export async function createNumberOrder(
  apiKey: string,
  phoneNumbers: string[],
  connectionId?: string
): Promise<TelnyxNumberOrder> {
  const body: any = {
    phone_numbers: phoneNumbers.map((n) => ({ phone_number: n })),
  };
  if (connectionId) body.connection_id = connectionId;

  const data = await telnyxRequest(apiKey, "POST", "/number_orders", body);
  return {
    id:           data.data.id,
    status:       data.data.status,
    phoneNumbers: (data.data.phone_numbers ?? []).map((n: any) => n.phone_number),
  };
}

export async function getNumberOrder(
  apiKey: string,
  orderId: string
): Promise<TelnyxNumberOrder> {
  const data = await telnyxRequest(apiKey, "GET", `/number_orders/${orderId}`);
  return {
    id:           data.data.id,
    status:       data.data.status,
    phoneNumbers: (data.data.phone_numbers ?? []).map((n: any) => n.phone_number),
  };
}

// ─── SMS ─────────────────────────────────────────────────────────────────────

export async function sendSms(
  apiKey: string,
  from: string,
  to: string,
  text: string
): Promise<string> {
  const data = await telnyxRequest(apiKey, "POST", "/messages", { from, to, text });
  return data.data.id;
}
