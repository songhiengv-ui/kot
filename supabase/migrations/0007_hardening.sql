-- Phase 6 security review: two private helpers kept Postgres' default EXECUTE-to-PUBLIC. Unreachable in practice
-- (anon has no USAGE on schema private; handle_new_user is a trigger function; check_item only runs inside
-- definer RPCs as the owner) — revoked anyway for defense in depth.
revoke all on function private.handle_new_user() from public;
revoke all on function private.check_item(jsonb) from public;
