import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";
import { embedText } from "../_shared/embeddings.ts";

/**
 * embed-knowledge — Edge Function
 * 
 * Triggered by Supabase Webhooks when a row in 'knowledge_base' is inserted/updated.
 * Generates an embedding for the 'content' field using OpenAI and saves it back.
 */

console.log("embed-knowledge — Initialized");

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const payload = await req.json();
    const { record, old_record, type } = payload;

    // Skip if it's a delete or if content hasn't changed (and we already have an embedding)
    if (type === 'DELETE') {
      return new Response(JSON.stringify({ status: 'deleted' }), { headers: corsHeaders });
    }

    if (type === 'UPDATE' && record.content === old_record?.content && record.embedding) {
      console.log(`[embed-knowledge] [${record.id}] Content unchanged, skipping re-embedding`);
      return new Response(JSON.stringify({ status: 'skipped' }), { headers: corsHeaders });
    }

    if (!record.content) {
      return new Response(JSON.stringify({ status: 'no_content' }), { headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Gera via helper compartilhado (chave dinâmica + timeout + falha isolada).
    console.log(`[embed-knowledge] [${record.id}] Generating embedding for: "${record.title}"`);
    const embedding = await embedText(supabase, record.content);
    if (!embedding) {
      return new Response(JSON.stringify({ error: "Embedding unavailable" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Update the record with the new embedding
    const { error: updateError } = await supabase
      .from("knowledge_base")
      .update({ embedding })
      .eq("id", record.id);

    if (updateError) {
        console.error(`[embed-knowledge] [${record.id}] Update DB error:`, updateError.message);
        throw updateError;
    }

    console.log(`[embed-knowledge] [${record.id}] Embedding saved successfully`);

    return new Response(JSON.stringify({ success: true, message: "Embedding generated and saved" }), { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });

  } catch (err: any) {
    console.error(`[embed-knowledge] Fatal:`, err.message);
    return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});
