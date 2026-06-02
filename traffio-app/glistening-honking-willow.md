# Plano de Implementacao: AI Scheduling Agent v2 — Robusto e Anti-Falha

## Contexto e Problema

O agent/bot de agendamento (ClinicalAgent) apresenta 4 bugs criticos em producao:
1. **Agent nao se apresenta** na primeira mensagem
2. **Nao coleta nome/WhatsApp** do paciente (essencial para remarketing)  
3. **Repete mensagens identicas** ao paciente
4. **Trava e nao consegue continuar** a conversa (stuck state)

### Causa-raiz (analise tecnica)
- `clinicalAgent.ts:501-1347` — System prompt com ~5000+ tokens. LLMs sofrem "Lost-in-the-Middle" e ignoram instrucoes centrais
- `clinicalAgent.ts:130-475` — Todas as 20+ tools expostas em TODOS os turnos. LLM faz chamadas desnecessarias, causando loops
- `clinicalAgent.ts:2578-2658` — Agentic loop sem deteccao de loop (sem hash de respostas anteriores)
- `clinicalAgent.ts:2612-2619` — `onIntermediateMessage` envia "Verificando..." + resposta final = duplicacao
- `process-inbox/index.ts:490-507` — Timeout de 40s retorna mensagem generica sem contexto, matando a conversa
- `clinicalAgent.ts:2499-2527` — `preRoute` nao trata primeira mensagem de paciente novo

---

## Arquivos a Modificar

| # | Arquivo | Linhas Afetadas | Descricao |
|---|---------|----------------|-----------|
| 1 | `traffio-app/supabase/functions/_shared/clinicalAgent.ts` | Multiplas secoes | Refactor principal |
| 2 | `traffio-app/supabase/functions/process-inbox/index.ts` | ~460-600 | Greeting deterministico + dedup |
| 3 | `traffio-app/supabase/functions/_shared/sessionManager.ts` | ~72-90 | Helper para phase tracking |

---

## TASK 1: Loop Detection — Anti-Repeticao de Mensagens

### Objetivo
Impedir que o agent envie a mesma mensagem 2+ vezes seguidas ao paciente.

### Arquivo: `clinicalAgent.ts`

### 1.1 Adicionar funcao de hash simples (antes da classe ClinicalAgent, ~linha 89)

```typescript
/** Simple string hash for loop detection (FNV-1a) */
function quickHash(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(36);
}
```

### 1.2 Adicionar loop detection no final de `processMessage()` (~linha 2606-2608)

ANTES de retornar a resposta no bloco `if (choice.finish_reason === "stop")`, adicionar:

```typescript
// Loop detection: check if this response was already sent recently
const responseHash = quickHash((msg.content ?? "").substring(0, 200));
const recentHashes: string[] = this.sessionContext.recent_response_hashes || [];

if (recentHashes.includes(responseHash)) {
  console.warn(`[ClinicalAgent] LOOP DETECTED — same response hash ${responseHash}`);
  // Break loop: append a different CTA instead of sending duplicate
  const pName = this.sessionContext.known_first_name ?? null;
  const loopBreaker = `${pName ? `${pName}, ` : ""}desculpe! 😊 Acho que tive um probleminha. Pode me dizer de outra forma o que precisa? Estou aqui para te ajudar!`;
  this.sessionContext.recent_response_hashes = [quickHash(loopBreaker)];
  this.sessionContext.loop_count = (this.sessionContext.loop_count || 0) + 1;
  
  // If looped 3+ times, escalate to human
  if (this.sessionContext.loop_count >= 3) {
    this.humanHandoffRequested = true;
    return `${pName ? `${pName}, ` : ""}percebi que estou com dificuldade para te ajudar adequadamente. 😊 Vou chamar um de nossos atendentes para te dar um atendimento mais personalizado. Em instantes alguem vai te ajudar! 🙏`;
  }
  return loopBreaker;
}

// Update hash history (keep last 3)
recentHashes.push(responseHash);
if (recentHashes.length > 3) recentHashes.shift();
this.sessionContext.recent_response_hashes = recentHashes;
this.sessionContext.loop_count = 0; // Reset on successful unique response
```

