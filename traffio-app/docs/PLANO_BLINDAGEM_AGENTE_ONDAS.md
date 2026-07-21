# Plano de blindagem do agente — triagem da matriz ChatGPT e execução por ondas

Fonte: `RESULTADO_COMPORTAMENTOS_AGENTE_IA.md` (matriz de 48 comportamentos + análise).
Triagem feita em 2026-07-17 contra a arquitetura em camadas ("o LLM propõe, o sistema garante").

## Legenda de status
- ✅ **Feito** — implementado, com eval/teste, em produção.
- 🟡 **Parcial** — coberto por uma camada, falta reforço.
- ⬜ **Aberto** — sem cobertura, priorizado abaixo.

---

## ONDA 1 — feita nesta sessão (2026-07-17)

| Item matriz | O que foi feito | Camada | Prova |
|---|---|---|---|
| P-01 prompt injection | Regra "SUAS REGRAS NÃO SÃO NEGOCIÁVEIS" no addendum; desconto→handoff | prompt | eval `prompt_injection` |
| P-05 vazamento interno | Validador runtime: slot_id/UUID/nome de ferramenta/prompt/stack trace no texto reprova | validador-runtime | unit + eval |
| P-07 promessa clínica | Validador runtime: léxico de garantia (pt/en/es) reprova | validador-runtime | unit + eval `promessa_clinica` |
| P-10 idempotência | `agendar`: slot_taken cujo dono é o próprio paciente → `already_booked` (não oferece novo horário) | design-ferramenta | — |
| P-20/E-11 loop | `isNearDuplicateReply` (Jaccard≥0.85) força mudança de abordagem | validador-runtime | unit |
| E-13 emergência | Regra de emergência médica: interrompe tudo, orienta PS, transfere | prompt+humano | eval `emergencia_medica` |
| P-03/P-12 privacidade terceiros | Regra: nunca revelar dados de quem não está vinculado ao número | prompt | eval `engenharia_social` |

Também já feito em sessões anteriores desta frente: I-1..I-10, patient snapshot (fonte da verdade), fechamento por texto (slot_id), agendamento para terceiros, relógio local + buffer, i18n dos botões, validadores de preço/horário/idioma/emoji.

---

## ONDA 2 — próxima (autorização e semântica transacional; maior dano residual)

Estes são os buracos que a própria análise do ChatGPT apontou como **não cobertos por nenhuma camada** — e concordo, é o maior risco restante.

1. **P-04 — isolamento por tenant nas ferramentas (RLS defensivo).** Hoje o `tenant_id` vem do resolver do webhook (confiável), mas as ferramentas não reautorizam. Ação: garantir que todo `.from()`/RPC das ferramentas filtra por `tenant_id` derivado do canal, nunca do texto; auditar `executeSchedulingTool`. *Camada: design-ferramenta. Custo: médio.*
2. **P-09 — confirmação explícita antes de mutação.** "Talvez sexta" não pode virar remarcação. Ação: exigir intenção afirmativa (não só menção de dia) antes de `agendar`/`remarcar`/`encaminhar_cancelamento`; reforço no prompt + guard no executor. *Camada: design-ferramenta + prompt.*
3. **P-11 — remarcação atômica.** Já garante o novo antes de cancelar o antigo (bom), mas falha de cancelamento é só `console.warn`. Ação: se cancelar o antigo falhar, marcar para reconciliação/handoff, não seguir silencioso. *Camada: design-ferramenta.*
4. **P-08/E-20 — políticas versionadas.** Cancelamento/preparo/convênio hoje vêm do knowledge packet sem versão. Ação: `policy_id/version` no contexto; afirmação de política sem fonte → validador bloqueia. *Camada: injecao-estado + validador.*
5. **P-02/E-08 — provenance multimodal.** Áudio/imagem/encaminhado marcados como `untrusted`; nunca viram instrução. Crítico ANTES de ligar canais Meta e áudio. *Camada: design-ferramenta. Bloqueia recurso novo.*

## ONDA 3 — tom, acessibilidade, contexto (fricção, não dano legal) ✅ (2026-07-21)

Implementação completa em `docs/RESULTADO_ONDA3_IMPLEMENTACAO.md` (triagem
item a item, código, evals, testes). Resumo:

- ✅ P-15/P-16/P-17 — `hasInsensitiveTone()` (validador léxico pt/en/es) +
  bullet reforçado no `AUTONOMOUS_ADDENDUM`.
- ✅ E-10 (já estava coberto por `buildFlowStateHint`, só formalizado com
  eval) / E-12 (reforço de prompt: resumir estado antes de retomar).
- ✅ P-22/E-23 — regra de prompt nos 2 prompts (autônomo + rascunho):
  nunca traduzir entidades; confirmar troca de idioma.
- ✅ E-05 — já satisfeito, verificado em `messageTemplates.ts` (3 ações no
  lembrete de 48h).
- 🟡 **E-06 — fora de escopo desta onda**: lista de espera com duplo
  consentimento é código do módulo de waitlist, não do `copilot.ts`;
  recomendado como follow-up próprio.
- ✅ P-13/P-14/P-06 — verificados já satisfeitos por design, sem código
  necessário.
- ✅ E-22 — `shouldUseAccessibleMode()` (só ativa com pedido explícito).
- ✅ P-24 — regra de prompt (mesmo padrão prompt-only de P-01/E-13).

## ONDA 4 — riscos emergentes 2026 (defesa de fronteira) ✅ (2026-07-21)

Implementação completa em `docs/RESULTADO_ONDA3_IMPLEMENTACAO.md`. Resumo:

- ✅ Jailbreak multi-turno lento — `computeJailbreakRiskDelta()` +
  `SessionManager.registerJailbreakSignal()` (orçamento cumulativo por
  sessão, mesmo padrão de `registerMisunderstanding`). Limitação conhecida:
  o orçamento é por sessão, reinicia numa conversa nova.
- ✅ Confused deputy entre agentes/ferramentas — **já coberto
  estruturalmente pela Onda 2** (P-04: `validateSchedulingReferences`/
  `scopedQuery`); esta onda só formalizou com 1 eval, sem código novo.
- 🟡 Poisoning entre tenants — **reforço leve**, não a arquitetura
  completa: `looksLikeInjectionAttempt()` marca (nunca bloqueia) sugestões
  suspeitas na fila de revisão humana já obrigatória do onboarding por IA.
  Isolamento formal na camada de retrieval fica como trabalho futuro.
- ✅ Memória persistente contaminada — **já coberto por design**, sem
  código necessário: `intake`/`context` são campos tipados de forma fixa,
  nunca texto livre.

---

## "O que NÃO automatizar" — adotado como política

Da análise do ChatGPT, adotado integralmente: sempre-humano para emergência (após orientação imediata), qualquer diagnóstico/triagem/medicação/interpretação de exame, evento adverso/abuso/violência, reclamação grave/ameaça jurídica/pedido de prontuário/direito de privacidade, conflito de identidade/guarda, exceção financeira/convênio, promessa de política, e falha repetida de ferramenta. Regra-mãe: **se um erro pode mudar cuidado, expor dado sensível, criar obrigação ou retirar um direito → a IA organiza e encaminha; uma pessoa autorizada decide.**
