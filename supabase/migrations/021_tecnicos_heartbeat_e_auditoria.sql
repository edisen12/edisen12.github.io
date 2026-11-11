-- ==============================================================================
-- Migration: 021_tecnicos_heartbeat_e_auditoria.sql
-- Sincronização em tempo real (heartbeat) e auditoria para gestão de técnicos offshore
-- Garante que inserções, edições e exclusões no cadastro mestre de técnicos reflitam
-- instantaneamente em todas as sessões conectadas e fiquem registradas no log WORM
-- ==============================================================================

-- 1. Heartbeat em tempo real para sincronização automática
DROP TRIGGER IF EXISTS trg_heartbeat_tecnicos ON public.tecnicos;
CREATE TRIGGER trg_heartbeat_tecnicos
AFTER INSERT OR UPDATE OR DELETE ON public.tecnicos
FOR EACH STATEMENT EXECUTE FUNCTION public.fn_touch_heartbeat();

-- 2. Trigger de Auditoria Forense WORM (system_audit_logs)
CREATE OR REPLACE FUNCTION public.fn_audit_tecnicos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor_id uuid;
  v_action text;
  v_old_data jsonb;
  v_new_data jsonb;
  v_label text;
BEGIN
  v_actor_id := auth.uid();

  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
    v_new_data := to_jsonb(NEW);
    v_label := NEW.nome || ' (Mat. ' || NEW.matricula || ')';
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'update';
    v_old_data := to_jsonb(OLD);
    v_new_data := to_jsonb(NEW);
    v_label := NEW.nome || ' (Mat. ' || NEW.matricula || ')';
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_old_data := to_jsonb(OLD);
    v_label := OLD.nome || ' (Mat. ' || OLD.matricula || ')';
  END IF;

  INSERT INTO public.system_audit_logs (
    user_id,
    action,
    category,
    target_id,
    target_label,
    details
  ) VALUES (
    v_actor_id,
    v_action,
    'cadastros',
    COALESCE(NEW.matricula, OLD.matricula),
    v_label,
    jsonb_build_object(
      'tabela', 'tecnicos',
      'antes', v_old_data,
      'depois', v_new_data
    )
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_tecnicos ON public.tecnicos;
CREATE TRIGGER trg_audit_tecnicos
  AFTER INSERT OR UPDATE OR DELETE ON public.tecnicos
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_audit_tecnicos();

REVOKE EXECUTE ON FUNCTION public.fn_audit_tecnicos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_audit_tecnicos() TO authenticated, service_role;
