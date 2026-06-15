# Analytics Pro — Overhaul "World Class" (filtros, métricas por campanha, exportação)

**Data:** 2026-06-15
**Status:** Implementação completa no código. **Pendente: rodar SQL no Supabase + deploy.**

---

## Resumo do que mudou

1. **Filtro de período corrigido** — antes o estado `period` não tinha `setter` e o botão de calendário não abria dropdown nenhum. Agora existe um dropdown real: *Hoje / Últimos 7 Dias / Últimos 30 Dias / Personalizado* (com dois `<input type="date">`).
2. **Filtro de plataforma corrigido** — antes `activeTab` ('Todas/Meta/Google') só afetava o gráfico. Agora afeta **KPIs, gráfico e tabela de campanhas**.
3. **Novo filtro de campanha** — dropdown com as campanhas presentes no período/plataforma selecionados.
4. **Novos KPIs nativos das plataformas**: Impressões, Cliques, CTR, CPC, CPM, CPA (custo por conversão).
5. **Seletor de métrica do gráfico**: Leads / Gasto / Impressões / Cliques / Conversões / CTR / CPC / CPM.
6. **Nova tabela "Performance por Campanha"**: granularidade por campanha (Meta/Google), com 11 colunas ordenáveis (Gasto, Impressões, Cliques, CTR, CPC, CPM, Conversões, CPA, ROAS).
7. **Exportação de relatórios** em **PDF** (jsPDF + autoTable) e **Excel** (SheetJS/xlsx), com os dados já filtrados (KPIs + tabela de campanhas).

Para suportar granularidade por campanha, `ad_performance_daily` precisa de 3 colunas novas (`ad_account_id`, `campaign_id`, `campaign_name`) e uma UNIQUE constraint atualizada. A tabela está **vazia em produção** (confirmado no diagnóstico anterior), então essa é uma alteração aditiva sem risco de migração de dados.

---

## Fase A — Migration de banco (RODAR NO SQL EDITOR DO SUPABASE)

Arquivo: `supabase/migrations/20260615_ad_performance_campaign_breakdown.sql` (já criado no repo).

➡️ **Copie e rode o bloco abaixo no SQL Editor do Supabase (projeto `fyyhxmugxcfqhvoevuwf`) ANTES do deploy das Edge Functions:**

```sql
-- Migration: Campaign-level breakdown for ad_performance_daily
-- ad_performance_daily está vazia em produção (confirmado via diagnóstico) — alteração aditiva, sem dados a migrar.

ALTER TABLE public.ad_performance_daily
  ADD COLUMN IF NOT EXISTS ad_account_id TEXT,
  ADD COLUMN IF NOT EXISTS campaign_id TEXT,
  ADD COLUMN IF NOT EXISTS campaign_name TEXT;

-- Substitui a UNIQUE (tenant_id, platform, date) por (tenant_id, platform, date, campaign_id)
-- para permitir múltiplas campanhas por dia/plataforma.
DO $$
DECLARE
  cname text;
BEGIN
  SELECT tc.constraint_name INTO cname
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'ad_performance_daily'
    AND tc.constraint_type = 'UNIQUE'
  GROUP BY tc.constraint_name
  HAVING array_agg(kcu.column_name::text ORDER BY kcu.ordinal_position) = ARRAY['tenant_id','platform','date'];

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.ad_performance_daily DROP CONSTRAINT %I', cname);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'ad_performance_daily'
      AND constraint_name = 'ad_performance_daily_tenant_platform_date_campaign_key'
  ) THEN
    ALTER TABLE public.ad_performance_daily
      ADD CONSTRAINT ad_performance_daily_tenant_platform_date_campaign_key
      UNIQUE (tenant_id, platform, date, campaign_id);
  END IF;
END $$;
```

Esse script:
- Adiciona `ad_account_id`, `campaign_id`, `campaign_name` (todas `TEXT`, nullable).
- Detecta dinamicamente o nome da UNIQUE constraint existente `(tenant_id, platform, date)` e a remove (qualquer que seja seu nome).
- Cria a nova UNIQUE `(tenant_id, platform, date, campaign_id)`, usada pelo `onConflict` do `sync-ads-performance` reescrito.
- É idempotente — pode ser executado novamente sem erro.

---

## Fase B — `sync-ads-performance` reescrita (granularidade por campanha)

Arquivo: `supabase/functions/sync-ads-performance/index.ts`.

