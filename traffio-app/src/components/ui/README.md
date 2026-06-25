# Design System (Traffio UI)

Fonte única de verdade visual da aplicação. O padrão foi extraído da página
Follow-up (`FollowUpBoard.tsx` / `PerformanceStats.tsx`), referência aprovada
de design "premium". **Nenhuma página deve escrever classes de card, badge,
botão ou KPI manualmente** — sempre usar estes componentes.

Tokens vêm de `src/index.css` (`@theme`): `brand-primary`, `brand-secondary`,
`graphite-{900,700,400,300}`, `ice-{50,100,200}`, `accent-{success,warning,error,info}`,
`radius-{xl,2xl,3xl,4xl}`.

## Card

```tsx
import { Card } from '../components/ui';

<Card variant="default" padding="md">...</Card>      // card padrão (lista, formulário)
<Card variant="panel" padding="lg">...</Card>         // painel grande (gráfico, seção)
<Card variant="interactive" padding="md">...</Card>   // card clicável/arrastável (hover lift)
<Card variant="flat" padding="none">...</Card>        // sem shadow (container neutro)
```

## KpiCard

```tsx
import { KpiCard } from '../components/ui';
import { Users } from 'lucide-react';

<KpiCard
  label="Total de Leads"
  value={42}
  icon={Users}
  accent="brand" // brand | success | warning | error | info | neutral
  trend={12.4}   // opcional, mostra seta + %
  subValue="8 avaliações" // opcional
/>
```

## Badge

```tsx
import { Badge } from '../components/ui';

<Badge accent="success" variant="pill">Concluído</Badge>   // status (uppercase, font-black)
<Badge accent="neutral" variant="tag">Consulta de rotina</Badge> // metadado (font-medium)
```

## Button

```tsx
import { Button } from '../components/ui';

<Button variant="primary">Salvar</Button>
<Button variant="secondary" size="sm">Cancelar</Button>
<Button variant="success">Concluir</Button>
<Button variant="danger">Excluir</Button>
<Button variant="ghost">Filtrar</Button>
```

## EmptyState

```tsx
import { EmptyState } from '../components/ui';
import { Search } from 'lucide-react';

<EmptyState icon={Search} label="Nenhum resultado encontrado" />
```

## Regras

1. Cor sempre por `accent` semântico (`brand`/`success`/`warning`/`error`/`info`/`neutral`),
   nunca `bg-blue-50`, `bg-emerald-100` etc. direto na página.
2. Raio sempre via variantes do `Card` (`rounded-3xl`/`rounded-4xl`) — nunca `rounded-[Npx]` arbitrário.
3. Tipografia de KPI/label segue `KpiCard` (`font-black uppercase tracking-widest` para label,
   `font-black tracking-tight` para valor) — não recriar manualmente.
4. Se um padrão visual se repete em 2+ páginas e não existe primitivo para ele, criar um novo
   componente aqui antes de copiar/colar JSX.
