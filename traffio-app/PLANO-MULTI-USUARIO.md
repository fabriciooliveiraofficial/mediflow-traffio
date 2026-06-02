# Plano: Sistema Multi-Usuário com Convites e Permissões

## Contexto

A plataforma Traffio já possui infraestrutura de multi-tenancy (tabelas `tenants`, `members`, `profiles`, RLS policies), mas **não existe fluxo para que o owner/admin de uma clínica possa convidar e gerenciar membros da equipe**. Atualmente, apenas o cadastro de clínica (owner) e o cadastro de paciente (portal) existem. Profissionais são criados apenas como registros na tabela `doctors` sem conta de login.

### Padrão de Referência: Octadesk / Intercom / Zendesk / HubSpot

Essas plataformas seguem o mesmo padrão consolidado:

1. **Owner cria a conta** → tenant é provisionado automaticamente
2. **Owner/Admin convida membros** por email com role pré-definido
3. **Convite chega por email** com link mágico + token único
4. **Convidado aceita** → preenche nome + senha (email já preenchido)
5. **Sistema cria** profile + member automaticamente com role correto
6. **Painel de equipe** permite: listar, editar role, desativar, reenviar convite, revogar
7. **Permissões por role** controlam quais páginas/funcionalidades cada usuário vê

### O que JÁ existe no Traffio

| Componente | Status | Observação |
|---|---|---|
| `profiles` table | OK | id, email, full_name, role, avatar_url |
| `tenants` table | OK | id, name, slug, settings, whatsapp config |
| `members` table | OK | tenant_id + user_id + role + is_active |
| RLS policies | OK | Filtram dados via `members.tenant_id` |
| `TenantContext` | Parcial | Retorna tenant mas NÃO retorna role do usuário |
| `DashboardLayout` | Parcial | Nav adaptativa por specialty, NÃO por role |
| `RegisterPage` | Parcial | Cria auth user mas NÃO cria tenant/member (simulado) |
| `Professionals` page | OK | CRUD de doctors, mas sem conta de login |
| Convites/Invitations | INEXISTENTE | Nenhuma tabela, UI ou Edge Function |
| Painel de Equipe | INEXISTENTE | Nenhuma aba em Settings |

### O que FALTA implementar

1. **Tabela `invitations`** — armazenar convites pendentes
2. **Edge Function `invite-member`** — criar convite + enviar email
3. **Edge Function `accept-invite`** — criar auth user + profile + member atomicamente
4. **Página `/invite/:token`** — formulário de aceitação do convite
5. **Aba "Equipe" em Settings** — listar membros, convidar, editar, desativar
6. **Corrigir RegisterPage** — provisionar tenant + member automaticamente
7. **Expandir TenantContext** — incluir role do usuário logado
8. **Filtrar nav por role** — esconder páginas que o usuário não tem permissão
9. **Middleware de permissões** — hook `usePermission` para checks granulares

---

## Arquitetura de Roles e Permissões

### Roles (hierárquico)

| Role | Label PT | Pode convidar | Pode editar equipe | Pode editar config | Vê financeiro | Vê atendimento |
|---|---|---|---|---|---|---|
| `owner` | Proprietário | Sim (todos) | Sim | Sim | Sim | Sim |
| `admin` | Administrador | Sim (exceto owner) | Sim | Sim | Sim | Sim |
| `manager` | Gerente | Sim (staff/attendant) | Parcial | Não | Sim | Sim |
| `doctor` | Profissional | Não | Não | Não | Não | Sim (própria agenda) |
| `attendant` | Atendente | Não | Não | Não | Não | Sim |
| `staff` | Auxiliar | Não | Não | Não | Não | Limitado |

### Mapa de Permissões por Página

| Página | owner | admin | manager | doctor | attendant | staff |
|---|---|---|---|---|---|---|
| Dashboard | Full | Full | Full | Próprio | Resumo | Resumo |
| Agenda Mestra | Full | Full | Full | Própria | Visualizar | - |
| Atendimento (Inbox) | Full | Full | Full | - | Full | - |
| CRM/Leads | Full | Full | Full | - | Visualizar | - |
| Prontuário | Full | Full | Visualizar | Próprio | - | - |
| Financeiro | Full | Full | Full | - | - | - |
| Automações | Full | Full | Visualizar | - | - | - |
| Config WhatsApp | Full | Full | - | - | - | - |
| Settings/Equipe | Full | Full | Visualizar | - | - | - |
| Profissionais | Full | Full | Visualizar | - | - | - |

