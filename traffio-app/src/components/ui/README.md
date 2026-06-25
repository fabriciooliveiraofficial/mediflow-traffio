# Design System (Traffio UI)

Fonte única de verdade visual da aplicação. O padrão foi extraído da página
Follow-up (`FollowUpBoard.tsx` / `PerformanceStats.tsx`), referência aprovada
de design "premium". **Nenhuma página deve escrever classes de card, badge,
botão, KPI, cabeçalho ou padding de página manualmente** — sempre usar estes
componentes e regras.

Tokens vêm de `src/index.css` (`@theme`): `brand-primary`, `brand-secondary`,
`graphite-{900,700,400,300}`, `ice-{50,100,200}`, `accent-{success,warning,error,info}`,
`graphite-{900,800,700,500,400,300}`, `radius-{xl,2xl,3xl,4xl}`, `shadow-premium-{sm,md,lg}`,
`shadow-glass-{sm,md,lg}`, `shadow-float` (sombra larga e quase imperceptível, sem borda —
painéis de workspace em tela cheia, ex: `CommunicationsHub`).

**Atenção:** `brand-primary`/`brand-secondary` são sobrescritos em runtime por tenant
(`TenantContext.tsx`, a partir de `tenant.color_primary` — recurso de white-label).
Use-os normalmente em CTAs e destaques de conteúdo (são "a marca da clínica"). Mas em
**chrome estrutural da própria plataforma** (ex: mini-nav escuro do Comunicações) que não
deve mudar de cor por tenant, use um accent fixo (`accent-info`, `graphite-*`) em vez de
`brand-primary`.

**Navegação:** todo chrome de navegação da plataforma (sidebar principal, mini-navs) é
claro — `bg-transparent`/`bg-white`, hover `bg-ice-50`, ícone inativo `graphite-400/500`,
ativo com accent fixo. Nunca usar fundo escuro (`graphite-900`, `bg-[#...]`) como base de
um menu — isso não existe em nenhum outro lugar da plataforma.

## Layout de página

Toda página vive dentro do `DashboardLayout`, que já aplica o padding padrão —
**nenhuma página deve definir seu próprio padding externo**:

- Padrão (todas as páginas, incluindo Comunicações): `px-6 lg:px-12 py-8` (aplicado pelo layout, não pela página)
- Inbox: `px-6 lg:px-12 pb-8` (sem padding superior — tem slot próprio no header global)
- Se uma página precisa de um contêiner cheio de altura (ex: board, workspace denso como
  Comunicações ou Follow-up), o componente da página define `h-[calc(100vh-Npx)]` ou
  `h-full` e se estiliza como um painel contido: `rounded-3xl border border-ice-100 shadow-sm overflow-hidden`
  — nunca remove o padding do layout para "ganhar espaço".

## Tipografia

Escala fixa — não inventar combinações novas de `font-size`/`font-weight`/`tracking`:

| Papel | Classes | Onde usar |
|---|---|---|
| Eyebrow / label de KPI | `text-[10px] font-black uppercase tracking-widest text-graphite-400` | Rótulo acima de um valor (KpiCard, seções) |
| Valor de destaque | `text-2xl font-black tracking-tight text-graphite-900` | Números grandes (KPI, totais) |
| Título de página | `text-xl font-black tracking-tight text-graphite-900` (compact) / `text-3xl md:text-4xl font-black tracking-tighter` (large, hero) | `PageHeader` |
| Título de seção/card | `text-sm font-black uppercase tracking-wider text-graphite-900` | Cabeçalho de painel/gráfico |
| Corpo | `text-sm font-medium text-graphite-700` | Texto corrido |
| Legenda/metadado | `text-xs font-bold text-graphite-400` ou `text-[10px] font-bold text-graphite-400` | Subtítulos, timestamps |

Fonte da família: `--font-sans` / `--font-display` (Plus Jakarta Sans) — já global via `body`, nunca declarar `font-family` em uma página.

## Card

