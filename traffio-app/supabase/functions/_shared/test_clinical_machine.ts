
// deno run --allow-all supabase/functions/_shared/test_clinical_machine.ts

import { clinicalMachine } from "./stateMachine.ts";
import { interpret } from "https://esm.sh/xstate@4.38.3";

console.log("--- CLINICAL AGENT STATE SIMULATION ---");

// Helper to simulate flow
function testFlow(name: string, events: any[]) {
    console.log(`\n▶ SCENARIO: ${name}`);

    // START
    let currentState = "INIT";
    let context: any = {
        tenant_id: "test-tenant",
        patient_phone: "5511999999999",
        entities: {},
        error_count: 0
    };

    console.log(`[START] State: ${currentState}`);

    for (const event of events) {
        console.log(`\n👤 User Event: ${event.type} (intent=${event.intent || '-'})`);

        // Use the machine definition logic (stateless transition simulation)
        // Since we are not using a running service, we check nextState.
        const nextState = clinicalMachine.transition(currentState, event);

        currentState = nextState.value as string;
        context = nextState.context;

        console.log(`🤖 Next State: ${currentState}`);
        console.log(`   Context:`, JSON.stringify(context.entities));

        if (currentState === 'HUMAN_HANDOFF') {
            console.log("🚨 Human Handoff Triggered!");
            break;
        }
    }
}

// Scenario 1: Happy Path Booking
testFlow("Happy Booking", [
    { type: 'USER_MESSAGE', intent: 'schedule', entities: {} }, // -> SCHEDULING.CHECKING_DATA -> AWAITING_SPECIALTY
    { type: 'USER_MESSAGE', intent: 'inform_specialty', entities: { specialty: 'Cardiologia' } }, // -> CHECKING_DATA -> AWAITING_DATE
    { type: 'USER_MESSAGE', intent: 'inform_date', entities: { date: '2023-10-10' } }, // -> CHECKING_DATA -> AWAITING_TIME
    { type: 'USER_MESSAGE', intent: 'inform_time', entities: { time: '10:00' } }, // -> CHECKING_DATA -> CONFIRMING
    { type: 'USER_MESSAGE', intent: 'confirm', entities: {} } // -> BOOKING -> SUCCESS (simulated)
]);

// Scenario 2: Redundancy Check (Enterprise Fix)
// User provides everything in the first message. Should jump straight to CONFIRMING.
testFlow("Smart Context Lock", [
    {
        type: 'USER_MESSAGE',
        intent: 'schedule',
        entities: { specialty: 'Dermatologia', date: 'Amanhã', time: '14:00' }
    },
    // Expected: INIT -> INTENT -> CHECKING_DATA -> CONFIRMING (skipping all questions)
]);

// Scenario 3: Handoff due to errors
testFlow("Error Loop / Handoff", [
    { type: 'USER_MESSAGE', intent: 'unknown', entities: {} }, // -> UNKNOWN_INTENT -> INIT (Error 1)
    { type: 'USER_MESSAGE', intent: 'unknown', entities: {} }, // -> UNKNOWN_INTENT -> INIT (Error 2)
    { type: 'USER_MESSAGE', intent: 'unknown', entities: {} }, // -> UNKNOWN_INTENT -> HUMAN_HANDOFF (Error 3)
]);