---

## Arquivos a Criar/Modificar

### Novos Arquivos

| # | Arquivo | Tipo | Descrição |
|---|---------|------|-----------|
| 1 | `supabase/migrations/XXXX_invitations_table.sql` | Migration | Tabela invitations + policies |
| 2 | `supabase/functions/invite-member/index.ts` | Edge Function | Criar convite + enviar email |
| 3 | `supabase/functions/accept-invite/index.ts` | Edge Function | Aceitar convite server-side |
| 4 | `src/pages/AcceptInvitePage.tsx` | Página | Formulário de aceitação |
| 5 | `src/components/settings/TeamManagement.tsx` | Componente | Aba Equipe no Settings |
| 6 | `src/hooks/usePermissions.ts` | Hook | Check de permissões por role |
| 7 | `src/services/invitationService.ts` | Service | CRUD de convites |
| 8 | `src/services/memberService.ts` | Service | CRUD de membros |

### Arquivos a Modificar

| # | Arquivo | Descrição |
|---|---------|-----------|
| 9 | `src/pages/Settings.tsx` | Adicionar aba "Equipe" |
| 10 | `src/pages/RegisterPage.tsx` | Auto-provisionar tenant + member |
| 11 | `src/contexts/TenantContext.tsx` | Expor userRole + permissions |
| 12 | `src/layouts/DashboardLayout.tsx` | Filtrar nav por role |
| 13 | `src/App.tsx` | Adicionar rota `/invite/:token` |

---

## SPRINT 1: Database + Edge Functions (Backend)

### TASK 1.1: Migration — Tabela `invitations`

**Arquivo**: `supabase/migrations/XXXX_invitations_table.sql`

```sql
-- Tabela de convites pendentes
CREATE TABLE IF NOT EXISTS invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'doctor', 'attendant', 'staff')),
    token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
    invited_by UUID NOT NULL REFERENCES profiles(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, email)  -- Evita convites duplicados
);

-- Índices
CREATE INDEX idx_invitations_token ON invitations(token) WHERE status = 'pending';
CREATE INDEX idx_invitations_tenant ON invitations(tenant_id);
CREATE INDEX idx_invitations_email ON invitations(email);

-- RLS
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- Admins do tenant podem ver e gerenciar convites
CREATE POLICY "admins_manage_invitations" ON invitations
FOR ALL TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM members
        WHERE members.user_id = auth.uid()
        AND members.tenant_id = invitations.tenant_id
        AND members.role IN ('owner', 'admin', 'manager')
        AND members.is_active = TRUE
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM members
        WHERE members.user_id = auth.uid()
        AND members.tenant_id = invitations.tenant_id
        AND members.role IN ('owner', 'admin', 'manager')
        AND members.is_active = TRUE
    )
);

-- Qualquer pessoa pode ler um convite pelo token (para aceitação)
CREATE POLICY "anyone_read_by_token" ON invitations
FOR SELECT TO anon, authenticated
USING (TRUE);  -- Token validation is done in the Edge Function
```

### TASK 1.2: Migration — Adicionar `is_active` e `invited_by` em members (se não existir)

```sql
-- Garantir que members tem is_active (já existe no DEPLOY_SCHEMA, mas pode faltar em prod)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'members' AND column_name = 'is_active') THEN
        ALTER TABLE members ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
    END IF;
END $$;

-- Expandir roles do members para incluir todos os roles do novo sistema
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_role_check;
ALTER TABLE members ADD CONSTRAINT members_role_check 
    CHECK (role IN ('owner', 'admin', 'manager', 'doctor', 'attendant', 'staff'));
```

### TASK 1.3: Edge Function — `invite-member`

**Arquivo**: `supabase/functions/invite-member/index.ts`

**Responsabilidades:**
- Recebe: `{ email, role, tenant_id }` + auth header do admin
- Valida: caller é admin/owner do tenant
- Valida: email não é de membro ativo existente
- Cria registro em `invitations` com token único
- Envia email de convite via Supabase Auth ou serviço externo (Resend/SendGrid)
- Template do email: link `https://app.traffio.com/invite/{token}`
- Retorna: `{ success: true, invitation_id }`

