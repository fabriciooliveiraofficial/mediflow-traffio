import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Bot, User, X, RotateCcw, Play } from 'lucide-react';
import { FlowOrchestrator } from '../services/flowOrchestrator';

interface FlowSimulatorProps {
    isOpen: boolean;
    onClose: () => void;
    flowDefinition: any;
    tenantId?: string;
}

interface Message {
    id: string;
    role: 'bot' | 'user' | 'system';
    content: any; // string or distinct object
    type?: 'text' | 'interactive';
}

export const FlowSimulator = ({ isOpen, onClose, flowDefinition, tenantId }: FlowSimulatorProps) => {
    const { t } = useTranslation('flowBuilder');
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const orchestratorRef = useRef<FlowOrchestrator | null>(null);

    // Initialize Orchestrator
    useEffect(() => {
        if (isOpen && flowDefinition) {
            startSimulation();
        }
    }, [isOpen, flowDefinition]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isTyping]);

    const startSimulation = async () => {
        setMessages([{
            id: 'init',
            role: 'system',
            content: t('simulator.simulationStarted'),
            type: 'text'
        }]);

        orchestratorRef.current = new FlowOrchestrator();

        // Output Handler
        orchestratorRef.current.setSimulatorMode(async (type, content) => {
            setIsTyping(true);
            await new Promise(r => setTimeout(r, 600)); // Fake network delay for realism

            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'bot',
                content: content,
                type: type as 'text' | 'interactive'
            }]);
            setIsTyping(false);
        });

        // Trigger Start
        // We simulate an empty "start" message to kick off the flow
        // Or we assume the orchestrator handles the entry automatically if we call handleMessage with empty text?
        // FlowOrchestrator expects a text message to trigger logic.
        // But for FIRST node, we might need to trigger it manually?
        // My updated FlowOrchestrator handles "Start" logic if current_node_id is set to start.
        // Let's send a "hello" or empty trigger.

        if (tenantId) {
            await orchestratorRef.current.handleMessage(tenantId, 'SIMULATOR_USER', '', flowDefinition);
        }
    };

    const handleSendMessage = async (text: string) => {
        if (!text.trim()) return;

        const newUserMsg: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: text,
            type: 'text'
        };

        setMessages(prev => [...prev, newUserMsg]);
        setInputValue('');

        if (orchestratorRef.current && tenantId) {
            setIsTyping(true);
            // We pass the flowDefinition again to ensure it uses the latest (though it should be using simulation state)
            await orchestratorRef.current.handleMessage(tenantId, 'SIMULATOR_USER', text, flowDefinition);
            // isTyping is handled by the callback
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-y-0 right-0 w-[400px] bg-white shadow-2xl border-l border-ice-200 z-50 flex flex-col transform transition-transform duration-300 ease-in-out">
            {/* Header */}
            <div className="h-16 border-b border-ice-200 px-4 flex justify-between items-center bg-slate-50">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-brand-primary/10 rounded-lg text-brand-primary">
                        <Bot size={20} />
                    </div>
                    <div>
                        <h3 className="font-black text-slate-800 text-sm">{t('simulator.title')}</h3>
                        <p className="text-[10px] text-slate-500 font-medium">{t('simulator.safeTestEnvironment')}</p>
                    </div>
                </div>
                <div className="flex gap-1">
                    <button
                        onClick={startSimulation}
                        className="p-2 hover:bg-slate-200 rounded-lg text-slate-500 transition-colors"
                        title={t('simulator.restart')}
                    >
                        <RotateCcw size={18} />
                    </button>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-rose-100 hover:text-rose-500 rounded-lg text-slate-400 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 bg-ice-50 overflow-y-auto p-4 space-y-4">
                {messages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-2xl p-3.5 shadow-sm text-sm leading-relaxed ${msg.role === 'user'
                                ? 'bg-brand-primary text-white rounded-tr-none'
                                : msg.role === 'system'
                                    ? 'bg-amber-100 text-amber-800 border border-amber-200 w-full text-center text-xs font-bold'
                                    : 'bg-white text-slate-700 border border-ice-100 rounded-tl-none'
                            }`}>
                            {msg.type === 'text' && typeof msg.content === 'string' && (
                                <p className="whitespace-pre-wrap">{msg.content}</p>
                            )}

                            {msg.type === 'interactive' && (
                                <div className="space-y-3">
                                    <p className="font-bold text-slate-900 border-b border-ice-100 pb-2 mb-2">
                                        {msg.content.title}
                                    </p>
                                    <p className="text-slate-600 mb-2">{msg.content.text}</p>
                                    <div className="space-y-2">
                                        {msg.content.options.map((opt: any) => (
                                            <button
                                                key={opt.id}
                                                onClick={() => handleSendMessage(opt.label)}
                                                className="w-full p-2.5 bg-brand-primary/5 hover:bg-brand-primary/10 text-brand-primary font-bold text-xs rounded-xl transition-colors border border-brand-primary/20 flex items-center justify-center gap-2"
                                            >
                                                <Play size={10} fill="currentColor" /> {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                {isTyping && (
                    <div className="flex justify-start">
                        <div className="bg-white px-4 py-3 rounded-2xl rounded-tl-none border border-ice-100 shadow-sm flex gap-1">
                            <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></span>
                            <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                            <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-white border-t border-ice-200">
                <div className="flex gap-2">
                    <input
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(inputValue)}
                        placeholder={t('simulator.typeYourMessage')}
                        className="flex-1 bg-slate-50 border border-ice-200 rounded-xl px-4 text-sm focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all font-medium text-slate-700"
                        autoFocus
                    />
                    <button
                        onClick={() => handleSendMessage(inputValue)}
                        className="p-3 bg-brand-primary text-white rounded-xl hover:bg-brand-primary-dark transition-colors shadow-lg shadow-brand-primary/20"
                    >
                        <Send size={18} />
                    </button>
                </div>
            </div>
        </div>
    );
};
