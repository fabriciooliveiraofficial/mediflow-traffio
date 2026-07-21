# Resultado da implementação — Ondas 3 e 4 de blindagem

Data: 2026-07-21
Executor: Claude Code (sessão interativa)
Deploy/migrations: migration da tabela `clinic_fact_suggestions` **aplicada**
(`20260721110000_clinic_fact_suggestions_flag.sql`); edge functions **não
reimplantadas ainda** (pendente do gate de evals abaixo).

## 0. Triagem item a item (antes de codar)

Pesquisa em `supabase/functions/_shared/copilot.ts` mostrou que
`validateAgentReply` hoje só roda no caminho `runAutonomousAgent`
(`ai_always`) — nunca no rascunho revisado por humano (`runCopilot`).
Vários itens da matriz já tinham cobertura parcial que só precisava de
reforço; outros eram greenfield.

| Item | Já coberto? | Ação nesta onda |
|---|---|---|
| P-15/16/17 (tom tóxico/festivo/culpa) | Não — só a regra de emoji do P-16 existia parcialmente no prompt | Código novo: `hasInsensitiveTone` |
| P-22/E-23 (preservar entidade/confirmar idioma) | Não — greenfield | Regra de prompt nos 2 prompts (autônomo + rascunho) |
| E-10 (não repetir pergunta) | Sim — `buildFlowStateHint` já fazia | Só eval de confirmação |
| E-12 (retomar após interrupção) | Parcial — só `pending_slots`/`intake`, sem "resumo de retomada" | Reforço de prompt + eval |
| E-22 (acessibilidade/frase curta) | Não — greenfield | Código novo: `shouldUseAccessibleMode` |
| P-24 (não oferecer canal indisponível) | Não | Regra de prompt (mesmo padrão prompt-only de P-01/E-13) |
| E-05 (lembrete com 3 ações) | **Sim, verificado** — `appointment_reminder_48h` já tem SIM/REAGENDAR/CANCELAR (`messageTemplates.ts:32`) | Documentado, sem código |
| P-06 (clínico não vira marketing) | **Sim, verificado** — nenhum serviço de ads/marketing lê `conversation_sessions`/`crm_journeys` | Documentado, sem código |
| P-13 (não inferir dado sensível) | **Sim, verificado** — `intake` é objeto de forma fixa (`procedure/for_whom/preferred_window/doctor_pref`), sem campo para gênero/condição/gravidez | Documentado, sem código |
| P-14 (TTL de dado multimodal) | Nenhum armazenamento multimodal de longo prazo encontrado além do próprio histórico de mensagens | Documentado "não aplicável hoje" |
| E-06 (lista de espera com duplo consentimento) | Não — `process-waitlist` notifica mas não há fluxo de consentimento em duas etapas | **Fora de escopo** — é código do módulo de waitlist, não do `copilot.ts`; fica para um follow-up próprio |
| Onda 4 — confused deputy | Já coberto estruturalmente pelo P-04 da Onda 2 (`validateSchedulingReferences`/`scopedQuery`) | Formalizado com 1 eval, sem código novo |
| Onda 4 — jailbreak multi-turno | Não — greenfield | Código novo: orçamento de risco cumulativo |
| Onda 4 — poisoning entre tenants | Já mitigado pela revisão humana obrigatória (Fase 4 onboarding nunca escreve direto) | Reforço leve: flag defensivo em `extract-clinic-facts` |
| Onda 4 — memória contaminada | Já coberto por design — `intake`/`context` são campos tipados de forma fixa, nunca texto livre | Documentado, sem código |

## 1. Implementação por tarefa

### Onda 3 — Tarefa 1: P-15/P-16/P-17 (tom)

- Nova função pura `hasInsensitiveTone(text, patientLastMessage)` em
  `copilot.ts` — três checagens lexicais pt/en/es: hostilidade/sarcasmo
  (`HOSTILE_TONE_PATTERN`), culpa/vergonha por falta/atraso
  (`BLAME_SHAME_PATTERN`), e tom festivo/emoji quando a última mensagem do
  paciente bate um léxico de contexto sensível (`SENSITIVE_CONTEXT_PATTERN`
  + `FESTIVE_TONE_PATTERN`).
