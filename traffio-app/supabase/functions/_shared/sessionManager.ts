import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

export interface Session {
    id: string;
    tenant_id: string;
    patient_phone: string;
    current_state: string;
    context: any;
    recent_messages: any[]; // New Enterprise Column
    conversation_summary: any; // New Enterprise Column
    human_handoff: boolean;
    updated_at: string;
    omnichannel_status: string;
}

export class SessionManager {
    constructor(private supabase: SupabaseClient) { }

    /**
     * Retrieves an existing session or creates a new one for the patient.
     */
    async getOrCreateSession(tenantId: string, patientPhone: string): Promise<Session> {
        // Passo 1: Verificar se sessão já existe (evita falha de constraint)
        const { data: existing } = await this.supabase
            .from('conversation_sessions')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('patient_phone', patientPhone)
            .maybeSingle();

        if (existing) return existing as Session;

        // Passo 2: Tentar criar nova sessão com colunas base (compatível com migration 01).
        // Colunas adicionadas na migration 05 (omnichannel_status, recent_messages, etc.)
        // são omitidas aqui para não quebrar se a migration ainda não foi aplicada.
        const baseInsert: any = {
            tenant_id: tenantId,
            patient_phone: patientPhone,
            current_state: 'INIT',
            context: {},
            human_handoff: false,
        };

        const { data: newSession, error: insertError } = await this.supabase
            .from('conversation_sessions')
            .insert(baseInsert)
            .select()
            .single();

        if (!insertError && newSession) return newSession as Session;

        // Passo 3: Se o INSERT falhou (race condition), buscar a sessão criada pelo outro request
        if (insertError) {
            console.warn('Session insert conflict, fetching existing:', insertError.message);
            const { data: raceSession, error: fetchError } = await this.supabase
                .from('conversation_sessions')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('patient_phone', patientPhone)
                .single();

            if (raceSession) return raceSession as Session;
            throw new Error(`Failed to get/create session: ${fetchError?.message}`);
        }

        throw new Error('Failed to create session: unknown error');
    }

    /**
     * Updates the session state and context (Atomic Update).
     */
    async updateState(sessionId: string, newState: string, contextUpdate?: any) {
        const updateData: any = { current_state: newState };
        if (contextUpdate) {
            updateData.context = contextUpdate;
        }
        const { error } = await this.supabase
            .from('conversation_sessions')
            .update(updateData)
            .eq('id', sessionId);
        if (error) console.error("Session update failed:", error);
    }

    /**
     * Logs a message to the history and updates rolling memory.
     * Sincroniza notas internas com a ficha do paciente (Enterprise Sticky Notes).
     */
    async logMessage(sessionId: string, role: 'user' | 'assistant' | 'human' | 'internal', content: string, metadata?: any): Promise<string | undefined> {
        // 1. Log to persistent history table (Audit Trail)
        const { data, error: logError } = await this.supabase
            .from('conversation_messages')
            .insert([{
                session_id:           sessionId,
                role:                 role,
                content:              content,
                media_url:            metadata?.media_url,
                message_type:         metadata?.message_type || 'text',
                file_name:            metadata?.file_name,
                mime_type:            metadata?.mime_type,
                file_size:            metadata?.file_size,
                caption:              metadata?.caption,
                duration_s:           metadata?.duration_s,
                ai_raw_response:      metadata?.ai_raw,
                parsed_intent:        metadata?.intent,
                whatsapp_message_id:  metadata?.whatsapp_message_id,
                replied_to_id:        metadata?.replied_to_id,
            }])
            .select('id')
            .single();

        if (logError) console.error("Failed to log message:", logError);

        // 2. Rolling Memory Update (Enterprise Pattern)
        const { data: session } = await this.supabase
            .from('conversation_sessions')
            .select('tenant_id, patient_phone, recent_messages')
            .eq('id', sessionId)
            .single();

        if (session) {
            // Sincronizar Nota Interna com Ficha do Paciente (Sticky Note Pattern)
            if (role === 'internal' && session.tenant_id && session.patient_phone) {
                console.log(`[SessionManager] Syncing internal note to patient ${session.patient_phone}`);
                await this.supabase
                    .from('patients')
                    .update({ notes: content })
                    .eq('tenant_id', session.tenant_id)
                    .eq('phone', session.patient_phone);
            }

            let recent = session.recent_messages || [];
            recent.push({ role, content, timestamp: new Date().toISOString() });

            // Rolling Logic: Keep last 20 turns
            if (recent.length > 20) recent = recent.slice(-20);

            await this.supabase
                .from('conversation_sessions')
                .update({ recent_messages: recent })
                .eq('id', sessionId);
        }
        
        return data?.id;
    }

