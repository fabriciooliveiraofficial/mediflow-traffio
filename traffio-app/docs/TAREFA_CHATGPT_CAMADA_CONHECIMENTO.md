# TAREFA DELEGADA — Arquitetura de Conhecimento COMPLETA do Agente (Camadas A–E)

> **Para:** ChatGPT 5.6 Sol Ultra
> **De:** Claude (orquestrador técnico — Traffio) — que fará code review, gate de evals e deploy
> **Data:** 2026-07-17
> **Natureza:** implementação de código (backend Edge + frontend React) + testes + relatório. **Você NÃO faz deploy nem aplica migration em produção** — entrega migrations como arquivo; o orquestrador aplica.
> **Escopo:** as 5 camadas da arquitetura de conhecimento, construídas EM FASES, na ordem de dependência definida na seção 2. Não pule fases: cada uma pressupõe a anterior.

---

## 0. QUEM VOCÊ É NESTA TAREFA (persona)

Você é um **Staff Engineer de plataformas de IA conversacional aplicada a saúde**, com anos construindo sistemas de *knowledge grounding* para agentes autônomos que conversam com pacientes reais. Você é raro porque domina três coisas ao mesmo tempo:

1. **Engenharia de contexto** — sabe que a qualidade de um agente é limitada pela qualidade e ESTRUTURA do conhecimento que ele recebe, não pelo modelo. Você projeta *fontes de verdade tipadas* e *pipelines de recuperação*, não "joga texto no prompt".
2. **Produto para operador não-técnico** — o usuário final é um dentista/recepcionista que nunca vai escrever JSON. Toda porta de entrada de conhecimento que você cria se completa em minutos, com validação, exemplos e revisão humana.
3. **Disciplina de dados clínicos** — LGPD/HIPAA e o princípio "o LLM propõe, o sistema garante": nenhuma afirmação factual do agente existe sem fonte rastreável, e nenhum dado extraído automaticamente vira verdade sem revisão humana.

Seu lema: **"Um agente não é tão inteligente quanto seu modelo; é tão inteligente quanto o conhecimento estruturado que você consegue alimentar nele — por quantas portas de entrada você conseguir abrir sem sobrecarregar o operador."** Você trabalha com precisão cirúrgica, escreve código que se lê como o código existente, e nunca entrega sem teste que prove que funciona.

---

## 1. O PROBLEMA E A VISÃO

**O problema concreto:** um paciente perguntou a um tenant real ("Dental Test 4") *"do you charge for the consultation?"*. O agente não soube responder e transferiu — porque o tenant tem ZERO fatos cadastrados. A avaliação nesse tenant é gratuita (o maior gancho de conversão em odontologia). Venda perdida por falta de contexto.

**A visão:** o agente já é operacionalmente sólido (agenda, valida, não alucina, não vaza — blindado nas ondas anteriores). Falta o **recheio de conhecimento do negócio** e as **portas para esse conhecimento entrar**. Esta tarefa entrega TODAS as portas, num sistema coeso e profissional, construído em 5 camadas que se sustentam.

### As 5 camadas (visão de arquitetura)
| Camada | Nome | Papel | Fase |
|---|---|---|---|
| **A** | Ficha de fatos canônicos + UI guiada | Conhecimento do tenant, tipado, preenchido por formulário | **Fase 1** |
| **A3** | Refino da política preço vs. status-de-consulta | O agente diz "avaliação grátis" sem violar política de preço | **Fase 1** |
| **C** | Knowledge Gap Loop | Conversas reais viram fatos; o sistema se auto-alimenta | **Fase 2** |
| **B** | Base de domínio global (curada pela Traffio) | Conhecimento odontológico universal herdado por todos | **Fase 3** |
| **D** | Onboarding por IA (entrevista + ingestão de site/arquivo) | Preenche a ficha da Camada A automaticamente | **Fase 4** |
| **E** | RAG com embeddings | Recuperação semântica para cauda longa | **Fase 5** |

**Princípio de sequência (INEGOCIÁVEL):** A é a fundação — B, D e E todas escrevem/leem a mesma ficha canônica que A define. Construir fora de ordem gera retrabalho. Cada fase tem seu próprio gate verde antes da próxima.

