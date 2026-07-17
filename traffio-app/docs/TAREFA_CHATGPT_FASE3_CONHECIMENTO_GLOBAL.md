# TAREFA DELEGADA — Fase 3: Base de Domínio Global Odontológica

> **Para:** ChatGPT 5.6 Sol Ultra
> **De:** Claude (orquestrador técnico — Traffio) — que fará code review, gate de evals e deploy
> **Data:** 2026-07-17
> **Natureza:** implementação de código (Edge + frontend React) + seed de conteúdo + testes + relatório. **Você NÃO faz deploy nem aplica migration** — entrega migration+seed como arquivo; o orquestrador aplica.
> **Pré-requisito:** Fases 1 (ficha canônica) e 2 (gap loop) estão EM PRODUÇÃO.

---

## 0. QUEM VOCÊ É (persona)

Você é o mesmo **Staff Engineer de IA conversacional aplicada a saúde**, agora atuando também como **curador de conhecimento de domínio clínico**. Você entende uma distinção que separa produtos amadores de profissionais: **há conhecimento que é do TENANT (o dono cadastra: "cobro pela consulta?", "meu endereço") e há conhecimento que é do DOMÍNIO (universal: "como funciona um implante?", "o que é clareamento?")**. Fazer cada clínica redigir o segundo do zero é desperdício e fonte de erro. Você constrói a base global — curada uma vez pela Traffio, trilíngue, herdada por todos — com a disciplina clínica de nunca prometer resultado e sempre devolver diagnóstico ao profissional.

Seu lema desta fase: **"O tenant conhece a própria clínica; a plataforma conhece a odontologia. O agente deve falar as duas com uma voz só — e nenhuma delas promete o que só o dentista pode."**

---

## 1. O PROBLEMA E O OBJETIVO

Uma clínica nova entra na plataforma com a base VAZIA. Hoje, até preencher a ficha (Fase 1), o agente não sabe nem explicar o que é um implante — mesmo isso sendo conhecimento universal, não segredo da clínica. Resultado: primeira impressão fraca, transferências desnecessárias.

**Objetivo da Fase 3:** uma **base de conhecimento odontológico global**, curada pela Traffio em pt/en/es, que TODOS os tenants herdam automaticamente. Quando um paciente pergunta "como funciona o implante?", o agente responde de forma rica e correta **mesmo que a clínica não tenha cadastrado nada** — sempre informativo, nunca prometendo resultado, sempre devolvendo diagnóstico/plano/preço ao profissional. O tenant pode personalizar/sobrepor localmente; na ausência de fato local, o global preenche.

### Contexto técnico (leia antes de codar)
- **Montagem do contexto do agente:** `supabase/functions/_shared/copilot.ts`, função `buildKnowledgePacket(supabase, tenantId)`. Hoje lê `appointment_types` + `clinic_info` + `knowledge_base`, cada item com marcador de fonte `[fonte:...]`. Você vai adicionar o MERGE do conhecimento global.
- **Idioma da conversa:** o agente já detecta/armazena idioma (`context.language`, `storedLanguage` no `runAutonomousAgent`; valores `pt|en|es`). O conteúdo global deve entrar **no idioma da conversa**, não nos três (evitar inflar o pacote). Isso exige threading do idioma até `buildKnowledgePacket` — mudança pequena e localizada; faça-a com cuidado (todos os call sites).
- **Guardrail clínico já existente:** `CLINICAL_PROMISE_PATTERN` (P-07) em `validateAgentReply` barra promessa de resultado ("garantimos", "100% sem dor", "cura"). O conteúdo global JAMAIS pode conter promessa — ele é informativo e devolve decisão clínica ao dentista. Escreva o seed já em conformidade.
- **Marcador de fonte:** o global usa `[fonte:global#<topic_key>]` (distinto de `[fonte:clinic_info#...]` e `[fonte:kb#...]`). Mantém rastreabilidade da Onda 2.
- **Super-admin:** área `/master/*` via `src/pages/master/MasterApp.tsx` (páginas irmãs: `MasterIntelligence`, `MasterTenants`, `MasterBilling`). A UI de curadoria do global é do super-admin, NÃO do tenant.
- **RLS:** `public.members` (tenant) para tabelas de tenant; para `global_knowledge` a leitura é de qualquer `authenticated`/`service_role` e a escrita é SÓ super_admin (padrão da policy de `master_config`: `profiles.role='super_admin'`). **LIÇÃO DAS FASES ANTERIORES:** verifique nomes reais de policy; como a tabela é nova, não há órfãs — mas documente isso no relatório para o orquestrador conferir `pg_policies`.
- **Evals/testes:** `_tests/evals/`. Gate precisa de `ANTHROPIC_API_KEY`; sem ela, PARE e reporte.
- **Design system + i18n:** `docs/DESIGN_SYSTEM.md`; 3 idiomas; nunca hardcode; nunca repetir namespace do `useTranslation()` dentro de `t()`.

