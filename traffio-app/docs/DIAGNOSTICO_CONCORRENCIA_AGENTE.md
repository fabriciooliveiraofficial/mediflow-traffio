# Diagnóstico de concorrência/carga — AI Agent (inbox worker)

> **Status:** diagnóstico apenas — nenhum código alterado. Decisão do usuário (2026-07-21):
> documentar o gargalo e o plano de hardening; seguir o teste de fogo comportamental
> (poucos pacientes) por enquanto; endurecer para carga depois.
>
> **Escopo:** este documento trata **exclusivamente de throughput sob concorrência**
> (50/100/150/200 pacientes simultâneos). A **qualidade de atendimento por conversa** já está
> validada e verde — ver `SPEC_AGENTE_IA_CLAUDE.md` § Suíte de evals (`run.ts` 44/44,
> `conversation.ts` 5/5 multi-turno + juiz de tom). Carga é uma superfície de risco **diferente**,
> que os evals (rodam uma conversa por vez, em sequência) **não exercitam**.

## TL;DR

Do jeito que está hoje, o sistema **não atende 200 pacientes verdadeiramente simultâneos com baixa
latência** — e a causa **não é alucinação**. É throughput de infraestrutura: um worker que processa
a fila **em série**, varrido por cron a cada ~20s, com retry fraco em rate-limit. Sob um burst de
200 simultâneos, a fila **não perde mensagens** (ficam `pending`, FIFO), mas drena ao longo de
**vários minutos** — os últimos pacientes esperam minutos pela 1ª resposta. Isso é "200
enfileirados, atendidos aos poucos", não "200 atendidos ao mesmo tempo".

## Como o processamento funciona hoje (verificado no código + banco de produção)

| Fato | Fonte |
|---|---|
| 3 cron jobs `process-inbox-a/b/c`, todos `* * * * *`, escalonados com `pg_sleep(20)`/`pg_sleep(40)` → fila varrida **a cada ~20s** (não a cada 2s; o comentário no topo do worker está desatualizado) | `cron.job` em produção + `migrations/20260326_inbox_advisory_lock_and_cron.sql` |
| Cada invocação puxa **todas** as conversas pendentes (**sem `.limit()`**), dedup por `(tenant, phone)` | `process-inbox/index.ts:54-77` |
| Processa as conversas **sequencialmente** num `for` loop — um turno de IA completo por vez | `process-inbox/index.ts:81-104` |
| Lock por telefone (lease com TTL 120s) impede que as ≤3 invocações sobrepostas colidam no mesmo paciente | `process-inbox/index.ts:133-140` + `migrations/20260716c_conversation_lock_lease.sql` |
| Cada turno de IA = 1 chamada Haiku (triagem) + 2-4 chamadas Sonnet (loop de ferramentas), ~5-15s de relógio | `copilot.ts` `runAutonomousAgent` (loop `MAX_TOOL_ROUNDS=4`) |
| Retry de API: **1 único retry fixo de 1,5s**, sem backoff exponencial, sem `retry-after` | `_shared/llmProvider.ts:178-185` |

## Os três tetos, por severidade

### 1. Throughput por tick + timeout do edge function — **gargalo principal**

Uma invocação processa conversas em série. Edge functions do Supabase têm limite de relógio
(~150-400s conforme o plano). A ~10s/turno, **uma invocação dá conta de ~15-40 conversas antes de
ser morta por timeout**. Com 3 jobs/min + o lease espalhando trabalho entre as invocações
sobrepostas, o throughput de regime fica na ordem de **dezenas de conversas por minuto** — não 200
em segundos.

- **Efeito num burst de 200:** fila drena em minutos; p95 da 1ª resposta na casa de minutos para os
  últimos da fila. Sem perda de mensagem (FIFO por `received_at`).
- **Números acima são estimativas** — só um teste de carga confirma o real.

### 2. Rate limit da API Anthropic + retry fraco — **teto duro da paralelização real**