- **Meta Ads**: troca de `/insights` agregado para `level=campaign&fields=campaign_id,campaign_name,spend,impressions,clicks,actions&time_increment=1&date_preset=last_30d`. Uma linha por campanha/dia. `conversion_count`/`leads_count` = soma de `actions[].value` cujo `action_type` esteja em `['lead','onsite_conversion.lead_grouped','offsite_conversion.fb_pixel_lead']` (helper `sumMetaActions`). `revenue_cents = conversion_count * 15000` (mantém estimativa de R$150/conversão).
- **Google Ads**: GAQL agora seleciona `campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date DURING LAST_30_DAYS`. Uma linha por campanha/dia. `revenue_cents = conversion_count * 18000` (mantém estimativa de R$180/conversão).
- Upsert agora usa `onConflict: "tenant_id,platform,date,campaign_id"` e grava `ad_account_id`, `campaign_id`, `campaign_name`.
- **Demo data** (usado quando as credenciais Meta/Google são placeholders): gera 2 campanhas fictícias por plataforma nos últimos 7 dias, para a tabela/filtro de campanhas terem conteúdo também no modo demo:
  - Meta: "Campanha — Implantes", "Campanha — Clareamento Dental"
  - Google: "Pesquisa — Ortodontia", "Pesquisa — Avaliação Gratuita"

Toda a lógica preexistente (CORS, `OPTIONS`, `getGoogleCred` com fallback para `master_config`, refresh de token do Google, tratamento de erro/`last_sync_error`) foi preservada.

---

## Fase C — Frontend (`src/pages/Dashboard.tsx`)

### Filtros (header + barra de filtros)
- **Período**: dropdown funcional — Hoje / Últimos 7 Dias / Últimos 30 Dias / Personalizado (com seletor de datas). Default: Últimos 30 Dias.
- **Plataforma**: segmented control Todas / Meta / Google — agora afeta tudo (KPIs, gráfico, tabela).
- **Campanha**: novo dropdown, populado dinamicamente a partir das campanhas presentes no período/plataforma selecionados.

### KPIs
- **Linha 1** (existente, agora respeitando os filtros): Leads Totais, Conversão CRM, Gasto Ads, ROAS Médio.
- **Linha 2** (nova): Impressões, Cliques, CTR, CPC, CPM, CPA — métricas nativas das plataformas de anúncios.

### Gráfico "Evolução de Tráfego"
- Novo seletor de métrica: Leads / Gasto / Impressões / Cliques / Conversões / CTR / CPC / CPM.
- Mantém as duas séries (Meta azul / Google verde), agora calculadas conforme a métrica escolhida e os filtros ativos.

### Nova seção "Performance por Campanha"
- Tabela com 11 colunas: Campanha, Plataforma, Gasto, Impressões, Cliques, CTR, CPC, CPM, Conversões, CPA, ROAS.
- Cabeçalhos clicáveis para ordenação (asc/desc).
- Agregada por campanha dentro do período/plataforma/campanha filtrados.

### Exportação de relatórios
- Botão **PDF** (ícone vermelho): gera relatório com cabeçalho (clínica, período, data de geração), tabela de resumo de KPIs e tabela completa de campanhas (jsPDF + jspdf-autotable).
- Botão **Excel** (ícone verde): gera `.xlsx` com abas "Resumo" (KPIs) e "Campanhas" (tabela completa) via SheetJS (`xlsx`).
- Ambos operam sobre os dados **já filtrados** pelos filtros ativos (período/plataforma/campanha).

### Estratégia de fetch
- `fetchDashboardData` busca sempre os **últimos 90 dias** de `ad_performance_daily` (cobre Hoje/7d/30d sem refetch).
- Um `useEffect` adicional, ativo apenas quando `period === 'custom'` e a data inicial do range escolhido é anterior a 90 dias, faz um fetch complementar e funde os resultados (dedup por `platform::date::campaign_id`).

### Novas dependências
`jspdf@4.2.1`, `jspdf-autotable@5.0.8`, `xlsx@0.18.5` — instaladas via `npm install jspdf jspdf-autotable xlsx` (já refletido em `package.json`).

> **Nota de segurança**: `xlsx@0.18.5` (SheetJS via npm) tem CVEs conhecidas de prototype-pollution/ReDoS relacionadas à **leitura/parsing** de arquivos `.xlsx` não confiáveis. Nosso uso é **somente escrita** (`XLSX.utils.json_to_sheet` + `XLSX.writeFile` a partir de dados internos já validados) — não há superfície de ataque exposta por essas CVEs neste fluxo.

---

## Fase D — Verificação

- ✅ `npx tsc --noEmit -p tsconfig.json` — sem erros.
- ✅ `npx eslint src/pages/Dashboard.tsx supabase/functions/sync-ads-performance/index.ts` — apenas erros `@typescript-eslint/no-explicit-any`, consistentes com o padrão já existente no projeto (o `Dashboard.tsx` anterior já tinha 10 ocorrências do mesmo tipo; `npm run build` não executa lint).
- ✅ `npm run build` — build de produção concluído com sucesso (`vite build`).

---

## Próximos passos (pendente confirmação do usuário)

1. **Rodar o SQL da Fase A** no SQL Editor do Supabase (bloco copiável acima).
2. Deploy da Edge Function:
   ```
   npx supabase functions deploy sync-ads-performance --project-ref fyyhxmugxcfqhvoevuwf
   ```
3. Deploy do frontend:
   ```
   npm run deploy
   ```

⚠️ Nenhum desses três passos foi executado automaticamente — aguardando confirmação.