    /**
     * BUG FIX #1: Ativa o modo human handoff de forma atômica.
     * Grava human_handoff=true E current_state='HUMAN_HANDOFF' em uma única operação,
     * garantindo que futuras mensagens sejam bloqueadas na guarda do index.ts (linha 73).
     */
    async triggerHumanHandoff(sessionId: string, contextUpdate?: any) {
        const updateData: any = {
            current_state: 'HUMAN_HANDOFF',
            human_handoff: true,
            omnichannel_status: 'queued',
        };
        if (contextUpdate) {
            updateData.context = contextUpdate;
        }
        const { error } = await this.supabase
            .from('conversation_sessions')
            .update(updateData)
            .eq('id', sessionId);
        if (error) console.error("triggerHumanHandoff failed:", error);
    }

    /**
     * Shallow-merge genérico em context (read-modify-write). Usado pelos
     * marcadores de correlação do F2 (pending_recovery/pending_waitlist) e por
     * qualquer chamador que precise gravar uma fatia de context sem sobrescrever
     * o resto (mesmo padrão de updateIntake, generalizado).
     */
    async updateContext(sessionId: string, patch: Record<string, unknown>): Promise<void> {
        const { data: session } = await this.supabase
            .from('conversation_sessions')
            .select('context')
            .eq('id', sessionId)
            .single();

        const context = { ...(session?.context || {}), ...patch };

        const { error } = await this.supabase
            .from('conversation_sessions')
            .update({ context })
            .eq('id', sessionId);
        if (error) console.error('updateContext failed:', error);
    }

    /**
     * F0 (docs/SPEC_AGENTE_IA_CLAUDE.md) — Ficha de estado (slot-filling).
     * Merge raso em context.intake: mensagens fragmentadas ACUMULAM informação
     * em vez de substituí-la. A próxima pergunta do agente é sempre o campo
     * que falta ({ procedure, for_whom, preferred_window, doctor_pref, ... }).
     */
    async updateIntake(sessionId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
        const { data: session } = await this.supabase
            .from('conversation_sessions')
            .select('context')
            .eq('id', sessionId)
            .single();

        const context = session?.context || {};
        context.intake = { ...(context.intake || {}), ...patch };

        const { error } = await this.supabase
            .from('conversation_sessions')
            .update({ context })
            .eq('id', sessionId);
        if (error) console.error('updateIntake failed:', error);
        return context.intake;
    }

    /**
     * F0 — Disjuntor de incompreensão: na N-ésima falha consecutiva (default 2),
     * transfere para humano com o contexto preservado e zera o contador.
     * Retorna true se o disjuntor disparou — o chamador NÃO deve responder de novo
     * (o loop de "desculpe, não entendi" é proibido por construção).
     */
    async registerMisunderstanding(sessionId: string, threshold: number = 2): Promise<boolean> {
        const { data: session } = await this.supabase
            .from('conversation_sessions')
            .select('context')
            .eq('id', sessionId)
            .single();

        const context = session?.context || {};
        const count = (context.misunderstand_count || 0) + 1;

        if (count >= threshold) {
            context.misunderstand_count = 0;
            await this.triggerHumanHandoff(sessionId, context);
            console.warn(`[SessionManager] Misunderstanding circuit breaker tripped (${count}/${threshold}) — session ${sessionId} handed to human`);
            return true;
        }

        context.misunderstand_count = count;
        const { error } = await this.supabase
            .from('conversation_sessions')
            .update({ context })
            .eq('id', sessionId);
        if (error) console.error('registerMisunderstanding failed:', error);
        return false;
    }

    /** F0 — Turno compreendido: zera o contador do disjuntor (se necessário). */
    async resetMisunderstanding(sessionId: string): Promise<void> {
        const { data: session } = await this.supabase
            .from('conversation_sessions')
            .select('context')
            .eq('id', sessionId)
            .single();

        const context = session?.context || {};
        if (!context.misunderstand_count) return; // nada a zerar — evita write inútil

        context.misunderstand_count = 0;
        const { error } = await this.supabase
            .from('conversation_sessions')
            .update({ context })
            .eq('id', sessionId);
        if (error) console.error('resetMisunderstanding failed:', error);
    }

    /**
     * Fetches history context from Rolling Memory (Fast).
     */
    async getHistory(sessionId: string, limit: number = 10): Promise<{ role: string, content: string }[]> {
        // Now efficiently reads from the session JSONB column
        const { data } = await this.supabase
            .from('conversation_sessions')
            .select('recent_messages')
            .eq('id', sessionId)
            .single();

        const messages = data?.recent_messages || [];
        // Map to simpler format if needed by ContextBuilder
        return messages.map((m: any) => ({ role: m.role, content: m.content }));
    }
}
