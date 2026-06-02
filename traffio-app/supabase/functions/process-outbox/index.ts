/**
 * Edge Function: process-outbox
 *
 * Processa o lote de mensagens pendentes na tabela message_outbox e as entrega
 * via Z-API com retry automático (backoff exponencial).
 *
 * Invocação:
 *   - Via pg_cron a cada 30 segundos (migration 06_cron_outbox.sql)
 *   - Via HTTP POST manual para debugging: POST /functions/v1/process-outbox
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";
import { OutboxDispatcher } from "../_shared/outboxDispatcher.ts";

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const dispatcher = new OutboxDispatcher(supabase);
    const result = await dispatcher.processBatch(20);

    console.log(`[process-outbox] sent=${result.sent} failed=${result.failed}`);

    return new Response(
      JSON.stringify({ success: true, ...result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[process-outbox] Error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
});
