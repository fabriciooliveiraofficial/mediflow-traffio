import { supabase } from '../lib/supabase';
import { AI_FLOW_SYSTEM_PROMPT } from './aiFlowPrompt';

/**
 * AIFlowPlanner
 * Implements the "AI Planning Layer" from Master Plan v2.
 * Step 1: Objective -> Strategic Plan
 * Step 2: Strategic Plan -> Flow DSL
 */
export class AIFlowPlanner {

    static async planAndGenerate(userRequest: string): Promise<{ plan: any, dsl: any }> {
        // Step 1: Strategic Planning
        const planningPrompt = `
        User Request: "${userRequest}"
        
        Task: Create a STRATEGIC PLAN for this medical conversation flow.
        Do not generate DSL yet. Focus on:
        1. Objective of the flow.
        2. Key stages (Identification, Validation, Solution, Closing).
        3. Decision points and branching logic.
        4. Required database integrations.
        
        Output format: STRUCTURED JSON.
        `;

        const planResponse = await this.callAI(planningPrompt, "You are a Medical Systems Architect.");
        const plan = JSON.parse(planResponse);

        // Step 2: DSL Generation from Plan
        const generationPrompt = `
        Strategic Plan: ${JSON.stringify(plan)}
        
        Task: Convert this plan into a valid Flow DSL 2.0.
        Follow the strict JSON schema provided in your system instructions.
        `;

        const dslResponse = await this.callAI(generationPrompt, AI_FLOW_SYSTEM_PROMPT);
        const dsl = JSON.parse(dslResponse);

        return { plan, dsl };
    }

    private static async callAI(prompt: string, systemPrompt: string): Promise<string> {
        // Using the same provider logic as existing ChatAgent
        // For now, mocking the structure, but in a real app this calls the Edge Function or Proxy
        const { data, error } = await supabase.functions.invoke('ai-assistant', {
            body: {
                prompt,
                systemPrompt,
                model: 'gemini-2.0-flash'
            }
        });

        if (error || !data.text) {
            throw new Error(error?.message || "AI failed to respond.");
        }

        // Clean JSON (remove markdown backticks and potential prefixes)
        let cleanText = data.text.replace(/```json|```/g, '').trim();

        // Ensure we only parse the object part
        const firstBrace = cleanText.indexOf('{');
        const lastBrace = cleanText.lastIndexOf('}');

        if (firstBrace !== -1 && lastBrace !== -1) {
            cleanText = cleanText.substring(firstBrace, lastBrace + 1);
        }

        try {
            // Verify if it's parseable
            JSON.parse(cleanText);
            return cleanText;
        } catch (e) {
            console.error("JSON Parse Error:", e);
            console.log("Raw Text:", data.text);
            console.log("Cleaned Text:", cleanText);
            // Attempt to repair common issues? For now, re-throw with context
            throw new Error("AI generated invalid JSON. Check console for details.");
        }
    }
}