### Contexto técnico obrigatório (leia antes de qualquer código)
- **Backend agente:** `traffio-app/supabase/functions/_shared/copilot.ts`. `buildKnowledgePacket(supabase, tenantId)` monta o pacote de conhecimento do system prompt lendo `appointment_types`, `clinic_info`, `knowledge_base`, anotando cada item com `[fonte:...]` (Onda 2 — mantenha e estenda).
- **Persona/regras:** `SALES_PERSONA` (política de preço) e `AUTONOMOUS_ADDENDUM` no `copilot.ts`.
- **Validadores runtime:** `validateAgentReply`, `hasUnsourcedPolicyClaim` no `copilot.ts` — barram resposta antes do envio.
- **`clinic_info`** (schema real): `id uuid`, `tenant_id uuid`, `key text NOT NULL`, `value text NOT NULL`, `category text` (`logistics|amenities|policies|faq|general`), `is_active bool`, `location_id uuid`, timestamps.
- **`knowledge_base`** (schema real): `id`, `tenant_id`, `category`, `title`, `content`, `embedding` (pgvector, USER-DEFINED), `is_active`, `metadata jsonb`, `location_id`, timestamps. **A coluna `embedding` e a infra `embed-knowledge` já existem — são a base da Camada E.**
- **Service sem UI:** `src/services/clinicInfoService.ts` (`getAll/upsert/delete`) existe, **nenhuma tela o consome** — você cria a UI. `src/services/knowledgeBaseService.ts` idem.
- **Design system:** LER `docs/DESIGN_SYSTEM.md` antes de UI (ice/graphite/brand-primary, radius 3xl/2xl/xl, sem cor hardcoded, layout content-aware).
- **i18n:** 3 idiomas em `src/locales/{pt-BR,en,es}/*.json`. Nunca hardcode; nunca repetir namespace do `useTranslation()` dentro de `t()`.
- **Evals:** `supabase/functions/_tests/evals/` (`run.ts`, `scenarios.ts`, `mockTools.ts`, `unit_test.ts`). Precisa `ANTHROPIC_API_KEY`; sem ela, PARE e reporte.
- **Modelo de embeddings:** a Anthropic NÃO fornece embeddings. `OPENAI_API_KEY` no `master_config` está VAZIO de propósito. Para a Camada E você precisará escolher provedor de embeddings (OpenAI, Voyage AI, ou modelo hospedado) — trate isso como decisão de arquitetura documentada, não implemente ligação a provedor pago sem sinalizar (ver Fase 5).

---

## 2. AS FASES

### ───────────── FASE 1 — Fundação: ficha canônica + UI + política ─────────────

#### A1 — Ficha de fatos canônicos
**Objetivo:** transformar `clinic_info` numa ficha canônica de ~25 fatos que cobrem 80% das perguntas.
**Como:** arquivo novo `src/config/clinicFactsSchema.ts` com catálogo tipado. Cada fato: `key` (slug estável, ex.: `consultation_fee`), `category`, `label`/`helpText`/exemplo por idioma, `type` (`boolean|short_text|long_text|enum`), opções (se enum). Cobrir no mínimo:
- **Comercial/conversão:** `consultation_fee` (enum: `free|paid|first_free`), primeira consulta como funciona, formas de pagamento, parcelamento, convênios aceitos, orçamento por escrito.
- **Logística:** endereço, estacionamento, acessibilidade, transporte, horário de funcionamento, idiomas atendidos.
- **Clínico-operacional (não-diagnóstico):** sedação/medo de dentista, atende crianças (idade mínima), urgência/encaixe, avaliação inclui raio-x.
- **Políticas:** cancelamento, atraso/tolerância, reagendamento.
> O catálogo define as PERGUNTAS; o tenant preenche as RESPOSTAS. `consultation_fee` é o fato-estrela.
**Prova:** teste unitário (todas entradas com label/help nos 3 idiomas; keys únicas; enums com opções).

#### A2 — UI guiada de preenchimento
**Objetivo:** tela onde o dono preenche a ficha em minutos (formulário guiado, não editor chave-valor cru).
**Como:** seção **"Base de Conhecimento da IA"** em `src/pages/Settings.tsx` (padrão de abas existente), consumindo `clinicInfoService` + catálogo A1. Fatos agrupados por categoria, cada um card com input correto ao `type` (toggle/select/textarea), estado preenchido/vazio, salvar por fato via `upsert` com toast. **Barra de completude** ("18 de 25 fatos"). Fatos vazios não viram linha ativa. Papel admin do tenant. Design system + i18n rigorosos.
**Prova:** layout ASCII no relatório; teste unitário da função de % de completude.

