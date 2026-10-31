-- 003_harden_function_permissions.sql
-- Hardening de permissões de funções para eliminar exposição SECURITY DEFINER ao papel anon
CREATE OR REPLACE FUNCTION public.ping_health()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT 'ok'::text;
$$;

GRANT EXECUTE ON FUNCTION public.ping_health() TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_justificativas_audit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_justificativas_audit() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_touch_heartbeat() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_touch_heartbeat() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.auth_is_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_is_active() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.auth_is_global() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_is_global() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.auth_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_is_admin() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.auth_allowed_uns() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_allowed_uns() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.auth_allowed_platforms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_allowed_platforms() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.auth_can_access_justificativa(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_can_access_justificativa(text, date) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_watermark_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_watermark_status() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_external_covered_days(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_external_covered_days(date, date) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_shared_ops(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shared_ops(text[]) TO authenticated, service_role;
