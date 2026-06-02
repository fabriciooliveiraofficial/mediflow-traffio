import { ChatAgent } from '../../../supabase/functions/_shared/chatAgent';

// Mock database of active sessions (In production use Redis/Supabase)
const sessions: Record<string, { patientId: string; doctorId: string }> = {
    '5511999999999': {
        patientId: '55c63dff-0628-403d-82c0-802526569201', // Mock Patient
        doctorId: 'cf663cdd-0628-403d-82c0-802526569201'  // Mock Doctor
    }
};

/**
 * Validates the incoming webhook payload from WhatsApp Provider.
 */
function validateSignature(req: any) {
    // TODO: Implement HMAC SHA256 signature validation
    return true;
}

/**
 * Main Webhook Handler
 * Receives POST requests from WhatsApp Provider (Twilio/WPPConnect/Z-API)
 */
export async function handleWhatsAppWebhook(req: Request) {
    try {
        const body = await req.json();

        // 1. Extract message details (Standardized format)
        const { from, message, type } = body;

        if (!from || !message) {
            return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400 });
        }

        console.log(`[WhatsApp] Message from ${from}: ${message}`);

        // 2. Load Session
        const session = sessions[from];
        if (!session) {
            // Logic to identify user by phone number in Supabase goes here
            return new Response(JSON.stringify({ error: 'User not registered' }), { status: 404 });
        }

        // 3. Process with Agent
        const agent = new ChatAgent(session.patientId, session.doctorId);

        // Restore agent state if needed (not implemented in this mock)

        const response = await agent.processMessage(message);

        // 4. Send Response back to WhatsApp Provider
        // In a real scenario, this would be an HTTP POST to the provider's API
        console.log(`[WhatsApp] Sending reply to ${from}: ${response}`);

        return new Response(JSON.stringify({
            status: 'success',
            reply: response
        }), { status: 200 });

    } catch (error: any) {
        console.error('[WhatsApp] Webhook Error:', error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}