O bloco que atualmente esta em `clinicalAgent.ts:2606-2608`:
```typescript
if (choice.finish_reason === "stop" || !msg.tool_calls?.length) {
  return msg.content ?? "Desculpe, não consegui processar sua solicitação.";
}
```

Deve ser modificado para:
```typescript
if (choice.finish_reason === "stop" || !msg.tool_calls?.length) {
  const finalContent = msg.content ?? "Desculpe, não consegui processar sua solicitação.";
  
  // --- LOOP DETECTION ---
  const responseHash = quickHash(finalContent.substring(0, 200));
  const recentHashes: string[] = this.sessionContext.recent_response_hashes || [];
  
  if (recentHashes.includes(responseHash)) {
    console.warn(`[ClinicalAgent] LOOP DETECTED — same response hash ${responseHash}`);
    const pName = this.sessionContext.known_first_name ?? null;
    const loopBreaker = `${pName ? `${pName}, ` : ""}desculpe! 😊 Acho que tive um probleminha. Pode me dizer de outra forma o que precisa? Estou aqui para te ajudar!`;
    this.sessionContext.recent_response_hashes = [quickHash(loopBreaker)];
    this.sessionContext.loop_count = (this.sessionContext.loop_count || 0) + 1;
    if (this.sessionContext.loop_count >= 3) {
      this.humanHandoffRequested = true;
      return `${pName ? `${pName}, ` : ""}percebi que estou com dificuldade para te ajudar. 😊 Vou chamar um atendente para um atendimento personalizado. Em instantes alguem te ajuda! 🙏`;
    }
    return loopBreaker;
  }
  
  recentHashes.push(responseHash);
  if (recentHashes.length > 3) recentHashes.shift();
  this.sessionContext.recent_response_hashes = recentHashes;
  this.sessionContext.loop_count = 0;
  // --- END LOOP DETECTION ---
  
  return finalContent;
}
```

---

## TASK 2: Intermediate Message Dedup — Anti-Mensagem-Dupla

### Objetivo
Impedir que o agent envie "Um momento! Vou verificar..." seguido da resposta real, criando sensacao de repeticao.

### Arquivo: `clinicalAgent.ts`

### 2.1 Limitar intermediate messages (~linha 2612-2619)

O bloco atual:
```typescript
// NON-TERMINAL: LLM returned text + tool_calls → send text as intermediate message
if (msg.content && msg.content.trim() && this.config.onIntermediateMessage) {
  try {
    await this.config.onIntermediateMessage(msg.content.trim());
  } catch (e: any) {
    console.warn(`[ClinicalAgent] Intermediate message send failed (non-fatal):`, e.message);
  }
}
```

Deve ser modificado para:
```typescript
// NON-TERMINAL: LLM returned text + tool_calls → send ONLY ONE intermediate message per conversation turn
// This prevents the "Verificando... Verificando... Verificando..." spam
if (msg.content && msg.content.trim() && this.config.onIntermediateMessage) {
  if (!this._intermediateMessageSent) {
    try {
      await this.config.onIntermediateMessage(msg.content.trim());
      this._intermediateMessageSent = true;
      console.log(`[ClinicalAgent] Sent intermediate text (round ${round}): "${msg.content.substring(0, 60)}"`);
    } catch (e: any) {
      console.warn(`[ClinicalAgent] Intermediate message send failed (non-fatal):`, e.message);
    }
  } else {
    console.log(`[ClinicalAgent] Skipping duplicate intermediate message (round ${round})`);
  }
}
```

### 2.2 Adicionar propriedade `_intermediateMessageSent` na classe (~linha 481-484)

Depois de `public sessionContext: Record<string, any>;` adicionar:
```typescript
/** Tracks whether an intermediate message was already sent in this turn */
private _intermediateMessageSent = false;
```

---

## TASK 3: First-Turn Guarantee — Apresentacao Deterministica

