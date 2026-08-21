-- Store the Supabase anon key in Vault so cron jobs can reference it at runtime
-- instead of hardcoding the JWT in SQL. To update the key, run:
--   SELECT vault.update_secret(<secret_id>, '<new_key>');
-- Or delete and re-create:
--   DELETE FROM vault.secrets WHERE name = 'supabase_anon_key';

CREATE EXTENSION IF NOT EXISTS supabase_vault;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'supabase_anon_key') THEN
    PERFORM vault.create_secret(
      current_setting('app.settings.supabase_anon_key'),
      'supabase_anon_key',
      'Supabase anon/public API key for cron job HTTP calls'
    );
  END IF;
END $$;
