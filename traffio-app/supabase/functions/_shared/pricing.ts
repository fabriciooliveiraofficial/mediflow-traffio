export const EXCHANGE_RATE_USD_BRL = 5.50;
export const MARKUP_MULTIPLIER = 2.0;

export interface ResourcePricing {
  unitCostUsd: number;
  telnyxCostBrl: number;
  totalPriceBrl: number;
}

/**
 * Retorna os valores para aquisição/mensalidade de números
 */
export function getNumberPricing(countryCode: string): ResourcePricing {
  const code = countryCode?.toUpperCase() ?? "US";
  let costUsd = 1.00; // US local default
  
  if (code === "BR") {
    costUsd = 3.00;
  } else if (code === "NZ") {
    costUsd = 3.00;
  } else if (["MX", "CO", "AR", "PT", "ES"].includes(code)) {
    costUsd = 3.00;
  }
  
  const costBrl = costUsd * EXCHANGE_RATE_USD_BRL;
  const priceBrl = costBrl * MARKUP_MULTIPLIER;
  
  return {
    unitCostUsd: costUsd,
    telnyxCostBrl: parseFloat(costBrl.toFixed(6)),
    totalPriceBrl: parseFloat(priceBrl.toFixed(2)), // Mensalidades arredondadas para 2 casas decimais
  };
}

/**
 * Retorna os valores para SMS e MMS
 */
export function getSmsPricing(countryCode: string, type: "sms" | "mms" = "sms"): ResourcePricing {
  const code = countryCode?.toUpperCase() ?? "US";
  let costUsd = 0.0040; // US SMS default
  
  if (type === "mms") {
    if (code === "US" || code === "CA") {
      costUsd = 0.0150;
    } else {
      costUsd = 0.0500; // NZ and fallback
    }
  } else {
    // sms
    if (code === "BR") {
      costUsd = 0.0350;
    } else if (code === "NZ") {
      costUsd = 0.0500;
    } else if (code === "US" || code === "CA") {
      costUsd = 0.0040;
    } else {
      costUsd = 0.0100; // standard fallback
    }
  }

  const costBrl = costUsd * EXCHANGE_RATE_USD_BRL;
  const priceBrl = costBrl * MARKUP_MULTIPLIER;
  
  return {
    unitCostUsd: costUsd,
    telnyxCostBrl: parseFloat(costBrl.toFixed(6)),
    totalPriceBrl: parseFloat(priceBrl.toFixed(6)),
  };
}

/**
 * Retorna os valores para mensagens de WhatsApp Cloud API (Meta, Tech Provider
 * direto — sem margem de BSP). Meta já cota em BRL (não USD como a Telnyx), então
 * o "custo" parte direto do BRL; unitCostUsd é um equivalente sintético só para o
 * trigger calculate_tenant_usage_profit() recalcular telnyx_cost_brl/total_price_brl
 * com a mesma fórmula (unit_cost_usd × quantity × EXCHANGE_RATE_USD_BRL × MARKUP).
 * Categoria "service" (conversa iniciada pelo paciente) é gratuita — não chamar esta
 * função para ela.
 */
export function getCloudApiPricing(category: "marketing" | "utility"): ResourcePricing {
  const costBrl = category === "marketing" ? 0.31 : 0.03;
  const priceBrl = costBrl * MARKUP_MULTIPLIER;

  return {
    unitCostUsd: parseFloat((costBrl / EXCHANGE_RATE_USD_BRL).toFixed(6)),
    telnyxCostBrl: costBrl,
    totalPriceBrl: parseFloat(priceBrl.toFixed(6)),
  };
}

/**
 * Retorna os valores de Voz por minuto (inclui $0.0025/min de gravação)
 */
export function getCallPricing(phoneNumber: string | undefined, direction: "inbound" | "outbound" = "inbound"): ResourcePricing {
  // Tentar deduzir o país com base no DDI do telefone
  // +55 -> BR, +64 -> NZ, +1 -> US/CA
  let code = "US";
  let isCellPhone = false;

  if (phoneNumber) {
    const cleanPhone = phoneNumber.replace(/\D/g, "");
    if (cleanPhone.startsWith("55")) {
      code = "BR";
      // Celulares no Brasil começam com 9 depois do DDI e DDD de 2 dígitos. Ex: 55119...
      const withoutDdi = cleanPhone.substring(2);
      if (withoutDdi.length >= 9 && withoutDdi.charAt(2) === "9") {
        isCellPhone = true;
      }
    } else if (cleanPhone.startsWith("64")) {
      code = "NZ";
      // Celulares na Nova Zelândia costumam começar com 2 (ex: +64 21, +64 22)
      const withoutDdi = cleanPhone.substring(2);
      if (withoutDdi.startsWith("2")) {
        isCellPhone = true;
      }
    } else if (cleanPhone.startsWith("1")) {
      code = "US";
    }
  }

  let costUsd = 0.0050; // US default
  
  if (code === "BR") {
    // 0.0095 for Fixo, 0.0225 for Celular (includes $0.0025 recording fee)
    costUsd = isCellPhone ? 0.0225 : 0.0095;
  } else if (code === "NZ") {
    // 0.0170 for Fixo, 0.0697 for Celular (includes $0.0025 recording fee)
    costUsd = isCellPhone ? 0.0697 : 0.0170;
  } else {
    // US / CA default: inbound/outbound base + $0.0025 recording
    costUsd = direction === "inbound" ? 0.0040 + 0.0025 : 0.0130 + 0.0025;
  }

  const costBrl = costUsd * EXCHANGE_RATE_USD_BRL;
  const priceBrl = costBrl * MARKUP_MULTIPLIER;
  
  return {
    unitCostUsd: costUsd,
    telnyxCostBrl: parseFloat(costBrl.toFixed(6)),
    totalPriceBrl: parseFloat(priceBrl.toFixed(6)),
  };
}
