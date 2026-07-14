# SPEC — Tela "Hoje" (Centro de Comando do Atendente)

> **Frase-norte do produto:** *"o que minha equipe faz agora e quanto dinheiro isso está gerando."*
> A tela Hoje é a resposta à primeira metade dessa frase. Ela é a nova tela inicial da plataforma.

---

## 1. Objetivo e princípio de design

**Objetivo:** ao logar, o atendente vê filas acionáveis — não gráficos, não features. Zerar as filas = dia bem feito.

**Princípio central — agregador, não duplicador.** As superfícies operáveis já existem (WorkQueue/FollowUpBoard, Human Inbox, Agenda, Recepção, Waitlist). A tela Hoje **conta, prioriza e roteia** para elas em 1 clique, e só resolve inline as ações de 1 toque que já têm backend pronto (disparar confirmação, enviar recovery, notificar waitlist). Nenhuma lógica de negócio nova na tela; nenhuma segunda implementação de fila.

**Anti-requisitos:** sem gráficos pesados, sem tabela de campanhas, sem métricas de vaidade. Tudo que aparece deve responder "o que eu faço agora?" ou "como está minha meta?".

---

## 2. Acesso e navegação

- Novo `activeScreen: 'today'` em [App.tsx](../src/App.tsx) e novo item **no topo** do menu em [DashboardLayout.tsx](../src/layouts/DashboardLayout.tsx).
- **Vira a tela default** (substitui `'agenda'` como fallback do `activeScreen` inicial).
- Visibilidade por papel (via RoleManagement existente):
  - **Atendente/Recepção:** vê tudo exceto o bloco de metas financeiras (vê meta de agendamentos/comparecimento).
  - **Dono/Admin:** vê tudo, incluindo metas financeiras.
  - **Clínico:** não é o público-alvo; se acessar, vê apenas F6 (agenda do dia) — não bloquear, só filtrar filas.

---

## 3. Layout (obrigatório seguir [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md))

Página padrão com scroll: wrapper `px-6 lg:px-12 py-8`. Fundo `bg-ice-50`. Cards `bg-white border border-ice-100 rounded-3xl shadow-sm`; sub-cards `rounded-2xl`; botões pequenos `rounded-xl`. Cor de destaque **sempre** `brand-primary` (dinâmica por tenant) — nunca paleta hardcoded, exceto cores de canal (verde WhatsApp etc.).

```
┌──────────────────────────────────────────────────────────────┐
│ Saudação + data (fuso do tenant)         [Atualizar] [○ live]│
├──────────────────────────────────────────────────────────────┤
│ METAS DO MÊS (strip horizontal, 2–3 barras de progresso)     │
├──────────────────────────────────────────────────────────────┤
│ FILAS — grid content-aware (não esticar a 100%; card-grid    │
│ 2 col ≥lg, 1 col mobile; fila vazia = card compacto ✓)       │
│ ┌────────────────────────┐  ┌────────────────────────┐       │
│ │ F1 Aguardando humano ⏱ │  │ F2 Confirmações        │       │
│ ├────────────────────────┤  ├────────────────────────┤       │
│ │ F3 Faltas a recuperar  │  │ F4 Follow-ups vencidos │       │
│ ├────────────────────────┤  ├────────────────────────┤       │
│ │ F5 Vaga p/ waitlist    │  │ F6 Agenda de hoje      │       │
│ └────────────────────────┘  └────────────────────────┘       │
├──────────────────────────────────────────────────────────────┤
│ PULSO DO DIA (linha discreta de números, sem gráfico)        │
└──────────────────────────────────────────────────────────────┘
```

**Anatomia de um card de fila:** título + ícone; **contador grande** (o número é o herói); até **3 itens de preview** (nome do paciente + linha de motivo + ação de 1 clique); rodapé "Ver todos (N) →" roteando para a superfície completa. Fila zerada: card encolhe para estado "em dia" com check discreto (`text-graphite-400`) — nunca desaparece (o vazio comunica "está tudo bem", que é informação).