### Objetivo
GARANTIR que o agent SEMPRE se apresente na primeira mensagem e SEMPRE pergunte o nome do paciente novo. Isso sera feito SEM depender do LLM — sera deterministico.

### Arquivo: `process-inbox/index.ts`

### 3.1 Adicionar greeting deterministico ANTES de chamar o ClinicalAgent (~linha 460, antes de `const agent = new ClinicalAgent(...)`)

Inserir este bloco:
```typescript
// --- FIRST-TURN GUARANTEE: Deterministic greeting for new conversations ---
// If bot hasn't introduced itself yet AND patient is not registered, send a
// deterministic greeting WITHOUT calling the LLM. This guarantees the bot
// always introduces itself and asks for the patient's name.
const sessionCtx = (session as any).context ?? {};
const botName = botConfig.identity?.name || 'Amanda';
const botRole = botConfig.identity?.role || 'atendente';
const clinicName = (tenant as any).name || 'Clinica';

if (!sessionCtx.bot_introduced && !patientData?.full_name) {
  // Determine time-appropriate greeting
  const brHour = new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false });
  const hour = parseInt(brHour, 10);
  const timeGreeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  
  const greetingText = `${timeGreeting}! 😊 Aqui e a ${botName}, ${botRole} da ${clinicName}. Seja muito bem-vindo(a)! Com quem tenho o prazer de falar? 💙`;
  
  // Send greeting directly via Z-API (no LLM needed)
  if (zapiCredentials) {
    try {
      await outbox.sendNow(zapiCredentials, phone, { text: greetingText }, 500);
      console.log(`[process-inbox] [${phone}] Deterministic greeting sent (first turn)`);
    } catch (e: any) {
      console.warn(`[process-inbox] [${phone}] Greeting send failed:`, e.message);
    }
  }
  
  // Update session context
  const updatedCtx = { ...sessionCtx, bot_introduced: true };
  await sessionManager.updateState(session.id, "GREETING", updatedCtx);
  await sessionManager.logMessage(session.id, "user", fusedContent);
  await sessionManager.logMessage(session.id, "assistant", greetingText);
  await markMessages(supabase, messageIds, "done");
  
  // Enqueue follow-ups (same logic as normal flow)
  // Skip follow-up enqueue here — it will be handled when the patient responds with their name
  return;
}

// --- LEAD CAPTURE: When patient responds with their name (second message of new conv) ---
// If bot just introduced itself and patient is not registered, this message is likely their name.
// Capture it deterministically + call save_lead_info logic inline.
if (sessionCtx.bot_introduced && !sessionCtx.name_captured && !patientData?.full_name) {
  // Heuristic: if the message is short (1-4 words, no scheduling keywords), it's likely a name
  const words = fusedContent.trim().split(/\s+/);
  const isLikelyName = words.length <= 4 && words.length >= 1 && 
    !/\b(agendar|marcar|consulta|horario|horário|cancelar|reagendar|preço|precio|valor|quanto)\b/i.test(fusedContent);
  
  if (isLikelyName) {
    const patientName = fusedContent.trim().replace(/[!?.,:;]+$/, ''); // Clean punctuation
    const firstName = patientName.split(' ')[0];
    
    // Save lead info immediately (for remarketing even if patient abandons)
    await supabase
      .from('patient_funnel_stage')
      .update({ 
        patient_name: patientName,
        last_interaction_at: new Date().toISOString()
      })
      .eq('tenant_id', tenantId)
      .eq('patient_phone', phone);
    
    // Update session context with name
    const updatedCtx = { 
      ...sessionCtx, 
      name_captured: true, 
      known_first_name: firstName,
      lead_temperature: 'warm'
    };
    await sessionManager.updateState(session.id, "IDENTIFIED", updatedCtx);
    
    // Send deterministic response confirming name + asking WhatsApp confirmation
    const nameResponse = `Que prazer, ${firstName}! 😊 Esse numero que voce esta usando e seu WhatsApp? Assim ja salvo para facilitar nosso contato! 📱`;
    
    if (zapiCredentials) {
      try {
        await outbox.sendNow(zapiCredentials, phone, { text: nameResponse }, 400);
      } catch (e: any) {
        console.warn(`[process-inbox] [${phone}] Name response send failed:`, e.message);
      }
    }
    
    await sessionManager.logMessage(session.id, "user", fusedContent);
    await sessionManager.logMessage(session.id, "assistant", nameResponse);
    await markMessages(supabase, messageIds, "done");
    return;
  }
  // If not a name (e.g. "quero agendar"), fall through to LLM but inject name_captured context
}

// --- WHATSAPP CONFIRMATION: Handle "sim"/"nao" after name capture ---
if (sessionCtx.name_captured && !sessionCtx.phone_confirmed && !patientData?.full_name) {
  const isYes = /^(sim|s|yes|é|e|isso|exato|meu|esse mesmo)[\s!.,]*$/i.test(fusedContent.trim());
  const isNo = /^(não|nao|no|nope|outro|diferente)[\s!.,]*$/i.test(fusedContent.trim());
  
  if (isYes) {
    const updatedCtx = { ...sessionCtx, phone_confirmed: true };
    await sessionManager.updateState(session.id, "QUALIFIED", updatedCtx);
    
    const firstName = sessionCtx.known_first_name || 'voce';
    const confirmResponse = `Perfeito, ${firstName}! Ja salvei seu contato. 😊 Como posso te ajudar hoje? Quer agendar uma consulta, tirar alguma duvida, ou precisa de outra coisa?`;
    
    if (zapiCredentials) {
      try {
        await outbox.sendNow(zapiCredentials, phone, { text: confirmResponse }, 400);
      } catch (e: any) {
        console.warn(`[process-inbox] [${phone}] Confirm response failed:`, e.message);
      }
    }
    
    await sessionManager.logMessage(session.id, "user", fusedContent);
    await sessionManager.logMessage(session.id, "assistant", confirmResponse);
    await markMessages(supabase, messageIds, "done");
    return;
  }
  
  if (isNo) {
    const updatedCtx = { ...sessionCtx, phone_confirmed: false };
    await sessionManager.updateState(session.id, "AWAITING_PHONE", updatedCtx);
    
    const firstName = sessionCtx.known_first_name || '';
    const phoneAskResponse = `Sem problema${firstName ? `, ${firstName}` : ''}! 😊 Pode me informar o numero de WhatsApp correto com DDD? Ex: 41 99999-0000`;
    
    if (zapiCredentials) {
      try {
        await outbox.sendNow(zapiCredentials, phone, { text: phoneAskResponse }, 400);
      } catch (e: any) {
        console.warn(`[process-inbox] [${phone}] Phone ask failed:`, e.message);
      }
    }
    
    await sessionManager.logMessage(session.id, "user", fusedContent);
    await sessionManager.logMessage(session.id, "assistant", phoneAskResponse);
    await markMessages(supabase, messageIds, "done");
    return;
  }
  // If response is neither yes/no (e.g. "quero agendar"), fall through to LLM
  // but mark phone as implicitly confirmed (they're using this number to chat)
  (session as any).context = { ...sessionCtx, phone_confirmed: true };
}
```

