/**
 * telnyx-number-orders — Edge Function
 *
 * Gerencia o ciclo de vida de pedidos de número com KYC.
 *
 * POST { action: "create_order", phone_number, country_code, holder_type, holder_info, friendly_name }
 *   → Para países sem KYC: compra imediato. Para países com KYC: cria pedido pending_docs.
 *
 * GET  ?action=get_order&order_id=...
 *   → Retorna pedido + documentos + holder_info
 *
 * GET  ?action=list_orders
 *   → Lista pedidos ativos do tenant
 *
 * POST { action: "submit_docs", order_id }
 *   → Marca como docs_submitted, cria order na Telnyx, inicia análise
 *
 * POST { action: "cancel_order", order_id }
 *   → Cancela pedido pendente
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { getTelnyxApiKey, getTelnyxConnectionId } from "../_shared/masterConfig.ts";
import {
  purchaseNumber, createNumberOrder, releaseNumber,
  getRequirements, createAddress, uploadDocument, createRequirementGroup, fillRequirementGroup,
} from "../_shared/telnyxClient.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Países que exigem KYC antes da compra
const KYC_COUNTRIES = new Set(["BR", "AR", "MX", "CO", "PT", "ES"]);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({}, 200);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase    = createClient(supabaseUrl, serviceKey);

  try {
    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const { data: { user } } = await supabase.auth.getUser(jwt);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { data: member } = await supabase
      .from("members")
      .select("tenant_id, role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!member) return json({ error: "Tenant not found" }, 404);
    if (!["owner", "admin"].includes(member.role)) return json({ error: "Insufficient permissions" }, 403);

    const tenantId = member.tenant_id;

    const { data: tenant } = await supabase
      .from("tenants")
      .select("telnyx_api_key, telnyx_app_id")
      .eq("id", tenantId)
      .maybeSingle();

    const apiKey       = await getTelnyxApiKey(supabase, tenant?.telnyx_api_key);
    const connectionId = await getTelnyxConnectionId(supabase, tenant?.telnyx_app_id);
    if (!apiKey) return json({ error: "Telnyx não configurado. Configure TELNYX_API_KEY em /master/intelligence" }, 400);

    // ── GET ──────────────────────────────────────────────────────────────────
    if (req.method === "GET") {
      const url    = new URL(req.url);
      const action = url.searchParams.get("action");

      if (action === "get_order") {
        const orderId = url.searchParams.get("order_id");
        if (!orderId) return json({ error: "order_id required" }, 400);

        const { data: order } = await supabase
          .from("number_order_requests")
          .select("*, number_order_holder_info(*), number_order_documents(*)")
          .eq("id", orderId)
          .eq("tenant_id", tenantId)
          .single();

        if (!order) return json({ error: "Order not found" }, 404);
        return json({ data: order });
      }

      if (action === "list_orders") {
        const { data: orders } = await supabase
          .from("number_order_requests")
          .select("*, number_order_documents(id, document_type, status)")
          .eq("tenant_id", tenantId)
          .not("status", "in", '("completed","cancelled")')
          .order("created_at", { ascending: false });

        return json({ data: orders ?? [] });
      }

      // Lista os requisitos regulatórios da Telnyx para país+tipo, e indica se
      // o tenant já possui um requirement_group preenchido para reuso silencioso.
      if (action === "get_requirements") {
        const country         = url.searchParams.get("country");
        const phoneNumberType = url.searchParams.get("type") ?? "local";
        if (!country) return json({ error: "country required" }, 400);

        const countryCode = country.toUpperCase();

        let requirements: any[] = [];
        let effectiveType = phoneNumberType;
        try {
          const result = await getRequirements(apiKey, countryCode, phoneNumberType);
          requirements  = result.requirements;
          effectiveType = result.phoneNumberType;
        } catch (e: any) {
          console.error(`[telnyx-number-orders] getRequirements failed: ${e.message}`);
          return json({ error: `Telnyx: ${e.message}` }, 502);
        }

        const { data: cached } = await supabase
          .from("tenant_requirement_groups")
          .select("telnyx_requirement_group_id, status, regulatory_requirements, updated_at")
          .eq("tenant_id", tenantId)
          .eq("country_code", countryCode)
          .eq("phone_number_type", effectiveType)
          .maybeSingle();

        return json({ data: { requirements, cached: cached ?? null, phone_number_type: effectiveType } });
      }

      return json({ error: "Unknown action" }, 400);
    }

    // ── POST (multipart) ────────────────────────────────────────────────────
    // Upload de documento regulatório (requirement do tipo "document") direto
    // para a Telnyx — usado por submit_regulatory_info em seguida.
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const action = form.get("action");

      if (action === "upload_regulatory_document") {
        const file = form.get("file");
        if (!(file instanceof File)) return json({ error: "file required" }, 400);

        try {
          const documentId = await uploadDocument(apiKey, file, file.name);
          return json({ data: { document_id: documentId, file_name: file.name } });
        } catch (e: any) {
          return json({ error: `Telnyx: ${e.message}` }, 502);
        }
      }

      return json({ error: `Unknown action: ${action}` }, 400);
    }

    // ── POST ─────────────────────────────────────────────────────────────────
    const body = await req.json();
    const { action } = body;

    // ── create_order ─────────────────────────────────────────────────────────
    if (action === "create_order") {
      const { phone_number, country_code, phone_number_type, holder_type, holder_info, friendly_name } = body;
      if (!phone_number || !country_code) return json({ error: "phone_number e country_code são obrigatórios" }, 400);

      const needsKyc = KYC_COUNTRIES.has(country_code.toUpperCase());

      if (!needsKyc) {
        // Validar que o número não é um placeholder mascarado
        if (phone_number.includes("-")) {
          return json({ error: "Número inválido. Este número não está disponível para compra. Busque novamente." }, 422);
        }

        // Reusar requirement_group já preenchido para este tenant/país, se houver.
        // Busca por país (sem exigir match de tipo): o tipo enviado pelo frontend
        // é um palpite — a Telnyx não informa o tipo em /available_phone_numbers —
        // e na prática há um grupo por tenant+país. Priorizar match exato de tipo.
        const { data: cachedGroups } = await supabase
          .from("tenant_requirement_groups")
          .select("telnyx_requirement_group_id, phone_number_type")
          .eq("tenant_id", tenantId)
          .eq("country_code", country_code.toUpperCase());
        const exactMatch = (cachedGroups ?? []).find((g) => g.phone_number_type === phone_number_type);
        const requirementGroupId: string | undefined =
          (exactMatch ?? (cachedGroups ?? [])[0])?.telnyx_requirement_group_id;

        // Compra imediata — sem KYC
        let result: any;
        try {
          result = await purchaseNumber(apiKey, phone_number, connectionId || undefined, requirementGroupId);
        } catch (purchaseErr: any) {
          const msg = (purchaseErr.message ?? "").toLowerCase();
          if (
            msg.includes("not be found") || msg.includes("not found") || msg.includes("404") ||
            msg.includes("unavailable") || msg.includes("not available") || msg.includes("no longer available") ||
            msg.includes("don't recognize") || msg.includes("do not recognize") || msg.includes("did you first search")
          ) {
            return json({ error: "Número não disponível para compra. Ele pode ter sido reservado por outro cliente ou já foi adquirido anteriormente. Por favor, busque um novo número." }, 422);
          }
          throw purchaseErr;
        }

        // Salvar no banco — se falhar, liberar o número para não ficar órfão na Telnyx
        const { error: insertErr } = await supabase.from("tenant_phone_numbers").insert({
          tenant_id:        tenantId,
          phone_number:     result.phoneNumber ?? phone_number,
          telnyx_number_id: result.id,
          friendly_name:    friendly_name ?? null,
          country_code:     country_code.toUpperCase(),
          is_active:        true,
          capabilities:     { voice: true, sms: true },
        });

        if (insertErr) {
          // Tentar liberar o número na Telnyx para evitar cobrança
          try {
            await releaseNumber(apiKey, result.id);
            console.error(`[telnyx-number-orders] Released ${phone_number} after DB failure: ${insertErr.message}`);
          } catch (releaseErr: any) {
            console.error(`[telnyx-number-orders] CRITICAL: number ${phone_number} (${result.id}) purchased but NOT saved. Manual release needed. DB error: ${insertErr.message}`);
          }
          throw new Error(`Erro ao salvar número no banco de dados: ${insertErr.message}`);
        }

        const pendingReview = result.requirementsMet === false;

        await logAudit(supabase, tenantId, user.id, "number_purchased_instant", phone_number,
          pendingReview ? { requirements_status: result.requirementsStatus } : undefined);
        console.log(`[telnyx-number-orders] ✓ Instant purchase: ${phone_number} | tenant: ${tenantId}` +
          (pendingReview ? ` (pending requirements review: ${result.requirementsStatus})` : ""));

        return json({ data: {
          instant:         true,
          phone_number:    result.phoneNumber ?? phone_number,
          status:          pendingReview ? "pending_review" : "completed",
          pending_review:  pendingReview,
        } });
      }

      // KYC — criar pedido
      const { data: order, error: orderErr } = await supabase
        .from("number_order_requests")
        .insert({
          tenant_id:    tenantId,
          phone_number,
          country_code: country_code.toUpperCase(),
          status:       "pending_docs",
        })
        .select()
        .single();

      if (orderErr || !order) throw new Error(`Erro ao criar pedido: ${orderErr?.message}`);

      // Salvar dados do titular
      if (holder_info && holder_type) {
        await supabase.from("number_order_holder_info").insert({
          order_id:    order.id,
          tenant_id:   tenantId,
          holder_type,
          ...holder_info,
        });
      }

      await logAudit(supabase, tenantId, user.id, "number_order_created", phone_number, { order_id: order.id, country_code });
      console.log(`[telnyx-number-orders] ✓ Order created: ${order.id} | ${phone_number} | tenant: ${tenantId}`);
      return json({ data: { instant: false, order_id: order.id, status: "pending_docs", phone_number } }, 201);
    }

    // ── submit_regulatory_info ───────────────────────────────────────────────
    // Recebe os dados preenchidos pelo usuário no formulário dinâmico de
    // requisitos regulatórios da Telnyx, cria/preenche um requirement_group e
    // cacheia o resultado para reuso silencioso em compras futuras do mesmo
    // tenant + país + tipo de número.
    if (action === "submit_regulatory_info") {
      const { country_code, phone_number_type, regulatory_data } = body;
      if (!country_code || !phone_number_type || !Array.isArray(regulatory_data)) {
        return json({ error: "country_code, phone_number_type e regulatory_data são obrigatórios" }, 400);
      }

      const countryCode = country_code.toUpperCase();

      // Re-resolver o tipo efetivo no servidor — o frontend pode mandar um
      // palpite ("local") que difere do tipo real do requisito na Telnyx.
      // Garante que chave de cache e requirement_group usem sempre o mesmo tipo.
      let effectiveType = phone_number_type;
      try {
        const resolved = await getRequirements(apiKey, countryCode, phone_number_type);
        effectiveType = resolved.phoneNumberType;
      } catch { /* mantém o tipo enviado */ }

      // Resolver field_value de cada requirement conforme seu tipo
      const regulatoryRequirements: { requirement_id: string; field_value: string }[] = [];
      try {
        for (const item of regulatory_data) {
          if (item.type === "address") {
            const addr = item.address ?? {};
            const addressId = await createAddress(apiKey, {
              firstName:          addr.firstName,
              lastName:           addr.lastName,
              businessName:       addr.businessName,
              streetAddress:      addr.streetAddress,
              locality:           addr.locality,
              administrativeArea: addr.administrativeArea,
              postalCode:         addr.postalCode,
              countryCode,
            });
            regulatoryRequirements.push({ requirement_id: item.requirement_id, field_value: addressId });
          } else if (item.type === "document") {
            if (!item.document_id) return json({ error: `document_id ausente para o requisito ${item.requirement_id}` }, 400);
            regulatoryRequirements.push({ requirement_id: item.requirement_id, field_value: item.document_id });
          } else {
            regulatoryRequirements.push({ requirement_id: item.requirement_id, field_value: item.value ?? "" });
          }
        }
      } catch (e: any) {
        return json({ error: `Telnyx: ${e.message}` }, 502);
      }

      // Reusar requirement_group existente (se houver) ou criar um novo
      const { data: existingGroup } = await supabase
        .from("tenant_requirement_groups")
        .select("telnyx_requirement_group_id")
        .eq("tenant_id", tenantId)
        .eq("country_code", countryCode)
        .eq("phone_number_type", effectiveType)
        .maybeSingle();

      let groupId: string;
      try {
        if (existingGroup?.telnyx_requirement_group_id) {
          groupId = existingGroup.telnyx_requirement_group_id;
          await fillRequirementGroup(apiKey, groupId, regulatoryRequirements);
        } else {
          groupId = await createRequirementGroup(apiKey, countryCode, effectiveType);
          await fillRequirementGroup(apiKey, groupId, regulatoryRequirements);
        }
      } catch (e: any) {
        return json({ error: `Telnyx: ${e.message}` }, 502);
      }

      await supabase.from("tenant_requirement_groups").upsert({
        tenant_id:                   tenantId,
        country_code:                countryCode,
        phone_number_type:           effectiveType,
        telnyx_requirement_group_id: groupId,
        regulatory_requirements:     regulatoryRequirements,
        status:                      "unapproved",
        updated_at:                  new Date().toISOString(),
      }, { onConflict: "tenant_id,country_code,phone_number_type" });

      await logAudit(supabase, tenantId, user.id, "regulatory_info_submitted", "", {
        country_code: countryCode, phone_number_type: effectiveType, requirement_group_id: groupId,
      });
      console.log(`[telnyx-number-orders] ✓ Requirement group ${groupId} preenchido | ${countryCode}/${effectiveType} | tenant: ${tenantId}`);

      return json({ data: { requirement_group_id: groupId } });
    }

    // ── submit_docs ───────────────────────────────────────────────────────────
    if (action === "submit_docs") {
      const { order_id } = body;
      if (!order_id) return json({ error: "order_id required" }, 400);

      const { data: order } = await supabase
        .from("number_order_requests")
        .select("*")
        .eq("id", order_id)
        .eq("tenant_id", tenantId)
        .single();

      if (!order) return json({ error: "Order not found" }, 404);
      if (!["pending_docs", "rejected"].includes(order.status)) {
        return json({ error: `Pedido não pode ser submetido no status '${order.status}'` }, 400);
      }

      // Criar order formal na Telnyx
      let telnyxOrderId: string | null = null;
      try {
        const telnyxOrder = await createNumberOrder(
          apiKey,
          [order.phone_number],
          connectionId || undefined
        );
        telnyxOrderId = telnyxOrder.id;
      } catch (e: any) {
        console.warn(`[telnyx-number-orders] Telnyx order creation failed (will retry): ${e.message}`);
      }

      await supabase
        .from("number_order_requests")
        .update({
          status:          "docs_submitted",
          telnyx_order_id: telnyxOrderId,
          submitted_at:    new Date().toISOString(),
          updated_at:      new Date().toISOString(),
        })
        .eq("id", order_id);

      await logAudit(supabase, tenantId, user.id, "number_order_docs_submitted", order.phone_number, { order_id, telnyx_order_id: telnyxOrderId });
      console.log(`[telnyx-number-orders] ✓ Docs submitted: ${order_id}`);
      return json({ data: { order_id, status: "docs_submitted" } });
    }

    // ── cancel_order ─────────────────────────────────────────────────────────
    if (action === "cancel_order") {
      const { order_id } = body;
      if (!order_id) return json({ error: "order_id required" }, 400);

      const { data: order } = await supabase
        .from("number_order_requests")
        .select("status, phone_number")
        .eq("id", order_id)
        .eq("tenant_id", tenantId)
        .single();

      if (!order) return json({ error: "Order not found" }, 404);
      if (!["pending_docs", "rejected"].includes(order.status)) {
        return json({ error: "Apenas pedidos pendentes ou rejeitados podem ser cancelados" }, 400);
      }

      await supabase
        .from("number_order_requests")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", order_id);

      await logAudit(supabase, tenantId, user.id, "number_order_cancelled", order.phone_number, { order_id });
      return json({ data: { order_id, status: "cancelled" } });
    }

    return json({ error: `Unknown action: ${action}` }, 400);

  } catch (err: any) {
    console.error("[telnyx-number-orders] Error:", err.message);
    return json({ error: err.message }, 500);
  }
});

async function logAudit(supabase: any, tenantId: string, userId: string, action: string, phone: string, extra?: any) {
  try {
    await supabase.from("audit_logs").insert({
      tenant_id:  tenantId,
      user_id:    userId,
      action,
      table_name: "number_order_requests",
      new_data:   { phone_number: phone, ...extra },
    });
  } catch (e: any) {
    console.error(`[telnyx-number-orders] logAudit failed: ${e.message}`);
  }
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