---

## 2. AS IMPLEMENTAÇÕES

### B1 — Tabela e merge no pacote de conhecimento

**Objetivo:** conhecimento global herdado por todos, com precedência do tenant.

**Como:**
1. **Migration (arquivo, NÃO aplicar)** `<timestamp>_global_knowledge.sql`: tabela `global_knowledge`:
   - `id uuid pk default gen_random_uuid()`, `topic_key text not null` (slug estável, ex.: `implant_overview`), `language text not null check (language in ('pt-BR','en','es'))`, `category text not null`, `title text not null`, `content text not null`, `is_active boolean not null default true`, `guardrails jsonb not null default '{}'::jsonb`, `created_at`/`updated_at timestamptz default now()`.
   - **SEM `tenant_id`** — é global.
   - Índice único `(topic_key, language)`; índice em `(language, is_active)` para leitura.
   - Constraint de tamanho em `content` (ex.: ≤ 2000 chars) — conteúdo enxuto por tópico.
   - RLS: `enable row level security`. SELECT para `authenticated` (todos os tenants herdam) — leitura não vaza nada sensível (é conteúdo público de domínio). Escrita (INSERT/UPDATE/DELETE) SÓ super_admin (`(select profiles.role from profiles where profiles.id = auth.uid()) = 'super_admin'`). Grants a `authenticated` (select) e `service_role` (all).
2. **`buildKnowledgePacket`**: adicione um SELECT de `global_knowledge` (`is_active=true` no idioma da conversa) e faça o MERGE:
   - Ordem no pacote: serviços do tenant → fatos do tenant (`clinic_info`) → **conhecimento global** → base do tenant (`knowledge_base`).
   - **Precedência do tenant:** o global é BACKGROUND informativo. Marque cada bloco global com `[fonte:global#<topic_key>]` e um rótulo claro tipo "CONHECIMENTO GERAL DE ODONTOLOGIA (informativo; o específico da clínica acima prevalece)". Onde um `topic_key` global mapear diretamente a um fato canônico que o tenant preencheu, **omita o global** (tenant vence, sem duplicidade/contradição).
   - Limite defensivo: no máximo N tópicos globais relevantes no pacote (ex.: 12) para não inflar. MVP: incluir os ativos do idioma; se crescer muito, priorização fica para a Fase 5 (RAG).
3. **Threading de idioma:** `buildKnowledgePacket(supabase, tenantId, language)` — atualize a assinatura e TODOS os call sites (`runCopilot`, `runAutonomousAgent`). Default `'pt-BR'` quando não houver idioma.

**Prova:** teste unitário puro da função de merge/precedência (tenant vence global no mesmo topic; marcador de fonte correto; idioma filtrado). Cenário de eval `conhecimento_global`: SEM nenhum fato do tenant, paciente pergunta "how does a dental implant work?" → responde informativo (`textIncludesAny` de termos como "implant", "titanium", "root", "replace"), **sem promessa** (`textExcludesAll`: "guarantee", "painless", "100%", "cure"), **sem preço** (`noPrice:true`), sem transferir. Para injetar o global no runner, siga o padrão de `buildScenarioKnowledgePacket`/`consultationFee` já existente em `run.ts`.

### B2 — Seed do conteúdo global + UI super-admin

**Objetivo:** popular a base e permitir curadoria.