**Lógica principal:**
```typescript
// 1. Verificar que o caller tem permissão
const { data: callerMember } = await supabase
    .from('members')
    .select('role')
    .eq('tenant_id', body.tenant_id)
    .eq('user_id', callerUserId)
    .single();

if (!['owner', 'admin', 'manager'].includes(callerMember.role)) {
    return new Response(JSON.stringify({ error: 'Sem permissão' }), { status: 403 });
}

// 2. Managers só podem convidar roles menores
if (callerMember.role === 'manager' && !['attendant', 'staff'].includes(body.role)) {
    return new Response(JSON.stringify({ error: 'Gerentes só podem convidar atendentes e auxiliares' }), { status: 403 });
}

// 3. Verificar se já existe membro ativo com esse email
const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', body.email)
    .maybeSingle();

if (existingProfile) {
    const { data: existingMember } = await supabase
        .from('members')
        .select('id')
        .eq('tenant_id', body.tenant_id)
        .eq('user_id', existingProfile.id)
        .eq('is_active', true)
        .maybeSingle();

    if (existingMember) {
        return new Response(JSON.stringify({ error: 'Este email já é membro ativo desta clínica' }), { status: 409 });
    }
}

// 4. Criar ou atualizar convite
const { data: invitation, error } = await supabase
    .from('invitations')
    .upsert({
        tenant_id: body.tenant_id,
        email: body.email,
        role: body.role,
        invited_by: callerUserId,
        status: 'pending',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: 'tenant_id,email' })
    .select()
    .single();

// 5. Enviar email
// Opção A: Supabase Auth (se configurado)
// Opção B: Edge Function que chama Resend/SendGrid
const tenantName = ...; // buscar nome do tenant
const inviteUrl = `${Deno.env.get('APP_URL')}/invite/${invitation.token}`;
// ... enviar email com template bonito contendo inviteUrl
```

### TASK 1.4: Edge Function — `accept-invite`

**Arquivo**: `supabase/functions/accept-invite/index.ts`

**Responsabilidades:**
- Recebe: `{ token, full_name, password }` (email vem do convite)
- Valida: token existe, status='pending', não expirado
- Cria auth user via `supabase.auth.admin.createUser()` (service role key)
- Profile é criado automaticamente pelo trigger `handle_new_user()`
- Cria registro em `members` linkando user ao tenant com o role do convite
- Se o role é 'doctor', cria registro na tabela `doctors`
- Atualiza invitation.status = 'accepted'
- Retorna: session tokens para auto-login

**Lógica principal:**
```typescript
// 1. Buscar e validar convite
const { data: invite } = await supabaseAdmin
    .from('invitations')
    .select('*, tenants(name)')
    .eq('token', body.token)
    .eq('status', 'pending')
    .single();

if (!invite || new Date(invite.expires_at) < new Date()) {
    return error(400, 'Convite inválido ou expirado');
}

// 2. Verificar se o email já tem conta
const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
const existingUser = existingUsers.users.find(u => u.email === invite.email);

let userId: string;

if (existingUser) {
    // Usuário já existe (pode ter conta em outro tenant) — apenas criar member
    userId = existingUser.id;
} else {
    // 3. Criar novo auth user (server-side com service_role key)
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: invite.email,
        password: body.password,
        email_confirm: true,  // Pula verificação pois veio via convite
        user_metadata: {
            full_name: body.full_name,
            role: invite.role,
        }
    });
    if (createError) throw createError;
    userId = newUser.user.id;
}

// 4. Criar membro no tenant
await supabaseAdmin.from('members').upsert({
    tenant_id: invite.tenant_id,
    user_id: userId,
    role: invite.role,
    is_active: true,
}, { onConflict: 'tenant_id,user_id' });

// 5. Se role é doctor, criar registro em doctors
if (invite.role === 'doctor') {
    await supabaseAdmin.from('doctors').upsert({
        id: userId,
        tenant_id: invite.tenant_id,
        full_name: body.full_name,
        email: invite.email,
        role: 'doctor',
        is_active: true,
    }, { onConflict: 'id' });
}

// 6. Marcar convite como aceito
await supabaseAdmin.from('invitations').update({
    status: 'accepted',
    accepted_at: new Date().toISOString(),
}).eq('id', invite.id);

// 7. Gerar sessão para auto-login
const { data: session } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: invite.email,
});

return { success: true, redirect_url: session.properties.action_link };
```