Se o worker paralelizasse, 200 turnos concorrentes = **600+ chamadas Sonnet + 200 Haiku** num burst.
O rate limit da conta (RPM/TPM por tier) limita isso. E o retry atual (1 retry fixo de 1,5s, sem
backoff, sem `retry-after`) **não recupera de 429 sustentado** — que é exatamente o que um burst
causa. Chamadas falham → agente cai em handoff humano (fail-safe **correto**, mas não é "IA
atendeu").

- **Mitigação que já existe:** prompt caching (~77% de economia de input) alivia muito o **TPM** —
  mas **não ajuda no RPM** (número de requisições).
- **Incógnita crítica:** o **tier da conta Anthropic** (RPM/TPM) é *o* número que define o teto de
  paralelismo. Sem ele, não dá para prometer nenhum "N simultâneos".

### 3. Mensagens presas em `processing` num kill por timeout — **gap de recuperação**

Mensagens viram `processing` no início do turno (`process-inbox/index.ts:160-165`); a limpeza para
`failed` só roda em **exceção capturada** (`index.ts:86-103`), não num kill de relógio. Num timeout
duro, elas ficam presas em `processing` até a limpeza de 24h. O **lease TTL cura o lock** sozinho em
120s, mas **não a mensagem**.

## Dimensão multi-tenant (vários tenants ao mesmo tempo)

A preocupação "todos os tenants terão seu AI Agent atendendo simultaneamente" se separa em duas
questões com respostas **opostas**:

### Isolamento entre tenants (correção) — ✅ sólido

Não há vazamento cruzado. Cada turno carrega `tenants`/`bot_config`/`clinic_info`/sessão/mensagens
**filtrados por `tenant_id`** (`process-inbox/index.ts:144-197`). O **prompt cache é por-tenant** — o
`cachePrefix` inclui persona+instruções+conhecimento daquele tenant, então o cache de um nunca é
servido a outro (garantido por teste em `unit_test.ts`: *"instructions/knowledgePacket diferentes →
cachePrefix diferente (não sobrepõe tenants distintos)"*). O eval `confused_deputy_multimodal` prova
que mídia alegando outro `tenant_id` não faz o agente agir cross-tenant. **50 tenants concorrentes não
se contaminam.**

### Justiça sob carga (throughput) — ⚠️ gap real, com solução já pronta no repo

O `process-inbox` usa **FIFO global por `received_at`, sequencial, sem cap por tenant**
(`index.ts:54-104`). Um tenant grande (200 mensagens) **empurra os pacientes de um tenant pequeno para
trás da fila** — *head-of-line blocking* (vizinho barulhento). O pequeno é atendido, mas com latência
inflada pela lotação do grande.

**Ponto-chave:** o processador de **saída** já resolveu exatamente isso —
`migrations/20260701_outbound_fair_claim.sql`, RPC `claim_outbound_messages`, que numa única chamada
atômica faz: (1) reaper de `processing` preso >5min → `pending`; (2) `FOR UPDATE SKIP LOCKED` (claim
sem contenção); (3) **cap por tenant** via `row_number() OVER (PARTITION BY tenant_id)` + `rn <= cap`
(um tenant grande nunca trava os pequenos). O lado de **entrada não tem equivalente** — usa o padrão
antigo (SELECT + lease por telefone) que o próprio outbound diz ter substituído. Portanto o hardening
de justiça multi-tenant **não é especulativo: é portar a RPC de fair-claim que já roda em produção na
saída.**

## O que isso NÃO é

- **Não é alucinação sob carga.** A qualidade de raciocínio é por-conversa e independente do volume.
  Os validadores (preço, horário inventado, deriva de idioma, promessa clínica) rodam por turno,
  igual com 1 ou 200 pacientes.
- **Não é perda de mensagem.** A fila é durável (`message_inbox`, FIFO por `received_at`); o pior
  caso é latência, não silêncio — exceto o gap #3 (mensagem presa em `processing` sob timeout duro).
- **Não é bug do dial/gate.** Gate de prontidão (endereço/horário/fee/serviços/vínculos) e roteamento
  soft/hard handoff estão corretos e verificados.

## Incógnitas (precisam ser respondidas antes de prometer um número)

1. **Tier da API Anthropic** (RPM e TPM). — determina o teto de paralelismo real.
2. **Plano Supabase**: limite de relógio e de concorrência de edge functions.
3. **Comportamento real sob carga** — só um teste de carga mede.

## Plano de hardening (quando for a hora)

Ordem sugerida — do maior ganho/menor risco para o mais estrutural:

1. ✅ **FEITO (2026-07-21)** — **Fair-claim por tenant no inbox**. RPC `claim_inbox_conversations`
   (`migrations/20260722130000_inbox_fair_claim.sql`) + `process-inbox/index.ts`: reaper de
   `processing` preso >5min (fecha o **gap #3**), **cap por tenant** via window function (mata o
   **head-of-line blocking** multi-tenant) e **limite de lote** + **orçamento de relógio de 100s** (o
   worker não morre mais no timeout deixando mensagem presa). Trava de segurança: RPC `SECURITY
   DEFINER` com EXECUTE só para `service_role` (REVOKE explícito de anon/authenticated). Provado com
   dados sintéticos (tenant grande capado, pequeno incluído) e smoke-testado em produção. **Não
   inclui** o claim exclusivo com `SKIP LOCKED` — mantém o lease-lock por conversa existente; a
   paralelização real fica no item 2.
2. ✅ **FEITO (2026-07-21)** — **Paralelizar o loop com concorrência limitada**. Extraído em
   `_shared/concurrencyPool.ts` (`runWithConcurrencyLimit`, testado isoladamente: 5 testes cobrindo
   teto nunca excedido, orçamento sem abandonar trabalho em voo, falha isolada). `process-inbox`
   agora roda `WORKER_CONCURRENCY` conversas em voo por invocação (default **5**, conservador —
   configurável via Supabase Secret `INBOX_WORKER_CONCURRENCY` sem novo deploy, para subir junto com
   o item 4). Conversas distintas `(tenant, phone)` já não têm contenção entre si (lease-lock é por
   conversa), então isso é ganho de throughput puro, sem novo risco de corrida. **Bug adjacente
   corrigido no caminho:** `message_inbox.status` nunca aceitava `'failed'` no CHECK constraint — o
   catch de erro do turno tentava gravar esse valor há tempos e a violação era engolida
   silenciosamente, deixando a mensagem presa até o reaper (item 1) resgatar. Ampliado o constraint
   (`migrations/20260722140000`).
3. **Backoff exponencial + jitter + honrar `retry-after`** em 429/5xx (`_shared/llmProvider.ts:178-185`),
   com mais de 1 tentativa. Transforma o degrade de "handoff em massa" em "espera curta e recupera".
   Baixo risco, alto valor sob burst.
4. **Confirmar/subir o tier da API Anthropic** e/ou aplicar um **limitador de RPM** central antes de
   disparar chamadas (semáforo por processo/tenant). Sem isso, os itens 2 e 3 só empurram o teto para
   o rate limit da conta.
5. **(Estrutural, opcional)** trocar o modelo poll-cron por **fila orientada a evento** (webhook →
   enfileira → worker consome com concorrência controlada) e/ou **mais frequência de cron**. Maior
   ganho de latência, maior esforço.

## Plano de teste de carga (para medir, não adivinhar)

Script que dispara **N webhooks de inbound simultâneos** (N ∈ {50, 100, 150, 200}) para o tenant de
teste e mede:

- **Tempo de drenagem da fila** (do 1º ao último `message_inbox` marcado `done`).
- **Latência da 1ª resposta** p50 / p95 / p99 por paciente.
- **Taxa de 429** nas chamadas Anthropic (via logs do `llmProvider` / `ai_usage_logs`).
- **Mensagens presas** em `processing` ao fim do teste.
- **Handoffs disparados por falha** (proxy de degrade sob carga) via `agent_turn_events`.

Rodar **antes e depois** do hardening para provar o ganho com número, não com narrativa.

## Recomendação

Para o **teste de fogo comportamental agora** (poucos pacientes, validar o atendimento ponta-a-ponta
como o cliente reclamou): **liberado** — a qualidade está verde e o caminho feliz funciona. Para
**abrir para volume real de clínica cheia (50-200 simultâneos)**: executar o hardening acima
(itens 1-5 no mínimo) e o teste de carga antes, com o tier da Anthropic confirmado.
