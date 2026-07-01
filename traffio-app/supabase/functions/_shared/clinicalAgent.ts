import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * ClinicalAgent V6 — Lead Qualification & Intelligent RAG Confirmations
 * 
 * Replaces the autonomous scheduling agent with a consultative qualifier.
 * Focused on: name/phone/treatment capture and premium confirmation assistance.
 */
export class ClinicalAgent {
  private supabase: SupabaseClient;
  private config: any;
  public sessionContext: any;
  public humanHandoffRequested: boolean = false;
  public bookingCompleted: boolean = false;

  constructor(supabase: any, config: any) {
    this.supabase = supabase;
    this.config = config;
    this.sessionContext = config.sessionContext || {};
  }

  async processMessage(userInput: string): Promise<string> {
    const { 
      apiKey, 
      model, 
      botConfig, 
      clinicName, 
      patientName, 
      conversationHistory, 
      knowledgePacket,
      recentAppointment 
    } = this.config;

    // --- SYSTEM PROMPT (SILENT LOGISTICS CLERK) ---
    const systemPrompt = `
Você é uma Assistente de Logística da ${clinicName}.
Seu único papel é ajudar pacientes que estão respondendo a um LEMBRETE de agendamento.

### REGRAS DE OURO:
1. **NÃO INICIE CONVERSAS**: Você só responde quando o paciente reage a um lembrete (48h/24h/2h/15m).
2. **FOCO EM LOGÍSTICA**: Se o paciente confirmar (SIM), forneça as instruções da base de conhecimento (RAG). MENCIONE SEMPRE:
   - Estacionamento, Café/Água/Chá e Música (Experiência Confort).
   - Link de endereço e Sala de Espera Virtual.
3. **HANDOFF IMEDIATO**: Se o paciente perguntar qualquer coisa fora de confirmação (ex: preços, dúvidas técnicas, horários novos), use 'transfer_to_human' imediatamente. NÃO tente responder.

### BASE DE CONHECIMENTO (RAG):
${knowledgePacket || "Consulte as informações gerais da clínica para orientar o paciente."}

### CONTEXTO DO AGENDAMENTO ATUAL:
${recentAppointment ? JSON.stringify(recentAppointment) : "Nenhum agendamento identificado."}
    `;

    const messages = [
      { role: "system", content: systemPrompt },
      ...(conversationHistory || []),
      { role: "user", content: userInput }
    ];

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model || "gpt-4o-mini",
          messages,
          tools: this.getTools(),
          tool_choice: "auto"
        })
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error.message);

      const message = data.choices[0].message;

      if (message.tool_calls) {
        let toolResultsContext = "";
        for (const toolCall of message.tool_calls) {
          const result = await this.executeTool(toolCall);
          toolResultsContext += `\n[Resultado da ferramenta ${toolCall.function.name}: ${JSON.stringify(result)}]`;
        }

        // Second pass to generate the final logistics response
        const secondResponse = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: model || "gpt-4o-mini",
            messages: [
              ...messages,
              message,
              { role: "user", content: `Tool Results: ${toolResultsContext}\nAgora gere a resposta de confirmação acolhedora com as instruções logísticas OU confirme o handoff.` }
            ]
          })
        });
        const secondData = await secondResponse.json();
        return secondData.choices[0].message.content;
      }

      return message.content;

    } catch (err: any) {
      console.error("Agent Execution Error:", err.message);
      return "Olá! Tive um pequeno problema técnico, mas já estou passando sua mensagem para nossa equipe te ajudar agora mesmo! 😊";
    }
  }

  private getTools() {
    return [
      {
        type: "function",
        function: {
          name: "transfer_to_human",
          description: "Silently transfers the conversation to a human. Call for any complex questions or requests outside of simple confirmation.",
          parameters: {
            type: "object",
            properties: {
              reason: { type: "string" }
            },
            required: ["reason"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "confirm_appointment",
          description: "Confirms an existing appointment in the database. Call when patient says YES to a reminder.",
          parameters: {
            type: "object",
            properties: {
              appointment_id: { type: "string" }
            },
            required: ["appointment_id"]
          }
        }
      }
    ];
  }

  private async executeTool(toolCall: any): Promise<any> {
    const args = JSON.parse(toolCall.function.arguments);
    const name = toolCall.function.name;

    if (name === 'transfer_to_human') {
      this.humanHandoffRequested = true;
      return { status: "success", target: "commercial_queue" };
    }

    if (name === 'confirm_appointment') {
      const { error } = await this.supabase
        .from('appointments')
        .update({ confirmation_status: 'confirmed', status: 'confirmed' })
        .eq('id', args.appointment_id);
      if (error) return { status: "error", message: error.message };
      
      this.bookingCompleted = true; // Signal for rich response logic
      return { status: "success" };
    }
  }
}
