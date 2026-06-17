/**
 * Edge Function: public-booking
 * -----------------------------------------------------------------------------
 * Portão PÚBLICO do widget de agendamento embarcado nas landing pages.
 *
 * Autenticação: NÃO usa JWT do Supabase (verify_jwt=false). A credencial é a
 * publishable key do tenant (pk_live_...), enviada no corpo como `key`.
 * A key resolve o tenant + config (tenant_public_keys). Roda com service_role
 * no servidor — a key secreta nunca vai ao browser.
 *
 * Ações (POST JSON { action, key, ... }):
 *   - config       -> tema/idioma/pixel/FAB para o widget se renderizar
 *   - specialties  -> especialidades com profissionais ativos
 *   - locations    -> unidades de uma especialidade
 *   - doctors      -> profissionais de uma especialidade numa unidade
 *   - slots        -> horários livres de um profissional numa data/unidade
 *   - lock         -> reserva temporária do slot (anti-corrida)  [origin-gated]
 *   - book         -> cria/associa paciente guest e agenda        [origin-gated]
 *
 * Leituras são abertas (dados já públicos no site). Escritas (lock/book) exigem
 * Origin ∈ allowed_domains do tenant.
 *
 * TODO (Fase 1.5): rate limit por IP+tenant e verificação Turnstile/hCaptcha no book.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";

const READ_ACTIONS = new Set(["config", "specialties", "locations", "doctors", "dates", "slots"]);
const WRITE_ACTIONS = new Set(["lock", "book"]);

interface KeyConfig {
  id: string;
  tenant_id: string;
  allowed_domains: string[];
  is_active: boolean;
  primary_color: string | null;
  fab_label: string | null;
  fab_style: string | null;
  fab_position: string | null;
  fab_delay_ms: number;
  meta_pixel_id: string | null;
  google_ads_id: string | null;
  google_conversion_label: string | null;
  success_virtual_path: string | null;
  tenant: { name: string; slug: string; locale: string; country: string; timezone: string } | null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não suportado" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const body = await req.json().catch(() => ({}));
    const action: string = body.action;
    const key: string = body.key;

    if (!action) return json({ error: "action é obrigatório" }, 400);
    if (!key) return json({ error: "key é obrigatório" }, 401);

    // ── Resolve tenant + config a partir da publishable key ──────────────────
    const { data: cfg, error: cfgErr } = await db
      .from("tenant_public_keys")
      .select(
        "id, tenant_id, allowed_domains, is_active, primary_color, fab_label, fab_style, fab_position, fab_delay_ms, meta_pixel_id, google_ads_id, google_conversion_label, success_virtual_path, tenant:tenants(name, slug, locale, country, timezone)",
      )
      .eq("public_key", key)
      .eq("is_active", true)
      .maybeSingle();

    if (cfgErr) {
      console.error("config lookup error:", cfgErr);
      return json({ error: "Erro ao validar a chave" }, 500);
    }
    if (!cfg) return json({ error: "Chave inválida ou inativa" }, 401);

    const config = cfg as unknown as KeyConfig;
    const tenantId = config.tenant_id;

    // ── Guardas das escritas: origem + rate limit + anti-bot ─────────────────
    if (WRITE_ACTIONS.has(action)) {
      const origin = req.headers.get("Origin") ?? req.headers.get("Referer") ?? "";
      if (!originAllowed(origin, config.allowed_domains)) {
        return json({ error: "Origem não autorizada para esta chave" }, 403);
      }

      // Rate limit por (tenant, IP, ação)
      const ip = getClientIp(req);
      const limit = action === "book" ? { max: 6, win: 600 } : { max: 20, win: 600 };
      const { data: allowed } = await db.rpc("check_widget_rate_limit", {
        p_tenant_id: tenantId,
        p_ip: ip,
        p_action: action,
        p_max: limit.max,
        p_window_secs: limit.win,
      });
      if (allowed === false) {
        return json({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." }, 429);
      }

      // Verificação anti-bot no booking (Cloudflare Turnstile)
      if (action === "book") {
        const ok = await verifyTurnstile(body.turnstile_token, ip);
        if (!ok) return json({ error: "Falha na verificação de segurança. Recarregue a página e tente novamente." }, 403);
      }
    } else if (!READ_ACTIONS.has(action)) {
      return json({ error: `Ação desconhecida: ${action}` }, 400);
    }

    switch (action) {
      case "config":
        return json({
          tenant: { name: config.tenant?.name, slug: config.tenant?.slug },
          locale: config.tenant?.locale ?? "pt-BR",
          country: config.tenant?.country ?? "BR",
          timezone: config.tenant?.timezone ?? "America/Sao_Paulo",
          theme: { primary_color: config.primary_color ?? "#0E7C7B" },
          fab: {
            label: config.fab_label ?? "Agendar",
            style: config.fab_style ?? "soft",
            position: config.fab_position ?? "bottom-right",
            delay_ms: config.fab_delay_ms ?? 0,
          },
          tracking: {
            meta_pixel_id: config.meta_pixel_id,
            google_ads_id: config.google_ads_id,
            google_conversion_label: config.google_conversion_label,
            success_virtual_path: config.success_virtual_path ?? "/agendamento-confirmado",
          },
        });

      case "specialties":
        return await handleSpecialties(db, tenantId);

      case "locations":
        return await handleLocations(db, tenantId, body.specialty);

      case "doctors":
        return await handleDoctors(db, tenantId, body.specialty, body.location_id);

      case "dates":
        return await handleDates(db, body.doctor_id, body.from_date, body.limit, body.location_id, body.duration_minutes);

      case "slots":
        return await handleSlots(db, tenantId, body.doctor_id, body.date, body.location_id, body.duration_minutes);

      case "lock":
        return await handleLock(db, tenantId, body);

      case "book":
        return await handleBook(db, tenantId, body);

      default:
        return json({ error: `Ação desconhecida: ${action}` }, 400);
    }
  } catch (err) {
    console.error("public-booking error:", err);
    return json({ error: (err as Error).message ?? "Erro interno" }, 500);
  }
});

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleSpecialties(db: SupabaseClient, tenantId: string) {
  const { data, error } = await db
    .from("doctors")
    .select("specialty")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  if (error) throw error;

  const map = new Map<string, number>();
  for (const d of data ?? []) {
    if (d.specialty) map.set(d.specialty, (map.get(d.specialty) ?? 0) + 1);
  }
  return json({ specialties: [...map.entries()].map(([name, count]) => ({ name, count })) });
}

async function handleLocations(db: SupabaseClient, tenantId: string, specialty?: string) {
  // doctors da especialidade -> unidades onde atendem
  let docIds: string[] = [];
  if (specialty) {
    const { data: docs } = await db
      .from("doctors")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("specialty", specialty)
      .eq("is_active", true);
    docIds = (docs ?? []).map((d) => d.id);
    if (docIds.length === 0) return json({ locations: [] });
  }

  let availQuery = db.from("doctor_availability").select("location_id").eq("tenant_id", tenantId);
  if (docIds.length > 0) availQuery = availQuery.in("doctor_id", docIds);
  const { data: avail } = await availQuery;
  const locIds = [...new Set((avail ?? []).map((a) => a.location_id).filter(Boolean))];
  if (locIds.length === 0) return json({ locations: [] });

  const { data: locations, error } = await db
    .from("locations")
    .select("id, name, address, type")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .in("id", locIds);
  if (error) throw error;
  return json({ locations: locations ?? [] });
}

async function handleDoctors(db: SupabaseClient, tenantId: string, specialty?: string, locationId?: string) {
  let docIds: string[] | null = null;
  if (locationId) {
    const { data: avail } = await db
      .from("doctor_availability")
      .select("doctor_id")
      .eq("tenant_id", tenantId)
      .eq("location_id", locationId);
    docIds = [...new Set((avail ?? []).map((a) => a.doctor_id))];
    if (docIds.length === 0) return json({ doctors: [] });
  }

  let q = db
    .from("doctors")
    .select("id, full_name, specialty, color")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  if (specialty) q = q.eq("specialty", specialty);
  if (docIds) q = q.in("id", docIds);

  const { data, error } = await q;
  if (error) throw error;
  return json({ doctors: data ?? [] });
}

async function handleDates(
  db: SupabaseClient,
  doctorId?: string,
  fromDate?: string,
  limit = 14,
  locationId?: string,
  durationMinutes = 30,
) {
  if (!doctorId) return json({ error: "doctor_id é obrigatório" }, 400);

  // Próximas datas COM vaga. "Ver mais datas" no widget pagina passando
  // from_date = dia seguinte à última data exibida.
  const { data, error } = await db.rpc("find_next_available_dates", {
    p_doctor_id: doctorId,
    p_from_date: fromDate ?? new Date().toISOString().slice(0, 10),
    p_limit: limit,
    p_duration_minutes: durationMinutes,
    p_location_id: locationId ?? null,
  });
  if (error) throw error;

  const dates = (data ?? []).map((d: Record<string, unknown>) => ({
    date: d.date,
    location_id: d.location_id ?? null,
    location_name: d.location_name ?? null,
    slot_count: d.slot_count ??
      ((Array.isArray(d.slots) ? d.slots.length : 0) ||
        ((d.prime_slots as unknown[])?.length ?? 0) + ((d.regular_slots as unknown[])?.length ?? 0)),
  }));
  return json({ dates });
}

async function handleSlots(
  db: SupabaseClient,
  _tenantId: string,
  doctorId?: string,
  date?: string,
  locationId?: string,
  durationMinutes = 30,
) {
  if (!doctorId || !date) return json({ error: "doctor_id e date são obrigatórios" }, 400);

  // Mesma chamada usada pelo app (smartSchedulingService) — fonte da verdade.
  const { data, error } = await db.rpc("find_next_available_dates", {
    p_doctor_id: doctorId,
    p_from_date: date,
    p_limit: 1,
    p_duration_minutes: durationMinutes,
    p_location_id: locationId ?? null,
  });
  if (error) throw error;

  const dayData = (data ?? []).find((d: { date: string }) => d.date === date);
  if (!dayData) return json({ slots: [] });

  // Resiliente a ambas as formas do RPC: {slots:[{time,available}]} OU prime/regular_slots.
  let times: string[] = [];
  if (Array.isArray(dayData.slots)) {
    times = dayData.slots.filter((s: { available?: boolean }) => s.available !== false).map((s: { time: string }) => s.time);
  } else {
    times = [...(dayData.prime_slots ?? []), ...(dayData.regular_slots ?? [])];
  }
  times.sort();

  const slots = times.map((time: string) => {
    const [h, m] = time.split(":").map(Number);
    const total = h * 60 + m + durationMinutes;
    const slot_end = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    return { slot_time: time, slot_end, location_id: dayData.location_id ?? locationId ?? null, location_name: dayData.location_name ?? null };
  });
  return json({ slots, location_id: dayData.location_id, location_name: dayData.location_name });
}

async function handleLock(db: SupabaseClient, tenantId: string, body: Record<string, unknown>) {
  const { doctor_id, date, time } = body as { doctor_id?: string; date?: string; time?: string };
  if (!doctor_id || !date || !time) return json({ error: "doctor_id, date e time são obrigatórios" }, 400);

  const { data, error } = await db.rpc("lock_slot", {
    p_tenant_id: tenantId,
    p_doctor_id: doctor_id,
    p_date: date,
    p_time: time,
  });
  if (error) throw error;
  if (!data?.success) return json({ success: false, message: data?.message ?? "Horário indisponível" }, 409);
  return json({ success: true });
}

async function handleBook(db: SupabaseClient, tenantId: string, body: Record<string, unknown>) {
  const {
    doctor_id, location_id, date, start_time, end_time, type_id,
    patient, // { full_name, phone, email } — finalidade comercial (lead), sem dados fiscais
    notes,
  } = body as {
    doctor_id?: string; location_id?: string; date?: string; start_time?: string; end_time?: string; type_id?: string;
    patient?: { full_name?: string; phone?: string; email?: string };
    notes?: string;
  };

  if (!doctor_id || !location_id || !date || !start_time) {
    return json({ error: "doctor_id, location_id, date e start_time são obrigatórios" }, 400);
  }
  if (!patient?.full_name || !patient?.phone || !patient?.email) {
    return json({ error: "Nome, telefone e e-mail são obrigatórios" }, 400);
  }

  // end_time/notes não fazem parte da assinatura de book_appointment em produção.
  void end_time; void notes;

  const patientId = await upsertGuestPatient(db, tenantId, patient);

  const { data, error } = await db.rpc("book_appointment", {
    p_tenant_id: tenantId,
    p_patient_id: patientId,
    p_doctor_id: doctor_id,
    p_location_id: location_id,
    p_type_id: type_id ?? null,
    p_date: date,
    p_start_time: start_time,
    p_booked_by: "landing_widget",
  });
  if (error) throw error;
  if (!data?.success) {
    const reason = data?.reason === "slot_taken" ? "Este horário acabou de ser reservado." : (data?.message ?? data?.reason ?? "Não foi possível agendar.");
    return json({ success: false, message: reason }, 409);
  }

  return json({ success: true, appointment_id: data.appointment_id, patient_id: patientId });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function upsertGuestPatient(
  db: SupabaseClient,
  tenantId: string,
  patient: { full_name?: string; phone?: string; email?: string },
): Promise<string> {
  const phone = (patient.phone ?? "").trim();
  const email = (patient.email ?? "").trim().toLowerCase() || null;

  // Match por tenant + telefone OU email (paciente recorrente sem conta).
  // Há unique constraints (tenant_id, phone) e (tenant_id, email) em produção —
  // por isso checamos os dois antes de inserir, e tratamos a corrida abaixo.
  const orFilter = email ? `phone.eq.${phone},email.eq.${email}` : `phone.eq.${phone}`;
  const { data: existing } = await db
    .from("patients")
    .select("id")
    .eq("tenant_id", tenantId)
    .or(orFilter)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id;

  // Captura comercial (lead): apenas nome, telefone e email — sem dados fiscais.
  const { data: created, error } = await db
    .from("patients")
    .insert({
      tenant_id: tenantId,
      full_name: patient.full_name,
      phone,
      email,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 = unique_violation (corrida: outro request cadastrou o mesmo phone/email entre o select e o insert)
    if (error.code === "23505") {
      const { data: race } = await db
        .from("patients")
        .select("id")
        .eq("tenant_id", tenantId)
        .or(orFilter)
        .limit(1)
        .maybeSingle();
      if (race?.id) return race.id;
    }
    throw error;
  }
  return created.id;
}

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "0.0.0.0";
}

// Cloudflare Turnstile. Sem TURNSTILE_SECRET configurado, NÃO bloqueia (rollout gradual).
async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  const secret = Deno.env.get("TURNSTILE_SECRET");
  if (!secret) return true;
  if (!token) return false;
  try {
    const form = new FormData();
    form.append("secret", secret);
    form.append("response", token);
    if (ip && ip !== "0.0.0.0") form.append("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    const data = await res.json();
    return data?.success === true;
  } catch (_e) {
    return false;
  }
}

function originAllowed(origin: string, allowed: string[] | null): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  // dev/preview
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (!allowed || allowed.length === 0) return false;
  return allowed.some((d) => {
    const dom = d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    return dom.length > 0 && (host === dom || host.endsWith("." + dom));
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
