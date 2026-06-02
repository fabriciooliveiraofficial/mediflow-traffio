import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const ASAAS_BASE = {
  production: "https://api.asaas.com/v3",
  sandbox:    "https://api-sandbox.asaas.com/v3",
};

export type AsaasBillingType = "PIX" | "CREDIT_CARD" | "BOLETO" | "UNDEFINED";

export interface AsaasPixResult {
  asaas_id:    string;
  invoice_url: string;
  pix_code:    string;
  pix_image:   string;
}

export interface AsaasCreditCardResult {
  asaas_id:             string;
  invoice_url:          string;
  installment_id:       string | null;   // ID do parcelamento (se installmentCount > 1)
  installment_count:    number;
  installment_value:    number;
}

export interface AsaasBoletoResult {
  asaas_id:       string;
  invoice_url:    string;
  bank_slip_url:  string;
  bar_code:       string;
}

export interface AsaasInstallmentResult {
  installment_id:   string;
  installment_count: number;
  installment_value: number;
  payments:          Array<{ asaas_id: string; due_date: string; status: string }>;
}

/**
 * AsaasClient — Wrapper para a API Asaas v3
 *
 * Suporta:
 *  - PIX
 *  - Cartão de crédito (à vista e parcelado em até 21x para Visa/Master)
 *  - Boleto bancário
 *  - Gestão de clientes (getOrCreateCustomer)
 *
 * Uso:
 *   const client = new AsaasClient(supabase, tenantId);
 *   await client.init();
 *   const result = await client.createPixPayment(...);
 */