```tsx
import { Card } from '../components/ui';

<Card variant="default" padding="md">...</Card>      // card padrão (lista, formulário)
<Card variant="panel" padding="lg">...</Card>         // painel grande (gráfico, seção)
<Card variant="interactive" padding="md">...</Card>   // card clicável/arrastável (hover lift)
<Card variant="flat" padding="none">...</Card>        // sem shadow (container neutro)
<Card variant="glass" padding="md">...</Card>         // destaque/hero, sem borda, sombra suave (sem backdrop-blur — custo de performance sem ganho sobre fundo chapado)
<Card variant="floating" padding="md">...</Card>      // sem borda, sombra --shadow-float (preta, larga, bem sutil) com hover lift
<Card variant="floatingPanel" padding="none">...</Card> // mesma sombra --shadow-float, painel grande sem hover (radius-4xl)
```

## PageHeader

```tsx
import { PageHeader } from '../components/ui';
import { TrendingUp } from 'lucide-react';

<PageHeader
  icon={TrendingUp}
  size="compact"        // compact (padrão, text-xl) | large (hero/hub, text-3xl/4xl)
  accent="brand"        // brand | success | warning | error | info | neutral
  title="Follow-up"
  subtitle="Acompanhamento de leads"
  actions={<Button variant="primary">Nova ação</Button>}
/>
```

## KpiCard

```tsx
import { KpiCard } from '../components/ui';
import { Users } from 'lucide-react';

<KpiCard
  label="Total de Leads"
  value={42}
  icon={Users}
  accent="brand" // brand | success | warning | error | info | neutral | indigo | purple
  variant="interactive" // interactive (padrão) | glass (em painéis hero)
  trend={12.4}   // opcional, mostra seta + %
  subValue="8 avaliações" // opcional
  onClick={...}  // opcional
/>
```

## Badge

```tsx
import { Badge } from '../components/ui';

<Badge accent="success" variant="pill">Concluído</Badge>   // status (uppercase, font-black)
<Badge accent="neutral" variant="tag">Consulta de rotina</Badge> // metadado (font-medium)
```

Accents disponíveis: `brand | success | warning | error | info | neutral | indigo | purple`.
`indigo`/`purple` são para séries categóricas sem semântica de estado (ex: 5º+ KPI numa
fileira) — nunca usar `bg-blue-50`/`bg-purple-100` direto.

## Button

```tsx
import { Button } from '../components/ui';

<Button variant="primary">Salvar</Button>
<Button variant="secondary" size="sm">Cancelar</Button>
<Button variant="success">Concluir</Button>
<Button variant="danger">Excluir</Button>
<Button variant="ghost">Filtrar</Button>
<Button variant="dangerGhost">Excluir registro</Button>
```

## IconButton

```tsx
import { IconButton } from '../components/ui';
import { X } from 'lucide-react';

<IconButton onClick={onClose}><X size={20} /></IconButton>
```

## EmptyState

```tsx
import { EmptyState } from '../components/ui';
import { Search } from 'lucide-react';

<EmptyState icon={Search} label="Nenhum resultado encontrado" />
```

## Regras

1. Cor sempre por `accent` semântico (`brand`/`success`/`warning`/`error`/`info`/`neutral`/`indigo`/`purple`),
   nunca `bg-blue-50`, `bg-emerald-100` etc. direto na página.
2. Raio sempre via variantes do `Card` (`rounded-3xl`/`rounded-4xl`) — nunca `rounded-[Npx]` arbitrário.
3. Tipografia sempre da escala documentada acima — não recriar combinações de peso/tamanho/tracking.
4. Padding de página vem do `DashboardLayout`, nunca da própria página.
5. CTAs (ações primárias clicáveis) sempre via `Button`/`IconButton` — nunca `<button className="...">` com cor/raio/peso escritos à mão. Controles de navegação/filtro (abas, segmented controls) podem continuar bespoke quando representam seleção, não ação.
6. Se um padrão visual se repete em 2+ páginas e não existe primitivo para ele, criar um novo
   componente aqui antes de copiar/colar JSX.
