import type { FlowDSL, FlowNode } from './flowDSL';
import type { Node, Edge } from 'reactflow';
import dagre from 'dagre';

/**
 * FlowCompiler v2
 * Transforms the AI-generated DSL 2.0 into ReactFlow nodes and edges.
 * Uses Dagre for professional graph layout.
 */

export class FlowCompiler {
    private static NODE_WIDTH = 280;
    private static NODE_HEIGHT = 160;

    static compile(dsl: FlowDSL): { nodes: Node[], edges: Edge[] } {
        const nodes: Node[] = [];
        const edges: Edge[] = [];

        // 1. Create Nodes and Edges
        dsl.nodes.forEach((node) => {
            nodes.push({
                id: node.id,
                type: this.mapType(node.type),
                position: { x: 0, y: 0 }, // Will be calculated by dagre
                data: this.prepareNodeData(node)
            });

            this.prepareEdges(node, edges);
        });

        // 2. Apply Dagre Layout
        return this.applyLayout(nodes, edges);
    }

    private static applyLayout(nodes: Node[], edges: Edge[]): { nodes: Node[], edges: Edge[] } {
        const g = new dagre.graphlib.Graph();
        g.setGraph({ rankdir: 'LR', nodesep: 70, ranksep: 100 }); // Left to Right layout
        g.setDefaultEdgeLabel(() => ({}));

        nodes.forEach(node => {
            g.setNode(node.id, { width: this.NODE_WIDTH, height: this.NODE_HEIGHT });
        });

        edges.forEach(edge => {
            g.setEdge(edge.source, edge.target);
        });

        dagre.layout(g);

        const layoutedNodes = nodes.map(node => {
            const nodeWithPosition = g.node(node.id);
            return {
                ...node,
                position: {
                    x: nodeWithPosition.x - this.NODE_WIDTH / 2,
                    y: nodeWithPosition.y - this.NODE_HEIGHT / 2
                }
            };
        });

        return { nodes: layoutedNodes, edges };
    }

    private static mapType(dslType: string): string {
        switch (dslType) {
            case 'menu': return 'interactive';
            case 'api_call': return 'db_query';
            case 'webhook': return 'db_query'; // Temp: Visual placeholder
            case 'delay': return 'message';     // Temp: Visual placeholder
            case 'cron': return 'start';        // Temp: Visual placeholder
            case 'split_percentual': return 'condition';
            case 'human_handoff': return 'message';
            case 'end': return 'message';
            default: return dslType;
        }
    }

    private static prepareNodeData(node: FlowNode): any {
        const data: any = {
            label: node.label || node.id,
            metadata: node.metadata,
            runtime: node.runtime
        };

        if (node.type === 'message' || node.type === 'input') {
            data.message = node.content;
        } else if (node.type === 'menu') {
            data.title = node.content?.title || 'Escolha uma opção';
            data.options = node.choices?.map((c, i) => ({ id: `opt-${i}`, label: c.label }));
        } else if (node.type === 'condition') {
            data.variable = node.condition?.variable;
            data.operator = node.condition?.operator;
            data.value = node.condition?.value;
        } else if (node.type === 'db_query') {
            data.table = node.db_config?.table;
            data.filterColumn = node.db_config?.filter_column;
            data.filterValue = node.db_config?.filter_value;
            data.resultMapping = node.db_config?.result_mapping;
        } else if (node.type === 'ai_orchestrator') {
            data.prompt = node.ai_config?.system_prompt || node.content;
            data.config = node.ai_config;
        } else if (node.type === 'split_percentual') {
            data.label = "SPLIT TEST";
            data.options = node.choices?.map((c, i) => ({ id: `opt-${i}`, label: `${c.label} (${c.weight || 50}%)` }));
        }

        return data;
    }

    private static prepareEdges(node: FlowNode, edges: Edge[]) {
        // Universal next
        if (node.next) {
            edges.push({
                id: `e-${node.id}-${node.next}`,
                source: node.id,
                target: node.next,
                animated: true
            });
        }

        // Branching (Menu / Split)
        if (node.choices) {
            node.choices.forEach((choice, i) => {
                edges.push({
                    id: `e-${node.id}-opt-${i}-${choice.next}`,
                    source: node.id,
                    sourceHandle: `opt-${i}`,
                    target: choice.next,
                    label: choice.label,
                    animated: true
                });
            });
        }

        // Logical Branching (Condition)
        if (node.condition) {
            edges.push({
                id: `e-${node.id}-true-${node.condition.true_next}`,
                source: node.id,
                sourceHandle: 'true',
                target: node.condition.true_next,
                label: 'SIM',
                animated: true,
                style: { stroke: '#10b981', strokeWidth: 2 }
            });
            edges.push({
                id: `e-${node.id}-false-${node.condition.false_next}`,
                source: node.id,
                sourceHandle: 'false',
                target: node.condition.false_next,
                label: 'NÃO',
                animated: true,
                style: { stroke: '#ef4444', strokeWidth: 2 }
            });
        }

        // Fallback edge (only if not already connected)
        if (node.fallback && !node.next) {
            edges.push({
                id: `e-${node.id}-fallback-${node.fallback}`,
                source: node.id,
                target: node.fallback,
                label: 'FALLBACK',
                animated: true,
                style: { strokeDasharray: '5,5', stroke: '#94a3b8' }
            });
        }
    }
}
