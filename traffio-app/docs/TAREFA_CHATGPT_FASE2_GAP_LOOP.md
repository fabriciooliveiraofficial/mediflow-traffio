# TAREFA DELEGADA — Fase 2: Knowledge Gap Loop (o agente que aprende com o uso)

> **Para:** ChatGPT 5.6 Sol Ultra
> **De:** Claude (orquestrador técnico — Traffio) — que fará code review, gate de evals e deploy
> **Data:** 2026-07-17
> **Natureza:** implementação de código (Edge + frontend React) + testes + relatório. **Você NÃO faz deploy nem aplica migration** — entrega migration como arquivo; o orquestrador aplica.
> **Pré-requisito:** a Fase 1 (ficha canônica `clinic_info` + UI na página Inteligência) está EM PRODUÇÃO. Esta fase se apoia nela.

---

## 0. QUEM VOCÊ É (persona)

Você é o mesmo **Staff Engineer de IA conversacional aplicada a saúde** da Fase 1 — mas agora vestindo o chapéu de **engenheiro de sistemas que aprendem em produção**. Você sabe que o maior ativo de um agente não é o que ele já sabe, é o **registro sistemático do que ele NÃO soube**. Toda pergunta que o agente não conseguiu responder é ouro: é a lista priorizada, escrita pelos próprios pacientes, do que falta na base de conhecimento. Você constrói o loop que transforma cada lacuna real numa melhoria permanente — sem ruído, sem falso-positivo, sem expor dado sensível.

Seu lema desta fase: **"Um agente que não registra suas próprias lacunas comete o mesmo erro para sempre; um que registra melhora sozinho a cada conversa."**

---

## 1. O PROBLEMA E O OBJETIVO

Na Fase 1, um paciente perguntou "do you charge for the consultation?" e o agente transferiu por não ter o dado. Corrigimos o dado — mas **ninguém teria percebido a lacuna se você não a tivesse relatado manualmente**. Não existe hoje mecanismo que capture "o agente não soube responder isto".

**Objetivo da Fase 2:** toda vez que o agente **não souber responder** (transferir por falta de informação, ou dizer "a equipe vai confirmar"), registrar a **pergunta do paciente** numa fila que o operador vê no painel e transforma em fato canônico com um clique. Fecha o ciclo: pergunta real → lacuna registrada → fato permanente → o agente nunca mais erra aquilo.

**Regra de produto (NOVA — respeite):** tudo relacionado ao agente de IA mora na página **Inteligência** (`src/pages/Intelligence.tsx`), NÃO em Configurações. A Fase 1 foi corrigida para isso; a UI desta fase entra na mesma página, junto da ficha de conhecimento.

### Contexto técnico (leia antes de codar)
- **Onde o agente transfere:** `supabase/functions/_shared/copilot.ts`, função `runAutonomousAgent`. Sinais relevantes já existentes:
  - `transferReason: string | null` — preenchido quando o modelo chama `transfer_to_human` (o texto vem de `(transferCall.input as any)?.reason`). Também há transferência por **resposta vazia/rounds esgotados** (bloco `if (transferReason || !text)`).
  - Transferências que **NÃO são lacuna de conhecimento**: pedido explícito de humano, insistência em preço, **emergência médica**, dúvida clínica (diagnóstico/medicação), cancelamento (`cancelRequested`), e reconciliação de remarcação (`reconciliationNeeded`). Essas NÃO podem virar gap.
  - Padrão "a equipe vai confirmar" já existe como regex: `CONFIRMATION_FOLLOW_UP_PATTERN` no mesmo arquivo — uma resposta que cai nesse padrão indica lacuna MESMO sem transferência.
  - A última mensagem do paciente já é derivada no fluxo: `lastPatientMessage` (`[...history].reverse().find(m => m.role === "user")`).
