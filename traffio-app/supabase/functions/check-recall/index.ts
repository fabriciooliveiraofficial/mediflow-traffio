import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1"

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  // 1. Find patients with last_visit_at older than 6 months
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const { data: patients, error } = await supabase
    .from('patients')
    .select('id, name, mobile, tenant_id')
    .lt('last_visit_at', sixMonthsAgo.toISOString())
    .limit(10); // Process in small batches

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  // 2. For each patient, trigger AI follow-up (Mocking logic for now)
  const results = [];
  for (const patient of patients) {
    // Logic: In production, this would call the WhatsApp AI Agent
    // with a specific 'recall' intent.
    console.log(`Triggering recall for ${patient.name} (${patient.mobile})`);
    
    // Create a notification record for tracking
    await supabase.from('notifications').insert({
        patient_id: patient.id,
        tenant_id: patient.tenant_id,
        type: 'recall',
        status: 'pending',
        content: `Olá ${patient.name.split(' ')[0]}, faz 6 meses desde sua última consulta. Que tal agendar uma limpeza preventiva?`
    });

    results.push({ id: patient.id, status: 'triggered' });
  }

  return new Response(JSON.stringify({ processed: results.length, data: results }), {
    headers: { "Content-Type": "application/json" },
  });
});
