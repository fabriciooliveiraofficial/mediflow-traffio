import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { OutboxDispatcher } from "../_shared/outboxDispatcher.ts";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * process-waitlist — Edge Function
 * 
 * Triggered by a database webhook when an appointment is canceled.
 * Finds matching waitlist entries and notifies the next patient via WhatsApp.
 */

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  
  try {
    const payload = await req.json();
    console.log("[waitlist] Canceled Slot Payload:", payload);
    
    const { doctor_id, date, start_time, tenant_id } = payload;

    if (!doctor_id || !date || !start_time || !tenant_id) {
      return new Response("Missing required fields", { status: 400 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Identify Day of Week for matching
    const dateObj = new Date(date);
    const dayOfWeek = dateObj.getUTCDay(); // 0=Sunday, 1=Monday...

    // 2. Find matching waitlist entries
    // Logic: Same doctor, status='waiting'. 
    // Optimization: Filter by preferred_days if they exist.
    const { data: matches, error: fetchError } = await supabase
      .from("waitlist")
      .select("*, patients:patient_id(full_name, phone)")
      .eq("tenant_id", tenant_id)
      .eq("doctor_id", doctor_id)
      .eq("status", "waiting")
      .order("created_at", { ascending: true })
      .limit(5); // Get a few to filter in memory for complex time logic if needed

    if (fetchError) throw fetchError;
    
    if (!matches || matches.length === 0) {
      console.log("[waitlist] No patients waiting for this slot.");
      return new Response(JSON.stringify({ status: "no_matches" }), { status: 200 });
    }

    // Filter by day preference in memory (easier for array overlaps in JS sometimes)
    const eligibleMatch = matches.find(m => {
        if (!m.preferred_days || m.preferred_days.length === 0) return true;
        return m.preferred_days.includes(dayOfWeek);
    });

    if (!eligibleMatch) {
      console.log("[waitlist] Found candidates but none prefer this day of week.");
      return new Response(JSON.stringify({ status: "no_day_matches" }), { status: 200 });
    }

    const patient = (eligibleMatch as any).patients;
    if (!patient?.phone) {
        console.error("[waitlist] Patient data incomplete:", eligibleMatch);
        return new Response("Patient data incomplete", { status: 500 });
    }
    
    // 3. Fetch Doctor Name for the message
    const { data: doctor } = await supabase
        .from("doctors")
        .select("full_name")
        .eq("id", doctor_id)
        .single();
    
    const doctorName = doctor?.full_name || "um profissional";

    // 4. Prepare notification message
    const formattedDate = dateObj.toLocaleDateString('pt-BR');
    const message = `Olá ${patient.full_name}! Uma vaga acaba de surgir com Dr(a). ${doctorName} para o dia ${formattedDate} às ${start_time}. Gostaria de agendar agora? Responda "Sim" para confirmar!`;

    // 5. Enqueue notification
    const outbox = new OutboxDispatcher(supabase);
    await outbox.enqueue(tenant_id, patient.phone, { text: message });

    // 6. Update waitlist status to prevent multiple notifications for same slot
    await supabase
      .from("waitlist")
      .update({ status: "notified", updated_at: new Date().toISOString() })
      .eq("id", eligibleMatch.id);

    console.log(`[waitlist] Notification sent to ${patient.full_name} (${patient.phone})`);

    return new Response(JSON.stringify({ status: "success", notified: patient.full_name }), { 
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("[process-waitlist] Error:", error.message);
    return new Response(error.message, { status: 500 });
  }
});
