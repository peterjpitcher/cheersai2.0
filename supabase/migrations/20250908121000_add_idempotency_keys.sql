-- Idempotency keys for publish operations
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_unique
ON idempotency_keys (tenant_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_idempotency_created_at
ON idempotency_keys (created_at);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = 'idempotency_keys' AND policyname = 'Tenant read own idempotency keys'
  ) THEN
    CREATE POLICY "Tenant read own idempotency keys"
      ON idempotency_keys FOR SELECT
      USING (tenant_id = get_auth_tenant_id());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = 'idempotency_keys' AND policyname = 'Tenant insert own idempotency keys'
  ) THEN
    CREATE POLICY "Tenant insert own idempotency keys"
      ON idempotency_keys FOR INSERT
      WITH CHECK (tenant_id = get_auth_tenant_id());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = 'idempotency_keys' AND policyname = 'Tenant update own idempotency keys'
  ) THEN
    CREATE POLICY "Tenant update own idempotency keys"
      ON idempotency_keys FOR UPDATE
      USING (tenant_id = get_auth_tenant_id());
  END IF;
END $$;

