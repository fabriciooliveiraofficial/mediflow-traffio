import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import ReactFlow, {
    useNodesState,
    useEdgesState,
    Controls,
    Background,
    addEdge,
} from 'reactflow';
import type { Node, Connection } from 'reactflow';
import 'reactflow/dist/style.css';
import {
    Save,
    Loader2,
    MessageSquare,
    Bot,
    Trash2,
    Sparkles,
    Send,
    Globe,
    Clock,
    Play
} from 'lucide-react';
import { clsx } from 'clsx';
import { useToast } from '../../contexts/ToastContext';
import { FlowCompiler } from '../../services/flowCompiler';
import { AIFlowPlanner } from '../../services/aiFlowPlanner';
import { nodeTypes } from './nodes';

export const FlowStudio = ({ flows, activeFlowId, onSelectFlow, onNewFlow, onSave, onSimulate }: {
    flows: any[],
    activeFlowId: string | null,
    onSelectFlow: (id: string) => void,
    onNewFlow: () => void,
    onSave: (data: any) => void,
    onSimulate: () => void
}) => {
    const { t } = useTranslation('flowBuilder');
    const { showToast } = useToast();
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [aiPrompt, setAiPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);

    const activeFlow = useMemo(() => flows.find(f => f.id === activeFlowId), [flows, activeFlowId]);
    const selectedNode = useMemo(() => nodes.find(n => n.id === selectedNodeId), [nodes, selectedNodeId]);

    // Sync active flow data
    useEffect(() => {
        if (activeFlow?.definition?.nodes) {
            setNodes(activeFlow.definition.nodes.map((n: any) => ({ ...n, position: n.position || { x: 0, y: 0 } })));
            setEdges(activeFlow.definition.edges || []);
        } else {
            setNodes([]);
            setEdges([]);
        }
    }, [activeFlowId, flows, setNodes, setEdges]);

    const handleGenerateAI = async () => {
        if (!aiPrompt.trim()) return;
        setIsGenerating(true);
        try {
            const { dsl } = await AIFlowPlanner.planAndGenerate(aiPrompt);
            const { nodes: newNodes, edges: newEdges } = FlowCompiler.compile(dsl);
            setNodes(newNodes);
            setEdges(newEdges);
            setAiPrompt('');
        } catch (error) {
            console.error('AI Generation error:', error);
            showToast('error', t('studio.aiGenerationError'));
        } finally {
            setIsGenerating(false);
        }
    };

    const onConnect = useCallback((params: Connection) => setEdges((eds) => addEdge(params, eds)), [setEdges]);

    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const onDrop = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();

            const type = event.dataTransfer.getData('application/reactflow');
            if (!type || !reactFlowInstance || !reactFlowWrapper.current) return;

            const position = reactFlowInstance.screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
            });

            const newNode: Node = {
                id: `${type}_${Date.now()}`,
                type,
                position,
                data: { label: t('studio.newNodeLabel', { type }), message: '', prompt: '', url: '' },
            };

            setNodes((nds) => nds.concat(newNode));
        },
        [reactFlowInstance, setNodes]
    );

    const handleUpdateNode = (data: any) => {
        if (!selectedNodeId) return;
        setNodes(nds => nds.map(n => n.id === selectedNodeId ? { ...n, data: { ...n.data, ...data } } : n));
    };

    return (
        <div className="h-full flex overflow-hidden bg-white font-sans">
            {/* Left AI Studio Sidebar */}
            <aside className="w-80 bg-slate-50 border-r border-ice-200 flex flex-col z-10">
                {/* Flow Selector */}
                <div className="p-6 border-b border-ice-200 bg-white">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">{t('studio.yourAiEcosystem')}</div>
                    <div className="flex gap-2 mb-4">
                        <select
                            value={activeFlowId || ''}
                            onChange={(e) => onSelectFlow(e.target.value)}
                            className="flex-1 bg-slate-50 border border-ice-100 rounded-xl px-3 py-2 text-xs font-bold text-graphite-900 outline-none focus:border-brand-primary"
                        >
                            <option value="">{t('studio.selectFlow')}</option>
                            {flows.map(f => (
                                <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                        </select>
                        <button
                            onClick={onNewFlow}
                            className="p-2.5 bg-brand-primary/5 text-brand-primary rounded-xl border border-brand-primary/10 hover:bg-brand-primary hover:text-white transition-all"
                        >
                            <Sparkles size={16} />
                        </button>
                    </div>

                    {activeFlow && (
                        <div className="flex items-center justify-between p-3 bg-slate-50 border border-ice-100 rounded-xl">
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">{t('studio.onlineStatus')}</span>
                            <button
                                onClick={async () => {
                                    // Implementation of exclusive activation
                                    try {
                                        const { error: resetError } = await supabase
                                            .from('bot_flows')
                                            .update({ is_active: false })
                                            .eq('tenant_id', activeFlow.tenant_id);

                                        if (resetError) throw resetError;

                                        const { error: activeError } = await supabase
                                            .from('bot_flows')
                                            .update({ is_active: !activeFlow.is_active })
                                            .eq('id', activeFlow.id);

                                        if (activeError) throw activeError;
                                        onSave({ nodes, edges }); // Force sync
                                        showToast('success', activeFlow.is_active ? t('studio.flowDeactivated') : t('studio.flowActivatedExclusive'));
                                    } catch (e) {
                                        console.error(e);
                                    }
                                }}
                                className={clsx(
                                    "px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all",
                                    activeFlow.is_active ? "bg-emerald-500 text-white shadow-lg shadow-emerald-200" : "bg-slate-200 text-slate-500"
                                )}
                            >
                                {activeFlow.is_active ? t('studio.active') : t('studio.inactive')}
                            </button>
                        </div>
                    )}
                </div>

                <div className="p-6 border-b border-ice-200 bg-white/50">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="p-2 bg-brand-primary/10 rounded-xl text-brand-primary">
                            <Bot size={18} />
                        </div>
                        <h3 className="font-black text-xs uppercase tracking-widest text-graphite-900 italic">{t('studio.aiArchitect')}</h3>
                    </div>
                    <div className="relative">
                        <textarea
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                            placeholder={t('studio.aiPromptPlaceholder')}
                            className="w-full h-32 bg-slate-50 border border-ice-200 rounded-2xl p-4 text-sm font-medium focus:ring-4 focus:ring-brand-primary/5 focus:border-brand-primary outline-none resize-none leading-relaxed transition-all"
                        />
                        <button
                            onClick={handleGenerateAI}
                            disabled={isGenerating || !aiPrompt}
                            className="absolute bottom-3 right-3 p-2 bg-brand-primary text-white rounded-xl shadow-lg hover:scale-105 transition-all disabled:opacity-50 disabled:scale-100"
                        >
                            {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                        </button>
                    </div>
                    {isGenerating && (
                        <div className="mt-4 p-3 bg-brand-primary/5 border border-brand-primary/10 rounded-xl animate-pulse">
                            <p className="text-[10px] font-black text-brand-primary uppercase tracking-wider text-center">
                                {t('studio.architectingFlow')}
                            </p>
                        </div>
                    )}
                </div>

                <div className="flex-1 p-6 overflow-y-auto space-y-6">
                    <div>
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">{t('studio.nodeLibrary')}</div>
                        <div className="space-y-2">
                            {[
                                { type: 'message', icon: MessageSquare, label: t('studio.nodeLabelMessage'), color: 'bg-blue-500' },
                                { type: 'ai_orchestrator', icon: Bot, label: t('studio.nodeLabelAi'), color: 'bg-indigo-600' },
                                { type: 'webhook', icon: Globe, label: t('studio.nodeLabelWebhook'), color: 'bg-emerald-600' },
                                { type: 'delay', icon: Clock, label: t('studio.nodeLabelDelay'), color: 'bg-slate-700' },
                            ].map((cfg) => (
                                <div
                                    key={cfg.type}
                                    className="p-3 bg-white border border-ice-100 rounded-xl cursor-grab hover:border-brand-primary transition-all flex items-center gap-3 shadow-sm group select-none"
                                    onDragStart={(e) => e.dataTransfer.setData('application/reactflow', cfg.type)}
                                    draggable
                                >
                                    <div className={clsx("p-1.5 rounded-lg text-white", cfg.color)}>
                                        <cfg.icon size={14} />
                                    </div>
                                    <span className="text-xs font-bold text-slate-700">{cfg.label}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="p-6 border-t border-ice-100 bg-white">
                    <button
                        onClick={() => onSave({ nodes, edges })}
                        className="w-full bg-emerald-500 text-white py-3.5 rounded-2xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 hover:bg-emerald-600 transition-all shadow-xl shadow-emerald-200"
                    >
                        <Save size={16} /> {t('studio.publishV2')}
                    </button>
                </div>
            </aside>

            {/* Canvas Area */}
            <div className="flex-1 relative bg-slate-50" ref={reactFlowWrapper}>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onDragOver={onDragOver}
                    onDrop={onDrop}
                    onInit={setReactFlowInstance}
                    onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                    onPaneClick={() => setSelectedNodeId(null)}
                    nodeTypes={nodeTypes}
                    fitView
                >
                    <Controls className="!bg-white !border-ice-200 !shadow-xl !rounded-lg" />
                    <Background color="#cbd5e1" gap={20} />
                </ReactFlow>
            </div>

            {/* Right Properties Sidebar */}
            {selectedNode && (
                <aside className="w-80 bg-white border-l border-ice-200 flex flex-col z-20 shadow-2xl animate-in slide-in-from-right overflow-y-auto">
                    <div className="p-6 border-b border-ice-200">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="font-black text-xs uppercase tracking-widest text-graphite-900">{t('studio.settings')}</h3>
                            <button
                                onClick={() => setSelectedNodeId(null)}
                                className="p-1 hover:bg-ice-50 rounded text-slate-400"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>

                        <div className="space-y-6">
                            <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">{t('studio.blockTitle')}</label>
                                <input
                                    value={selectedNode.data.label || ''}
                                    onChange={(e) => handleUpdateNode({ label: e.target.value })}
                                    className="w-full bg-slate-50 border border-ice-100 rounded-xl p-3 text-sm font-bold outline-none focus:border-brand-primary"
                                />
                            </div>

                            {selectedNode.type === 'message' && (
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">{t('studio.messageCopy')}</label>
                                    <textarea
                                        value={selectedNode.data.message || ''}
                                        onChange={(e) => handleUpdateNode({ message: e.target.value })}
                                        className="w-full h-32 bg-slate-50 border border-ice-100 rounded-xl p-3 text-sm font-medium outline-none focus:border-brand-primary resize-none italic"
                                    />
                                </div>
                            )}

                            {selectedNode.type === 'ai_orchestrator' && (
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">{t('studio.systemPrompt')}</label>
                                    <textarea
                                        value={selectedNode.data.ai_config?.system_prompt || selectedNode.data.prompt || ''}
                                        onChange={(e) => handleUpdateNode({ ai_config: { ...selectedNode.data.ai_config, system_prompt: e.target.value } })}
                                        className="w-full h-48 bg-indigo-50/30 border border-indigo-100 rounded-xl p-3 text-xs font-medium outline-none focus:border-indigo-500 resize-none italic leading-relaxed"
                                    />
                                </div>
                            )}

                            {selectedNode.type === 'interactive' && (
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">{t('studio.menuText')}</label>
                                        <textarea
                                            value={selectedNode.data.message || ''}
                                            onChange={(e) => handleUpdateNode({ message: e.target.value })}
                                            className="w-full h-24 bg-slate-50 border border-ice-100 rounded-xl p-3 text-sm font-medium outline-none focus:border-brand-primary resize-none italic"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">{t('studio.buttonsOptions')}</label>
                                        <div className="space-y-2">
                                            {(selectedNode.data.options || []).map((opt: any, idx: number) => (
                                                <div key={idx} className="flex gap-2">
                                                    <input
                                                        value={opt.label}
                                                        onChange={(e) => {
                                                            const newOpts = [...selectedNode.data.options];
                                                            newOpts[idx] = { ...newOpts[idx], label: e.target.value };
                                                            handleUpdateNode({ options: newOpts });
                                                        }}
                                                        className="flex-1 bg-slate-50 border border-ice-100 rounded-xl p-2 text-xs font-bold outline-none"
                                                    />
                                                    <button
                                                        onClick={() => {
                                                            const newOpts = selectedNode.data.options.filter((_: any, i: number) => i !== idx);
                                                            handleUpdateNode({ options: newOpts });
                                                        }}
                                                        className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            ))}
                                            <button
                                                onClick={() => {
                                                    const newOpts = [...(selectedNode.data.options || []), { id: `opt_${Date.now()}`, label: t('studio.newOption') }];
                                                    handleUpdateNode({ options: newOpts });
                                                }}
                                                className="w-full py-2 border-2 border-dashed border-ice-100 rounded-xl text-[10px] font-black text-slate-400 uppercase hover:border-brand-primary hover:text-brand-primary transition-all"
                                            >
                                                {t('studio.addButton')}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {selectedNode.type === 'webhook' && (
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">{t('studio.endpointUrl')}</label>
                                    <input
                                        value={selectedNode.data.url || ''}
                                        onChange={(e) => handleUpdateNode({ url: e.target.value })}
                                        className="w-full bg-slate-50 border border-ice-100 rounded-xl p-3 text-xs font-medium outline-none focus:border-emerald-500"
                                    />
                                </div>
                            )}

                            <div className="pt-6 border-t border-ice-100">
                                <button
                                    onClick={onSimulate}
                                    className="w-full bg-brand-primary text-white p-3.5 rounded-2xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 hover:bg-brand-primary/90 transition-all shadow-lg"
                                >
                                    <Play size={16} fill="currentColor" /> {t('studio.simulateActiveNode')}
                                </button>
                            </div>
                        </div>
                    </div>
                </aside>
            )}
        </div>
    );
};
