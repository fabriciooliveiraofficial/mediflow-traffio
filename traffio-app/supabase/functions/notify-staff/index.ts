import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import webpush from "https://esm.sh/web-push@3.6.6";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";

webpush.setVapidDetails(
  "mailto:suporte@traffio.com.br",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json();
    console.log("[notify-staff] Received payload:", JSON.stringify(body, null, 2));

    const { type, tenant_id, record, message } = body;
    const messageData = record || message;

    if (!messageData) {
      throw new Error("No message data provided");
    }

    // 1. Get Tenant and Members
    // The tenant_id can come from the root or the record
    const tenantId = tenant_id || messageData.tenant_id;
    
    if (!tenantId) {
      console.warn("[notify-staff] No tenantId found in payload");
    }

    // Updated query to use 'members' table which now holds the tenant_id link
    // We join with 'profiles' to get the notification_settings
    const { data: members, error: membersError } = await supabase
      .from("members")
      .select("user_id, profiles(id, notification_settings)")
      .eq("tenant_id", tenantId);

    if (membersError) throw membersError;

    // 2. Dispatch Realtime Broadcast (for active sessions)
    // We target the specific channel 'whatsapp_notifications'
    const channel = supabase.channel('whatsapp_notifications');
    const { error: broadcastError } = await channel.send({
      type: "broadcast",
      event: "new_whatsapp_message",
      payload: { 
        ...messageData, 
        tenant_id: tenantId,
        sender_name: messageData.sender_name || (messageData.role === 'user' ? 'Paciente' : 'Clínica')
      },
    });

    if (broadcastError) console.error("Broadcast error:", broadcastError);

    // 3. Dispatch Web Push (for background/closed sessions)
    const notifications = (members || [])
      .map(m => m.profiles)
      .filter(p => p && p.notification_settings?.whatsapp_push !== false)
      .map(async (profile) => {
        const { data: subs, error: subsError } = await supabase
          .from("user_push_subscriptions")
          .select("*")
          .eq("user_id", profile.id);

        if (subsError) return;

        return Promise.all(subs.map(async (sub) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: {
                  p256dh: sub.p256dh,
                  auth: sub.auth,
                },
              },
              JSON.stringify({
                title: "Nova Mensagem WhatsApp",
                body: `${messageData.sender_name || 'Paciente'}: ${messageData.content || 'Mensagem de mídia'}`,
                icon: "/logo192.png",
                data: {
                  url: "/dashboard/inbox",
                  tenant_id: tenantId,
                }
              })
            );
          } catch (err) {
            if (err.statusCode === 404 || err.statusCode === 410) {
              // Subscription expired or gone, delete it
              await supabase.from("user_push_subscriptions").delete().eq("id", sub.id);
            }
            console.error(`Push error for user ${profile.id}:`, err);
          }
        }));
      });

    await Promise.all(notifications);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in notify-staff:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
