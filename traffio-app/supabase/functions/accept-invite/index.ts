/**
 * Edge Function: accept-invite
 *
 * Recebe: { token, full_name, password }
 * Responsabilidades:
 *   1. Busca e valida convite pelo token
 *   2. Se usuário já existe (outro tenant), apenas cria o member
 *   3. Se usuário novo: cria auth user + profile via trigger
 *   4. Cria member vinculando ao tenant com o role do convite
 *   5. Se role = doctor, cria registro em doctors
 *   6. Marca convite como aceito
 *   7. Retorna session tokens para auto-login
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl   = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    const body = await req.json();
    const { token, full_name, password } = body;

    if (!token || !full_name || !password) {
      return json({ error: 'token, full_name e password são obrigatórios' }, 400);
    }

    if (password.length < 6) {
      return json({ error: 'A senha deve ter no mínimo 6 caracteres' }, 400);
    }

    // ── 1. Buscar e validar convite ──────────────────────────────────────────
    const { data: invite, error: inviteError } = await supabaseAdmin
      .from('invitations')
      .select('*, tenants(name)')
      .eq('token', token)
      .eq('status', 'pending')
      .maybeSingle();

    if (inviteError || !invite) {
      return json({ error: 'Convite inválido ou não encontrado' }, 400);
    }

    if (new Date(invite.expires_at) < new Date()) {
      // Marcar como expirado
      await supabaseAdmin
        .from('invitations')
        .update({ status: 'expired' })
        .eq('id', invite.id);
      return json({ error: 'Este convite expirou. Solicite um novo convite ao administrador.' }, 400);
    }

    const email      = invite.email as string;
    const role       = invite.role  as string;
    const tenant_id  = invite.tenant_id as string;

    // ── 2. Verificar se email já tem conta ───────────────────────────────────
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers({
      page: 1, perPage: 1000,
    });
    const existingUser = existingUsers?.users?.find((u: any) => u.email === email);

    let userId: string;
    let needsSignIn = false;

    if (existingUser) {
      // Usuário já existe: pode estar em outro tenant
      userId = existingUser.id;
      needsSignIn = false; // Já tem conta, não vamos recriar

      // Atualizar full_name no profile se mudou
      await supabaseAdmin
        .from('profiles')
        .update({ full_name })
        .eq('id', userId);

    } else {
      // ── 3. Criar novo auth user ────────────────────────────────────────────
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,  // Pula verificação — veio via convite autenticado
        user_metadata: { full_name, role, tenant_id },
      });

      if (createError || !newUser?.user) {
        console.error('createUser error:', createError);
        return json({ error: createError?.message ?? 'Erro ao criar usuário' }, 500);
      }

      userId     = newUser.user.id;
      needsSignIn = true;

      // Aguardar o trigger handle_new_user() criar o profile
      await sleep(800);

      // Garantir que o profile está correto (trigger pode não ter rodado ainda)
      await supabaseAdmin.from('profiles').upsert({
        id:        userId,
        full_name,
        email,
        role,
      }, { onConflict: 'id' });
    }

    // ── 4. Criar member no tenant ────────────────────────────────────────────
    const { error: memberError } = await supabaseAdmin
      .from('members')
      .upsert({
        tenant_id,
        user_id:   userId,
        role,
        is_active: true,
      }, { onConflict: 'tenant_id,user_id' });

    if (memberError) {
      console.error('member upsert error:', memberError);
      return json({ error: 'Erro ao vincular ao tenant' }, 500);
    }

    // ── 5. Se role = doctor, criar registro em doctors ───────────────────────
    if (role === 'doctor') {
      await supabaseAdmin.from('doctors').upsert({
        id:        userId,
        tenant_id,
        full_name,
        email,
        role:      'doctor',
        is_active: true,
        color:     '#1152d4',
        cancellation_policy: {
          enabled: false,
          free_window_hours: 24,
          late_penalty_percent: 0,
          no_show_penalty_percent: 100,
        },
      }, { onConflict: 'id' });
    }

    // ── 6. Marcar convite como aceito ────────────────────────────────────────
    await supabaseAdmin
      .from('invitations')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', invite.id);

    // ── 7. Fazer login do usuário para retornar session ──────────────────────
    // Para usuários novos: login com credenciais
    // Para usuários existentes: retornar apenas sucesso (eles já estão logados)
    let session: any = null;

    if (needsSignIn) {
      const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '');
      const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        console.warn('Auto sign-in failed (non-fatal):', signInError.message);
      } else {
        session = signInData.session;
      }
    }

    return json({
      success:    true,
      user_id:    userId,
      role,
      tenant_id,
      session,    // null se usuário já existia (deve fazer login normalmente)
      tenant_name: (invite.tenants as any)?.name ?? '',
      message:    'Conta criada com sucesso! Bem-vindo(a) à equipe.',
    });

  } catch (err: any) {
    console.error('accept-invite error:', err);
    return json({ error: err.message ?? 'Erro interno' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