### 3.2 Para pacientes JA CADASTRADOS — greeting personalizado

Adicionar LOGO APOS o bloco acima (antes de `const agent = new ClinicalAgent(...)`):

```typescript
// --- RETURNING PATIENT GREETING: Personalized first-turn for registered patients ---
if (!sessionCtx.bot_introduced && patientData?.full_name) {
  const firstName = patientData.full_name.split(' ')[0];
  const brHour = new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false });
  const hour = parseInt(brHour, 10);
  const timeGreeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  
  // Don't send deterministic greeting for returning patients — let LLM handle
  // But DO ensure bot_introduced is set and name is in context
  (session as any).context = { 
    ...sessionCtx, 
    bot_introduced: true, 
    known_first_name: firstName,
    name_captured: true,
    phone_confirmed: true
  };
}
```

---

## TASK 4: Phase-Based Tool Restriction

### Objetivo
Reduzir o numero de tools expostas ao LLM em cada turno, baseado na fase da conversa. Menos tools = menos erros de tool calling = menos loops.

### Arquivo: `clinicalAgent.ts`

### 4.1 Adicionar funcao `getPhaseTools()` na classe ClinicalAgent (antes de `processMessage`, ~linha 2528)

```typescript
/** Returns only the tools relevant to the current conversation phase */
private getPhaseTools(): typeof TOOLS[number][] {
  const ctx = this.sessionContext;
  
  // Phase: GREETING/IDENTIFY — only need patient lookup and lead capture
  if (!ctx.bot_introduced || !ctx.name_captured) {
    return TOOLS.filter(t => 
      ['lookup_patient', 'save_lead_info'].includes(t.function.name)
    );
  }
  
  // Phase: MANAGE — patient wants to cancel/reschedule existing appointment
  if (ctx.reminder_cancel_requested || ctx.reminder_reschedule_requested) {
    return TOOLS.filter(t => 
      ['list_patient_appointments', 'cancel_appointment', 'reschedule_appointment', 
       'verify_identity', 'check_availability', 'get_next_available_date'].includes(t.function.name)
    );
  }
  
  // Phase: CONFIRM — booking details are set, just need confirmation
  if (ctx.pending_booking?.date && ctx.pending_booking?.time) {
    return TOOLS.filter(t => 
      ['store_booking_selection', 'book_appointment', 'update_patient_details', 
       'register_patient', 'generate_pix_payment'].includes(t.function.name)
    );
  }
  
  // Phase: SCHEDULE — actively looking for doctor/service/date/time
  if (ctx.current_doctor_id || ctx.current_service_id || ctx.last_offered_slots) {
    return TOOLS.filter(t => 
      ['list_appointment_types', 'list_service_locations', 'get_next_available_date',
       'check_availability', 'store_booking_selection', 'book_appointment',
       'list_doctor_insurances', 'add_to_waitlist', 'get_doctor_details',
       'register_patient', 'update_patient_details', 'save_lead_info',
       'request_human_agent'].includes(t.function.name)
    );
  }
  
  // Phase: DEFAULT — full tool set (initial scheduling exploration)
  return [...TOOLS];
}
```