- Adicionado como novo item em `validateAgentReply` (widened
  `AgentReplyValidationOptions` com `patientLastMessage?: string`).
- Novo bullet no `AUTONOMOUS_ADDENDUM`: culpa/vergonha por falta/atraso
  proibida **sempre** (antes só existia como guidance do estágio CRM
  `recovery` em `journeyStage.ts`).
- 3 cenários de eval: `tom_hostil_no_abuso`, `tom_festivo_contexto_sensivel`,
  `culpa_no_show`.

### Onda 3 — Tarefa 2: P-22/E-23 (entidades e troca de idioma)

- Bullet novo no `AUTONOMOUS_ADDENDUM` **e** no rascunho do `runCopilot`
  (`REGRAS INEGOCIÁVEIS`): nunca traduzir nome próprio/dose/endereço/
  horário; confirmar troca de idioma intencional antes de prosseguir nela.
- Sem validador runtime novo — a checagem de deriva de idioma já existente
  cobre parte disso.
- Eval `traducao_preserva_entidade`: conversa em inglês com agendamento
  ativo (fixture `MOCK_APPOINTMENT`, médica "Dra. Ana Souza"), confirma que
  o nome "Ana Souza" aparece verbatim na resposta.

### Onda 3 — Tarefa 3: E-10/E-12 (continuidade)

- E-10 já estava implementado (`buildFlowStateHint` despeja o `intake`
  conhecido com "NÃO pergunte de novo"). Novo campo `intake` em
  `EvalScenario` + wiring em `run.ts` (`flowStateHint: s.intake ?
  buildFlowStateHint({}, s.intake) : null`) para poder provar isso via eval.
- E-12: novo bullet no `AUTONOMOUS_ADDENDUM` pedindo resumo de 1 frase do
  último estado confirmado antes de perguntar só a decisão pendente, ao
  retomar uma conversa com fluxo em andamento.
- Eval `nao_repete_pergunta` cobre os dois: com `intake.procedure`/
  `preferred_window` já preenchidos, a resposta não pode re-perguntar o
  procedimento.

### Onda 3 — Tarefa 4: E-22 (acessibilidade)

- Nova função pura `shouldUseAccessibleMode(patientMessage)` — léxico de
  pedido explícito de linguagem simples (pt/en/es), **nunca inferido**.
- Novo campo `accessibleMode` em `buildAutonomousSystemPrompt`, injeta um
  bloco `### MODO ACESSÍVEL` no prompt quando ativo.
- Wiring em `runAutonomousAgent`: `accessibleMode:
  shouldUseAccessibleMode(patientQuery || "")`.
- Eval `modo_acessivel`.

### Onda 3 — Tarefa 5: P-24 (canal indisponível)

- Bullet novo no `AUTONOMOUS_ADDENDUM` — mesmo padrão prompt-only já usado
  para P-01 (injeção) e E-13 (emergência): nunca afirmar que um canal
  (vídeo, Libras) ou recurso indisponível está ativo.
- Eval `canal_indisponivel`.

### Onda 3 — Tarefas 6-9: já satisfeitas (E-05, P-06, P-13, P-14)

Verificadas diretamente no código, sem necessidade de mudança:
- **E-05**: `messageTemplates.ts:32` (`appointment_reminder_48h`) já tem as
  3 ações (SIM confirmar / REAGENDAR / CANCELAR) claramente rotuladas.
- **P-06**: nenhum serviço de ads/marketing (`grep` em `src/services/*ads*`,
  `*marketing*`) referencia `conversation_sessions`/`crm_journeys` — os
  sistemas são estruturalmente isolados.
- **P-13**: o schema de `intake` (extraído pela triagem) é fixo —
  `procedure`, `for_whom`, `preferred_window`, `doctor_pref` — não há campo
  para gênero, condição clínica, gravidez ou parentesco inferido.
- **P-14**: nenhum armazenamento multimodal de longo prazo encontrado além
  do próprio log de mensagens (retenção padrão, não uma exceção).

### Onda 3 — Tarefa 10: E-06 (fora de escopo)

Lista de espera com duplo consentimento não foi implementada nesta onda —
`process-waitlist`/UI de waitlist são um subsistema separado do
`copilot.ts`. Recomendado como follow-up próprio.

