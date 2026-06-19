import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, X, Loader2 } from 'lucide-react';

interface AIExplainButtonProps {
    term: string;
}

/**
 * Calls Groq API (free tier) to translate a medical term into layman's Portuguese.
 * Falls back gracefully if the API is unavailable.
 */
export const AIExplainButton: React.FC<AIExplainButtonProps> = ({ term }) => {
    const { t } = useTranslation('medical');
    const [isOpen, setIsOpen] = useState(false);
    const [explanation, setExplanation] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleExplain = async () => {
        setIsOpen(true);

        if (explanation) return; // already fetched

        setLoading(true);
        try {
            const groqApiKey = import.meta.env.VITE_GROQ_API_KEY;

            if (!groqApiKey) {
                // Fallback: provide a generic explanation
                setExplanation(t('aiExplainButton.fallbackExplanation', { term }));
                return;
            }

            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${groqApiKey}`,
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        {
                            role: 'system',
                            content: t('aiExplainButton.systemPrompt')
                        },
                        {
                            role: 'user',
                            content: t('aiExplainButton.userPromptPrefix', { term })
                        }
                    ],
                    max_tokens: 150,
                    temperature: 0.3,
                }),
            });

            const data = await response.json();
            setExplanation(data.choices?.[0]?.message?.content || t('aiExplainButton.noExplanationGenerated'));
        } catch {
            setExplanation(t('aiExplainButton.errorFallback', { term }));
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <button
                onClick={handleExplain}
                className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-black bg-gradient-to-r from-brand-primary/10 to-brand-secondary/20 text-brand-primary rounded-lg uppercase hover:from-brand-primary hover:to-brand-primary hover:text-white transition-all border-none cursor-pointer"
            >
                <Sparkles size={10} />
                {t('aiExplainButton.trigger')}
            </button>

            {/* Explanation Modal */}
            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-graphite-900/40 backdrop-blur-sm p-4"
                    onClick={() => setIsOpen(false)}>
                    <div
                        className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-xl bg-brand-primary/10 flex items-center justify-center">
                                    <Sparkles size={16} className="text-brand-primary" />
                                </div>
                                <h3 className="font-black text-sm text-graphite-900">{t('aiExplainButton.modalTitle')}</h3>
                            </div>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="w-8 h-8 rounded-xl bg-ice-100 flex items-center justify-center text-graphite-400 hover:text-graphite-900 transition-colors border-none cursor-pointer"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="bg-ice-50 rounded-2xl p-4 mb-3">
                            <p className="text-[10px] font-black text-graphite-400 uppercase tracking-wider mb-1">{t('aiExplainButton.termLabel')}</p>
                            <p className="text-sm font-bold text-graphite-900">{term}</p>
                        </div>

                        {loading ? (
                            <div className="flex items-center justify-center gap-2 py-4 text-graphite-400">
                                <Loader2 size={16} className="animate-spin" />
                                <span className="text-xs font-medium">{t('aiExplainButton.consultingAi')}</span>
                            </div>
                        ) : (
                            <div className="py-2">
                                <p className="text-[10px] font-black text-graphite-400 uppercase tracking-wider mb-2">{t('aiExplainButton.explanationLabel')}</p>
                                <p className="text-sm text-graphite-700 font-medium leading-relaxed">
                                    {explanation}
                                </p>
                            </div>
                        )}

                        <p className="text-[9px] text-graphite-300 text-center mt-4 font-medium">
                            {t('aiExplainButton.footerNote')}
                        </p>
                    </div>
                </div>
            )}
        </>
    );
};