export class AsaasClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(
    private supabase: SupabaseClient,
    private tenantId: string,
    customApiKey?: string
  ) {
    this.apiKey  = customApiKey ?? "";
    this.baseUrl = ASAAS_BASE.production;
  }

  /**
   * Carrega a API key da subconta do tenant.
   * Deve ser chamado antes de qualquer request.
   */
  async init() {
    if (this.apiKey) return;

    const { data, error } = await this.supabase
      .from("tenants")
      .select("asaas_api_key, payment_config")
      .eq("id", this.tenantId)
      .single();

    if (error || !data?.asaas_api_key) {
      throw new Error(`Asaas API Key não encontrada para o tenant ${this.tenantId}.`);
    }

    this.apiKey = data.asaas_api_key;

    // Respeita ambiente configurado na payment_config do tenant
    const env = data.payment_config?.asaas_env ?? "production";
    this.baseUrl = ASAAS_BASE[env as keyof typeof ASAAS_BASE] ?? ASAAS_BASE.production;
  }

  // ── Core HTTP helper ──────────────────────────────────────

  private async request<T = any>(
    endpoint: string,
    method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
    body?: Record<string, unknown>
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: {
        "access_token":  this.apiKey,
        "Content-Type":  "application/json",
        "User-Agent":    "Traffio-Med/1.0",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json();

    if (!res.ok) {
      const msg = data.errors?.[0]?.description ?? JSON.stringify(data);
      throw new Error(`Asaas API [${res.status}] ${endpoint}: ${msg}`);
    }

    return data as T;
  }

  // ── Customer management ───────────────────────────────────

  /**
   * Garante que o paciente exista como Customer no Asaas.
   * Evita duplicatas buscando por CPF ou e-mail antes de criar.
   */
  async getOrCreateCustomer(patient: {
    id:                  string;
    full_name:           string;
    cpf?:                string;
    email?:              string;
    phone?:              string;
    asaas_customer_id?:  string;
  }): Promise<string> {
    if (patient.asaas_customer_id) return patient.asaas_customer_id;

    // Busca por CPF ou e-mail para evitar duplicata
    if (patient.cpf || patient.email) {
      const query   = patient.cpf ? `cpfCnpj=${patient.cpf}` : `email=${patient.email}`;
      const search  = await this.request<{ data: Array<{ id: string }> }>(`/customers?${query}`);

      if (search.data?.length > 0) {
        const existingId = search.data[0].id;
        await this.supabase
          .from("patients")
          .update({ asaas_customer_id: existingId })
          .eq("id", patient.id);
        return existingId;
      }
    }

    // Cria novo customer
    const customer = await this.request<{ id: string }>("/customers", "POST", {
      name:              patient.full_name,
      cpfCnpj:           patient.cpf,
      email:             patient.email,
      mobilePhone:       patient.phone,
      externalReference: patient.id,
      notificationDisabled: false,
    });

    await this.supabase
      .from("patients")
      .update({ asaas_customer_id: customer.id })
      .eq("id", patient.id);

    return customer.id;
  }

  // ── PIX ───────────────────────────────────────────────────

  /**
   * Gera uma cobrança PIX com validade de 24h.
   */
  async createPixPayment(
    customerId:        string,
    amountCents:       number,
    description:       string,
    externalReference: string
  ): Promise<AsaasPixResult> {
    const payment = await this.request<{ id: string; invoiceUrl: string }>("/payments", "POST", {
      customer:          customerId,
      billingType:       "PIX",
      value:             amountCents / 100,
      dueDate:           this._tomorrowDate(),
      description,
      externalReference,
    });

    const pixData = await this.request<{ payload: string; encodedImage: string }>(
      `/payments/${payment.id}/pixQrCode`
    );

    return {
      asaas_id:    payment.id,
      invoice_url: payment.invoiceUrl,
      pix_code:    pixData.payload,
      pix_image:   pixData.encodedImage,
    };
  }

  // ── Boleto ────────────────────────────────────────────────

  /**
   * Gera um boleto bancário.
   * @param dueDays dias até o vencimento (default 3)
   */
  async createBoletoPayment(
    customerId:        string,
    amountCents:       number,
    description:       string,
    externalReference: string,
    dueDays:           number = 3
  ): Promise<AsaasBoletoResult> {
    const payment = await this.request<{
      id:           string;
      invoiceUrl:   string;
      bankSlipUrl:  string;
      nossoNumero:  string;
    }>("/payments", "POST", {
      customer:          customerId,
      billingType:       "BOLETO",
      value:             amountCents / 100,
      dueDate:           this._futureDateDays(dueDays),
      description,
      externalReference,
    });

    return {
      asaas_id:       payment.id,
      invoice_url:    payment.invoiceUrl,
      bank_slip_url:  payment.bankSlipUrl,
      bar_code:       payment.nossoNumero,
    };
  }

  // ── Cartão de Crédito ─────────────────────────────────────

  /**
   * Cobra no cartão de crédito, à vista ou parcelado.
   *
   * Para cartões Visa/Mastercard: até 21 parcelas.
   * Para demais bandeiras: até 12 parcelas.
   *
   * @param installmentCount 1 = à vista
   */
  async createCreditCardPayment(
    customerId:        string,
    amountCents:       number,
    description:       string,
    externalReference: string,
    card: {
      holderName:      string;
      number:          string;   // tokenizado antes de chegar aqui
      expiryMonth:     string;
      expiryYear:      string;
      ccv:             string;
    },
    holderInfo: {
      name:            string;
      email:           string;
      cpfCnpj:         string;
      postalCode:      string;
      addressNumber:   string;
      phone:           string;
    },
    installmentCount:  number = 1
  ): Promise<AsaasCreditCardResult> {
    const isInstallment = installmentCount > 1;
    const valuePerInstallment = isInstallment
      ? Math.ceil(amountCents / installmentCount) / 100
      : amountCents / 100;

    const payload: Record<string, unknown> = {
      customer:          customerId,
      billingType:       "CREDIT_CARD",
      value:             amountCents / 100,
      dueDate:           this._tomorrowDate(),
      description,
      externalReference,
      creditCard: {
        holderName:  card.holderName,
        number:      card.number,
        expiryMonth: card.expiryMonth,
        expiryYear:  card.expiryYear,
        ccv:         card.ccv,
      },
      creditCardHolderInfo: {
        name:          holderInfo.name,
        email:         holderInfo.email,
        cpfCnpj:       holderInfo.cpfCnpj,
        postalCode:    holderInfo.postalCode,
        addressNumber: holderInfo.addressNumber,
        phone:         holderInfo.phone,
      },
    };

    if (isInstallment) {
      payload.installmentCount = installmentCount;
      payload.installmentValue = valuePerInstallment;
    }

    const payment = await this.request<{
      id:               string;
      invoiceUrl:       string;
      installment?:     string;
    }>("/payments", "POST", payload);

    return {
      asaas_id:           payment.id,
      invoice_url:        payment.invoiceUrl,
      installment_id:     payment.installment ?? null,
      installment_count:  installmentCount,
      installment_value:  valuePerInstallment,
    };
  }

  /**
   * Busca as cobranças individuais de um parcelamento.
   * Útil para registrar cada parcela em billing_installments.
   */
  async getInstallmentPayments(installmentId: string): Promise<AsaasInstallmentResult> {
    const data = await this.request<{
      id:              string;
      installmentCount: number;
      value:           number;
      paymentCount?:   number;
    }>(`/installments/${installmentId}`);

    const paymentsData = await this.request<{
      data: Array<{ id: string; dueDate: string; status: string }>;
    }>(`/installments/${installmentId}/payments`);

    return {
      installment_id:    installmentId,
      installment_count: data.installmentCount,
      installment_value: data.value,
      payments: paymentsData.data.map((p) => ({
        asaas_id: p.id,
        due_date: p.dueDate,
        status:   p.status,
      })),
    };
  }

  // ── Billing record helper ─────────────────────────────────

  /**
   * Persiste um billing_record no banco após criar a cobrança no Asaas.
   */
  async saveBillingRecord(params: {
    patientId?:       string;
    appointmentId?:   string;
    asaas_billing_id: string;
    asaas_customer_id?: string;
    amount:           number;  // em centavos
    billingType:      AsaasBillingType;
    installmentCount: number;
    installmentValue?: number;
    description?:     string;
    dueDate?:         string;
    invoiceUrl?:      string;
    bankSlipUrl?:     string;
    pixQrCode?:       string;
    pixCopyPaste?:    string;
  }): Promise<string> {
    const { data, error } = await this.supabase
      .from("billing_records")
      .insert({
        tenant_id:         this.tenantId,
        patient_id:        params.patientId ?? null,
        appointment_id:    params.appointmentId ?? null,
        asaas_billing_id:  params.asaas_billing_id,
        asaas_customer_id: params.asaas_customer_id ?? null,
        amount:            params.amount / 100,
        billing_type:      params.billingType,
        installment_count: params.installmentCount,
        installment_value: params.installmentValue ? params.installmentValue / 100 : null,
        status:            "PENDING",
        description:       params.description ?? null,
        due_date:          params.dueDate ?? null,
        invoice_url:       params.invoiceUrl ?? null,
        bank_slip_url:     params.bankSlipUrl ?? null,
        pix_qr_code:       params.pixQrCode ?? null,
        pix_copy_paste:    params.pixCopyPaste ?? null,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Failed to save billing_record: ${error.message}`);
    return data.id;
  }

  // ── Date helpers ──────────────────────────────────────────

  private _tomorrowDate(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  }

  private _futureDateDays(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split("T")[0];
  }
}
