import { createMachine, assign } from "https://esm.sh/xstate@4.38.3";

export interface Context {
    tenant_id: string;
    patient_phone: string;
    intent?: string;
    entities: {
        specialty?: string;
        doctor_id?: string;
        doctor_name?: string;
        location_id?: string;
        service_id?: string;
        date?: string;
        time?: string;
    };
    error_count: number;
    last_message?: string;
    missing_fields: string[];
}

export type ClinicalEvents =
    | { type: 'USER_MESSAGE'; intent: string; entities: any; confidence: number }
    | { type: 'SLOT_SELECTED'; date: string; time: string }
    | { type: 'CONFIRM' }
    | { type: 'REJECT' }
    | { type: 'TIMEOUT' }
    | { type: 'ERROR' }
    | { type: 'HUMAN_HANDOFF' };

export const clinicalMachine = createMachine<Context, ClinicalEvents>({
    id: "clinical-agent",
    initial: "INIT",
    context: {
        tenant_id: "",
        patient_phone: "",
        entities: {},
        error_count: 0,
        missing_fields: []
    },
    states: {
        INIT: {
            // Immediate transition if intent is provided in context (from index.ts injection)
            always: [
                { target: 'SCHEDULING', cond: (ctx) => ctx.intent === 'schedule' },
                { target: 'FAQ_ANSWER', cond: (ctx) => ctx.intent === 'faq' },
                { target: 'HUMAN_HANDOFF', cond: (ctx) => ctx.intent === 'human_handoff' },
                // If it's a greeting, we stay here or move to a GREETING state. 
                // For now, let's keep INIT but acknowledge the intent was processed.
                { target: 'INTENT_DETECTED', cond: (ctx) => !!ctx.intent && ctx.intent !== 'greeting' && ctx.intent !== 'unknown' }
            ],
            on: {
                USER_MESSAGE: [
                    { target: "HUMAN_HANDOFF", cond: (ctx, event) => event.intent === 'human_handoff' },
                    { target: 'INTENT_DETECTED', actions: 'assignIntent' }
                ]
            }
        },
        INTENT_DETECTED: {
            always: [
                { target: 'SCHEDULING', cond: (ctx) => ctx.intent === 'schedule' },
                { target: 'FAQ_ANSWER', cond: (ctx) => ctx.intent === 'faq' },
                { target: 'HUMAN_HANDOFF', cond: (ctx) => ctx.intent === 'human_handoff' },
                { target: 'INIT', cond: (ctx) => ctx.intent === 'greeting' }, // loops back to init but response will handle greeting
                { target: 'UNKNOWN_INTENT', cond: (ctx) => ctx.intent === 'unknown' }
            ]
        },
        SCHEDULING: {
            initial: 'CHECKING_DATA',
            states: {
                CHECKING_DATA: {
                    always: [
                        // STRICT CONTEXT LOCK: Order matters.
                        // If we have all required fields -> Go to CONFIRMING
                        { target: 'CONFIRMING', cond: (ctx) => !!ctx.entities.specialty && !!ctx.entities.doctor_id && !!ctx.entities.location_id && !!ctx.entities.service_id && !!ctx.entities.date && !!ctx.entities.time },

                        // If we have date but NO time -> Go to TIME
                        { target: 'AWAITING_TIME', cond: (ctx) => !!ctx.entities.specialty && !!ctx.entities.doctor_id && !!ctx.entities.location_id && !!ctx.entities.service_id && !!ctx.entities.date },

                        // If we have service but NO date -> Go to DATE
                        { target: 'AWAITING_DATE', cond: (ctx) => !!ctx.entities.specialty && !!ctx.entities.doctor_id && !!ctx.entities.location_id && !!ctx.entities.service_id },

                        // If we have location but NO service -> Go to SERVICE
                        { target: 'AWAITING_SERVICE', cond: (ctx) => !!ctx.entities.specialty && !!ctx.entities.doctor_id && !!ctx.entities.location_id },

                        // If we have doctor but NO location -> Go to LOCATION
                        { target: 'AWAITING_LOCATION', cond: (ctx) => !!ctx.entities.specialty && !!ctx.entities.doctor_id },

                        // If we have specialty but NO doctor -> Go to DOCTOR
                        { target: 'AWAITING_DOCTOR', cond: (ctx) => !!ctx.entities.specialty },

                        // Default fallback: If no specialty -> Go to SPECIALTY
                        { target: 'AWAITING_SPECIALTY' }
                    ]
                },
                AWAITING_SPECIALTY: {
                    on: {
                        USER_MESSAGE: {
                            target: 'CHECKING_DATA',
                            actions: 'updateEntities'
                        }
                    }
                },
                AWAITING_DOCTOR: {
                    on: {
                        USER_MESSAGE: {
                            target: 'CHECKING_DATA',
                            actions: 'updateEntities'
                        }
                    }
                },
                AWAITING_LOCATION: {
                    on: {
                        USER_MESSAGE: {
                            target: 'CHECKING_DATA',
                            actions: 'updateEntities'
                        }
                    }
                },
                AWAITING_SERVICE: {
                    on: {
                        USER_MESSAGE: {
                            target: 'CHECKING_DATA',
                            actions: 'updateEntities'
                        }
                    }
                },
                AWAITING_DATE: {
                    on: {
                        USER_MESSAGE: {
                            target: 'CHECKING_DATA',
                            actions: 'updateEntities'
                        }
                    }
                },
                AWAITING_TIME: {
                    on: {
                        USER_MESSAGE: {
                            target: 'CHECKING_DATA',
                            actions: 'updateEntities'
                        },
                        SLOT_SELECTED: {
                            target: 'CHECKING_DATA',
                            actions: 'assignSlot'
                        }
                    }
                },
                CONFIRMING: {
                    on: {
                        CONFIRM: 'BOOKING',
                        REJECT: 'INIT', // User cancelled
                        USER_MESSAGE: [
                            { target: 'BOOKING', cond: (ctx, event) => event.intent === 'confirm' },
                            { target: 'INIT', cond: (ctx, event) => event.intent === 'reject' || event.intent === 'cancel' }
                        ]
                    }
                },
                BOOKING: {
                    invoke: {
                        src: 'executeBooking',
                        onDone: '#clinical-agent.SUCCESS',
                        onError: '#clinical-agent.FAILED'
                    }
                }
            }
        },
        FAQ_ANSWER: {
            // Logic to answer and go back to init or end
            on: {
                USER_MESSAGE: 'INIT'
            }
        },
        UNKNOWN_INTENT: {
            entry: 'incrementError',
            always: [
                { target: 'HUMAN_HANDOFF', cond: (ctx) => ctx.error_count >= 3 },
                { target: 'INIT' } // Ask to rephrase
            ]
        },
        SUCCESS: {
            type: 'final'
        },
        FAILED: {
            on: {
                USER_MESSAGE: 'INIT'
            }
        },
        HUMAN_HANDOFF: {
            type: 'final'
        }
    }
}, {
    actions: {
        assignIntent: assign((ctx, event: any) => ({
            intent: event.intent,
            entities: { ...ctx.entities, ...event.entities },
            missing_fields: event.missing_fields || []
        })),
        updateEntities: assign((ctx, event: any) => ({
            entities: { ...ctx.entities, ...(event.entities || {}) }
        })),
        assignSlot: assign((ctx, event: any) => ({
            entities: { ...ctx.entities, date: event.date, time: event.time }
        })),
        incrementError: assign({
            error_count: (ctx) => ctx.error_count + 1
        })
    }
});
