-- Optional Production hardening (run manually after partner redemption frontend is deployed)
-- Removes anon EXECUTE on partner redemption RPC; authenticated partner JWT still required at runtime.
-- Does NOT modify the function body.

REVOKE EXECUTE ON FUNCTION public.redeem_voucher_for_partner(uuid, text) FROM anon;
