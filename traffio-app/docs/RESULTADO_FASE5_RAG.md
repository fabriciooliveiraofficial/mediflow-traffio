# Resultado — Fase 5: RAG construído desligado

Data: 2026-07-20

## 1. O que foi implementado

- `supabase/functions/_shared/embeddings.ts`: `embedText` lê `OPENAI_API_KEY` pelo padrão de `master_config`, chama `text-embedding-3-small` com 1536 dimensões e timeout de 3 segundos. Chave ausente, timeout, erro HTTP ou payload inválido retornam `null`; nenhuma falha é propagada ao atendimento.
- `supabase/functions/embed-knowledge/index.ts`: a indexação passou a reutilizar `embedText`, removendo a chamada OpenAI duplicada. O webhook continua salvando o vetor na mesma coluna e continua respondendo HTTP 500 quando não consegue gerar o embedding, permitindo retentativa/observabilidade no lado de indexação.
- `supabase/functions/_shared/masterConfig.ts`: getters de `OPENAI_API_KEY`, `RAG_ENABLED` e `RAG_MIN_KB_ENTRIES`. As duas flags de produto ignoram env vars deliberadamente e leem `master_config`; defaults: `false` e `20`.
- `supabase/functions/_shared/copilot.ts`:
  - `shouldUseRag` é a decisão pura `ragEnabled && kbCount >= threshold`;
  - `buildKnowledgeBaseSection` é a montagem pura e preserva `[fonte:kb#id]`;
  - `buildKnowledgePacket` aceita `patientQuery?: string`;
  - com RAG ligado e volume suficiente, a pergunta é embeddada e enviada à RPC existente `match_knowledge_base`, com similaridade mínima `0.5` e top-K `6`;
  - sem query, flag off, volume baixo, embedding indisponível, erro/resultado vazio da RPC: usa exatamente o dump defensivo anterior de até 20 entradas;
  - serviços, `clinic_info`, fato-estrela de consulta e conhecimento global não foram alterados;
  - `runCopilot` e `runAutonomousAgent` passam a última mensagem do paciente.
- `supabase/functions/_tests/evals/unit_test.ts`: testes de decisão/defaults, montagem top-K/fallback e embedding (sucesso, chave ausente, HTTP e timeout).
- `supabase/migrations/20260720150000_rag_flags_and_ann_index.sql`: seeds idempotentes das flags e garantia idempotente de índice HNSW/cosseno. A migration foi apenas criada; não foi aplicada.

O caminho de recuperação reutiliza a RPC de produção `match_knowledge_base`; nenhuma RPC ou coluna vetorial nova foi criada. Os validadores e guardrails posteriores do agente continuam os mesmos, portanto um trecho RAG não contorna política de preço, promessa clínica ou exigência de fonte.

## 2. Como ligar (runbook)

Não ligar antes de aplicar a migration e validar o índice/RLS.

1. Preencher `master_config.OPENAI_API_KEY` com uma chave válida da OpenAI.
2. Confirmar que o Database Webhook de INSERT/UPDATE em `knowledge_base` chama `embed-knowledge` e que a função retorna sucesso.
3. Validar a indexação:

   ```sql
   select
       tenant_id,
       count(*) filter (where is_active) as ativas,
       count(*) filter (where is_active and embedding is not null) as vetorizadas,
       count(*) filter (where is_active and embedding is null) as pendentes
   from public.knowledge_base
   group by tenant_id;
   ```

4. Para entradas legadas sem vetor, executar um backfill controlado em lotes que reinvoque `embed-knowledge` (ou faça updates reais de conteúdo compatíveis com o webhook). Não foi executado backfill nesta fase.
5. Ajustar `RAG_MIN_KB_ENTRIES` se 20 não representar o ponto de saturação real do prompt.
6. Por último, definir `RAG_ENABLED=true`. A leitura tem cache em memória de até 5 minutos por instância Edge; aguardar esse período ou invalidar/reiniciar as instâncias antes da validação.
7. Fazer uma pergunta cuja resposta exista em uma entrada vetorizada e conferir logs, resposta e marcador `[fonte:kb#<id>]`. Testar também chave inválida/RPC indisponível para confirmar que o dump continua presente.

Para desligar imediatamente do ponto de vista de configuração, voltar `RAG_ENABLED` para `false` (considerando o TTL de cache acima).

## 3. DDL das flags e índice ANN

