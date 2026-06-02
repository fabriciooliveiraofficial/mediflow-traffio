import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";
import { corsHeaders } from "./cors.ts";

// --- VALIDATION SCHEMAS ---

export const IntentSchema = z.object({
    intent: z.enum([
        "greeting",
        "schedule",
        "reschedule",
        "cancel",
        "faq",
        "human_handoff",
        "confirm",
        "reject",
        "unknown"
    ]),
    entities: z.object({
        name: z.string().nullish(),
        specialty: z.string().nullish(),
        date: z.string().nullish(),
        time: z.string().nullish(),
        doctor_name: z.string().nullish()
    }),
    confidence: z.number().min(0).max(1),
    missing_fields: z.array(z.string()).optional(),
    reasoning: z.string().nullish(), // Make AI explain why (good for audit)
    tool_call: z.object({
        name: z.string(),
        parameters: z.record(z.any())
    }).nullish()
});

export type AIResult = z.infer<typeof IntentSchema>;

export class AIInterpreter {
    private apiKey: string;
    private provider: string;
    private model: string;

    constructor(apiKey: string, provider: string = 'google', model: string = 'gemini-1.5-flash') {
        this.apiKey = apiKey;
        this.provider = provider;
        this.model = model;
    }

    async interpret(userMessage: string, context: any, retries: number = 2): Promise<AIResult> {
        if (this.provider === 'openai') {
            return this.interpretOpenAI(userMessage, context, retries);
        } else {
            return this.interpretGemini(userMessage, context, retries);
        }
    }

    private async interpretOpenAI(userMessage: string, context: any, retries: number): Promise<AIResult> {
        const url = "https://api.openai.com/v1/chat/completions";

        const systemPrompt = this.buildSystemPrompt(context);
        const history = (context.last_messages || [])
            .filter((m: any) => m.content !== null && m.content !== undefined)
            .map((m: any) => ({
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: String(m.content)
            }));

        const payload = {
            model: this.model, // e.g., gpt-4o-2024-08-06
            messages: [
                { role: "system", content: systemPrompt },
                ...history,
                { role: "user", content: userMessage }
            ],
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "intent_interpretation",
                    strict: true,
                    schema: {
                        type: "object",
                        properties: {
                            intent: { type: "string", enum: ["greeting", "schedule", "reschedule", "cancel", "faq", "human_handoff", "confirm", "reject", "unknown"] },
                            entities: {
                                type: "object",
                                properties: {
                                    name: { type: ["string", "null"] },
                                    specialty: { type: ["string", "null"] },
                                    date: { type: ["string", "null"], description: "YYYY-MM-DD format" },
                                    time: { type: ["string", "null"], description: "HH:MM format" },
                                    doctor_name: { type: ["string", "null"] }
                                },
                                required: [],
                                additionalProperties: false
                            },
                            confidence: { type: "number" },
                            reasoning: { type: ["string", "null"] },
                            missing_fields: { type: "array", items: { type: "string" } },
                            tool_call: {
                                type: ["object", "null"],
                                properties: {
                                    name: { type: "string" },
                                    parameters: { type: "object", additionalProperties: true }
                                },
                                required: ["name", "parameters"],
                                additionalProperties: false
                            }
                        },
                        required: ["intent", "entities", "confidence", "reasoning"],
                        additionalProperties: false
                    }
                }
            },
            temperature: 0
        };

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error(`OpenAI Error: ${res.status} ${await res.text()}`);

            const data = await res.json();
            const content = data.choices[0].message.content;
            return IntentSchema.parse(JSON.parse(content));
        } catch (e: any) {
            console.error("OpenAI Interpretation Error:", e);
            // Fallback to prevent bot crash
            return {
                intent: 'unknown',
                entities: {},
                confidence: 0,
                reasoning: e.message || "Validation Error",
                missing_fields: []
            };
        }
    }

    private async interpretGemini(userMessage: string, context: any, retries: number): Promise<AIResult> {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
        const systemPrompt = this.buildSystemPrompt(context);
        const historyText = context.last_messages.map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join('\n');

        const finalPrompt = `
        ${systemPrompt}

        HISTORY:
        ${historyText}

        USER MESSAGE: "${userMessage}"
        
        JSON OUTPUT:
        `;

        const payload = {
            contents: [{ parts: [{ text: finalPrompt }] }],
            generationConfig: {
                temperature: 0,
                responseMimeType: "application/json",
                maxOutputTokens: 1024
            }
        };

        for (let attempt = 1; attempt <= retries + 1; attempt++) {
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!res.ok) throw new Error(`Gemini Error: ${res.status}`);

                const data = await res.json();
                const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
                const cleanJson = rawText.replace(/```json|```/g, '').trim();
                return IntentSchema.parse(JSON.parse(cleanJson));
            } catch (e: any) {
                if (attempt > retries) {
                    return { intent: 'unknown', entities: {}, confidence: 0, reasoning: `Gemini failed: ${e.message}`, missing_fields: [] };
                }
            }
        }
        return { intent: 'unknown', entities: {}, confidence: 0, missing_fields: [] };
    }

    private buildSystemPrompt(context: any): string {
        return `
        You are a STRICT JSON INTERPRETER for a Clinical Scheduling Agent.
        Your job is to analyze the USER MESSAGE and the CONTEXT to determine the intent.

        # RULES
        1. OUTPUT MUST BE VALID JSON ONLY.
        2. INTENTS: 'greeting', 'schedule', 'reschedule', 'cancel', 'faq', 'human_handoff', 'confirm', 'reject', 'unknown'.
        3. CONFIDENCE: 0.0 to 1.0. 
        4. CURRENT STATE: ${context.current_state}

        # CONTEXT
        Clinic: ${context.clinic_name}
        Specialties Available: ${JSON.stringify(context.specialties)}
        Today: ${context.date}

        # TOOLS AVAILABLE
        If you need to fetch data before answering, you can return a tool_call.
        Available tools:
        - fetch_doctors (params: tenant_id, specialty?)
        - get_available_slots (params: tenant_id, doctor_id, location_id, date)
        - cancel_appointment (params: appointment_id, patient_phone)
        `;
    }
}