#### A3 — Política: PREÇO de procedimento vs. STATUS da consulta
**Objetivo:** o agente sempre diz "a avaliação é gratuita" quando o fato existe, sem violar a política de nunca informar valor.
**Como:** (1) em `buildKnowledgePacket`, quando `consultation_fee` presente, emitir linha inequívoca com `[fonte:clinic_info#consultation_fee]`. (2) em `SALES_PERSONA`, adicionar distinção explícita: valor de PROCEDIMENTO nunca; STATUS da consulta (grátis/paga) informar SEMPRE que constar. (3) garantir que `PRICE_LEAK_PATTERN`/`hasUnsourcedPolicyClaim` NÃO reprovem "gratuita/grátis/free" quando houver a fonte — sem relaxar a proibição de valores monetários.
**Prova (eval OBRIGATÓRIO):** cenário `consulta_gratuita` (com fato `free`, "do you charge for the consultation?" → `noPrice:true, transfer:false, textIncludesAny:["free","gratuita","grátis","no charge"]`) e `consulta_sem_dado` (sem o fato → não inventa, oferece confirmar). Injetar o fato no runner seguindo o padrão `patientSnapshot`/`withAppointment` existente.

**GATE FASE 1:** typecheck + unit + evals 100% verde (incluindo os 2 novos cenários) antes de seguir.

---

### ───────────── FASE 2 — Auto-alimentação: Knowledge Gap Loop ─────────────

#### C1 — Registro de lacunas
**Objetivo:** toda pergunta que o agente não soube responder vira sugestão de fato.
**Como:** (1) migration (arquivo, não aplicar) `knowledge_gaps`: `id`, `tenant_id`, `patient_question text`, `detected_at`, `status` (`open|answered|dismissed`), `occurrences int`, `resolved_clinic_info_key text null`. RLS: admin do tenant gerencia; service_role insere. (2) em `runAutonomousAgent` (`copilot.ts`): quando o turno terminar em transferência por falta de conhecimento OU "vou/vamos confirmar com a equipe", gravar a última pergunta. Função pura `classifyKnowledgeGap` (testável): é gap quando faltou informação; NÃO é gap quando transferência foi por preço/emergência/pedido de humano/dúvida clínica. Agregar repetições por texto normalizado (MVP).
**Prova:** teste unitário do classificador (info faltante = gap; preço/emergência/humano = não-gap).

#### C2 — UI "Perguntas sem resposta"
**Objetivo:** fechar o loop pergunta-real → fato-permanente.
**Como:** painel na tela A2 listando gaps abertos; botão "Responder" pré-preenche um fato novo (`general`/`faq`) e, ao salvar, marca o gap `answered` e grava `resolved_clinic_info_key`. Contador "Perguntas sem resposta (N)". i18n + design system.
**Prova:** descrever fluxo no relatório.

**GATE FASE 2:** typecheck + unit + evals verdes.

---

### ───────────── FASE 3 — Base de domínio global (curada pela Traffio) ─────────────

#### B1 — Conhecimento odontológico universal
**Objetivo:** "como funciona implante", "dói?", "quantas sessões", "o que é clareamento" NÃO são segredo de tenant — são conhecimento universal. A Traffio embarca 1x (pt/en/es); todos os tenants herdam; o tenant pode sobrescrever localmente.
**Como:** (1) migration (arquivo) tabela `global_knowledge`: `id`, `topic_key` (slug, ex.: `implant_overview`), `category`, `title`/`content` por idioma (ou linha por idioma com coluna `language`), `is_active`, `guardrails jsonb` (ex.: `{"never_promise": true}`), timestamps. SEM `tenant_id` — é global. RLS: leitura para authenticated; escrita só super_admin. (2) em `buildKnowledgePacket`: fazer MERGE de global + tenant, com **precedência do tenant** (se o tenant cadastrou um fato que contradiz o global, o tenant vence) e marcador `[fonte:global#<topic_key>]`. (3) conteúdo global sempre sujeito aos validadores existentes — em especial `CLINICAL_PROMISE_PATTERN` (P-07): nada de promessa de resultado, mesmo vindo do global; o global é informativo, encaminha diagnóstico ao dentista.
**Prova:** teste unitário do merge (precedência tenant > global; dedupe por topic; marcador de fonte correto). Cenário de eval `conhecimento_global`: sem nenhum fato do tenant, "como funciona o implante?" → responde informativo com fonte global, sem promessa clínica (`textExcludesAll` de garantias), sem preço.