Arquivo entregue: `supabase/migrations/20260720150000_rag_flags_and_ann_index.sql`.

```sql
insert into public.master_config (key, value, description)
values
    ('RAG_ENABLED', 'false', 'Ativa recuperação semântica da knowledge_base; desligado por padrão'),
    ('RAG_MIN_KB_ENTRIES', '20', 'Mínimo de entradas ativas por tenant para usar RAG')
on conflict (key) do nothing;
```

A migration histórica `20260406_knowledge_base.sql` já declara HNSW em `embedding vector_cosine_ops`. A nova migration consulta `pg_indexes` e só cria `knowledge_base_embedding_hnsw_idx` quando não encontra um HNSW equivalente, inclusive se o índice antigo tiver nome gerado automaticamente.

HNSW foi mantido porque oferece bom recall/latência de consulta e não exige treinamento do índice; o custo é maior consumo de memória e build mais caro que IVFFlat. Antes de aplicar, o orquestrador deve conferir no banco real:

```sql
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'knowledge_base';

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('knowledge_base', 'master_config');
```

Também deve confirmar a extensão `vector` e que a RPC mantém escopo por `p_tenant_id` sob as políticas reais. Não alterar `OPENAI_API_KEY` pela migration.

## 4. Verificação executada

Checagem estática:

```text
$ npx deno check _shared/copilot.ts _shared/embeddings.ts _tests/evals/run.ts embed-knowledge/index.ts
Check _shared/copilot.ts
Check _shared/embeddings.ts
Check _tests/evals/run.ts
Check embed-knowledge/index.ts
exit code 0
```

Testes unitários:

```text
$ npx deno test -A _tests/evals/unit_test.ts
running 62 tests
ok | 62 passed | 0 failed
exit code 0
```

O Deno emitiu apenas o aviso preexistente de que `allowJs` é ignorado em `deno.json`.

Evals conversacionais:

```text
$ env check
ANTHROPIC_API_KEY=ABSENT

$ npx deno run -A _tests/evals/run.ts
NÃO EXECUTADO — a especificação determina parar e reportar quando ANTHROPIC_API_KEY estiver ausente.
```

Portanto ainda não existe evidência `30/30` nesta máquina. Esse gate precisa ser executado pelo orquestrador com a credencial antes de review/deploy. RAG permanece desligado por default tanto no código quanto na migration.

## 5. Análise crítica

1. `0.5` e top-K `6` são valores iniciais arbitrários. Precisam de um conjunto rotulado de perguntas/trechos por idioma e categoria para medir precision@K, recall@K e taxa de fallback; recuperar contexto incorreto é pior que não recuperar.
2. A indexação usa apenas `content`. Incorporar `title` e possivelmente `category` ao texto do embedding pode melhorar perguntas curtas, mas exigiria uma decisão de formato e reindexação versionada para não misturar representações.
3. Entradas legadas com `embedding is null` nunca aparecem na busca vetorial. O fallback evita perda total da KB, mas um backfill em lotes, com rate limit, retentativa e métrica de cobertura, é obrigatório antes de ligar em tenants antigos.
4. Em falha do RAG, o dump legado continua limitado a 20 linhas e sem ordenação explícita. Isso preserva compatibilidade, mas em KB grande pode omitir justamente a resposta relevante durante uma indisponibilidade da OpenAI/RPC.
5. Cada turno elegível adiciona uma chamada OpenAI e uma RPC, além da contagem (esta última ocorre apenas com a flag ligada e usa cache apenas para configuração). Convém medir p50/p95, custo por conversa e considerar cache de embeddings de perguntas normalizadas após haver volume real.
6. O conteúdo continua truncado em 400 caracteres por entrada. Isso controla prompt/custo, porém pode cortar a conclusão relevante; chunking semântico e embeddings por chunk seriam uma evolução melhor que simplesmente aumentar o limite.
7. HNSW favorece recall e latência, mas consome mais memória e torna o build mais caro. Para a escala inicial isso é razoável; parâmetros e tamanho do índice devem ser observados antes de crescer a base.

## 6. Estado

**PARCIAL.** Código, migration, checagem estática e testes unitários estão completos. O único gate pendente é a suíte conversacional obrigatória de 30 cenários, bloqueada pela ausência de `ANTHROPIC_API_KEY`. Não houve deploy, aplicação de migration, ativação do RAG nem backfill.
