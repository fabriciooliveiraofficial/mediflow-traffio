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

## ONDA 3 — tom, acessibilidade, contexto (fricção, não dano legal)

- P-15/P-16/P-17 — toxicidade/tom festivo em contexto sensível/blame por no-show (validador de toxicidade + contexto sensível).
- E-10/E-12 — não reperguntar dado válido; retomar após interrupção (reforço do flowStateHint + evals multi-turno).
- P-22/E-23 — não traduzir entidades (nome/dose/endereço/horário); confirmar troca de idioma.
- E-05/E-06 — lembrete com 3 ações; lista de espera com duplo consentimento.
- P-13/P-14/P-06 — não inferir dado sensível; TTL de dado multimodal; não usar clínico p/ marketing.
- E-22/P-24 — acessibilidade (frases curtas sob pedido); não oferecer canal indisponível.

## ONDA 4 — riscos emergentes 2026 (defesa de fronteira)

- Jailbreak multi-turno lento (orçamento de risco cumulativo por conversa).
- Poisoning entre tenants na ingestão de conhecimento (isolamento + sanitização + canário).
- Confused deputy entre agentes/ferramentas (cada ferramenta reautoriza).
- Memória persistente contaminada (só campos tipados com finalidade/TTL entram no contexto).

---

## "O que NÃO automatizar" — adotado como política

Da análise do ChatGPT, adotado integralmente: sempre-humano para emergência (após orientação imediata), qualquer diagnóstico/triagem/medicação/interpretação de exame, evento adverso/abuso/violência, reclamação grave/ameaça jurídica/pedido de prontuário/direito de privacidade, conflito de identidade/guarda, exceção financeira/convênio, promessa de política, e falha repetida de ferramenta. Regra-mãe: **se um erro pode mudar cuidado, expor dado sensível, criar obrigação ou retirar um direito → a IA organiza e encaminha; uma pessoa autorizada decide.**
