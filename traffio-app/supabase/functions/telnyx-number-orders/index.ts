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
  getRequirements, createAddress, uploadDocument, createRequirementGroup, fillRequirementGroup, getAddress,
  associateRequirementGroupWithSubOrder
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

      if (action === "get_resubmit_details") {
        const orderId = url.searchParams.get("order_id");
        if (!orderId) return json({ error: "order_id required" }, 400);

        const { data: order } = await supabase
          .from("number_order_requests")
          .select("*")
          .eq("id", orderId)
          .eq("tenant_id", tenantId)
          .single();

        if (!order) return json({ error: "Order not found" }, 404);
        if (!order.telnyx_order_id) {
          // Se o pedido ainda não foi pra Telnyx (apenas local pending_docs),
          // devolvemos as exigências base do país.
          let requirements: any[] = [];
          let effectiveType = "local";
          try {
            const result = await getRequirements(apiKey, order.country_code, "local");
            requirements = result.requirements;
            effectiveType = result.phoneNumberType;
          } catch (e: any) {
            console.error(`[telnyx-number-orders] getRequirements failed: ${e.message}`);
          }

          const mergedRequirements = requirements.map((r: any) => ({
            id: r.id,
            name: r.name,
            type: r.type,
            description: r.description || "",
            example: r.example || "",
            acceptanceCriteria: r.acceptanceCriteria || {},
            status: "pending",
            field_value: ""
          }));

          const { data: cached } = await supabase
            .from("tenant_requirement_groups")
            .select("telnyx_requirement_group_id, status, regulatory_requirements, updated_at")
            .eq("tenant_id", tenantId)
            .eq("country_code", order.country_code)
            .eq("phone_number_type", effectiveType)
            .maybeSingle();

          const resolvedAddresses: Record<string, any> = {};
          if (cached?.regulatory_requirements) {
            for (const reqVal of cached.regulatory_requirements) {
              const reqId = reqVal.requirement_id;
              const reqType = requirements.find((r) => r.id === reqId);
              
              if (reqType?.type === "address" && reqVal.field_value && !resolvedAddresses[reqId]) {
                try {
                  const addrData = await getAddress(apiKey, reqVal.field_value);
                  if (addrData) {
                    resolvedAddresses[reqId] = {
                      firstName:          addrData.first_name ?? "",
                      lastName:           addrData.last_name ?? "",
                      businessName:       addrData.business_name ?? "",
                      streetAddress:      addrData.street_address ?? "",
                      locality:           addrData.locality ?? "",
                      administrativeArea: addrData.administrative_area ?? "",
                      postalCode:         addrData.postal_code ?? "",
                    };
                  }
                } catch (addrErr: any) {
                  console.error(`Failed to resolve cached address:`, addrErr.message);
                }
              }
            }
          }

          return json({
            data: {
              order_id: order.id,
              telnyx_order_id: null,
              sub_number_order_id: null,
              country_code: order.country_code,
              phone_number: order.phone_number,
              requirements: mergedRequirements,
              resolved_addresses: resolvedAddresses,
              cached: cached ?? null
            }
          });
        }

        // 1. Buscar ordem na Telnyx
        const resOrder = await fetch(`https://api.telnyx.com/v2/number_orders/${order.telnyx_order_id}`, {
          headers: { "Authorization": `Bearer ${apiKey}` }
        });
        if (!resOrder.ok) {
          const errText = await resOrder.text();
          throw new Error(`Failed to fetch Telnyx order: ${errText}`);
        }
        const telnyxOrder = await resOrder.json();
        const telnyxOrderData = telnyxOrder.data;

        const subNumberOrderId = telnyxOrderData?.sub_number_orders_ids?.[0] || null;

        // 2. Extrair os requisitos pendentes/existentes da ordem
        const phoneNumbers = telnyxOrderData?.phone_numbers || [];
        const orderRequirements = phoneNumbers[0]?.regulatory_requirements || [];

        // 3. Buscar os metadados de exigências do país
        let requirements: any[] = [];
        let effectiveType = "local";
        try {
          const result = await getRequirements(apiKey, order.country_code, "local");
          requirements  = result.requirements;
          effectiveType = result.phoneNumberType;
        } catch (e: any) {
          console.error(`[telnyx-number-orders] getRequirements failed: ${e.message}`);
        }

        // 4. Cruzar exigências do pedido com metadados detalhados
        const mergedRequirements = orderRequirements.map((or: any) => {
          const definition = requirements.find(r => r.id === or.requirement_id);
          return {
            id: or.requirement_id,
            name: definition?.name || or.field_type,
            type: or.field_type,
            description: definition?.description || "",
            example: definition?.example || "",
            acceptanceCriteria: definition?.acceptanceCriteria || {},
            status: or.status, // "awaiting-value", "approved", "declined" etc.
            field_value: or.field_value
          };
        });

        // 5. Se houver algum endereço preenchido, resolver os detalhes dele para pre-população
        const resolvedAddresses: Record<string, any> = {};
        for (const reqVal of orderRequirements) {
          if (reqVal.field_type === "address" && reqVal.field_value) {
            try {
              const addrData = await getAddress(apiKey, reqVal.field_value);
              if (addrData) {
                resolvedAddresses[reqVal.requirement_id] = {
                  firstName:          addrData.first_name ?? "",
                  lastName:           addrData.last_name ?? "",
                  businessName:       addrData.business_name ?? "",
                  streetAddress:      addrData.street_address ?? "",
                  locality:           addrData.locality ?? "",
                  administrativeArea: addrData.administrative_area ?? "",
                  postalCode:         addrData.postal_code ?? "",
                };
              }
            } catch (addrErr: any) {
              console.error(`Failed to resolve address ${reqVal.field_value}:`, addrErr.message);
            }
          }
        }

        // 6. Verificar se há cache em tenant_requirement_groups para preencher o que falta
        const { data: cached } = await supabase
          .from("tenant_requirement_groups")
          .select("telnyx_requirement_group_id, status, regulatory_requirements, updated_at")
          .eq("tenant_id", tenantId)
          .eq("country_code", order.country_code)
          .eq("phone_number_type", effectiveType)
          .maybeSingle();

        if (cached?.regulatory_requirements) {
          for (const reqVal of cached.regulatory_requirements) {
            const reqId = reqVal.requirement_id;
            const reqType = requirements.find((r) => r.id === reqId);
            if (reqType?.type === "address" && reqVal.field_value && !resolvedAddresses[reqId]) {
              try {
                const addrData = await getAddress(apiKey, reqVal.field_value);
                if (addrData) {
                  resolvedAddresses[reqId] = {
                    firstName:          addrData.first_name ?? "",
                    lastName:           addrData.last_name ?? "",
                    businessName:       addrData.business_name ?? "",
                    streetAddress:      addrData.street_address ?? "",
                    locality:           addrData.locality ?? "",
                    administrativeArea: addrData.administrative_area ?? "",
                    postalCode:         addrData.postal_code ?? "",
                  };
                }
              } catch (addrErr: any) {
                console.error(`Failed to resolve cached address:`, addrErr.message);
              }
            }
          }
        }

        return json({
          data: {
            order_id: order.id,
            telnyx_order_id: order.telnyx_order_id,
            sub_number_order_id: subNumberOrderId,
            country_code: order.country_code,
            phone_number: order.phone_number,
            requirements: mergedRequirements,
            resolved_addresses: resolvedAddresses,
            cached: cached ?? null
          }
        });
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

        const resolvedAddresses: Record<string, any> = {};
        if (cached?.regulatory_requirements) {
          for (const reqVal of cached.regulatory_requirements) {
            const reqId = reqVal.requirement_id;
            const reqType = requirements.find((r) => r.id === reqId);
            if (reqType?.type === "address" && reqVal.field_value) {
              try {
                const addrData = await getAddress(apiKey, reqVal.field_value);
                if (addrData) {
                  resolvedAddresses[reqId] = {
                    firstName:          addrData.first_name ?? "",
                    lastName:           addrData.last_name ?? "",
                    businessName:       addrData.business_name ?? "",
                    streetAddress:      addrData.street_address ?? "",
                    locality:           addrData.locality ?? "",
                    administrativeArea: addrData.administrative_area ?? "",
                    postalCode:         addrData.postal_code ?? "",
                  };
                }
              } catch (addrErr: any) {
                console.error(`[get_requirements] Failed to resolve address ${reqVal.field_value}:`, addrErr.message);
              }
            }
          }
        }

        return json({
          data: {
            requirements,
            cached: cached ?? null,
            resolved_addresses: resolvedAddresses,
            phone_number_type: effectiveType,
          },
        });
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

        // Tentar resolver os requisitos silenciosamente
        let requirementGroupId: string | undefined = undefined;
        try {
          const satisfaction = await satisfyRequirementsSilently(supabase, apiKey, tenantId, country_code, phone_number_type || "local");
          if (satisfaction.documentUploadRequired) {
            // Se exigir documento, devolve erro especial para o frontend
            return json({
              error: "DOCUMENT_UPLOAD_REQUIRED",
              message: "Este número requer o envio de um comprovante de endereço ou documento oficial.",
              requirements: satisfaction.requirements,
              phone_number_type: satisfaction.requirements?.[0]?.phone_number_type || phone_number_type || "local"
            }, 400);
          }
          if (satisfaction.requirementGroupId) {
            requirementGroupId = satisfaction.requirementGroupId;
          }
        } catch (satisfyErr: any) {
          return json({ error: satisfyErr.message }, 400);
        }

        // Compra imediata — sem KYC formal do Traffio (mas pode usar o requirementGroupId silencioso)
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

        const pendingReview = result.requirementsMet === false || !!requirementGroupId;

        // Salvar no banco — se falhar, liberar o número para não ficar órfão na Telnyx
        const { error: insertErr } = await supabase.from("tenant_phone_numbers").insert({
          tenant_id:        tenantId,
          phone_number:     result.phoneNumber ?? phone_number,
          telnyx_number_id: result.id,
          friendly_name:    friendly_name ?? null,
          country_code:     country_code.toUpperCase(),
          is_active:        !pendingReview,
          capabilities:     { voice: true, sms: true },
        });

        if (insertErr) {
          try {
            await releaseNumber(apiKey, result.id);
            console.error(`[telnyx-number-orders] Released ${phone_number} after DB failure: ${insertErr.message}`);
          } catch (releaseErr: any) {
            console.error(`[telnyx-number-orders] CRITICAL: number ${phone_number} (${result.id}) purchased but NOT saved. Manual release needed. DB error: ${insertErr.message}`);
          }
          throw new Error(`Erro ao salvar número no banco de dados: ${insertErr.message}`);
        }

        if (pendingReview) {
          // Criar uma solicitação de ordem no banco de dados para rastreamento pelo webhook
          await supabase.from("number_order_requests").insert({
            tenant_id:       tenantId,
            phone_number:    result.phoneNumber ?? phone_number,
            country_code:    country_code.toUpperCase(),
            status:          "under_review",
            telnyx_order_id: result.numberOrderId,
            submitted_at:    new Date().toISOString(),
          });
        }

        await logAudit(supabase, tenantId, user.id, "number_purchased_instant", phone_number,
          pendingReview ? { requirements_status: result.requirementsStatus, telnyx_order_id: result.numberOrderId } : undefined);
        console.log(`[telnyx-number-orders] ✓ Instant purchase: ${phone_number} | tenant: ${tenantId}` +
          (pendingReview ? ` (pending requirements review: ${result.requirementsStatus})` : ""));

        return json({ data: {
          instant:         true,
          phone_number:    result.phoneNumber ?? phone_number,
          status:          pendingReview ? "pending_review" : "completed",
          pending_review:  pendingReview,
        } });
      }

      // KYC — verificar se já existe um pedido em andamento (qualquer status exceto completed e cancelled)
      const { data: existingOrder } = await supabase
        .from("number_order_requests")
        .select("id, status")
        .eq("tenant_id", tenantId)
        .eq("phone_number", phone_number)
        .not("status", "in", '("completed","cancelled")')
        .maybeSingle();

      if (existingOrder) {
        // Atualizar dados do titular se fornecido
        if (holder_info && holder_type) {
          const { error: holderErr } = await supabase.from("number_order_holder_info").upsert({
            order_id:    existingOrder.id,
            tenant_id:   tenantId,
            holder_type,
            ...holder_info,
          }, { onConflict: "order_id" });
          if (holderErr) {
            console.error(`[telnyx-number-orders] Error updating holder info:`, holderErr.message);
          }
        }

        await logAudit(supabase, tenantId, user.id, "number_order_reused", phone_number, { order_id: existingOrder.id, country_code });
        console.log(`[telnyx-number-orders] ✓ Order reused: ${existingOrder.id} | ${phone_number} | tenant: ${tenantId}`);
        return json({ data: { instant: false, order_id: existingOrder.id, status: existingOrder.status, phone_number } }, 200);
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
      const { country_code, phone_number_type, regulatory_data, sub_number_order_id, order_id } = body;
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

      // Se foi enviado um sub_number_order_id, associar o requirement_group ao sub-pedido na Telnyx
      if (sub_number_order_id) {
        try {
          console.log(`Associating requirement group ${groupId} to sub-order ${sub_number_order_id}`);
          await associateRequirementGroupWithSubOrder(apiKey, sub_number_order_id, groupId);
        } catch (assocErr: any) {
          console.error(`[telnyx-number-orders] Failed to associate group with sub-order:`, assocErr.message);
          return json({ error: `Falha ao vincular exigências ao pedido Telnyx: ${assocErr.message}` }, 502);
        }
      }

      // Se foi enviado um order_id local, voltar o status para "under_review" (em análise) e limpar erro
      if (order_id) {
        await supabase
          .from("number_order_requests")
          .update({
            status: "under_review",
            rejection_reason: null,
            updated_at: new Date().toISOString()
          })
          .eq("id", order_id);
      }

      await logAudit(supabase, tenantId, user.id, "regulatory_info_submitted", "", {
        country_code: countryCode, phone_number_type: effectiveType, requirement_group_id: groupId, sub_number_order_id, order_id
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
      let telnyxOrderId: string;
      try {
        const telnyxOrder = await createNumberOrder(
          apiKey,
          [order.phone_number],
          connectionId || undefined
        );
        telnyxOrderId = telnyxOrder.id;
      } catch (e: any) {
        console.error(`[telnyx-number-orders] Telnyx order creation failed: ${e.message}`);
        return json({ error: `Erro na Telnyx ao criar pedido: ${e.message}` }, 400);
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

function isAddressInCountry(addressStr: string, countryCode: string): boolean {
  const normalized = addressStr.toLowerCase();
  const code = countryCode.toUpperCase();
  if (code === "NZ") {
    const nzKeywords = ["nz", "new zealand", "nova zelandia", "nova zelândia", "auckland", "wellington", "christchurch", "hamilton", "tauranga", "dunedin"];
    return nzKeywords.some(kw => normalized.includes(kw));
  }
  if (code === "BR") {
    const brKeywords = ["brasil", "brazil", "curitiba", "são paulo", "rio de janeiro", "bh", "porto alegre", "fortaleza", "recife", "salvador"];
    return brKeywords.some(kw => normalized.includes(kw));
  }
  return normalized.includes(code.toLowerCase());
}

function parseAddress(addressStr: string | null | undefined, tenantName: string, countryCode: string) {
  const code = countryCode.toUpperCase();

  // Endereço padrão de fallback para a Nova Zelândia (Queen Street, Auckland — real e deliverável)
  const nzDefault = {
    firstName: "Clinic",
    lastName: "Owner",
    businessName: tenantName || "Traffio Clinic",
    streetAddress: "101 Queen Street",
    locality: "Auckland",
    administrativeArea: "Auckland",
    postalCode: "1010",
    countryCode: "NZ"
  };

  const parsed = {
    firstName: "Clinic",
    lastName: "Owner",
    businessName: tenantName || "Traffio Clinic",
    streetAddress: "Main Street 123",
    locality: "Auckland",
    administrativeArea: "Auckland",
    postalCode: "1010",
    countryCode: code
  };

  const defaultForCountry = code === "NZ" ? nzDefault : parsed;

  if (addressStr && isAddressInCountry(addressStr, code)) {
    // Split por múltiplos delimitadores comuns (vírgula, travessão, hífen, ponto e vírgula)
    const parts = addressStr.split(/,|\u2014|-|;/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 1) {
      parsed.streetAddress = parts[0];
    }
    if (code === "NZ") {
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

    // Tentar estruturar o nome com base no nome do tenant
    if (tenantName) {
      const nameParts = tenantName.split(' ').map(p => p.trim()).filter(Boolean);
      if (nameParts.length > 0) {
        parsed.firstName = nameParts[0];
        if (nameParts.length > 1) {
          parsed.lastName = nameParts.slice(1).join(' ');
        } else {
          parsed.lastName = nameParts[0];
        }
      }
    }
    return parsed;
  }

  // Se o endereço do tenant for vazio ou de outro país, usa o default cadastrado para o país solicitado
  if (tenantName) {
    const nameParts = tenantName.split(' ').map(p => p.trim()).filter(Boolean);
    if (nameParts.length > 0) {
      defaultForCountry.firstName = nameParts[0];
      if (nameParts.length > 1) {
        defaultForCountry.lastName = nameParts.slice(1).join(' ');
      } else {
        defaultForCountry.lastName = nameParts[0];
      }
    }
  }

  return defaultForCountry;
}

async function satisfyRequirementsSilently(
  supabase: any,
  apiKey: string,
  tenantId: string,
  countryCode: string,
  phoneNumberType: string
): Promise<{ requirementGroupId: string | null; documentUploadRequired?: boolean; requirements?: any[] }> {
  const country = countryCode.toUpperCase();
  let requirements: any[] = [];
  let effType = phoneNumberType;
  try {
    const result = await getRequirements(apiKey, country, phoneNumberType);
    requirements = result.requirements || [];
    effType = result.phoneNumberType || phoneNumberType;
  } catch (e) {
    console.error(`[satisfyRequirementsSilently] Failed to fetch requirements:`, e);
    return { requirementGroupId: null };
  }

  if (requirements.length === 0) {
    return { requirementGroupId: null };
  }

  const { data: cached } = await supabase
    .from("tenant_requirement_groups")
    .select("telnyx_requirement_group_id, status")
    .eq("tenant_id", tenantId)
    .eq("country_code", country)
    .eq("phone_number_type", effType)
    .maybeSingle();

  if (cached?.telnyx_requirement_group_id) {
    console.log(`[satisfyRequirementsSilently] Found cached requirement group: ${cached.telnyx_requirement_group_id}`);
    return { requirementGroupId: cached.telnyx_requirement_group_id };
  }

  const hasDocumentReq = requirements.some(r => r.type === "document");
  if (hasDocumentReq) {
    console.log(`[satisfyRequirementsSilently] Document required for country ${country}, type ${effType}`);
    return { requirementGroupId: null, documentUploadRequired: true, requirements };
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, address")
    .eq("id", tenantId)
    .maybeSingle();

  const parsedAddr = parseAddress(tenant?.address, tenant?.name || "Clinic", country);

  // Buscar informações do dono do tenant para preenchimento dos dados textuais de contato
  const { data: ownerMember } = await supabase
    .from("members")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("role", "owner")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  let ownerProfile: { full_name: string | null; phone: string | null; email: string | null } | null = null;
  if (ownerMember?.user_id) {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, phone, email")
      .eq("id", ownerMember.user_id)
      .maybeSingle();
    ownerProfile = data;
  }

  // Sobrescrever o nome de contato do endereço com o nome real do dono do tenant
  if (ownerProfile?.full_name) {
    const nameParts = ownerProfile.full_name.split(' ').map((p: string) => p.trim()).filter(Boolean);
    if (nameParts.length > 0) {
      parsedAddr.firstName = nameParts[0];
      if (nameParts.length > 1) {
        parsedAddr.lastName = nameParts.slice(1).join(' ');
      } else {
        parsedAddr.lastName = nameParts[0];
      }
    }
  }

  const contactName = ownerProfile?.full_name || tenant?.name || "Clinic Owner";
  const contactPhone = ownerProfile?.phone || "+6498890000";
  const contactEmail = ownerProfile?.email || "contact@traffio.com";

  const regulatoryRequirements: { requirement_id: string; field_value: string }[] = [];
  try {
    for (const r of requirements) {
      if (r.type === "address") {
        const addressId = await createAddress(apiKey, parsedAddr);
        regulatoryRequirements.push({ requirement_id: r.id, field_value: addressId });
      } else if (r.type === "textual") {
        let val = "";
        const name = (r.name || "").toLowerCase();

        // Se for o formato composto de Contato (Maria Garcia... | Business... | Phone...)
        if (name.includes("contact") && name.includes("business")) {
          val = `Contact: ${contactName} | Business: ${tenant?.name || "N/A"} | Phone: ${contactPhone}`;
        } else if (name.includes("name") || name.includes("nome") || name.includes("contact")) {
          val = contactName;
        } else if (name.includes("email")) {
          val = contactEmail;
        } else if (name.includes("phone") || name.includes("telef")) {
          val = contactPhone;
        } else {
          val = tenant?.name || "Clinic Owner";
        }
        regulatoryRequirements.push({ requirement_id: r.id, field_value: val });
      }
    }
  } catch (e: any) {
    console.error(`[satisfyRequirementsSilently] Failed to create Address or Textual requirement:`, e);
    throw new Error(`Erro ao satisfazer requisitos regulatórios: ${e.message}`);
  }

  let groupId: string;
  try {
    groupId = await createRequirementGroup(apiKey, country, effType);
    await fillRequirementGroup(apiKey, groupId, regulatoryRequirements);
  } catch (e: any) {
    console.error(`[satisfyRequirementsSilently] Failed to create/fill Requirement Group:`, e);
    throw new Error(`Erro ao criar/preencher grupo regulatório na Telnyx: ${e.message}`);
  }

  await supabase.from("tenant_requirement_groups").upsert({
    tenant_id:                   tenantId,
    country_code:                country,
    phone_number_type:           effType,
    telnyx_requirement_group_id: groupId,
    regulatory_requirements:     regulatoryRequirements,
    status:                      "unapproved",
    updated_at:                  new Date().toISOString(),
  }, { onConflict: "tenant_id,country_code,phone_number_type" });

  console.log(`[satisfyRequirementsSilently] Created and cached group ${groupId} for ${country}/${effType}`);
  return { requirementGroupId: groupId };
}