---

## SPRINT 2: Frontend — Aceitação de Convite + RegisterPage Fix

### TASK 2.1: Página `/invite/:token` — AcceptInvitePage

**Arquivo**: `src/pages/AcceptInvitePage.tsx`

**Fluxo UX:**
1. Usuário clica no link do email → chega em `/invite/abc123...`
2. Página busca dados do convite pelo token (nome da clínica, role, email)
3. Se convite válido: mostra formulário com:
   - Email (read-only, preenchido do convite)
   - Nome completo (input)
   - Senha (input)
   - Confirmar senha (input)
   - Botão "Aceitar Convite e Criar Conta"
4. Se convite expirado/inválido: mostra mensagem de erro com link para contato
5. Ao submeter: chama Edge Function `accept-invite`
6. Sucesso → auto-login + redirect para `/dashboard`

**Layout:**
- Tela cheia com fundo branco
- Card centralizado (max-w-md)
- Logo da clínica no topo (buscado do tenant via convite)
- Design limpo, similar ao RegisterPage
- Stepper: 1 step (simples)

### TASK 2.2: Corrigir RegisterPage — Provisionar tenant + member

**Arquivo**: `src/pages/RegisterPage.tsx`

**Problema atual:** O signup cria auth user mas NÃO cria tenant nem member. As "etapas de provisionamento" são simuladas.

**Correção:** Criar Edge Function `provision-tenant` ou fazer client-side:

```typescript
// Após supabase.auth.signUp() retornar sucesso:

// 1. Esperar o trigger criar o profile
await new Promise(r => setTimeout(r, 1000));

// 2. Criar tenant
const { data: tenant } = await supabase.from('tenants').insert({
    name: form.clinicName,
    slug: form.clinicName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-'),
}).select().single();

// 3. Criar member como owner
const { data: { user } } = await supabase.auth.getUser();
await supabase.from('members').insert({
    tenant_id: tenant.id,
    user_id: user.id,
    role: 'owner',
    is_active: true,
});

// 4. Atualizar profile.role
await supabase.from('profiles').update({ role: 'owner' }).eq('id', user.id);
```

**Alternativa melhor:** Edge Function `provision-tenant` que faz tudo atomicamente com service_role key.

### TASK 2.3: Adicionar rota no App.tsx

```typescript
import { AcceptInvitePage } from './pages/AcceptInvitePage';

// Dentro das rotas públicas:
<Route path="/invite/:token" element={<AcceptInvitePage />} />
```

---

## SPRINT 3: Frontend — Painel de Equipe

### TASK 3.1: Service — `invitationService.ts`

**Arquivo**: `src/services/invitationService.ts`

```typescript
export const invitationService = {
    async list(tenantId: string) {
        return supabase.from('invitations')
            .select('*, profiles!invited_by(full_name)')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false });
    },

    async invite(tenantId: string, email: string, role: string) {
        return supabase.functions.invoke('invite-member', {
            body: { tenant_id: tenantId, email, role }
        });
    },

    async revoke(invitationId: string) {
        return supabase.from('invitations')
            .update({ status: 'revoked' })
            .eq('id', invitationId);
    },

    async resend(invitationId: string) {
        return supabase.functions.invoke('resend-invite', {
            body: { invitation_id: invitationId }
        });
    },
};
```

### TASK 3.2: Service — `memberService.ts`

**Arquivo**: `src/services/memberService.ts`

```typescript
export const memberService = {
    async list(tenantId: string) {
        return supabase.from('members')
            .select('*, profiles(full_name, email, avatar_url, role)')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: true });
    },

    async updateRole(memberId: string, role: string) {
        return supabase.from('members')
            .update({ role })
            .eq('id', memberId);
    },

    async deactivate(memberId: string) {
        return supabase.from('members')
            .update({ is_active: false })
            .eq('id', memberId);
    },

    async reactivate(memberId: string) {
        return supabase.from('members')
            .update({ is_active: true })
            .eq('id', memberId);
    },
};
```

### TASK 3.3: Componente — `TeamManagement.tsx`

**Arquivo**: `src/components/settings/TeamManagement.tsx`