- **Ficha canônica:** `src/config/clinicFactsSchema.ts` (`CLINIC_FACTS`, categorias). Um gap resolvido vira uma linha `clinic_info` (via `clinicInfoService.upsert`), normalmente categoria `faq`/`general`.
- **Página Inteligência:** `src/pages/Intelligence.tsx` já hospeda o dial de autonomia + `ClinicKnowledgeSettings`. Sua UI entra aqui.
- **RLS por membership:** tabela real `public.members` (`tenant_id`, `user_id`, `role`, `is_active`). **LIÇÃO DA FASE 1 (crítica):** ao escrever policies, verifique os nomes REAIS de policies existentes na tabela alvo — não confie nos nomes que você imagina; uma migration que dropa nomes inexistentes deixa policies antigas vivas. Como você NÃO tem acesso ao banco, escreva a migration defensivamente e SINALIZE no relatório que o orquestrador deve conferir `pg_policies` antes de aplicar.
- **Serviço frontend:** siga o padrão de `clinicInfoService.ts` para um novo `knowledgeGapsService.ts`.
- **Evals/testes:** `_tests/evals/` (`run.ts`, `scenarios.ts`, `unit_test.ts`). Gate precisa de `ANTHROPIC_API_KEY`; sem ela, PARE e reporte (não pule).
- **Design system + i18n:** `docs/DESIGN_SYSTEM.md`; 3 idiomas em `src/locales/{pt-BR,en,es}/*.json`; nunca hardcode; nunca repetir namespace do `useTranslation()` dentro de `t()`.

---

## 2. AS IMPLEMENTAÇÕES

### C1 — Registro determinístico de lacunas

**Objetivo:** capturar a pergunta do paciente quando (e SOMENTE quando) o turno terminou por falta de conhecimento.

**Como:**
1. **Migration (arquivo, NÃO aplicar)** `supabase/migrations/<timestamp>_knowledge_gaps.sql`: tabela `knowledge_gaps`:
   - `id uuid pk default gen_random_uuid()`, `tenant_id uuid not null`, `patient_question text not null`, `normalized_question text not null` (para deduplicar), `status text not null default 'open'` (`open|answered|dismissed`), `occurrences int not null default 1`, `first_detected_at timestamptz default now()`, `last_detected_at timestamptz default now()`, `resolved_clinic_info_key text null`, `sample_language text null`.
   - Índice único parcial em `(tenant_id, normalized_question)` para `status='open'` — permite agregar repetições via upsert (`occurrences = occurrences + 1`, `last_detected_at = now()`).
   - RLS: `enable row level security`. SELECT/UPDATE (marcar answered/dismissed) para membros `owner`/`admin` do tenant (via `public.members`); INSERT pelo agente é via `service_role` (bypassa RLS). **NÃO** exponha a tabela a `public`/anon. Grants a `authenticated` e `service_role` conforme o padrão da migration da Fase 1.
   - **Privacidade:** guarde apenas a PERGUNTA (dúvida factual), nunca dados clínicos/pessoais do paciente. Ver item 3 abaixo.
2. **Função pura `classifyKnowledgeGap`** (em `copilot.ts`, exportada, testável) — recebe `{ transferReason, replyText, lastPatientMessage, flags }` e retorna `{ isGap: boolean; question: string | null }`:
   - **É gap:** transferência por resposta vazia/rounds esgotados sem motivo específico; OU `transferReason` que indique falta de informação; OU `replyText` casando `CONFIRMATION_FOLLOW_UP_PATTERN` ("a equipe vai confirmar", "vou verificar").
   - **NÃO é gap (retornar isGap:false):** `cancelRequested`, `reconciliationNeeded`, emergência, dúvida clínica, pedido explícito de humano, insistência em preço. Use os sinais/flags disponíveis no fluxo; quando o `transferReason` for texto do modelo, classifique por palavras-chave conservadoras (preço/humano/emergência/clínico → não-gap).
   - `question` = a `lastPatientMessage` higienizada (sem mídia embrulhada `[CONTEÚDO DE MÍDIA...]`, sem PII óbvia — ver item 3).
3. **Hook no `runAutonomousAgent`:** após decidir o desfecho do turno, se `classifyKnowledgeGap(...).isGap`, gravar via `service_role` (upsert com dedupe por `normalized_question`). Falha ao gravar NUNCA afeta a resposta ao paciente (isole em try/catch com `console.warn`). Não bloqueie o fluxo.

**Prova:** testes unitários exaustivos de `classifyKnowledgeGap` (≥10 casos): gap por rounds esgotados, gap por "equipe confirma" (pt/en/es), NÃO-gap por preço, NÃO-gap por emergência, NÃO-gap por pedido de humano, NÃO-gap por cancelamento/reconciliação. Teste da normalização/dedupe (duas variações da mesma pergunta → mesma `normalized_question`).

### C2 — UI "Perguntas sem resposta" (na página Inteligência)

**Objetivo:** fechar o loop pergunta-real → fato-permanente, na página Inteligência.

