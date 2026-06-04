/**
 * upsertChannelPreference — Helper compartilhado
 *
 * Salva ou atualiza a preferência de canal de um paciente em patient_channel_preferences.
 * Regra: se a preferência foi definida manualmente (updated_by='manual'),
 * a auto-detecção NÃO sobrescreve.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

export interface ChannelPreferenceUpdate {
  preferred_channel?: "whatsapp" | "instagram" | "facebook" | "sms";
  instagram_user_id?: string;
  instagram_username?: string;
  facebook_user_id?: string;
  facebook_name?: string;
  whatsapp_phone?: string;
  sms_phone?: string;
}

export async function upsertChannelPreference(
  supabase: SupabaseClient,
  tenantId: string,
  patientPhone: string,      // Para IG/FB: usar IGSID ou PSID como identificador
  update: ChannelPreferenceUpdate,
  source: "auto" | "manual" = "auto"
): Promise<void> {
  // Verificar se já existe uma preferência manual — não sobrescrever
  if (source === "auto") {
    const { data: existing } = await supabase
      .from("patient_channel_preferences")
      .select("updated_by")
      .eq("tenant_id", tenantId)
      .eq("patient_phone", patientPhone)
      .maybeSingle();

    if (existing?.updated_by === "manual") {
      // Preferência manual protegida — só atualiza IDs de plataforma, não o canal preferido
      const safeUpdate: Partial<ChannelPreferenceUpdate> = { ...update };
      delete safeUpdate.preferred_channel;

      if (Object.keys(safeUpdate).length > 0) {
        await supabase
          .from("patient_channel_preferences")
          .update({ ...safeUpdate, updated_at: new Date().toISOString() })
          .eq("tenant_id", tenantId)
          .eq("patient_phone", patientPhone);
      }
      return;
    }
  }

  // Upsert completo
  const { error } = await supabase
    .from("patient_channel_preferences")
    .upsert(
      {
        tenant_id:             tenantId,
        patient_phone:         patientPhone,
        ...update,
        updated_by:            source,
        last_auto_detected_at: source === "auto" ? new Date().toISOString() : undefined,
        last_manual_updated_at: source === "manual" ? new Date().toISOString() : undefined,
        updated_at:            new Date().toISOString(),
      },
      { onConflict: "tenant_id,patient_phone" }
    );

  if (error) {
    console.error("[upsertChannelPreference] Error:", error.message);
  }
}
