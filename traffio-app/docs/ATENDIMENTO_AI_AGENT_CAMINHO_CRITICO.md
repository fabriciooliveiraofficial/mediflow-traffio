# Caminho crítico: o AI Agent atende (não deixe quebrar)

> **Por que este documento existe:** o atendimento automático pelo AI Agent é a
> razão nº 1 pela qual os tenants contratam a plataforma. Ele quebrou em produção
> **duas vezes em 2026-07-22/23** por mudanças adjacentes — conversas ficaram em
> "Aguardando" no inbox sem a IA responder. Este doc mapeia o caminho, os modos
> de falha e as **guardas** que protegem contra regressão. Leia antes de mexer em
> `process-inbox`, no roteamento de handoff, ou no cron.

## O fluxo, do WhatsApp à resposta da IA

1. **`whatsapp-bot`** (webhook) recebe a mensagem e a insere em `message_inbox`
   (status `pending`). Rápido, sem IA.
2. **Cron do Postgres** dispara a Edge Function **`process-inbox`** a cada ~20s
   (3 jobs `process-inbox-a/b/c` escalonados com `pg_sleep` 0/20/40).
3. **`process-inbox`** reivindica as pendentes (RPC `claim_inbox_conversations`),
   funde a rajada num turno, e **roteia**:
   `structuredFlow` (determinístico) → **AI Agent autônomo** (`ai_always`) → fila humana.
4. Se roteou para a IA: **`runAutonomousAgent`** gera a resposta e a envia; marca a
   sessão `omnichannel_status='bot_active'`.

## A regra de atendimento (o invariante de receita)

**O AI Agent autônomo responde ⇔ `dial === 'ai_always'` E a sessão NÃO está em
handoff estrito (`isHardHandoffSession === false`).**

- Isolada na função pura **`isAutonomousAgentTurn(activeAgent, session)`**
  (`_shared/sessionManager.ts`) e usada no roteamento de `process-inbox`.
- **Travada por teste:** `_tests/evals/agent_attendance_guard_test.ts` (10 casos).
  Se algum ficar vermelho, o atendimento vai quebrar — **não suba**.

Consequência que mais confunde: uma conversa em **`queued` / "Aguardando"** com
`human_handoff=false` (ninguém assumiu) **NÃO é hard handoff** → a IA **deve**
atender. "Aguardando" no inbox é só o estado transitório entre a mensagem chegar
e a IA responder (~10-25s). O botão "Assumir" fica disponível de propósito mesmo
com a IA ativa (`bot_active`), para um humano poder tomar a conversa se quiser —
isso **não** significa que a IA foi pulada.

## Os dois modos de falha já vistos (e como evitar)

### 1. Trigger do cron quebrado → `process-inbox` nunca roda → mensagens presas em `pending`

Sintoma: conversa fica "Aguardando" e a IA nunca responde; `message_inbox` acumula
`pending`. **Causa raiz (2026-07-22/23):** os jobs `process-inbox-a/b/c` reais em
produção usam **URL fixa + `service_role_key` JWT embutido** no comando (igual aos
jobs `process-outbound`), **NÃO** a GUC `current_setting('app.supabase_functions_url')`
que aparece no arquivo de migration `20260326` (desatualizado; a GUC nunca foi
setada). Recriar os jobs via `db query` copiando o texto GUC do migration →
falham silenciosamente com `unrecognized configuration parameter`.

- **NÃO** recrie os jobs de `process-inbox` com o padrão GUC. Se precisar recriá-los,
  **derive o comando do job `process-outbound-every-minute` que funciona**:
  `replace(command, '/process-outbound', '/process-inbox')`.
- **Diagnóstico:** `SELECT jobname, status, return_message FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid WHERE jobname LIKE 'process-inbox%' ORDER BY start_time DESC LIMIT 6;` — se `failed` com "unrecognized configuration parameter", é isto.
- **Mitigação de emergência (processa a fila uma vez):**
  `curl -X POST https://<project-ref>.supabase.co/functions/v1/process-inbox -H "Authorization: Bearer <ANON_KEY>"` — a anon key (pública, no `.env` do frontend) satisfaz o `verify_jwt=true`; a função usa seu próprio `service_role` interno.

### 2. Roteamento manda para a fila humana o que deveria ser da IA

Sintoma: `process-inbox` roda, mas a conversa cai calada na fila humana. **Causa:**
regressão em `isHardHandoffSession` / `isAutonomousAgentTurn` / na condição de
roteamento. **Guarda:** os testes em `agent_attendance_guard_test.ts` travam a
matriz (queued sem assumir → IA atende; hard/human_active → humano; dial não-ai →
humano). Mexeu na regra? Atualize os testes conscientemente — eles são o contrato.

## Regras de trabalho (não afrouxar)

- Alterou `process-inbox` (roteamento), `isHardHandoffSession`, `isAutonomousAgentTurn`,
  a persona (`SALES_PERSONA`) ou as ferramentas → rode `npx deno test -A _tests/`
  (inclui as guardas) **e** os evals de integração (`run.ts` + `conversation.ts`)
  ANTES do deploy. Vermelho = não sobe.
- **Nunca** recrie os pg_cron jobs de `process-inbox` via `db query` com o padrão GUC.
- Deploy que toca `copilot.ts` → `process-inbox` **e** `whatsapp-bot` (ambos o
  empacotam).