**Como:**
1. Novo `src/services/knowledgeGapsService.ts` (padrão `clinicInfoService`): `listOpen(tenantId)`, `markAnswered(id, clinicInfoKey)`, `dismiss(id)`.
2. Novo componente `src/components/settings/KnowledgeGapsPanel.tsx` montado em `Intelligence.tsx`, abaixo da ficha de conhecimento (mesma seção "cérebro do agente"): lista os gaps `open` ordenados por `occurrences desc, last_detected_at desc`, cada card com a pergunta, contador de ocorrências e data. Ações: **"Responder"** (abre um formulário inline que cria um fato — pode ser um fato canônico da ficha se casar, ou um fato `general`/`faq` livre — e ao salvar via `clinicInfoService.upsert` marca o gap `answered` com `resolved_clinic_info_key`) e **"Dispensar"** (`dismiss`). Contador no cabeçalho: "Perguntas sem resposta (N)". Só `owner`/`admin` (`canEditKnowledge`, já existente na página).
3. Design system + i18n (3 idiomas). Estado vazio acolhedor ("Nenhuma lacuna — seu agente está bem informado").

**Prova:** descreva o fluxo e o layout (ASCII) no relatório; teste unitário de qualquer função pura (ordenação/normalização de exibição).

---

## 3. PRIVACIDADE (requisito, não opcional)
- `knowledge_gaps` guarda **a dúvida factual**, não o paciente. Nunca gravar telefone, nome, nem relato clínico pessoal. Se a última mensagem misturar dúvida + dado pessoal, capture só a intenção factual; na dúvida, higienize agressivamente (função pura testável para stripping de PII óbvia: telefones, e-mails, nomes próprios longos).
- Conteúdo embrulhado como mídia não-confiável (`[CONTEÚDO DE MÍDIA DO PACIENTE...]`) nunca vira pergunta registrada verbatim — extraia só o texto de dúvida, se houver.
- Emergência/dado clínico sensível NUNCA vira gap (o classificador já barra).

## 4. TÉCNICAS E PADRÕES OBRIGATÓRIOS
- **Funções puras primeiro** (`classifyKnowledgeGap`, normalização, dedupe, PII-strip) → testadas em `unit_test.ts`.
- **Falha isolada:** registro de gap nunca derruba nem atrasa a resposta ao paciente.
- **`o LLM propõe, o sistema garante`:** a classificação de gap é determinística, não confia no modelo.
- **Diff mínimo, estilo do arquivo, i18n 3 idiomas, design system. Nenhuma dependência nova.**
- **UI na página Inteligência**, nunca em Configurações.

## 5. PROTOCOLO DE VERIFICAÇÃO
```bash
cd traffio-app/supabase/functions
npx deno check _shared/copilot.ts _tests/evals/run.ts
npx deno test -A _tests/evals/unit_test.ts
# com ANTHROPIC_API_KEY:
npx deno run -A _tests/evals/run.ts     # 100% verde (sem regressão nos 29 cenários)
cd traffio-app && npx tsc --noEmit
```
Eval vermelho = não está pronto. Nunca "ajuste o teste pra passar" sem justificar por escrito. Um cenário de eval novo NÃO é obrigatório (o gap loop é fluxo de escrita), mas a suíte existente NÃO pode regredir — o hook não pode alterar o comportamento visível ao paciente.

## 6. RELATÓRIO FINAL EXIGIDO
Crie `docs/RESULTADO_FASE2_GAP_LOOP.md` com:
1. **O que implementou** — arquivos/funções, decisões e PORQUÊ;
2. **Regras exatas do `classifyKnowledgeGap`** (o que é e o que NÃO é gap, e como decide);
3. **DDL final da migration** + aviso explícito para o orquestrador verificar `pg_policies`/nomes reais antes de aplicar;
4. **Layout da UI** (ASCII) e fluxo responder/dispensar;
5. **Saída dos comandos de verificação** (colada);
6. **Análise crítica honesta (mín. 3 achados)** — fragilidades do classificador, risco de falso-positivo/negativo, PII residual, o que faria diferente;
7. **Estado:** completa / parcial / bloqueada e o que falta.

## 7. FORA DE ESCOPO
Deploy; aplicar migration; iniciar Fases 3–5; agregação semântica de perguntas por embedding (dedupe MVP é por texto normalizado); mudar o comportamento visível do agente ao paciente; refactor amplo; trocar modelo. Em dúvida entre interpretar e perguntar: implemente a leitura mais conservadora (a que menos registra dado / menos automatiza) e registre a dúvida no relatório.
