// ==============================================================================
// Supabase Edge Function: admin-users
// Gestão Segura de Usuários, RBAC & Provisionamento Transacional
// ==============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://edisen12.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173'
];

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  const isAllowed = ALLOWED_ORIGINS.includes(origin);
  const allowOrigin = isAllowed ? origin : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json'
  };
}

interface CallerProfile {
  id: string;
  email: string;
  nome: string;
  role: 'admin' | 'gestor' | 'controlador' | 'preposto';
  ativo: boolean;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  // 1. Resposta para Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ ok: false, message: 'Método HTTP não permitido. Utilize POST.' }),
      { status: 405, headers: corsHeaders }
    );
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('Configuração ausente: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY');
      return new Response(
        JSON.stringify({ ok: false, message: 'Erro interno de configuração do servidor.' }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Instância com Service Role (Segura no ambiente Deno)
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // 2. Extração e validação do token do solicitante
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!jwt) {
      return new Response(
        JSON.stringify({ ok: false, message: 'Token de autorização não fornecido.' }),
        { status: 401, headers: corsHeaders }
      );
    }

    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(jwt);
    if (userError || !userData?.user) {
      return new Response(
        JSON.stringify({ ok: false, message: 'Sessão inválida ou expirada. Faça login novamente.' }),
        { status: 401, headers: corsHeaders }
      );
    }

    const callerId = userData.user.id;

    // Consulta perfil e autorização do solicitante
    const { data: callerProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, email, nome, role, ativo')
      .eq('id', callerId)
      .single<CallerProfile>();

    if (profileError || !callerProfile) {
      return new Response(
        JSON.stringify({ ok: false, message: 'Perfil do usuário não encontrado no sistema.' }),
        { status: 403, headers: corsHeaders }
      );
    }

    if (!callerProfile.ativo) {
      return new Response(
        JSON.stringify({ ok: false, message: 'Seu acesso foi desativado pela administração.' }),
        { status: 403, headers: corsHeaders }
      );
    }

    if (callerProfile.role !== 'admin' && callerProfile.role !== 'gestor') {
      return new Response(
        JSON.stringify({ ok: false, message: 'Apenas Administradores e Gestores podem gerenciar acessos.' }),
        { status: 403, headers: corsHeaders }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { action } = body;

    if (!action) {
      return new Response(
        JSON.stringify({ ok: false, message: 'Ação não especificada na requisição.' }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Helper: Contagem de administradores ativos no sistema (proteção anti-lockout)
    const countActiveAdmins = async (): Promise<number> => {
      const { count, error } = await supabaseAdmin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .eq('ativo', true);

      if (error) throw error;
      return count || 0;
    };

    // Helper: Obter perfil do usuário alvo
    const getTargetProfile = async (targetId: string): Promise<CallerProfile | null> => {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('id, email, nome, role, ativo')
        .eq('id', targetId)
        .maybeSingle<CallerProfile>();

      if (error) throw error;
      return data;
    };

    // Helper: Registrar log de auditoria corporativo em system_audit_logs
    const recordAuditLog = async (log: {
      action: string;
      category: string;
      target_id: string | null;
      target_label: string | null;
      details?: Record<string, any>;
    }): Promise<void> => {
      try {
        const { error: auditErr } = await supabaseAdmin.from('system_audit_logs').insert({
          actor_id: callerProfile.id,
          actor_nome: callerProfile.nome,
          actor_email: callerProfile.email,
          actor_role: callerProfile.role,
          action: log.action,
          category: log.category,
          target_id: log.target_id,
          target_label: log.target_label,
          details: log.details || {}
        });
        if (auditErr) {
          console.error('Erro retornado ao inserir system_audit_logs:', auditErr);
        }
      } catch (err) {
        console.error('Exceção ao registrar log de auditoria no system_audit_logs:', err);
      }
    };

    // --------------------------------------------------------------------------
    // AÇÃO: 'create'
    // --------------------------------------------------------------------------
    if (action === 'create') {
      const { email, password, nome, role = 'preposto', pessoaId, plats = [], uns = [] } = body;

      const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
      const cleanNome = typeof nome === 'string' ? nome.trim() : '';

      if (!cleanEmail || !cleanEmail.includes('@')) {
        return new Response(
          JSON.stringify({ ok: false, message: 'E-mail inválido ou não informado.' }),
          { status: 400, headers: corsHeaders }
        );
      }

      if (!cleanNome) {
        return new Response(
          JSON.stringify({ ok: false, message: 'Nome completo obrigatório.' }),
          { status: 400, headers: corsHeaders }
        );
      }

      if (typeof password !== 'string' || password.length < 8) {
        return new Response(
          JSON.stringify({ ok: false, message: 'A senha provisória deve conter no mínimo 8 caracteres.' }),
          { status: 400, headers: corsHeaders }
        );
      }

      const validRoles = ['admin', 'gestor', 'controlador', 'preposto'];
      if (!validRoles.includes(role)) {
        return new Response(
          JSON.stringify({ ok: false, message: `Papel inválido: ${role}` }),
          { status: 400, headers: corsHeaders }
        );
      }

      // Regra 3: Somente admin cria outro admin
      if (role === 'admin' && callerProfile.role !== 'admin') {
        return new Response(
          JSON.stringify({ ok: false, message: 'Apenas Administradores podem criar novos Administradores.' }),
          { status: 403, headers: corsHeaders }
        );
      }

      // Criação no GoTrue (com email_confirm: true para evitar bloqueio por cota SMTP)
      const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: cleanEmail,
        password,
        email_confirm: true,
        user_metadata: { nome: cleanNome, role }
      });

      if (createError || !createData?.user) {
        console.error('Erro ao criar usuário no auth.admin:', createError);
        return new Response(
          JSON.stringify({ ok: false, message: createError?.message || 'Erro ao criar credencial de acesso.' }),
          { status: 400, headers: corsHeaders }
        );
      }

      const newUserId = createData.user.id;

      // Inserção no banco em profiles e vínculo com pessoas
      try {
        const { error: insertProfileError } = await supabaseAdmin.from('profiles').insert({
          id: newUserId,
          email: cleanEmail,
          nome: cleanNome,
          role,
          ativo: true
        });

        if (insertProfileError) throw insertProfileError;

        // Garante registro de primeiro login obrigatório em user_onboarding
        await supabaseAdmin.from('user_onboarding').upsert(
          {
            user_id: newUserId,
            primeiro_login: true,
            obriga_troca_senha: true,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'user_id' }
        );

        // Vínculo transacional com public.pessoas (se não for admin ou se pessoaId foi passado)
        let resolvedPessoaId = pessoaId;

        if (pessoaId) {
          const { error: updPessoaErr } = await supabaseAdmin
            .from('pessoas')
            .update({ user_id: newUserId, email: cleanEmail, nome: cleanNome, papel: role === 'admin' ? 'gestor' : role })
            .eq('id', pessoaId);

          if (updPessoaErr) throw updPessoaErr;
        } else if (role !== 'admin') {
          // Busca se já existe pessoa com este e-mail
          const { data: existingPessoa } = await supabaseAdmin
            .from('pessoas')
            .select('id')
            .eq('email', cleanEmail)
            .maybeSingle();

          if (existingPessoa) {
            resolvedPessoaId = existingPessoa.id;
            await supabaseAdmin
              .from('pessoas')
              .update({ user_id: newUserId, papel: role })
              .eq('id', existingPessoa.id);
          } else {
            // Gera slug único
            const baseSlug = cleanNome.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const slug = `${baseSlug}-${Date.now().toString().slice(-4)}`;

            const { data: insertedPessoa, error: insPessoaErr } = await supabaseAdmin
              .from('pessoas')
              .insert({
                nome: cleanNome,
                slug,
                email: cleanEmail,
                papel: role,
                user_id: newUserId
              })
              .select('id')
              .single();

            if (insPessoaErr) throw insPessoaErr;
            resolvedPessoaId = insertedPessoa.id;
          }
        }

        // Atualização de plataformas e unidades atribuídas se aplicável
        if (resolvedPessoaId) {
          if (Array.isArray(plats)) {
            await supabaseAdmin.from('pessoa_plataformas').delete().eq('pessoa_id', resolvedPessoaId);
            if (plats.length > 0) {
              const rowsPlat = plats.map((p: string) => ({ pessoa_id: resolvedPessoaId, plataforma_sigla: p }));
              await supabaseAdmin.from('pessoa_plataformas').insert(rowsPlat);
            }
          }

          if (Array.isArray(uns)) {
            await supabaseAdmin.from('pessoa_unidades').delete().eq('pessoa_id', resolvedPessoaId);
            if (uns.length > 0) {
              const rowsUn = uns.map((u: string) => ({ pessoa_id: resolvedPessoaId, unidade_negocio: u }));
              await supabaseAdmin.from('pessoa_unidades').insert(rowsUn);
            }
          }
        }

        // Registro de auditoria corporativa
        await recordAuditLog({
          action: 'user_created',
          category: 'usuarios',
          target_id: newUserId,
          target_label: `${cleanNome} (${cleanEmail})`,
          details: {
            role,
            email: cleanEmail,
            nome: cleanNome,
            pessoaId: resolvedPessoaId || null
          }
        });

        return new Response(
          JSON.stringify({ ok: true, userId: newUserId, message: `Usuário ${cleanNome} criado com sucesso.` }),
          { status: 200, headers: corsHeaders }
        );
      } catch (sqlError: any) {
        console.error('Falha na persistência SQL pós-GoTrue. Realizando rollback compensatório:', sqlError);
        // Rollback compensatório para evitar usuários órfãos
        await supabaseAdmin.auth.admin.deleteUser(newUserId);
        return new Response(
          JSON.stringify({ ok: false, message: 'Erro ao vincular dados do usuário no banco de dados.' }),
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // --------------------------------------------------------------------------
    // AÇÃO: 'update-role'
    // --------------------------------------------------------------------------
    if (action === 'update-role') {
      const { userId, role, nome } = body;

      if (!userId || !role) {
        return new Response(
          JSON.stringify({ ok: false, message: 'Identificador do usuário e novo papel são obrigatórios.' }),
          { status: 400, headers: corsHeaders }
        );
      }

      const validRoles = ['admin', 'gestor', 'controlador', 'preposto'];
      if (!validRoles.includes(role)) {
        return new Response(
          JSON.stringify({ ok: false, message: `Papel inválido: ${role}` }),
          { status: 400, headers: corsHeaders }
        );
      }

      const targetProfile = await getTargetProfile(userId);
      if (!targetProfile) {
        return new Response(
          JSON.stringify({ ok: false, message: 'Usuário alvo não encontrado.' }),
          { status: 404, headers: corsHeaders }
        );
      }

      const previousRole = targetProfile.role;

      // Regra 3: Somente admin mexe em perfil admin ou promove para admin
      if ((targetProfile.role === 'admin' || role === 'admin') && callerProfile.role !== 'admin') {
        return new Response(
          JSON.stringify({ ok: false, message: 'Apenas Administradores podem gerenciar o papel de Administrador.' }),
          { status: 403, headers: corsHeaders }
        );
      }

      // Regra 4: Anti-lockout - Proibir auto-rebaixamento de admin
      if (callerId === userId && targetProfile.role === 'admin' && role !== 'admin') {
        return new Response(
          JSON.stringify({ ok: false, message: 'Você não pode rebaixar seu próprio papel de Administrador.' }),
          { status: 400, headers: corsHeaders }
        );
      }

      // Se rebaixando outro admin, garantir pelo menos mais 1 ativo
      if (targetProfile.role === 'admin' && role !== 'admin') {
        const activeAdmins = await countActiveAdmins();
        if (activeAdmins <= 1) {
          return new Response(
            JSON.stringify({ ok: false, message: 'Operação bloqueada: o sistema precisa manter ao menos um Administrador ativo.' }),
            { status: 400, headers: corsHeaders }
          );
        }
      }

      const updatePayload: Record<string, any> = { role, updated_at: new Date().toISOString() };
      if (typeof nome === 'string' && nome.trim()) {
        updatePayload.nome = nome.trim();
      }

      const { error: updErr } = await supabaseAdmin.from('profiles').update(updatePayload).eq('id', userId);
      if (updErr) throw updErr;

      // Sincroniza em auth.users metadata
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: { role, ...(updatePayload.nome ? { nome: updatePayload.nome } : {}) }
      });

      // Se houver registro correspondente em pessoas, atualiza o papel operacional
      if (role !== 'admin') {
        await supabaseAdmin.from('pessoas').update({ papel: role }).eq('user_id', userId);
      }

      // Registro de auditoria corporativa
      await recordAuditLog({
        action: 'role_changed',
        category: 'seguranca',
        target_id: userId,
        target_label: `${targetProfile.nome} (${targetProfile.email})`,
        details: {
          previousRole,
          newRole: role,
          targetEmail: targetProfile.email,
          updatedNome: typeof nome === 'string' && nome.trim() ? nome.trim() : targetProfile.nome
        }
      });

      return new Response(
        JSON.stringify({ ok: true, message: `Papel do usuário atualizado para "${role}".` }),
        { status: 200, headers: corsHeaders }
      );
    }

    // --------------------------------------------------------------------------
    // AÇÃO: 'reset-password'
    // --------------------------------------------------------------------------
    if (action === 'reset-password') {
      const { userId, newPassword } = body;

      if (!userId || typeof newPassword !== 'string' || newPassword.length < 8) {
        return new Response(
          JSON.stringify({ ok: false, message: 'Usuário inválido ou nova senha com menos de 8 caracteres.' }),
          { status: 400, headers: corsHeaders }
        );
      }

      const targetProfile = await getTargetProfile(userId);
      if (!targetProfile) {
        return new Response(
          JSON.stringify({ ok: false, message: 'Usuário alvo não encontrado.' }),
          { status: 404, headers: corsHeaders }
        );
      }

      // Somente admin redefine senha de outro admin
      if (targetProfile.role === 'admin' && callerProfile.role !== 'admin') {
        return new Response(
          JSON.stringify({ ok: false, message: 'Apenas Administradores podem redefinir a senha de outro Administrador.' }),
          { status: 403, headers: corsHeaders }
        );
      }

      const { error: pwError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: newPassword
      });

      if (pwError) {
        console.error('Erro ao atualizar senha no auth.admin:', pwError);
        return new Response(
          JSON.stringify({ ok: false, message: pwError.message || 'Erro ao redefinir senha do usuário.' }),
          { status: 400, headers: corsHeaders }
        );
      }

      // Obriga o usuário a definir nova senha pessoal no próximo login
      const forceChange = body.forceChange !== false;
      const { data: updatedOnb } = await supabaseAdmin
        .from('user_onboarding')
        .update({
          obriga_troca_senha: forceChange,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .select('user_id');

      if (!updatedOnb || updatedOnb.length === 0) {
        await supabaseAdmin.from('user_onboarding').insert({
          user_id: userId,
          primeiro_login: true,
          obriga_troca_senha: forceChange
        });
      }

      // Registro de auditoria corporativa
      await recordAuditLog({
        action: 'password_reset',
        category: 'seguranca',
        target_id: userId,
        target_label: `${targetProfile.nome} (${targetProfile.email})`,
        details: {
          forceChange,
          targetRole: targetProfile.role,
          targetEmail: targetProfile.email
        }
      });

      return new Response(
        JSON.stringify({
          ok: true,
          message: 'Senha provisória definida. O usuário deverá trocá-la no próximo login.'
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    // --------------------------------------------------------------------------
    // AÇÃO: 'toggle-active'
    // --------------------------------------------------------------------------
    if (action === 'toggle-active') {
      const { userId, ativo } = body;

      if (!userId || typeof ativo !== 'boolean') {
        return new Response(
          JSON.stringify({ ok: false, message: 'Parâmetros userId e ativo (booleano) são obrigatórios.' }),
          { status: 400, headers: corsHeaders }
        );
      }

      const targetProfile = await getTargetProfile(userId);
      if (!targetProfile) {
        return new Response(
          JSON.stringify({ ok: false, message: 'Usuário alvo não encontrado.' }),
          { status: 404, headers: corsHeaders }
        );
      }

      const previousStatus = targetProfile.ativo;

      // Regra 3: Somente admin desativa outro admin
      if (targetProfile.role === 'admin' && callerProfile.role !== 'admin') {
        return new Response(
          JSON.stringify({ ok: false, message: 'Apenas Administradores podem alterar a ativação de um Administrador.' }),
          { status: 403, headers: corsHeaders }
        );
      }

      // Regra 4: Anti-lockout: Proibir auto-desativação
      if (callerId === userId && !ativo) {
        return new Response(
          JSON.stringify({ ok: false, message: 'Você não pode desativar seu próprio acesso.' }),
          { status: 400, headers: corsHeaders }
        );
      }

      // Se desativando um admin, garantir pelo menos mais 1 ativo
      if (targetProfile.role === 'admin' && !ativo) {
        const activeAdmins = await countActiveAdmins();
        if (activeAdmins <= 1) {
          return new Response(
            JSON.stringify({ ok: false, message: 'Operação bloqueada: o sistema precisa manter ao menos um Administrador ativo.' }),
            { status: 400, headers: corsHeaders }
          );
        }
      }

      // Atualiza profiles.ativo (corta acesso em 0ms no RLS do banco)
      const { error: updErr } = await supabaseAdmin
        .from('profiles')
        .update({ ativo, updated_at: new Date().toISOString() })
        .eq('id', userId);

      if (updErr) throw updErr;

      // Bloqueia ou desbloqueia no GoTrue ban_duration ('876000h' ~ 100 anos ou 'none')
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        ban_duration: ativo ? 'none' : '876000h'
      });

      // Registro de auditoria corporativa
      await recordAuditLog({
        action: 'status_toggled',
        category: 'seguranca',
        target_id: userId,
        target_label: `${targetProfile.nome} (${targetProfile.email})`,
        details: {
          previousStatus,
          newStatus: ativo,
          targetRole: targetProfile.role,
          targetEmail: targetProfile.email
        }
      });

      return new Response(
        JSON.stringify({
          ok: true,
          message: `Acesso do usuário ${ativo ? 'ativado' : 'desativado'} com sucesso.`
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    // --------------------------------------------------------------------------
    // AÇÃO: 'delete-user'
    // --------------------------------------------------------------------------
    if (action === 'delete-user') {
      const { userId } = body;

      if (!userId || typeof userId !== 'string' || !userId.trim()) {
        return new Response(
          JSON.stringify({ ok: false, message: 'Identificador do usuário (userId) é obrigatório.' }),
          { status: 400, headers: corsHeaders }
        );
      }

      const targetProfile = await getTargetProfile(userId);
      if (!targetProfile) {
        return new Response(
          JSON.stringify({ ok: false, message: 'Usuário alvo não encontrado.' }),
          { status: 404, headers: corsHeaders }
        );
      }

      // Regra 1: Anti-lockout: Bloquear auto-exclusão
      if (callerId === userId) {
        return new Response(
          JSON.stringify({ ok: false, message: 'Você não pode remover sua própria conta de Administrador.' }),
          { status: 400, headers: corsHeaders }
        );
      }

      // Regra 2: Somente admin remove outro admin
      if (targetProfile.role === 'admin' && callerProfile.role !== 'admin') {
        return new Response(
          JSON.stringify({ ok: false, message: 'Apenas Administradores podem remover contas de Administrador.' }),
          { status: 403, headers: corsHeaders }
        );
      }

      // Regra 3: Anti-lockout: Garantir ao menos um admin ativo remanescente
      if (targetProfile.role === 'admin') {
        const activeAdmins = await countActiveAdmins();
        if (activeAdmins <= 1) {
          return new Response(
            JSON.stringify({ ok: false, message: 'Operação bloqueada: o sistema precisa manter ao menos um Administrador ativo.' }),
            { status: 400, headers: corsHeaders }
          );
        }
      }

      // 1. Excluir do GoTrue Auth
      const { error: delAuthErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (delAuthErr) {
        console.error('Erro ao excluir usuário no auth.admin:', delAuthErr);
        return new Response(
          JSON.stringify({ ok: false, message: delAuthErr.message || 'Erro ao excluir usuário no sistema de autenticação.' }),
          { status: 400, headers: corsHeaders }
        );
      }

      // 2. Excluir de public.profiles e public.user_onboarding
      await supabaseAdmin.from('user_onboarding').delete().eq('user_id', userId);
      await supabaseAdmin.from('profiles').delete().eq('id', userId);

      // 3. Desvincular de public.pessoas
      await supabaseAdmin.from('pessoas').update({ user_id: null }).eq('user_id', userId);

      // 4. Inserir registro em public.system_audit_logs
      await recordAuditLog({
        action: 'user_deleted',
        category: 'usuarios',
        target_id: userId,
        target_label: `${targetProfile.nome} (${targetProfile.email})`,
        details: {
          targetRole: targetProfile.role,
          targetEmail: targetProfile.email,
          reason: 'Exclusão definitiva de conta'
        }
      });

      return new Response(
        JSON.stringify({
          ok: true,
          message: `Usuário ${targetProfile.nome} removido do sistema com sucesso.`
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({ ok: false, message: `Ação desconhecida: "${action}".` }),
      { status: 400, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Erro não tratado na Edge Function admin-users:', error);
    return new Response(
      JSON.stringify({ ok: false, message: 'Ocorreu um erro interno ao processar a solicitação administrativa.' }),
      { status: 500, headers: corsHeaders }
    );
  }
});