### 4.2 Usar `getPhaseTools()` no `callOpenAI` (~linha 2677)

Modificar o body do JSON.stringify em `callOpenAI`:

ANTES:
```typescript
tools: TOOLS,
```

DEPOIS:
```typescript
tools: this._phaseTools,
```

### 4.3 Setar `_phaseTools` antes do loop em `processMessage()` (~linha 2578)

Antes de `for (let round = 0; round < 8; round++)`, adicionar:
```typescript
// Determine phase-appropriate tools (fewer tools = more reliable tool calling)
this._phaseTools = this.getPhaseTools();
console.log(`[ClinicalAgent] Phase tools: ${this._phaseTools.map(t => t.function.name).join(', ')}`);
```

### 4.4 Adicionar propriedade `_phaseTools` na classe (~linha 481)

```typescript
private _phaseTools: typeof TOOLS[number][] = [...TOOLS];
```

---

## TASK 5: Max Turns Enforcement — Anti-Stuck-State

### Objetivo
Impedir que a conversa fique presa indefinidamente no mesmo estado. Se exceder um limite de turnos, mudar de abordagem ou escalar para humano.

### Arquivo: `clinicalAgent.ts`

### 5.1 Adicionar turn tracking no inicio de `processMessage()` (~linha 2529, apos `const preRouted`)

