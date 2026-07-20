# TAREFA DELEGADA — Fase 5: RAG (recuperação semântica, construída DESLIGADA)

> **Para:** ChatGPT 5.6 Sol Ultra
> **De:** Claude (orquestrador técnico — Traffio) — que fará code review, gate de evals e deploy
> **Data:** 2026-07-20
> **Natureza:** implementação de código (Edge) + testes + relatório. **Você NÃO faz deploy nem aplica migration** — entrega migration como arquivo; o orquestrador aplica.
> **Pré-requisito:** Fases 1–4 EM PRODUÇÃO.

---

## 0. DECISÕES JÁ TOMADAS PELO DONO DO PRODUTO (não questione)
1. **Construir DESLIGADO.** A infra fica pronta mas inativa por padrão; liga por tenant SOMENTE quando a base de conhecimento crescer além de um limiar. Sem custo nem latência até haver volume real.
2. **Provedor de embeddings: OpenAI `text-embedding-3-small`** (1536 dims). Casa com a coluna `knowledge_base.embedding vector(1536)` existente — ZERO mudança de schema. A credencial vai em `master_config.OPENAI_API_KEY` (hoje VAZIO — o dono preenche quando ligar; seu código trata a ausência como "RAG indisponível → fallback").

## 1. QUEM VOCÊ É (persona)
Você é o mesmo **Staff Engineer de IA conversacional aplicada a saúde**, agora como **engenheiro de sistemas de recuperação (retrieval)**. Você sabe a regra de ouro do RAG em produção: **recuperar o trecho errado é pior que não recuperar nada**, e **uma falha de embedding jamais pode derrubar a conversa**. Você constrói retrieval que degrada graciosamente, liga só quando agrega valor, e nunca deixa o pipeline de embeddings virar um ponto único de falha do atendimento.

Seu lema: **"RAG não é sobre buscar mais contexto; é sobre buscar SÓ o contexto certo — e sumir sem deixar rastro quando não há o que buscar."**

## 2. O QUE JÁ EXISTE (reaproveite — NÃO reconstrua)
Verificado em produção 2026-07-20:
- **`knowledge_base.embedding vector(1536)`** — coluna pgvector pronta. pgvector instalado.
- **RPC `match_knowledge_base(query_embedding vector, match_threshold float8, match_count int, p_tenant_id uuid, p_location_id uuid default null)`** → retorna `(id, title, content, category, similarity)`, escopado por tenant, cosseno. **Use esta RPC** para recuperar; não crie outra.
- **Edge `embed-knowledge`** — já gera embedding do `content` com `text-embedding-3-small` ao inserir/atualizar `knowledge_base` (via webhook), lendo `OPENAI_API_KEY` de `master_config`. É o lado de INDEXAÇÃO. Verifique se está correto e reutilize o padrão de chamada à OpenAI; NÃO duplique lógica de embedding — extraia um helper compartilhado se precisar (ver B1).
- **`buildKnowledgePacket(supabase, tenantId, language)`** em `copilot.ts` — hoje despeja TODAS as linhas de `knowledge_base` (limite `MAX_KB_ENTRIES`). É aqui que a recuperação entra.

O que FALTA (seu trabalho): o lado de CONSULTA (embeddar a pergunta do paciente + recuperar top-K), o limiar/flag que decide quando usar RAG, e o fallback robusto.

### Contexto adicional
- **Gate de evals:** como você VAI tocar `copilot.ts` (buildKnowledgePacket), a suíte conversacional de 30 cenários É OBRIGATÓRIA e não pode regredir. Precisa de `ANTHROPIC_API_KEY`; sem ela PARE e reporte. Com RAG desligado (default), o comportamento deve ser IDÊNTICO ao atual — os 30 cenários provam isso.
- **Config dinâmica:** flags globais ficam em `master_config` (padrão `getMasterConfig`); `AI_MODEL_*` e chaves já moram lá. Não use env var para o flag de produto.
- Comentários PT-BR no estilo do arquivo; nenhuma dependência nova.

## 3. AS IMPLEMENTAÇÕES

### B1 — Helper de embedding de consulta (lado query)
**Objetivo:** transformar a pergunta do paciente em vetor, reusando o provedor já usado na indexação.
**Como:**
1. Helper compartilhado (ex.: `_shared/embeddings.ts`) `embedText(supabase, text): Promise<number[] | null>`: lê `OPENAI_API_KEY` de `master_config`; se vazio/erro/timeout → retorna `null` (nunca lança). Chama `text-embedding-3-small`, dims 1536. Timeout curto (ex.: 3s) — retrieval é caminho quente; melhor sem RAG do que lento.
2. Se `embed-knowledge` tiver lógica de chamada à OpenAI duplicável, refatore para usar este helper (mantendo o comportamento de indexação idêntico). Se o refactor for arriscado, deixe `embed-knowledge` como está e documente a duplicação no relatório — diff mínimo vence.
**Prova:** teste unitário do helper com fetch mockado (sucesso → vetor; sem chave → null; erro HTTP → null; timeout → null).

