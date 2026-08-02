import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { getPhoneSearchVariations, normalizePhoneNumber } from "./phoneNormalizer.ts";

export interface ChannelIdentityRecord {
    id: string;
    tenant_id: string;
    channel: string;
    channel_user_id: string;
    patient_id: string | null;
    platform_meta: Record<string, unknown>;
}

/**
 * Obtém ou cria a ChannelIdentity para a combinação tenant + canal + id_do_usuario
 */
export async function getOrCreateChannelIdentity(
    supabase: SupabaseClient,
    opts: {
        tenantId: string;
        channel: string;
        channelUserId: string;
        platformMeta?: Record<string, unknown>;
    }
): Promise<ChannelIdentityRecord | null> {
    const { tenantId, channel, channelUserId, platformMeta = {} } = opts;

    const { data: existing } = await supabase
        .from("channel_identities")
        .select("id, tenant_id, channel, channel_user_id, patient_id, platform_meta")
        .eq("tenant_id", tenantId)
        .eq("channel", channel)
        .eq("channel_user_id", channelUserId)
        .maybeSingle();

    if (existing) return existing as ChannelIdentityRecord;

    const { data: created, error: insertErr } = await supabase
        .from("channel_identities")
        .insert({
            tenant_id: tenantId,
            channel,
            channel_user_id: channelUserId,
            platform_meta: platformMeta,
        })
        .select("id, tenant_id, channel, channel_user_id, patient_id, platform_meta")
        .single();

    if (insertErr && insertErr.code === "23505") {
        const { data: retry } = await supabase
            .from("channel_identities")
            .select("id, tenant_id, channel, channel_user_id, patient_id, platform_meta")
            .eq("tenant_id", tenantId)
            .eq("channel", channel)
            .eq("channel_user_id", channelUserId)
            .single();
        return (retry as ChannelIdentityRecord) || null;
    }

    return (created as ChannelIdentityRecord) || null;
}

/**
 * Vincula uma ChannelIdentity a um paciente (Fusão de Identidade)
 */
export async function linkChannelIdentityToPatient(
    supabase: SupabaseClient,
    identityId: string,
    patientId: string
): Promise<boolean> {
    const { error } = await supabase
        .from("channel_identities")
        .update({ patient_id: patientId, updated_at: new Date().toISOString() })
        .eq("id", identityId);

    return !error;
}

/**
 * Resolve a identidade do paciente pelo número de telefone fornecido (fusão omnicanal)
 */
export async function resolveOrLinkIdentityByPhone(
    supabase: SupabaseClient,
    opts: {
        tenantId: string;
        channel: string;
        channelUserId: string;
        rawPhone: string;
        fullName?: string;
    }
): Promise<{ identity: ChannelIdentityRecord | null; patientId: string | null }> {
    const { tenantId, channel, channelUserId, rawPhone, fullName } = opts;

    const identity = await getOrCreateChannelIdentity(supabase, { tenantId, channel, channelUserId });
    if (!identity) return { identity: null, patientId: null };

    if (identity.patient_id) {
        return { identity, patientId: identity.patient_id };
    }

    const searchVariations = getPhoneSearchVariations(rawPhone);
    if (!searchVariations.length) {
        return { identity, patientId: null };
    }

    const { data: existingPatients } = await supabase
        .from("patients")
        .select("id, full_name, phone")
        .eq("tenant_id", tenantId)
        .in("phone", searchVariations)
        .order("created_at", { ascending: true })
        .limit(1);

    let targetPatientId: string | null = null;

    if (existingPatients && existingPatients.length > 0) {
        targetPatientId = existingPatients[0].id;
    } else if (fullName) {
        const norm = normalizePhoneNumber(rawPhone);
        const phoneToSave = norm ? norm.e164 : rawPhone;

        const { data: newPatient } = await supabase
            .from("patients")
            .insert({
                tenant_id: tenantId,
                full_name: fullName.trim(),
                phone: phoneToSave,
            })
            .select("id")
            .single();

        if (newPatient) {
            targetPatientId = newPatient.id;
        }
    }

    if (targetPatientId) {
        await linkChannelIdentityToPatient(supabase, identity.id, targetPatientId);
        identity.patient_id = targetPatientId;
    }

    return { identity, patientId: targetPatientId };
}