**Ordenação dos cards:** fixa (F1→F6), não reordenar dinamicamente — previsibilidade espacial vale mais que ranking.

---

## 4. As filas — contratos de dados e ações

> ⚠️ **Antes de implementar cada query, validar colunas contra o schema de produção** (histórico do projeto: os `.sql` do repo divergem do banco real — ex.: assinatura do `book_appointment`, `patients.metadata` inexistente).

### F1 — Conversas aguardando humano (SLA) — a fila mais urgente
- **Fonte:** `conversation_sessions` com `omnichannel_status = 'queued'` (+ `unread_count` de `human_active` atribuídas ao usuário logado, como linha secundária).
- **Motivo exibido:** tempo de espera desde a entrada na fila. Semáforo: `<5min` neutro · `5–15min` âmbar · `>15min` vermelho pulsante (o SLA é o produto aqui).
- **Ação primária:** abrir Human Inbox direto na sessão (deep-link; hoje via `onNavigate('inbox')` + estado de sessão selecionada — expor prop/param de sessão inicial no HumanInboxPage).
- **Ordenação:** espera mais longa primeiro.
- **Realtime:** assinar o canal já usado pelo Inbox para `conversation_sessions`.

### F2 — Confirmações pendentes (hoje + amanhã)
- **Fonte:** `appointments` na janela [hoje, amanhã] no fuso do tenant, com status agendado e sem confirmação registrada. **(Validar no schema real qual coluna representa confirmação — status vs. campo dedicado — antes de codar.)**
- **Ação primária:** "Confirmar via…" → abre o **seletor de canal multi-canal já existente** (WA/Meta/SMS/E-mail, `target_channel` no `send-human-message`). Ação em lote: "Enviar todas" respeitando o canal default do tenant (`default_notification_channel`).
- **Restrição de fuso:** respeitar a janela de envio do tenant — **nunca alterar `tenants.timezone`**; fora da janela, agendar para a próxima janela + toast informativo (regra já estabelecida no projeto).
- **Ordenação:** horário da consulta ascendente.

### F3 — Faltas a recuperar
- **Fonte:** `crm_journeys` com `stage_id = 'recovery'` e `needs_action = true` (o motor de recovery já move jornadas para cá; `no_show_count` disponível para a linha de motivo).
- **Ação primária:** "Recuperar" → dispara o recovery template do estágio adequado (imediato/48h/7d — backend pronto) pelo canal configurado em `channel_automations.*.recovery`. Sucesso: `crm_move_stage()` (porta única de movimentação — **nunca** update direto no stage).
- **Ação secundária:** abrir a jornada no FollowUpBoard.

### F4 — Follow-ups vencidos (leads esfriando)
- **Fonte:** o estrato **`due`** do WorkQueue: `crm_journeys` abertas com `needs_action = true` OU `next_action_at <= now`, ordenadas por `priority_score` desc — **exatamente a lógica de [WorkQueue.tsx](../src/components/crm/WorkQueue.tsx)**.
- **Refactor obrigatório:** extrair a estratificação (`due/scheduled/quiet`, `isDue`, `reasonFor`) para um hook compartilhado `useWorkQueueStrata` consumido pelo WorkQueue e pela tela Hoje — uma fonte de verdade, dois consumidores. Proibido copiar/colar a lógica.
- **Ação primária:** rodapé roteia para FollowUpBoard em modo "ação"; itens de preview abrem a jornada/conversa (mesmos handlers do WorkQueue).
- **Nota de futuro:** quando o módulo de Orçamentos existir, "orçamentos parados" entra como estágio/filtro desta mesma fila — não criar card separado agora.

### F5 — Vaga para a lista de espera
- **Fonte:** cruzamento de cancelamentos do dia com entradas ativas da waitlist (`waitlistService`; lembrar: `process-waitlist` só notifica entradas com `doctor_id` preenchido — exibir as sem médico como "atribuir médico" em vez de escondê-las).
- **Ação primária:** "Oferecer vaga" → aciona o fluxo de notificação da waitlist existente.

