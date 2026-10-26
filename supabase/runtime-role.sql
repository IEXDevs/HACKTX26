-- Run only after approval to create astronom_app. No password belongs here.
-- This login owns only the private app schema. It receives no public/auth/storage grants.
GRANT astronom_app TO postgres;
ALTER SCHEMA astronom OWNER TO astronom_app;
DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'astronom' LOOP
    EXECUTE format('ALTER TABLE astronom.%I OWNER TO astronom_app', item.tablename);
  END LOOP;
END $$;
REVOKE ALL ON SCHEMA astronom FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA astronom FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA astronom FROM PUBLIC, anon, authenticated;