**Como:**
1. **Seed (arquivo de migration OU script de dados separado, NÃO aplicar)** com no mínimo **15 tópicos** essenciais, cada um em pt-BR/en/es (= 45 linhas), texto informativo, calibrado, SEM promessa, sempre devolvendo diagnóstico/indicação ao dentista. Tópicos mínimos: `implant_overview`, `teeth_whitening`, `root_canal`, `clear_aligners`, `dental_cleaning_prophylaxis`, `veneers`, `tooth_extraction`, `post_op_general`, `first_consultation_general`, `dental_anxiety_general`, `gum_disease_periodontitis`, `crowns_bridges`, `cavities_fillings`, `pediatric_dentistry_general`, `emergency_guidance_general` (este último SEM diagnosticar: orienta procurar atendimento, coerente com a regra de emergência do agente).
   - Cada conteúdo: 2–4 frases, linguagem de paciente, foco em "o que é / como costuma funcionar / por que a avaliação define o plano". NUNCA "vai ficar perfeito", "sem dor", "cura garantida".
2. **UI super-admin** — nova página `src/pages/master/MasterKnowledge.tsx` (rota `knowledge` em `MasterApp.tsx`, ao lado de `intelligence`) OU seção em `MasterIntelligence`. CRUD do `global_knowledge`: lista por tópico com os 3 idiomas, editor de título/conteúdo, toggle ativo, aviso visível "conteúdo informativo — nunca prometa resultado". Design system (master usa paleta própria slate/indigo — siga o padrão de `MasterIntelligence.tsx`) + i18n.
3. **Serviço** `src/services/globalKnowledgeService.ts` (padrão dos services existentes).

**Prova:** liste no relatório os 15 tópicos semeados (com uma amostra de conteúdo pt/en/es de 1 tópico); descreva a UI.

---

## 3. GUARDRAILS CLÍNICOS (requisito inegociável)
- Nenhum conteúdo global promete resultado, ausência de dor, prazo garantido ou adequação de tratamento — sempre devolve ao dentista. Escreva o seed já em conformidade com `CLINICAL_PROMISE_PATTERN`.
- Emergência: o tópico de emergência ORIENTA procurar atendimento imediato; NUNCA diagnostica nem minimiza.
- O global nunca contém preço (coerente com a política absoluta).
- O global é informativo e genérico; o específico da clínica (fatos do tenant) sempre prevalece.

## 4. TÉCNICAS E PADRÕES OBRIGATÓRIOS
- **Funções puras primeiro** (merge/precedência, filtro de idioma) → testadas em `unit_test.ts`.
- **Threading de idioma cuidadoso** — atualize todos os call sites de `buildKnowledgePacket`; default seguro.
- **`o LLM propõe, o sistema garante`** — o global entra rotulado e sujeito aos validadores existentes.
- **Diff mínimo, estilo do arquivo, i18n 3 idiomas, design system. Nenhuma dependência nova.**
- **Curadoria do global é super-admin**, herança é automática para tenants.

## 5. PROTOCOLO DE VERIFICAÇÃO
```bash
cd traffio-app/supabase/functions
npx deno check _shared/copilot.ts _tests/evals/run.ts
npx deno test -A _tests/evals/unit_test.ts
# com ANTHROPIC_API_KEY:
npx deno run -A _tests/evals/run.ts     # 100% verde, incl. conhecimento_global, sem regressão
cd traffio-app && npx tsc --noEmit
```
Eval vermelho = não está pronto. Nunca "ajuste o teste pra passar" sem justificar por escrito.

## 6. RELATÓRIO FINAL EXIGIDO
Crie `docs/RESULTADO_FASE3_CONHECIMENTO_GLOBAL.md` com:
1. **O que implementou** — arquivos/funções, decisões e PORQUÊ (especialmente a regra de precedência tenant>global e o threading de idioma);
2. **DDL final da migration** + os **15 tópicos semeados** (com 1 amostra trilíngue) + aviso para o orquestrador conferir `pg_policies`;
3. **Layout da UI super-admin** (ASCII);
4. **Saída dos comandos de verificação** (colada);
5. **Análise crítica honesta (mín. 3 achados)** — precedência imperfeita, inflar o pacote, cobertura dos tópicos, o que faria diferente;
6. **Estado:** completa / parcial / bloqueada e o que falta.

## 7. FORA DE ESCOPO
Deploy; aplicar migration/seed; iniciar Fases 4–5; ligar embeddings (Fase 5); priorização semântica do global (Fase 5); mudar o comportamento visível ao paciente além de responder domínio quando faltava; refactor amplo; trocar modelo. Em dúvida entre interpretar e perguntar: implemente a leitura mais conservadora (a que menos promete / menos infla) e registre a dúvida no relatório.