```typescript
// Turn tracking — detect stuck conversations
this.sessionContext.total_turns = (this.sessionContext.total_turns || 0) + 1;
this.sessionContext.turns_since_last_tool_success = (this.sessionContext.turns_since_last_tool_success || 0) + 1;

// Safety: if conversation has been going for 25+ turns without booking, something is wrong
if (this.sessionContext.total_turns > 25 && !this.bookingCompleted) {
  console.warn(`[ClinicalAgent] Excessive turns (${this.sessionContext.total_turns}) without booking — escalating`);
  this.humanHandoffRequested = true;
  const pName = this.sessionContext.known_first_name ?? null;
  return `${pName ? `${pName}, ` : ""}percebi que nosso atendimento esta demorando mais do que o normal. 😊 Vou chamar um de nossos atendentes para te ajudar de forma mais rapida. Um momento, por favor! 🙏`;
}
```

### 5.2 Resetar `turns_since_last_tool_success` quando tool tem sucesso

No bloco de execucao de tools (~linha 2637-2654), apos cada tool call bem-sucedida, adicionar:
```typescript
// Reset stuck counter on successful tool execution
if (!result.includes('"error"')) {
  this.sessionContext.turns_since_last_tool_success = 0;
}
```

---

## TASK 6: Timeout com Contexto Inteligente

### Objetivo
Quando o agent atinge timeout (40s), em vez de mensagem generica, enviar recovery baseada no estado atual.

### Arquivo: `process-inbox/index.ts`

### 6.1 Modificar o bloco de timeout (~linha 499-507)

ANTES:
```typescript
if (timeoutErr.message === "AGENT_TIMEOUT") {
  console.warn(`[process-inbox] [${phone}] Agent timeout after ${AGENT_TIMEOUT_MS}ms`);
  const pName = patientData?.full_name?.split(" ")[0] ?? patientRow?.patient_name?.split(" ")[0] ?? null;
  responseText = `${pName ? `${pName}, ` : ""}peço desculpas pela demora! 🙏 Estamos com uma alta demanda no momento. Pode repetir sua solicitação? Vou te responder agora mesmo! 😊`;
}
```

DEPOIS:
```typescript
if (timeoutErr.message === "AGENT_TIMEOUT") {
  console.warn(`[process-inbox] [${phone}] Agent timeout after ${AGENT_TIMEOUT_MS}ms`);
  const pName = patientData?.full_name?.split(" ")[0] ?? patientRow?.patient_name?.split(" ")[0] ?? null;
  const ctx = (session as any).context ?? {};
  
  // Context-aware timeout recovery
  if (ctx.current_doctor_id && !ctx.pending_booking) {
    // Was searching for availability
    responseText = `${pName ? `${pName}, ` : ""}desculpe a demora! 😊 Tive um pequeno atraso ao buscar os horarios. Pode me dizer novamente qual dia ou periodo prefere? Vou verificar rapidinho! 🔍`;
  } else if (ctx.pending_booking) {
    // Was trying to book
    responseText = `${pName ? `${pName}, ` : ""}ops, tive um probleminha ao finalizar! 😅 Seus dados estao salvos. Pode confirmar novamente com "sim" que eu finalizo o agendamento? 😊`;
  } else if (!ctx.name_captured) {
    // Was in identification phase
    responseText = `${pName ? `Oi, ${pName}! ` : "Oi! "}desculpe a demora! 😊 Estou aqui. Como posso te ajudar hoje?`;
  } else {
    // Generic but better than before
    responseText = `${pName ? `${pName}, ` : ""}desculpe a demora! 😊 Tive um pequeno atraso tecnico. Pode repetir o que precisa? Estou pronta para te ajudar! 💙`;
  }
}
```

---

## TASK 7: Outbound Dedup no process-inbox

### Objetivo
Prevenir envio de mensagem identica ao mesmo paciente em menos de 30 segundos.

### Arquivo: `process-inbox/index.ts`

### 7.1 Adicionar dedup check ANTES de `outbox.sendNow()` (~linha 533-546)

ANTES:
```typescript
if (zapiCredentials) {
  try {
    await outbox.sendNow(
      zapiCredentials,
      phone,
      { text: responseText },
      500
    );
```

