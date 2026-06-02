import type { FlowDSL, FlowNode } from './flowDSL';

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * FlowValidator v2
 * Validates the logical and structural integrity of a Flow DSL 2.0.
 */
export class FlowValidator {
    static validate(dsl: FlowDSL): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // 1. Basic Structure
        const nodesMap = new Map<string, FlowNode>();
        dsl.nodes.forEach(n => nodesMap.set(n.id, n));

        if (!nodesMap.has(dsl.start_node)) {
            errors.push(`Start node "${dsl.start_node}" not found.`);
        }

        // 2. Cycle Detection (Infinite Loops)
        const visited = new Set<string>();
        const stack = new Set<string>();
        if (this.hasCycle(dsl.start_node, nodesMap, visited, stack)) {
            warnings.push("Infinite cycle detected. Ensure there are escape conditions or end nodes.");
        }

        // 3. Reachability & Orphans
        const reachable = new Set<string>();
        this.trackReachability(dsl.start_node, nodesMap, reachable);

        dsl.nodes.forEach(node => {
            if (!reachable.has(node.id)) {
                warnings.push(`Node "${node.id}" (${node.type}) is unreachable from start.`);
            }
        });

        // 4. Node-Specific Validations
        dsl.nodes.forEach(node => {
            this.validateNodeConnections(node, nodesMap, errors);
            this.validateNodeConfig(node, errors);
        });

        // 5. Termination check
        const hasEndNode = dsl.nodes.some(n => n.type === 'end');
        if (!hasEndNode) {
            errors.push("The flow has no 'end' node. It must have at least one termination point.");
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    private static hasCycle(id: string, nodes: Map<string, FlowNode>, visited: Set<string>, stack: Set<string>): boolean {
        if (stack.has(id)) return true;
        if (visited.has(id)) return false;

        visited.add(id);
        stack.add(id);

        const node = nodes.get(id);
        if (node) {
            const neighbors: string[] = [];
            if (node.next) neighbors.push(node.next);
            node.choices?.forEach(c => neighbors.push(c.next));
            if (node.condition) {
                neighbors.push(node.condition.true_next);
                neighbors.push(node.condition.false_next);
            }

            for (const neighbor of neighbors) {
                if (this.hasCycle(neighbor, nodes, visited, stack)) return true;
            }
        }

        stack.delete(id);
        return false;
    }

    private static trackReachability(id: string, nodes: Map<string, FlowNode>, reachable: Set<string>) {
        if (reachable.has(id)) return;
        reachable.add(id);

        const node = nodes.get(id);
        if (!node) return;

        if (node.next) this.trackReachability(node.next, nodes, reachable);
        node.choices?.forEach(c => this.trackReachability(c.next, nodes, reachable));
        if (node.condition) {
            this.trackReachability(node.condition.true_next, nodes, reachable);
            this.trackReachability(node.condition.false_next, nodes, reachable);
        }
    }

    private static validateNodeConnections(node: FlowNode, nodes: Map<string, FlowNode>, errors: string[]) {
        const check = (targetId: string, label: string) => {
            if (!nodes.has(targetId)) {
                errors.push(`Node "${node.id}" (${node.type}) ${label} references missing node "${targetId}".`);
            }
        };

        if (node.next) check(node.next, 'next');
        node.choices?.forEach((c, i) => check(c.next, `choice[${i}] (${c.label})`));
        if (node.condition) {
            check(node.condition.true_next, 'condition (TRUE)');
            check(node.condition.false_next, 'condition (FALSE)');
        }
        if (node.fallback) check(node.fallback, 'fallback');
    }

    private static validateNodeConfig(node: FlowNode, errors: string[]) {
        if (node.type === 'db_query' && !node.db_config) {
            errors.push(`Node "${node.id}" (db_query) is missing "db_config".`);
        }
        if (node.type === 'condition' && !node.condition) {
            errors.push(`Node "${node.id}" (condition) is missing "condition" logic.`);
        }
        if (node.type === 'ai_orchestrator' && !node.ai_config && !node.content) {
            errors.push(`Node "${node.id}" (ai_orchestrator) missing prompt/config.`);
        }
        if (node.type === 'split_percentual' && (!node.choices || node.choices.length < 2)) {
            errors.push(`Node "${node.id}" (split_percentual) needs at least 2 choices.`);
        }
    }
}