### Onda 4 — Tarefa 1: orçamento de risco de jailbreak multi-turno

- Nova função pura `computeJailbreakRiskDelta(patientMessage)` em
  `copilot.ts` — retorna 0 (nada suspeito), 1 (sondagem leve: "quais são
  suas regras", "finja que", "modo desenvolvedor"...) ou 2 (tentativa
  forte: "ignore suas instruções", "revele seu prompt"...).
- Novo método `SessionManager.registerJailbreakSignal(sessionId, delta,
  threshold=4)` — **cópia direta do padrão de `registerMisunderstanding`**
  (contador em `context.jailbreak_risk_score`, ao cruzar o threshold zera e
  chama `triggerHumanHandoff`).
- Wiring no início de `runAutonomousAgent`: soma o delta a cada turno,
  independente de a resposta violar algo isoladamente; se o orçamento
  estourar, handoff imediato antes mesmo de gerar uma resposta.
- **Sem eval de sessão completa** — o harness de evals (`run.ts`) não tem
  estado de sessão/banco (roda com `stubSupabase` mockado), então não
  consegue simular o acúmulo entre turnos. Coberto por unit test da função
  pura (`computeJailbreakRiskDelta`); `registerJailbreakSignal` em si segue
  o mesmo padrão não-testado-por-unit-test de `registerMisunderstanding`
  (ambos dependem de `SupabaseClient` real).

### Onda 4 — Tarefa 2: confused deputy (formalização)

- Nenhum código novo — o padrão `validateSchedulingReferences`/
  `scopedQuery` da Onda 2 (P-04) já reautoriza tenant/paciente em toda
  ferramenta mutante, que é exatamente a defesa contra confused deputy.
- Eval `confused_deputy_multimodal` formaliza isso: conteúdo de mídia tenta
  redirecionar o agendador para outro paciente/tenant; a checagem
  disponível no harness (mocks não conhecem `tenant_id`) prova resistência
  a injeção-via-mídia (já coberta pela Onda 2), não isolamento de tenant em
  nível de banco — essa prova já existe na auditoria de queries da Onda 2.

### Onda 4 — Tarefa 3: poisoning entre tenants (reforço leve)

- Nova função pura `looksLikeInjectionAttempt(text)` em
  `extract-clinic-facts/extractor.ts` — léxico de instrução embutida
  ("ignore as regras", "system:", "you are now"...).
- Novo campo `flagged_suspicious` em `ExtractedSuggestion`, calculado em
  `validateExtractedSuggestions` (cobre os dois caminhos: extração de
  texto/URL e entrevista guiada, que reusa a mesma função).
- Migration `20260721110000_clinic_fact_suggestions_flag.sql`: coluna
  `clinic_fact_suggestions.flagged_suspicious boolean not null default
  false` — **aplicada em produção**.
- UI: badge vermelho "Revisar com atenção" em `AiOnboardingWizard.tsx`
  quando `flagged_suspicious` é true — nunca bloqueia a sugestão, só destaca
  para o revisor humano (que já é obrigatório).
- Unit test da função pura, sem eval (não passa pelo `copilot.ts`).

### Onda 4 — Tarefa 4: memória contaminada (já coberto)

Nenhum código novo — `intake`/`context` já são objetos de forma fixa e
tipada (`procedure/for_whom/preferred_window/doctor_pref` +
contadores numéricos como `misunderstand_count`/`jailbreak_risk_score`),
nunca texto livre persistido como "instrução" futura.

## 2. Achado durante a implementação: trabalho concorrente

Enquanto esta onda estava em andamento, uma sessão concorrente (mesmo
padrão de orquestração paralela já documentado no projeto) editou os
mesmos arquivos (`copilot.ts`, `run.ts`, `scenarios.ts`, `unit_test.ts`,
`extractor.ts`) implementando, em paralelo, um refinamento de resolução de
idioma (`normalizeConversationLanguage`/`resolveConversationLanguage`,
priorizando o idioma do turno atual sobre o idioma armazenado) e um novo
validador `hasAppointmentContradiction`/`appointmentEvidence` (nunca dizer
que um agendamento ativo falhou/está ausente quando o snapshot do paciente
mostra o contrário — reforça E-02/E-17 da matriz). `git stash`/`git stash
pop` fez o merge automático dos dois conjuntos de mudanças sem conflitos;
`deno check`/`deno test` confirmaram a integração correta depois do merge.