DEPOIS:
```typescript
if (zapiCredentials) {
  // Outbound dedup: prevent identical message within 30s
  const responseSnippet = responseText.substring(0, 150);
  const lastSent = (session as any).context?.last_sent_snippet;
  const lastSentAt = (session as any).context?.last_sent_at;
  const isDuplicate = lastSent === responseSnippet && lastSentAt && (Date.now() - new Date(lastSentAt).getTime()) < 30000;
  
  if (isDuplicate) {
    console.warn(`[process-inbox] [${phone}] OUTBOUND DEDUP — identical message within 30s, skipping send`);
  } else {
    try {
      await outbox.sendNow(
        zapiCredentials,
        phone,
        { text: responseText },
        500
      );
```

E atualizar o context apos envio bem-sucedido (dentro do try, apos `sendNow`):
```typescript
      // Track last sent for dedup
      agent.sessionContext.last_sent_snippet = responseSnippet;
      agent.sessionContext.last_sent_at = new Date().toISOString();
```

Fechar os blocos adequadamente:
```typescript
    } catch (sendErr: any) {
      console.warn(`[process-inbox] [${phone}] Direct send failed, falling back to outbox:`, sendErr.message);
      await outbox.enqueue(tenantId, phone, { text: responseText });
    }
  } // end isDuplicate check
}
```

---

## TASK 8: System Prompt Optimization — Reducao de Tokens

### Objetivo
Reduzir o system prompt de ~5000 tokens para ~2000-3000 tokens removendo instrucoes redundantes e usando prompt tiered por fase.

### Arquivo: `clinicalAgent.ts`

### 8.1 Modificar `buildSystemPrompt()` para ser phase-aware

No inicio de `buildSystemPrompt()` (~linha 501), adicionar:
```typescript
const currentPhase = this.getCurrentPhase();
```

Adicionar metodo `getCurrentPhase()`:
```typescript
private getCurrentPhase(): 'GREET' | 'IDENTIFY' | 'SCHEDULE' | 'CONFIRM' | 'FAQ' | 'MANAGE' {
  const ctx = this.sessionContext;
  if (!ctx.bot_introduced || !ctx.name_captured) return 'GREET';
  if (ctx.reminder_cancel_requested || ctx.reminder_reschedule_requested) return 'MANAGE';
  if (ctx.pending_booking?.date && ctx.pending_booking?.time) return 'CONFIRM';
  if (ctx.current_doctor_id || ctx.current_service_id) return 'SCHEDULE';
  return 'SCHEDULE'; // Default for most conversations
}
```

### 8.2 Condicionar blocos do prompt pela fase

No `buildSystemPrompt()`, envolver os blocos mais longos em condicionais:

```typescript
// Only include ETAPA 1 (identification protocol) during GREET/IDENTIFY phase
const etapa1Block = (currentPhase === 'GREET' || !this.config.patientId) 
  ? `[...existing ETAPA 1 content...]` 
  : '';

// Only include ETAPA 2 (scheduling) during SCHEDULE phase  
const etapa2Block = (currentPhase === 'SCHEDULE' || currentPhase === 'CONFIRM')
  ? `[...existing ETAPA 2 content...]`
  : '';

// Only include ETAPA 3 (yield management) during SCHEDULE phase
const etapa3Block = (currentPhase === 'SCHEDULE')
  ? `[...existing ETAPA 3 content...]`
  : '';

// Only include ETAPA 4 (confirmation) during CONFIRM phase
const etapa4Block = (currentPhase === 'CONFIRM')
  ? `[...existing ETAPA 4 content...]`
  : '';
```

### 8.3 Repetir regras criticas no FINAL do prompt

Adicionar ao final do return de `buildSystemPrompt()`:
```typescript
// Critical rules repeated at END (LLM attention bias — beginning + end get most attention)
\n# REGRAS MAIS IMPORTANTES (REPETIDAS PARA ENFASE)
1. JAMAIS invente medicos, horarios ou unidades — use APENAS dados das ferramentas.
2. NUNCA repita a mesma mensagem que ja enviou.
3. Cada mensagem deve avancar o paciente 1 passo mais perto do agendamento.
4. Use o nome do paciente (${patientFirstName || 'quando souber'}) em TODAS as mensagens.
```

