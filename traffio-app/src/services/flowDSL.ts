import { z } from 'zod';

/**
 * Flow DSL Schema Definition
 * Strictly following the AI Flow Generator Blueprint
 */

export const NodeTypesSchema = z.enum([
    'message',
    'menu',
    'input',
    'condition',
    'db_query',
    'api_call',
    'ai_orchestrator',
    'subflow',
    'webhook',
    'delay',
    'cron',
    'split_percentual',
    'human_handoff',
    'end'
]);

export const RuntimeConfigSchema = z.object({
    timeout_ms: z.number().default(30000),
    retry_policy: z.object({
        max_retries: z.number().default(3),
        backoff_ms: z.number().default(1000)
    }).optional(),
    fallback_node_id: z.string().optional()
});

export const FlowNodeSchema = z.object({
    id: z.string(),
    type: NodeTypesSchema,
    label: z.string().optional(),
    content: z.any().optional(), // Text, menu options, or query config
    next: z.string().optional(), // For linear transitions
    choices: z.array(z.object({
        label: z.string(),
        next: z.string(),
        weight: z.number().optional() // for split percentual
    })).optional(), // For menu/interactive branches
    condition: z.object({
        variable: z.string(),
        operator: z.enum(['==', '!=', '>', '<', 'contains', 'matches_regex']),
        value: z.any(),
        true_next: z.string(),
        false_next: z.string()
    }).optional(),
    db_config: z.object({
        table: z.string(),
        filter_column: z.string(),
        filter_value: z.string(),
        result_mapping: z.record(z.string(), z.string()).optional() // col -> var
    }).optional(),
    ai_config: z.object({
        system_prompt: z.string(),
        temperature: z.number().default(0.7),
        max_tokens: z.number().default(500),
        guardrails: z.array(z.string()).optional(),
        output_variable: z.string().optional()
    }).optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    runtime: RuntimeConfigSchema.optional(),
    fallback: z.string().optional()
});

export const FlowDSLSchema = z.object({
    flow_id: z.string(),
    version: z.string().default('2.0'),
    name: z.string(),
    description: z.string().optional(),
    start_node: z.string(),
    nodes: z.array(FlowNodeSchema),
    metadata: z.object({
        author: z.string().optional(),
        tags: z.array(z.string()).optional(),
        createdAt: z.string().optional(),
        updatedAt: z.string().optional()
    }).optional(),
    global_config: z.object({
        input_variables: z.array(z.string()).optional(),
        output_variables: z.array(z.string()).optional(),
        persistent_memory: z.boolean().default(true)
    }).optional()
});

export type FlowDSL = z.infer<typeof FlowDSLSchema>;
export type FlowNode = z.infer<typeof FlowNodeSchema>;

/**
 * Helper to validate a DSL object
 */
export function validateFlowDSL(dsl: any) {
    return FlowDSLSchema.safeParse(dsl);
}
