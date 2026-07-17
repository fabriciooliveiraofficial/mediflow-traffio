# Resultado — Fase 2: Knowledge Gap Loop

## 1. O que foi implementado

- `supabase/functions/_shared/copilot.ts`: funções puras `classifyKnowledgeGap`, `sanitizeKnowledgeGapQuestion` e `normalizeKnowledgeGapQuestion`; persistência isolada em `recordKnowledgeGap`; hooks após o envio de handoff e após resposta normal com confirmação futura. O registro ocorre depois da mensagem ao paciente e uma falha apenas gera `console.warn`.
- `supabase/migrations/20260717160000_knowledge_gaps.sql`: tabela, índice parcial, RLS, grants e RPC `record_knowledge_gap`. A RPC faz `INSERT ... ON CONFLICT ... DO UPDATE` atômico para não perder incrementos concorrentes.
- `src/services/knowledgeGapsService.ts`: `listOpen`, `markAnswered`, `dismiss` e ordenação pura `sortKnowledgeGaps`.
- `src/components/settings/KnowledgeGapsPanel.tsx`: fila, contador, estado vazio/erro/loading e formulário inline para criar FAQ livre ou preencher fato canônico textual.
- `src/pages/Intelligence.tsx`: painel montado abaixo da ficha canônica, no mesmo bloco do “cérebro do agente”, visível somente no gate já existente de owner/admin.
- `src/locales/{pt-BR,en,es}/settings.json`: toda a nova interface localizada, sem texto de produto hardcoded.
- `supabase/functions/_tests/evals/unit_test.ts`: 14 testes do gap loop, incluindo os casos mínimos exigidos, PII/mídia e dedupe.

## 2. Regras exatas do classificador

É gap quando existe pergunta sanitizável e ocorre um destes sinais:

1. resposta vazia sem motivo específico (resposta vazia/rounds esgotados);
2. motivo de transferência contém marcador conservador de conhecimento ausente em PT/EN/ES;
3. resposta final contém o padrão de confirmação futura em PT/EN/ES.

Não é gap quando qualquer flag indica cancelamento, reconciliação, emergência, dúvida clínica, pedido explícito de humano ou insistência em preço. Motivo de transferência e pergunta também passam por denylist determinística para humano, preço, emergência, diagnóstico, medicação, dor, cancelamento e remarcação. Em conflito de sinais, a exclusão vence.

A pergunta remove wrapper de mídia, email, telefone e apresentação explícita de nome. Se ficar vazia/curta, nada é salvo. A normalização aplica Unicode NFD, remove acentos, caixa, pontuação, “por favor/please” e espaços redundantes.

## 3. DDL final

O DDL final está integralmente em `supabase/migrations/20260717160000_knowledge_gaps.sql`. Ele cria:

```sql
create table if not exists public.knowledge_gaps (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  patient_question text not null, normalized_question text not null,
  status text not null default 'open' check (status in ('open','answered','dismissed')),
  occurrences integer not null default 1 check (occurrences > 0),
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  resolved_clinic_info_key text null, sample_language text null
);
create unique index if not exists knowledge_gaps_open_tenant_question_uidx
  on public.knowledge_gaps (tenant_id, normalized_question) where status = 'open';
alter table public.knowledge_gaps enable row level security;
```

As policies SELECT/UPDATE exigem membership ativa owner/admin. Não há policy INSERT para cliente. A função de agregação é `security definer`, teve execução revogada de `public`, `anon` e `authenticated`, e foi concedida somente a `service_role`.

**Aviso obrigatório ao orquestrador:** antes de aplicar, consultar `pg_policies` para `public.knowledge_gaps` e confirmar os nomes reais. A migration remove defensivamente os nomes que ela própria cria, mas uma policy permissiva preexistente com outro nome combina por `OR` e precisa ser removida explicitamente.

## 4. Layout e fluxo

```text
Inteligência
└─ Base de conhecimento canônica
   └─ Perguntas sem resposta (N)
      ├─ “A clínica abre aos sábados?”
      │  3 ocorrências · última em 17/07/2026
      │  [Dispensar] [Responder]
      │               └─ destino: [Novo FAQ | fato canônico textual]
      │                  resposta: [........................]
      │                  [Cancelar] [Salvar resposta]
      └─ estado vazio: ✓ Nenhuma lacuna — seu agente está bem informado
```

Responder salva primeiro o `clinic_info`; somente depois marca o gap como `answered` com a chave gravada. Assim, falha parcial nunca fecha uma lacuna sem criar conhecimento. Dispensar muda somente o status para `dismissed`.

## 5. Verificação

```text
deno check _shared/copilot.ts _tests/evals/run.ts
Check _shared/copilot.ts
Check _tests/evals/run.ts

deno test -A _tests/evals/unit_test.ts
ok | 54 passed | 0 failed

npx tsc --noEmit -p tsconfig.json
exit code 0

git diff --check
exit code 0 (somente avisos de futura conversão LF/CRLF)
```

`ANTHROPIC_API_KEY` não está definida neste ambiente. Conforme o protocolo, `deno run -A _tests/evals/run.ts` não foi executado nem pulado silenciosamente: o gate de 29 cenários permanece bloqueado aguardando a chave.

## 6. Análise crítica

1. Regex multilíngue é intencionalmente conservadora e terá falsos negativos para paráfrases não catalogadas. Telemetria das transferências não registradas ajudaria a expandi-la com evidência real.
2. Dedupe textual não une equivalentes semânticos (“abre sábado?” e “funciona no fim de semana?”). Isso é limite assumido do MVP; embedding está fora de escopo.
3. PII stripping por regex reduz risco, mas não prova anonimização completa: nomes sem fórmula de apresentação, endereços e identificadores incomuns podem sobreviver. Em produção, eu adicionaria auditoria amostral restrita, métricas de descarte e uma política de retenção.
4. A denylist da pergunta pode gerar falso negativo factual quando uma palavra clínica aparece em contexto operacional. O viés é deliberado: perder um gap é preferível a persistir relato sensível.
5. O formulário oferece fatos canônicos apenas para campos textuais. Enums/booleanos exigem controles próprios para não violar o schema; ficaram fora do seletor em vez de aceitar valor inválido.

## 7. Estado

**Parcial por gate externo.** Código, migration, UI, i18n, checks estáticos e 54 testes unitários estão completos. Falta exclusivamente executar e obter 100% verde nos 29 evals com `ANTHROPIC_API_KEY`. Migration não foi aplicada e nenhum deploy foi feito, conforme solicitado.