**Layout:**
1. **Header**: "Equipe" + botão "Convidar Membro" (azul, canto direito)
2. **Tabs**: "Membros Ativos" | "Convites Pendentes"
3. **Lista de Membros** (tab 1):
   - Card por membro: avatar, nome, email, role badge, status badge
   - Dropdown de ações: Alterar Role, Desativar, Remover
   - Owner não pode ser removido/desativado
   - Admin não pode editar outro admin (apenas owner pode)
4. **Lista de Convites** (tab 2):
   - Card por convite: email, role, data de envio, status, expiração
   - Ações: Reenviar, Revogar
5. **Modal de Convite**:
   - Input email
   - Select role (filtrado por permissão do caller)
   - Botão "Enviar Convite"

**Badges de Role:**
```
owner    → Proprietário (roxo)
admin    → Administrador (azul)
manager  → Gerente (indigo)
doctor   → Profissional (verde)
attendant → Atendente (amber)
staff    → Auxiliar (cinza)
```

### TASK 3.4: Integrar aba "Equipe" no Settings.tsx

**Arquivo**: `src/pages/Settings.tsx`

- Adicionar nova tab "Equipe" (ícone: Users)
- Renderizar `<TeamManagement />` quando tab selecionada
- Tab visível apenas para roles: owner, admin, manager

---

## SPRINT 4: Permissões e Nav Filtering

### TASK 4.1: Hook — `usePermissions.ts`

**Arquivo**: `src/hooks/usePermissions.ts`

```typescript
const PERMISSION_MAP: Record<string, string[]> = {
    'page:dashboard':     ['owner', 'admin', 'manager', 'doctor', 'attendant', 'staff'],
    'page:agenda':        ['owner', 'admin', 'manager', 'doctor', 'attendant'],
    'page:inbox':         ['owner', 'admin', 'manager', 'attendant'],
    'page:crm':           ['owner', 'admin', 'manager', 'attendant'],
    'page:financial':     ['owner', 'admin', 'manager'],
    'page:automations':   ['owner', 'admin', 'manager'],
    'page:settings':      ['owner', 'admin', 'manager'],
    'page:professionals': ['owner', 'admin', 'manager'],
    'page:whatsapp':      ['owner', 'admin'],
    'action:invite':      ['owner', 'admin', 'manager'],
    'action:manage_team': ['owner', 'admin'],
    'action:edit_config': ['owner', 'admin'],
    'action:view_billing':['owner', 'admin', 'manager'],
};

export function usePermissions() {
    const { userRole } = useTenant(); // após expandir TenantContext

    const can = useCallback((permission: string): boolean => {
        const allowedRoles = PERMISSION_MAP[permission];
        if (!allowedRoles) return false;
        return allowedRoles.includes(userRole);
    }, [userRole]);

    return { can, role: userRole };
}
```

### TASK 4.2: Expandir TenantContext

**Arquivo**: `src/contexts/TenantContext.tsx`

Adicionar ao context:
```typescript
interface TenantContextType {
    tenant: Tenant | null;
    userRole: string;        // NEW: role do usuário no tenant atual
    userProfile: {           // NEW: dados do profile
        id: string;
        full_name: string;
        email: string;
        avatar_url: string | null;
    } | null;
    loading: boolean;
    refresh: () => Promise<void>;
    updateTenant: (updates: Partial<Tenant>) => Promise<void>;
}
```

Na função `fetchTenant()`, após buscar o member:
```typescript
const { data: memberData } = await supabase
    .from('members')
    .select('tenant_id, role')  // <-- adicionar role
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

if (memberData) {
    setUserRole(memberData.role);
    // ... fetch tenant como antes
}
```

### TASK 4.3: Filtrar navegação por role

**Arquivo**: `src/layouts/DashboardLayout.tsx`

```typescript
const { can } = usePermissions();

const filteredNavItems = useMemo(() => {
    return adaptiveNavItems.filter(item => {
        const permissionKey = `page:${item.id}`;
        // Se não há permissão mapeada, mostrar por padrão
        if (!PERMISSION_MAP[permissionKey]) return true;
        return can(permissionKey);
    });
}, [adaptiveNavItems, can]);
```

### TASK 4.4: Proteger rotas no App.tsx