### B2 — Decisão de recuperação + limiar (o "quando")
**Objetivo:** RAG só entra quando há volume; caso contrário, comportamento atual intacto.
**Como (função PURA, testável)** `shouldUseRag({ ragEnabled, kbCount, threshold }): boolean`:
- `ragEnabled` = flag global `master_config.RAG_ENABLED` (default `false`).
- `kbCount` = nº de linhas ativas de `knowledge_base` do tenant.
- `threshold` = `master_config.RAG_MIN_KB_ENTRIES` (default ex.: 20).
- Retorna `true` SOMENTE se `ragEnabled && kbCount >= threshold`. Abaixo disso → `false` (dump atual, que já cabe no prompt).
**Prova:** teste unitário exaustivo (flag off → false; volume baixo → false; ambos ok → true; defaults corretos).

### B3 — Recuperação no `buildKnowledgePacket` (o "como") + fallback
**Objetivo:** quando RAG ativo, injetar só os top-K trechos relevantes à pergunta em vez de todos.
**Como:**
1. `buildKnowledgePacket` passa a receber a última mensagem do paciente (novo parâmetro opcional `patientQuery?: string`; atualize os 2 call sites em `runCopilot`/`runAutonomousAgent`). Sem query ou RAG inativo → comportamento atual (dump `MAX_KB_ENTRIES`).
2. Quando `shouldUseRag(...)` = true E há `patientQuery`:
   - `embedText(...)`. Se `null` → **fallback**: comportamento atual (dump). Nunca falhar o turno.
   - `match_knowledge_base(vetor, threshold≈0.5, match_count≈6, tenantId)`. Injeta só os retornados, com `[fonte:kb#<id>]` (mantém rastreabilidade da Onda 2). Se a RPC falhar/retornar vazio → fallback para dump.
3. **Isolamento total:** qualquer erro no caminho RAG (embedding, RPC, timeout) cai no comportamento atual; o pacote NUNCA fica sem a KB por causa de RAG. Log `console.warn`, sem lançar.
4. A parte NÃO-KB do pacote (serviços, fatos do tenant, conhecimento global) é inalterada — RAG afeta SOMENTE a seção `knowledge_base`.
**Prova:** teste unitário puro da MONTAGEM (dado um conjunto de trechos recuperados, produz a seção com marcador correto; dado retrieval vazio/erro, usa o dump). O eval `run.ts` roda com RAG default OFF → deve dar 30/30 sem regressão (prova que desligado = idêntico).

### B4 — Migration/flags + verificação de índice
**Objetivo:** flags e performance prontos, sem ligar nada.
**Como:**
1. Migration (arquivo, NÃO aplicar): garante as linhas `master_config` `RAG_ENABLED='false'` e `RAG_MIN_KB_ENTRIES='20'` (INSERT ... ON CONFLICT DO NOTHING — não sobrescreve se já existirem). NÃO altere `OPENAI_API_KEY`.
2. Índice ANN para o `match_knowledge_base` escalar: se ainda não houver, crie `ivfflat`/`hnsw` em `knowledge_base.embedding` (`vector_cosine_ops`) — verifique antes se já existe (o orquestrador confere no banco). Documente o trade-off (hnsw melhor recall, mais custo de build).
**Prova:** documentar no relatório; o orquestrador valida índice no banco.

## 4. GUARDRAILS
- RAG desligado por padrão; ligar é decisão explícita do dono (flag + chave OpenAI).
- Falha de RAG = fallback silencioso para o comportamento atual, NUNCA erro ao paciente.
- Trecho recuperado passa pelos MESMOS validadores de saída (preço, promessa, política sem fonte) — RAG não é bypass de guardrail.
- `[fonte:kb#id]` preservado — rastreabilidade intacta.
- Latência: timeout curto no embedding; RAG nunca pode tornar a resposta lenta.

## 5. PROTOCOLO DE VERIFICAÇÃO
```bash
cd traffio-app/supabase/functions
npx deno check _shared/copilot.ts _shared/embeddings.ts _tests/evals/run.ts embed-knowledge/index.ts
npx deno test -A _tests/evals/unit_test.ts   # + testes novos do helper/shouldUseRag/montagem
# com ANTHROPIC_API_KEY (RAG default OFF):
npx deno run -A _tests/evals/run.ts          # 30/30, ZERO regressão (desligado = idêntico)
```
Eval vermelho = não está pronto. Nunca "ajuste o teste pra passar" sem justificar.

## 6. RELATÓRIO FINAL EXIGIDO
Crie `docs/RESULTADO_FASE5_RAG.md` com:
1. **O que implementou** — arquivos/funções, o que reusou de `embed-knowledge`/`match_knowledge_base`, e PORQUÊ das decisões;
2. **Como ligar** (runbook para o dono): preencher `OPENAI_API_KEY`, setar `RAG_ENABLED=true`, ajustar `RAG_MIN_KB_ENTRIES`, e como validar que embeddings estão sendo gerados (webhook de `embed-knowledge`);
3. **DDL das flags + índice ANN** (com aviso para o orquestrador conferir índice/pg_policies);
4. **Saída dos comandos de verificação** (colada, incl. 30/30);
5. **Análise crítica honesta (mín. 3 achados)** — qualidade de recuperação, threshold/match_count arbitrários, custo, backfill de embeddings para KB legada sem vetor, o que faria diferente;
6. **Estado:** completa / parcial / bloqueada.

## 7. FORA DE ESCOPO
Deploy; aplicar migration; LIGAR o RAG (fica off — decisão do dono); trocar provedor de embeddings; re-embeddar em massa a KB existente (proponha runbook, não execute); mudar o comportamento visível com RAG desligado; refactor amplo; trocar modelo do agente. Em dúvida: implemente a leitura mais conservadora (a que mantém o comportamento atual quando RAG off) e registre no relatório.
