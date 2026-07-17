# Resultado — Fase 3: Conhecimento Global

## Estado

**Parcial — implementação concluída, gates de runtime pendentes no ambiente.** A migration e o seed não foram aplicados. O `tsc` passou; o Deno local está instalado apenas como um shim quebrado do WinGet e o eval com Anthropic não foi executado porque `ANTHROPIC_API_KEY` não está disponível.

## 1. O que foi implementado

- `supabase/migrations/20260717170000_global_knowledge.sql`: tabela global, índices, constraint de 2.000 caracteres, RLS e seed de 45 linhas.
- `supabase/functions/_shared/copilot.ts`:
  - `normalizeGlobalKnowledgeLanguage` converte `pt`/`pt-BR` para `pt-BR` e mantém `en`/`es`.
  - `mergeGlobalKnowledge` é função pura, filtra tópicos já preenchidos pelo tenant e limita a 12 entradas.
  - `buildKnowledgePacket(supabase, tenantId, language)` consulta apenas o idioma atual e monta: serviços → fatos do tenant → global → KB do tenant.
  - Global identificado por `[fonte:global#topic_key]` e rotulado como informativo.
- `unit_test.ts`: testes de normalização, precedência, limite e marcador de fonte.
- `scenarios.ts`/`run.ts`: cenário `conhecimento_global` com termos positivos, sem promessa, preço ou transferência.
- `src/services/globalKnowledgeService.ts`: listagem e atualização de título, conteúdo e ativação.
- `src/pages/master/MasterKnowledge.tsx` e `MasterApp.tsx`: CRUD de curadoria no `/master/knowledge`, com três idiomas, toggle ativo/inativo e aviso clínico.
- `src/locales/{pt-BR,en,es}/master.json`: textos da nova tela.

O tenant vence o global porque qualquer `clinic_info` ativo e preenchido com a mesma `topic_key` suprime o bloco global correspondente. Isso evita duplicidade e contradição sem alterar o conteúdo global. O idioma é threadado a partir de `context.language`/`storedLanguage`, com `pt-BR` como fallback.

## 2. DDL e conteúdo

DDL final entregue em `supabase/migrations/20260717170000_global_knowledge.sql`:

```sql
create table public.global_knowledge (
  id uuid primary key default gen_random_uuid(),
  topic_key text not null,
  language text not null check (language in ('pt-BR', 'en', 'es')),
  category text not null,
  title text not null,
  content text not null,
  is_active boolean not null default true,
  guardrails jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint global_knowledge_content_length check (char_length(content) <= 2000),
  constraint global_knowledge_topic_language_unique unique (topic_key, language)
);
create index global_knowledge_language_active_idx
  on public.global_knowledge (language, is_active);
alter table public.global_knowledge enable row level security;
-- SELECT: authenticated usando (true)
-- INSERT/UPDATE/DELETE: authenticated somente quando profiles.role = 'super_admin'
grant select on public.global_knowledge to authenticated;
grant all on public.global_knowledge to service_role;
```

Tópicos semeados: `implant_overview`, `teeth_whitening`, `root_canal`, `clear_aligners`, `dental_cleaning_prophylaxis`, `veneers`, `tooth_extraction`, `post_op_general`, `first_consultation_general`, `dental_anxiety_general`, `gum_disease_periodontitis`, `crowns_bridges`, `cavities_fillings`, `pediatric_dentistry_general`, `emergency_guidance_general`.

Amostra de `implant_overview`:

- pt-BR: “O implante dentário é um suporte, geralmente de titânio, colocado no osso para substituir a raiz de um dente ausente. Depois da avaliação clínica e dos exames indicados, o dentista define se essa opção é adequada e explica as etapas do plano.”
- en: “A dental implant is a support, commonly made of titanium, placed in the jawbone to replace the root of a missing tooth. After a clinical assessment and any indicated exams, the dentist decides whether it is suitable and explains the treatment plan.”
- es: “Un implante dental es un soporte, generalmente de titanio, colocado en el hueso para reemplazar la raíz de un diente ausente. Tras la evaluación clínica y los estudios indicados, el dentista define si es adecuado y explica las etapas del plan.”

O tópico de emergência apenas orienta buscar atendimento imediato em sinais graves, sem diagnóstico ou automedicação. Nenhum seed contém preço, garantia de resultado ou promessa de ausência de dor.

**Atenção ao orquestrador:** após aplicar, conferir `pg_policies` e os nomes reais de `profiles.role`, além de confirmar que a policy de leitura global não é combinada com uma policy mais ampla inesperada. A tabela não possui `tenant_id` por desenho.

## 3. Layout da UI

```text
MASTER ADMIN
├── ...
└── Global Knowledge (/master/knowledge)
    ├── cabeçalho + contador de tópicos
    ├── aviso: conteúdo informativo; nunca prometa resultado
    ├── aviso: fatos da clínica prevalecem
    └── cartão por topic_key
        ├── pt-BR: título, conteúdo, ativo/inativo, salvar
        ├── en:    título, conteúdo, ativo/inativo, salvar
        └── es:    título, conteúdo, ativo/inativo, salvar
```

## 4. Verificação

```text
PowerShell: npx tsc --noEmit
Resultado: exit code 0

Validação JSON dos 3 master.json
Resultado: OK (pt-BR, en, es)

git diff --check
Resultado: sem erros de whitespace

npx.cmd deno check _shared/copilot.ts _tests/evals/run.ts
Resultado: não concluído; o processo ficou sem saída aguardando o runtime/dependências.

deno --version
Resultado: falhou; o deno.exe exposto pelo WinGet não possui aplicativo associado.

npx deno test -A _tests/evals/unit_test.ts
Resultado: não executado pelo mesmo bloqueio do runtime Deno.

npx deno run -A _tests/evals/run.ts
Resultado: não executado; requer ANTHROPIC_API_KEY e o runtime Deno funcional.
```

## 5. Análise crítica

1. A precedência é por igualdade de `topic_key` com fatos ativos do tenant. Ela não detecta equivalência semântica entre uma FAQ local e um tópico global com outra chave; isso é deliberado no MVP e deve ser resolvido com catálogo/RAG futuro.
2. O limite de 12 reduz o risco de inflar o prompt, mas a seleção atual é lexical por `topic_key`, não por relevância à pergunta. A Fase 5 deve substituir esse fallback por recuperação semântica.
3. Os 15 tópicos cobrem o núcleo de dúvidas gerais, mas não substituem protocolos locais, contraindicações ou orientação clínica individual. O agente continua obrigado a devolver diagnóstico, indicação e plano ao dentista.
4. A migration inclui `updated_at`, mas não cria trigger de atualização automática; a UI atualiza conteúdo sem depender desse campo. Um trigger pode ser adicionado em uma revisão posterior se auditoria temporal exigir.

## 6. O que falta

- Orquestrador aplicar migration/seed.
- Corrigir/ disponibilizar runtime Deno e executar `deno check` + `deno test`.
- Executar `run.ts` com `ANTHROPIC_API_KEY`, obter 100% verde e colar a saída final neste relatório.
- Conferir policies no banco após aplicação.