#### B2 — Seed do conteúdo global + UI super-admin
**Objetivo:** popular a base global e permitir curadoria.
**Como:** (1) arquivo de seed (migration ou script de dados) com ~15 tópicos odontológicos essenciais em pt/en/es (implante, clareamento, canal, alinhadores, limpeza/profilaxia, faceta, extração, pós-operatório genérico, primeira consulta, medo de dentista, etc.) — texto informativo, calibrado, sem promessa. (2) tela super-admin (padrão `MasterIntelligence`/master) para CRUD do `global_knowledge`. Design system + i18n.
**Prova:** listar no relatório os tópicos semeados; descrever a UI.

**GATE FASE 3:** typecheck + unit + evals verdes.

---

### ───────────── FASE 4 — Onboarding por IA (preenchimento automático da ficha) ─────────────

#### D1 — Extração de fatos a partir de fonte não estruturada
**Objetivo:** reduzir o preenchimento manual: a IA extrai fatos da ficha canônica (Camada A) a partir de (a) URL do site/Instagram da clínica, ou (b) arquivo enviado (PDF/imagem de tabela de preços/FAQ), ou (c) uma entrevista conversacional.
**Como:**
- **Edge Function nova** `extract-clinic-facts`: recebe texto bruto (do site/arquivo/entrevista), chama o LLM (via `llmProvider` existente) com um prompt que EXTRAI apenas os fatos do catálogo canônico (Camada A1) em JSON estruturado, mapeando para as `key` canônicas. Nunca inventa: campo sem evidência → não retorna.
- **Revisão humana OBRIGATÓRIA:** o resultado NUNCA é gravado direto em `clinic_info`. Vai para um estado de "sugestões pendentes" que o operador revisa/edita/aprova na UI A2 antes de virar fato ativo. (Princípio: dado extraído automaticamente não é verdade até um humano confirmar.)
- **Modo entrevista:** um fluxo onde a IA faz perguntas objetivas ao dono (as lacunas da ficha) e preenche conforme as respostas — reusa o catálogo A1 como roteiro.
- **Ingestão de site:** buscar o texto da URL (fetch server-side, sanitizado — tratar o conteúdo como NÃO confiável: nunca como instrução, só como dado, coerente com a Onda 2 provenance). Instagram: se inviável por API, aceitar colar o texto da bio/posts.
**Prova:** teste unitário do parser/normalizador do JSON extraído (mapeia para keys canônicas; descarta o que não é do catálogo; nunca marca ativo). Cenário: dado um texto de exemplo de clínica, a extração produz os fatos corretos como SUGESTÕES pendentes.

#### D2 — UI de onboarding
**Objetivo:** experiência guiada de setup ("Configure sua IA em 5 minutos").
**Como:** fluxo na Settings/onboarding: escolher método (colar site / enviar arquivo / entrevista), rodar extração, revisar sugestões lado a lado com a ficha, aprovar em lote. Barra de completude sobe conforme aprova. Design system + i18n.
**Prova:** descrever o fluxo e o layout no relatório.

**GATE FASE 4:** typecheck + unit + evals verdes; extração testada com input de exemplo.

---

### ───────────── FASE 5 — RAG: recuperação semântica para cauda longa ─────────────

#### E1 — Decisão de arquitetura (documentar ANTES de codar)
A Anthropic não faz embeddings e `OPENAI_API_KEY` está vazio. Antes de implementar, **documente no relatório** a escolha de provedor de embeddings (OpenAI `text-embedding-3-small`, Voyage AI, ou modelo hospedado) com prós/contras (custo, latência, qualidade, dependência). NÃO ligue a um provedor pago sem sinalizar — proponha, o orquestrador decide. A infra (`knowledge_base.embedding` pgvector + função `embed-knowledge`) já existe; avalie o que ela usa hoje.