---

## TASK 9: Agentic Loop Safety — Max Consecutive Tool Failures

### Arquivo: `clinicalAgent.ts`

### 9.1 Dentro do agentic loop (~linha 2637-2654), apos execucao de tools

Adicionar tracking de tool failures consecutivas:
```typescript
// Track consecutive tool failures
const failedTools = results.filter(r => {
  try { return JSON.parse(r.content).error; } catch { return false; }
});

if (failedTools.length === toolCalls.length) {
  this.sessionContext.consecutive_tool_failures = (this.sessionContext.consecutive_tool_failures || 0) + 1;
  console.warn(`[ClinicalAgent] All tools failed this round. Consecutive failures: ${this.sessionContext.consecutive_tool_failures}`);
  
  if (this.sessionContext.consecutive_tool_failures >= 3) {
    console.warn(`[ClinicalAgent] 3+ consecutive tool failures — escalating to human`);
    this.humanHandoffRequested = true;
    const pName = this.sessionContext.known_first_name ?? null;
    return `${pName ? `${pName}, ` : ""}desculpe, estou com uma dificuldade tecnica no momento. 😊 Vou chamar um atendente para te ajudar. Um momento! 🙏`;
  }
} else {
  this.sessionContext.consecutive_tool_failures = 0;
}
```

---

## Resumo de Mudancas por Arquivo

### `clinicalAgent.ts` — Mudancas
1. Adicionar funcao `quickHash()` (novo, antes da classe)
2. Adicionar propriedade `_intermediateMessageSent` (classe)
3. Adicionar propriedade `_phaseTools` (classe)
4. Adicionar metodo `getPhaseTools()` (classe)
5. Adicionar metodo `getCurrentPhase()` (classe)
6. Modificar `processMessage()`: loop detection, turn tracking, phase tools
7. Modificar intermediate message block: dedup
8. Modificar `callOpenAI()`: usar `_phaseTools` em vez de `TOOLS`
9. Modificar `buildSystemPrompt()`: phase-aware, repetir regras no final
10. Adicionar tool failure tracking no agentic loop

### `process-inbox/index.ts` — Mudancas
1. Adicionar greeting deterministico (antes de ClinicalAgent)
2. Adicionar lead capture deterministico (nome)
3. Adicionar WhatsApp confirmation handler
4. Adicionar returning patient context setup
5. Modificar timeout recovery (context-aware)
6. Adicionar outbound dedup check

### `sessionManager.ts` — Sem mudancas estruturais
- Os novos campos (total_turns, loop_count, etc.) sao armazenados no campo JSONB `context` existente
- Nenhuma migration de banco de dados necessaria

---

## Verificacao/Testes

1. **Teste: Primeira mensagem** — Enviar "Ola" como paciente novo → deve receber greeting deterministico com nome do bot e pergunta "com quem falo?"
2. **Teste: Captura de nome** — Responder "Maria" → deve receber confirmacao do nome + pergunta de WhatsApp
3. **Teste: Confirmacao WhatsApp** — Responder "sim" → deve receber "Como posso te ajudar?"
4. **Teste: Agendamento completo** — Pedir "quero agendar implante" → verificar fluxo sem loops
5. **Teste: Anti-loop** — Enviar a mesma mensagem 3x → agent deve variar resposta e eventualmente escalar
6. **Teste: Anti-dedup** — Verificar que "Verificando..." so e enviado 1x por turno
7. **Teste: Timeout** — Forcar timeout → verificar mensagem contextual (nao generica)
8. **Teste: Paciente cadastrado** — Enviar "Ola" como paciente existente → LLM deve cumprimentar pelo nome

### Como testar
- Deploy das Edge Functions: `supabase functions deploy process-inbox` e `supabase functions deploy whatsapp-bot`
- Enviar mensagem via WhatsApp para o numero conectado ao Z-API
- Verificar logs: `supabase functions logs process-inbox --tail`
- Verificar session context: query `conversation_sessions` no Supabase Dashboard