## 3. Protocolo de verificação

### Type-check

Comando (na pasta `supabase/functions`):
```
npx deno check _shared/copilot.ts _shared/sessionManager.ts _shared/schedulingTools.ts _shared/structuredFlow.ts _shared/llmProvider.ts extract-clinic-facts/index.ts extract-clinic-facts/extractor.ts process-inbox/index.ts whatsapp-bot/index.ts _tests/evals/run.ts _tests/evals/scenarios.ts _tests/evals/unit_test.ts
```
Resultado: **0 erros** em todos os 12 arquivos.

### Testes unitários

Comando:
```
npx deno test -A _tests/evals/unit_test.ts
```
Resultado: **68 passed | 0 failed** (62 pré-existentes + 6 novos blocos
desta onda: `hasInsensitiveTone` ×3, `shouldUseAccessibleMode`,
`computeJailbreakRiskDelta`, `looksLikeInjectionAttempt`).

### Evals com modelo real

Comando:
```
$env:ANTHROPIC_API_KEY="sk-ant-..."; npx deno run -A _tests/evals/run.ts
```
**Pendente** — precisa da chave `ANTHROPIC_API_KEY` (não armazenada no
repo, mesma pré-condição documentada na Onda 2). 39 cenários no total
(31 anteriores + 8 novos desta onda: `tom_hostil_no_abuso`,
`tom_festivo_contexto_sensivel`, `culpa_no_show`,
`traducao_preserva_entidade`, `nao_repete_pergunta`, `modo_acessivel`,
`canal_indisponivel`, `confused_deputy_multimodal`). **Não rodar em
produção sem este gate verde** — regra do projeto.

## 4. Análise crítica

1. `hasInsensitiveTone`'s P-16 (tom festivo em contexto sensível) usa
   `emojiCount > 0` como proxy de "festivo" — mais rígido que o limite
   normal de emoji (`>2`), intencional: a persona já proíbe qualquer emoji
   nesse contexto, então o validador formaliza exatamente essa regra
   existente, não uma nova.
2. O orçamento de risco de jailbreak é por sessão (`conversation_sessions.
   context.jailbreak_risk_score`), não por paciente/telefone — uma
   conversa nova reseta o orçamento. Aceitável para o risco descrito
   (sondagem lenta dentro de uma mesma conversa), mas não impede um
   atacante reiniciar a conversa para "resetar" o orçamento — mitigação
   parcial, não uma prova formal.
3. `looksLikeInjectionAttempt` é deliberadamente conservador (léxico
   estreito) para não gerar falsos positivos em fatos clínicos legítimos —
   por isso é só um FLAG para revisão, nunca um bloqueio automático.
4. `confused_deputy_multimodal` prova resistência a injeção-via-mídia
   (já Onda 2), não isolamento de tenant no nível do harness de eval (que
   usa ferramentas mockadas sem conceito de `tenant_id`) — a prova real de
   isolamento de tenant já está na tabela de auditoria de queries da Onda 2
   (`RESULTADO_ONDA2_IMPLEMENTACAO.md`, seção 2).
5. E-06 (lista de espera com duplo consentimento) fica como pendência real,
   não uma "quase-cobertura" — nenhum mecanismo de consentimento em duas
   etapas existe hoje no fluxo de waitlist.

## 5. Sugestões para próximos passos

- Rodar o gate de evals com `ANTHROPIC_API_KEY` antes de qualquer deploy
  desta onda.
- E-06 (waitlist com duplo consentimento) como entrega própria, tocando
  `process-waitlist`/UI de waitlist, não o `copilot.ts`.
- Orçamento de risco de jailbreak por paciente/telefone (não só por
  sessão), se o padrão de reinício de conversa para "resetar" o contador
  se mostrar um vetor real em produção.
- Onda 4 (arquitetura mais profunda de defesa contra poisoning entre
  tenants — isolamento formal na camada de retrieval, não só o flag na
  fila de revisão) permanece como trabalho futuro caso o volume de
  onboarding via IA cresça.