### F6 — Agenda de hoje (resumo passivo)
- **Fonte:** `appointments` de hoje no fuso do tenant: próximos 3 pacientes + contadores (total, realizados, aguardando).
- **Ação:** rotear para Recepção (check-in) ou Agenda. Sem ações inline — este card é orientação, não fila.

---

## 5. Metas do mês (strip)

**MVP sem tabela nova:** metas em `tenants.settings` (JSON) — `monthly_goals: { appointments: number, revenue: number, show_rate: number }` — editáveis em Configurações (seção "Metas"). Se `settings` não comportar, criar tabela `tenant_goals` (decisão na implementação, com base no schema real).

- **Meta de agendamentos:** agendados no mês corrente ÷ meta → barra de progresso `brand-primary`.
- **Taxa de comparecimento:** realizados ÷ (realizados + faltas) no mês → comparada à meta.
- **Meta de faturamento** (visível só para admin/dono): quando o caixa gateway-agnóstico existir, soma dos recebimentos; até lá, ocultar a barra (não mostrar zero — mentira visual).
- Sem meta configurada: CTA discreto "Definir metas →" (roteia para Configurações) — **primeiro empty-state que ensina o fluxo**.
- Mês corrente = mês no **fuso do tenant**.

## 6. Pulso do dia (rodapé)

Linha única de números discretos (sem cards, sem gráficos): consultas hoje · comparecimentos · novos leads hoje · conversas resolvidas hoje. Tipografia pequena, `text-graphite-500`, valores `tabular-nums`. É contexto, não chamada para ação.

---

## 7. Dados: serviço agregador

Novo `src/services/todayService.ts`:

```ts
getTodaySnapshot(tenantId): Promise<{
  queues: {
    humanQueue:    { count: number; items: QueuePreviewItem[] }   // top 3
    confirmations: { count: number; items: QueuePreviewItem[] }
    recovery:      { count: number; items: QueuePreviewItem[] }
    followUps:     { count: number; items: QueuePreviewItem[] }
    waitlistSlots: { count: number; items: QueuePreviewItem[] }
  }
  todayAgenda: { total: number; done: number; next: AgendaPreview[] }
  goals: { appointments?: GoalProgress; showRate?: GoalProgress; revenue?: GoalProgress }
  pulse: { appointmentsToday: number; showsToday: number; newLeadsToday: number; resolvedToday: number }
}>
```

- Counts via `select('*', { count: 'exact', head: true })`; previews com `limit(3)` — **nunca** carregar listas inteiras.
- Refresh: realtime para F1 (canal do Inbox) + refetch on focus + polling de 60s para o resto. Botão manual de atualizar no header.
- Toda janela "hoje/amanhã" calculada com `getTenantTodayString`/`getTenantNow` ([timezoneUtils](../src/lib/timezoneUtils.ts)). ⚠️ **Gotcha documentado:** o `Date` de `getTenantNow` **já vem deslocado** — nunca reformatar com `timeZone` de novo.

---

## 8. i18n — plataforma multi-idiomas (pt-BR, en, es)

