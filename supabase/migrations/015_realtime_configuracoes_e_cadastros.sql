-- ==============================================================================
-- Migration: 015_realtime_configuracoes_e_cadastros.sql
-- Sincronização em tempo real (heartbeat) para alterações em configurações contratuais e cadastros mestres
-- Permite que alterações em parâmetros e diretório reflitam instantaneamente em todos os navegadores
-- ==============================================================================

DROP TRIGGER IF EXISTS trg_heartbeat_configuracoes ON public.configuracoes;
CREATE TRIGGER trg_heartbeat_configuracoes
AFTER INSERT OR UPDATE OR DELETE ON public.configuracoes
FOR EACH STATEMENT EXECUTE FUNCTION public.fn_touch_heartbeat();

DROP TRIGGER IF EXISTS trg_heartbeat_config_usoff_un ON public.config_usoff_un;
CREATE TRIGGER trg_heartbeat_config_usoff_un
AFTER INSERT OR UPDATE OR DELETE ON public.config_usoff_un
FOR EACH STATEMENT EXECUTE FUNCTION public.fn_touch_heartbeat();

DROP TRIGGER IF EXISTS trg_heartbeat_plataformas ON public.plataformas;
CREATE TRIGGER trg_heartbeat_plataformas
AFTER INSERT OR UPDATE OR DELETE ON public.plataformas
FOR EACH STATEMENT EXECUTE FUNCTION public.fn_touch_heartbeat();

DROP TRIGGER IF EXISTS trg_heartbeat_pessoas ON public.pessoas;
CREATE TRIGGER trg_heartbeat_pessoas
AFTER INSERT OR UPDATE OR DELETE ON public.pessoas
FOR EACH STATEMENT EXECUTE FUNCTION public.fn_touch_heartbeat();
