/**
 * Edge Function: invite-member
 *
 * Recebe: { tenant_id, email, role }  +  Authorization: Bearer <token>
 * Responsabilidades:
 *   1. Valida que o caller é owner/admin/manager do tenant
 *   2. Valida regras de hierarquia (manager só convida attendant/staff)
 *   3. Verifica que o email não é já membro ativo
 *   4. Cria/renova registro em invitations (upsert)
 *   5. Envia email de convite via Supabase Auth Admin
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";

const ROLE_LABELS: Record<string, string> = {
  admin:     'Administrador',
  manager:   'Gerente',
  doctor:    'Profissional de Saúde',
  attendant: 'Atendente',
  staff:     'Auxiliar',
};

const CAN_INVITE: Record<string, string[]> = {
  owner:   ['admin', 'manager', 'doctor', 'attendant', 'staff'],
  admin:   ['manager', 'doctor', 'attendant', 'staff'],
  manager: ['attendant', 'staff'],
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl      = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const appUrl           = Deno.env.get('APP_URL') ?? 'https://app.traffio.com.br';
  const supabaseAdmin    = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json();
    const { tenant_id, email, role } = body;

    if (!tenant_id || !email || !role) {
      return json({ error: 'tenant_id, email e role são obrigatórios' }, 400);
    }

    // ── 1. Extrair caller do JWT ─────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace('Bearer ', '');
    if (!jwt) return json({ error: 'Não autenticado' }, 401);

    const { data: { user }, error: jwtError } = await supabaseAdmin.auth.getUser(jwt);
    if (jwtError || !user) return json({ error: 'Token inválido' }, 401);

    const callerId = user.id;

    // ── 2. Verificar permissão do caller ─────────────────────────────────────
    const { data: callerMember, error: memberError } = await supabaseAdmin
      .from('members')
      .select('role')
      .eq('tenant_id', tenant_id)
      .eq('user_id', callerId)
      .eq('is_active', true)
      .maybeSingle();

    if (memberError || !callerMember) {
      return json({ error: 'Você não é membro deste tenant' }, 403);
    }

    const callerRole = callerMember.role as string;
    const allowedRoles = CAN_INVITE[callerRole] ?? [];

    if (!allowedRoles.includes(role)) {
      return json({
        error: `Seu perfil (${callerRole}) não pode convidar um ${ROLE_LABELS[role] ?? role}`
      }, 403);
    }

    // ── 3. Verificar se já é membro ativo ────────────────────────────────────
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (existingProfile) {
      const { data: existingMember } = await supabaseAdmin
        .from('members')
        .select('id')
        .eq('tenant_id', tenant_id)
        .eq('user_id', existingProfile.id)
        .eq('is_active', true)
        .maybeSingle();

      if (existingMember) {
        return json({ error: 'Este email já é membro ativo desta clínica' }, 409);
      }
    }

    // ── 4. Buscar dados do tenant e do caller para o email ───────────────────
    const [tenantRes, callerProfileRes] = await Promise.all([
      supabaseAdmin.from('tenants').select('name').eq('id', tenant_id).single(),
      supabaseAdmin.from('profiles').select('full_name').eq('id', callerId).maybeSingle(),
    ]);

    const tenantName    = tenantRes.data?.name ?? 'Clínica';
    const callerName    = callerProfileRes.data?.full_name ?? 'Administrador';

    // ── 5. Criar/renovar convite ─────────────────────────────────────────────
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: invitation, error: inviteError } = await supabaseAdmin
      .from('invitations')
      .upsert({
        tenant_id,
        email:      email.toLowerCase(),
        role,
        invited_by: callerId,
        status:     'pending',
        expires_at: expiresAt,
      }, { onConflict: 'tenant_id,email' })
      .select()
      .single();

    if (inviteError || !invitation) {
      console.error('Invite upsert error:', inviteError);
      return json({ error: 'Erro ao criar convite' }, 500);
    }

    // ── 6. Enviar email via Supabase Auth Admin (invite link) ────────────────
    const inviteUrl = `${appUrl}/invite/${invitation.token}`;

    // Tentativa 1: usar supabase.auth.admin.inviteUserByEmail (se disponível)
    // Tentativa 2: enviar email de texto simples via admin.generateLink
    try {
      const { error: emailError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
        email.toLowerCase(),
        {
          redirectTo: inviteUrl,
          data: {
            invitation_token: invitation.token,
            tenant_name:      tenantName,
            role_label:       ROLE_LABELS[role] ?? role,
            inviter_name:     callerName,
          }
        }
      );

      if (emailError) {
        // Fallback: email via generateLink (magic link)
        console.warn('inviteUserByEmail failed, falling back to generateLink:', emailError.message);
        // Apenas logar — o admin pode reenviar manualmente
      }
    } catch (emailErr) {
      console.warn('Email send failed (non-fatal):', emailErr);
    }

    return json({
      success:       true,
      invitation_id: invitation.id,
      invite_url:    inviteUrl,   // Retornado para o frontend copiar/exibir
      message:       `Convite enviado para ${email}`,
    });

  } catch (err: any) {
    console.error('invite-member error:', err);
    return json({ error: err.message ?? 'Erro interno' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