1. **Novo namespace `today`**: criar `src/locales/{pt-BR,en,es}/today.json` e registrar no config do i18n junto aos demais namespaces. Os três arquivos entram **no mesmo PR** — nenhuma chave sem as três traduções.
2. ⚠️ **Bug recorrente do projeto:** com `useTranslation('today')`, chamar `t('queues.humanQueue.title')` — **nunca** `t('today.queues.humanQueue.title')` (prefixo repetido já causou bug em 11 arquivos).
3. **Plurais via i18next** (`_one`/`_other`), nunca concatenação ou template literal com "s":
   ```json
   "queues": {
     "humanQueue":    { "title": "Aguardando atendimento", "waiting_one": "{{count}} paciente esperando", "waiting_other": "{{count}} pacientes esperando", "reason": "Esperando há {{time}}" },
     "confirmations": { "title": "Confirmações pendentes", "action": "Confirmar via…", "bulkAction": "Enviar todas" },
     "recovery":      { "title": "Faltas a recuperar", "reason_one": "{{count}} falta", "reason_other": "{{count}} faltas", "action": "Recuperar" },
     "followUps":     { "title": "Follow-ups vencidos", "action": "Abrir fila" },
     "waitlist":      { "title": "Vaga para lista de espera", "action": "Oferecer vaga", "noDoctor": "Atribuir profissional" },
     "agenda":        { "title": "Agenda de hoje", "progress": "{{done}} de {{total}} realizadas" },
     "allClear": "Tudo em dia", "viewAll": "Ver todos ({{count}})"
   },
   "greeting": { "morning": "Bom dia, {{name}}", "afternoon": "Boa tarde, {{name}}", "evening": "Boa noite, {{name}}" },
   "goals": { "title": "Metas do mês", "appointments": "Agendamentos", "showRate": "Comparecimento", "revenue": "Faturamento", "setup": "Definir metas" },
   "pulse": { "appointments": "consultas hoje", "shows": "comparecimentos", "newLeads": "novos leads", "resolved": "conversas resolvidas" }
   ```
   (Estrutura de referência com copy pt-BR; en/es traduzidos na implementação.)
4. **Datas/horas/tempo relativo:** exclusivamente via `useLocaleFormat` (`formatDate`, `formatDateTime`) — nunca `toLocaleString` manual. "Esperando há X" com unidade traduzida por chave, não string montada.
5. **Moeda** (meta de faturamento): via `useTenantCurrency`/`formatDual`, como nas demais telas.
6. **Saudação por período:** derivar de `getTenantNow` (fuso do tenant, não do navegador).
7. Rótulos de estágio/ação do CRM reutilizam as chaves existentes do namespace `crm` (`CRM_STAGE_LABEL_KEYS`, `NEXT_ACTION_LABEL_KEYS`) — não duplicar no `today`.

---

## 9. Componentes

```
src/pages/TodayPage.tsx            // composição da tela
src/components/today/QueueCard.tsx // card genérico (título, count, 3 previews, ação, empty)
src/components/today/GoalsStrip.tsx
src/components/today/PulseRow.tsx
src/hooks/useTodaySnapshot.ts      // fetch + realtime + polling
src/hooks/useWorkQueueStrata.ts    // extraído do WorkQueue (F4) — fonte única
src/services/todayService.ts
```

Reutilizar `Badge`, `Button`, `IconButton`, `EmptyState` de `components/ui` — não criar variantes novas.

---

## 10. Critérios de aceite

1. Login de atendente cai na tela Hoje; cada pergunta operacional ("quem espera resposta?", "quem faltou?", "quem confirma amanhã?") tem resposta visível **sem nenhum clique**.
2. Toda ação inline usa backend existente (seletor de canal, recovery template, waitlist notify, `crm_move_stage`) — zero lógica de negócio nova na tela.
3. F4 e o WorkQueue exibem exatamente os mesmos itens "due" (mesma fonte via `useWorkQueueStrata`).
4. Troca de idioma (pt-BR/en/es) traduz 100% da tela, incluindo plurais e tempos relativos; nenhuma chave com prefixo de namespace repetido.
5. Tenant em fuso ≠ do navegador: "hoje/amanhã", saudação e janela de confirmação seguem o fuso do **tenant**; envio fora da janela é agendado + toast (timezone jamais alterado).
6. Todas as filas zeradas → estado "tudo em dia" (cards compactos com check), nunca tela em branco.
7. Sem meta configurada → CTA "Definir metas", sem barras zeradas falsas.
8. Layout segue DESIGN_SYSTEM.md (ice/graphite/brand-primary, radius 3xl/2xl/xl, shadow-sm) e é content-aware (cards não esticados artificialmente).

## 11. Fora de escopo (desta entrega)

- Fila de orçamentos parados (entra com o módulo de Orçamentos, dentro de F4).
- Meta/números de faturamento reais (dependem do caixa gateway-agnóstico).
- Reorganização completa do menu por grupos (entrega separada do P0; aqui só se adiciona o item "Hoje" no topo e muda o default).
- Rotas react-router (P1).
