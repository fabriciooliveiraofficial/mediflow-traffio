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
  phoneNumber:   string;
  countryCode:   string;
  regionCode:    string;
  city:          string;
  monthlyCost:   string;
  features:      string[];   // ["voice", "sms"]
}

export interface TenantNumber {
  id:          string;
  phoneNumber: string;
  status:      string;
}

export async function searchAvailableNumbers(
  apiKey: string,
  countryCode: string,
  _features: ("voice" | "sms")[] = ["voice", "sms"],
  limit = 10,
  nationalDestinationCode?: string
): Promise<AvailableNumber[]> {
  const ndcParam = nationalDestinationCode
    ? `&filter[national_destination_code]=${encodeURIComponent(nationalDestinationCode)}`
    : "";

  // Cascade: voice+sms → voice-only.
  // SMS-only numbers are never useful; voice-only numbers can still be shown
  // (SMS may be available via Telnyx messaging profile after purchase).
  const attempts: Array<{ featureQs: string }> = [
    { featureQs: "&filter[features][]=voice&filter[features][]=sms" },
    { featureQs: "&filter[features][]=voice" },
  ];

  for (const { featureQs } of attempts) {
    const qs = `filter[country_code]=${countryCode}&filter[limit]=${limit}${ndcParam}${featureQs}`;
    try {
      const data = await telnyxRequest(apiKey, "GET", `/available_phone_numbers?${qs}`);
      const rows: any[] = data.data ?? [];

      // Rejeitar placeholders mascarados — E.164 válido: apenas dígitos após o '+'
      const purchasable = rows.filter((n) => /^\+\d{7,15}$/.test(n.phone_number ?? ""));

      if (purchasable.length > 0) {
        return purchasable.map((n) => ({
          phoneNumber: n.phone_number,
          countryCode: n.region_information?.[0]?.region_name ?? countryCode,
          regionCode:  n.region_information?.[0]?.region_code ?? "",
          city:        n.region_information?.[1]?.region_name ?? "",
          monthlyCost: n.cost_information?.monthly_cost ?? "0",
          features:    n.features?.map((f: any) => f.name) ?? [],
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
  connectionId?: string   // Credential Connection ID do softphone
): Promise<TenantNumber> {
  const body: any = { phone_number: phoneNumber };
  if (connectionId) body.connection_id = connectionId;

  const data = await telnyxRequest(apiKey, "POST", "/phone_numbers", body);
  return {
    id:          data.data.id,
    phoneNumber: data.data.phone_number,
    status:      data.data.status,
  };
}

export async function releaseNumber(apiKey: string, numberId: string): Promise<void> {
  await telnyxRequest(apiKey, "DELETE", `/phone_numbers/${numberId}`);
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