```typescript
function ProtectedRoute({ permission, children }: { permission: string; children: React.ReactNode }) {
    const { can } = usePermissions();
    if (!can(permission)) return <Navigate to="/dashboard" />;
    return <>{children}</>;
}

// Uso:
<Route path="financial" element={
    <ProtectedRoute permission="page:financial">
        <FinancialDashboard />
    </ProtectedRoute>
} />
```

---

## Fluxo Completo (End-to-End)

### Cenário 1: Owner cadastra clínica e convida equipe

```
1. Owner acessa /register
2. Preenche: nome da clínica, seu nome, email, senha
3. Sistema cria: auth user → profile (trigger) → tenant → member(role=owner)
4. Owner é redirecionado para /dashboard
5. Owner vai em Settings → Equipe → "Convidar Membro"
6. Preenche: email da recepcionista, role = "Atendente"
7. Sistema envia email com link /invite/abc123...
8. Recepcionista clica no link
9. Preenche: nome, senha (email já preenchido)
10. Sistema cria: auth user → profile → member(role=attendant)
11. Recepcionista é auto-logada e redirecionada para /dashboard
12. Recepcionista vê apenas: Dashboard, Agenda (visualizar), Atendimento
```

### Cenário 2: Médico é convidado

```
1. Admin vai em Settings → Equipe → "Convidar Membro"
2. Preenche: email do médico, role = "Profissional"
3. Médico recebe email e clica no link
4. Preenche: nome, senha, CRM (campo extra para doctors)
5. Sistema cria: auth user → profile → member(role=doctor) → doctors(crm, specialty)
6. Médico é auto-logado
7. Médico vê apenas: Dashboard (próprio), Agenda (própria), Prontuário (próprio)
```

### Cenário 3: Membro já tem conta em outro tenant

```
1. Admin do Tenant B convida email que já existe no Tenant A
2. Sistema detecta que email já tem auth user
3. Cria apenas novo member(tenant_id=B, user_id=existente, role=X)
4. Usuário pode alternar entre tenants (se implementado)
5. Não precisa criar nova conta
```

---

## Email Template de Convite

```
Assunto: Você foi convidado para {clinicName} no Traffio

Corpo:
Olá!

{inviterName} convidou você para fazer parte da equipe da {clinicName} 
como {roleLabel} na plataforma Traffio.

Clique no botão abaixo para criar sua conta e começar:

[ACEITAR CONVITE]  →  https://app.traffio.com/invite/{token}

Este convite expira em 7 dias.

Se você não esperava este convite, pode ignorar este email.

---
Traffio — Gestão Inteligente para Clínicas
```

---

## Resumo de Entregas

### Sprint 1 (Backend)
- [ ] 1.1 Migration: tabela `invitations`
- [ ] 1.2 Migration: expandir roles do `members`
- [ ] 1.3 Edge Function: `invite-member`
- [ ] 1.4 Edge Function: `accept-invite`

### Sprint 2 (Onboarding)
- [ ] 2.1 Página `AcceptInvitePage.tsx`
- [ ] 2.2 Corrigir `RegisterPage.tsx` (provisionar tenant+member)
- [ ] 2.3 Rota `/invite/:token` no App.tsx

### Sprint 3 (Painel de Equipe)
- [ ] 3.1 Service: `invitationService.ts`
- [ ] 3.2 Service: `memberService.ts`
- [ ] 3.3 Componente: `TeamManagement.tsx`
- [ ] 3.4 Integrar aba "Equipe" no Settings.tsx

### Sprint 4 (Permissões)
- [ ] 4.1 Hook: `usePermissions.ts`
- [ ] 4.2 Expandir `TenantContext.tsx` com userRole
- [ ] 4.3 Filtrar nav por role no `DashboardLayout.tsx`
- [ ] 4.4 Proteger rotas no `App.tsx`

### Testes
- [ ] Owner cadastra clínica → tenant + member criados
- [ ] Admin convida membro → email enviado com link válido
- [ ] Convidado aceita → conta criada, auto-login, role correto
- [ ] Convite expirado → mensagem de erro amigável
- [ ] Manager não consegue convidar admin → erro 403
- [ ] Atendente não vê páginas financeiras → redirect
- [ ] Membro desativado não consegue logar → sem acesso ao tenant
- [ ] Reenviar convite → novo email, mesmo token
- [ ] Revogar convite → token inválido