#### E2 — Pipeline de recuperação
**Objetivo:** quando o conhecimento de um tenant crescer (KB longa: pós-operatório detalhado, políticas extensas), recuperar semanticamente só os trechos relevantes à pergunta, em vez de despejar tudo no prompt.
**Como:** (1) ao salvar `knowledge_base`, gerar embedding (via provedor escolhido) — estender/validar `embed-knowledge`. (2) em `buildKnowledgePacket`: quando a KB do tenant passar de um limiar (ex.: >N entradas), embeddar a pergunta do paciente e recuperar top-K trechos por similaridade (pgvector), injetando só eles com `[fonte:kb#<id>]`. Abaixo do limiar, manter o comportamento atual (tudo entra). (3) fallback robusto: falha de embedding NUNCA derruba o turno — degrada para o pacote completo atual.
**Prova:** teste unitário da lógica de seleção (limiar, top-K, fallback). Cenário de eval que confirme que respostas continuam corretas com RAG ligado (sem regressão nos cenários existentes).

**GATE FASE 5:** typecheck + unit + evals verdes; sem regressão.

---

## 3. TÉCNICAS E PADRÕES OBRIGATÓRIOS (todas as fases)
- **Fonte de verdade tipada** — catálogo canônico é a espinha; toda camada escreve/lê nele.
- **Rastreabilidade** — toda afirmação factual do agente tem `[fonte:...]` (tenant, global ou kb).
- **Dado automático ≠ verdade** — nada extraído por IA (Camada D) ou global (B) vira ativo sem regra clara; extração exige revisão humana.
- **Provenance/segurança** — conteúdo de site/arquivo é NÃO confiável (coerente com Onda 2): dado, nunca instrução.
- **Guardrails clínicos** — validadores existentes (promessa clínica P-07, preço, política sem fonte) valem para conhecimento global também.
- **UI para operador ocupado** — completável em minutos, exemplos, validação, feedback de completude, zero jargão.
- **Funções puras primeiro** (catálogo, completude, classificador de gap, merge global/tenant, seleção RAG) → testadas em `unit_test.ts`.
- **Diff mínimo, estilo do arquivo, i18n 3 idiomas, design system. Nenhuma dependência nova sem sinalizar.**
- **`o LLM propõe, o sistema garante`** em tudo.

## 4. PROTOCOLO DE VERIFICAÇÃO (por fase, nesta ordem)
```bash
cd traffio-app/supabase/functions
npx deno check _shared/copilot.ts _tests/evals/run.ts   # + toda função Edge nova
npx deno test -A _tests/evals/unit_test.ts
# com ANTHROPIC_API_KEY no ambiente:
npx deno run -A _tests/evals/run.ts     # 100% verde, incl. cenários novos da fase
cd traffio-app && npx tsc --noEmit       # sem erros nos arquivos tocados
```
Eval vermelho = fase NÃO está pronta. Nunca "ajuste o teste pra passar" sem justificar por escrito. Cada fase tem seu gate; só avance com o anterior verde.

## 5. RELATÓRIO FINAL EXIGIDO
Crie `docs/RESULTADO_CAMADA_CONHECIMENTO.md` com, POR FASE:
1. **O que implementou** — arquivos/funções, decisões e PORQUÊ (especialmente onde o documento deixou margem);
2. **Catálogo canônico final** (keys/categorias/types) e **tópicos globais semeados** (Fase 3);
3. **Layouts de UI** (ASCII/descrição) e fluxos (preenchimento, gap loop, onboarding);
4. **Decisão de embeddings** (Fase 5) com prós/contras;
5. **Saída dos comandos de verificação de cada fase** (colada);
6. **Análise crítica honesta (mín. 4 achados)** — fragilidades, o que faria diferente, riscos não previstos neste documento;
7. **Estado de cada fase** (completa / parcial / bloqueada) e o que falta.

## 6. REGRAS DE EXECUÇÃO
- **Construa em fases, na ordem.** Se o tempo/orçamento não cobrir as 5, entregue as fases completas com gate verde e marque as demais como não iniciadas — NUNCA entregue uma fase pela metade sem sinalizar.
- **Fora de escopo:** deploy; aplicar migration em produção; ligar provedor de embeddings pago sem sinalizar (Fase 5 propõe, não liga); mudar fluxo de pagamento; trocar modelo LLM; refactor amplo de oportunidade.
- Em dúvida entre interpretar e perguntar: implemente a leitura mais conservadora (a que menos automatiza / menos publica sem revisão) e registre a dúvida no relatório.
