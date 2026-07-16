-- Supabase advisor WARN (2026-07-16): public.rls_auto_enable() — the event-
-- trigger helper that auto-enables RLS on newly created public tables — was
-- executable by anon/authenticated via PostgREST RPC. It errors outside
-- event-trigger context, so this closes surface rather than a live exploit.
-- Event triggers fire in owner context and need no EXECUTE grant, so the
-- auto-enable behavior is unchanged.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
