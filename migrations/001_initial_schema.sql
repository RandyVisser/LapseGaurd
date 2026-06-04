-- LapseGuard initial schema

CREATE TABLE IF NOT EXISTS hoas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hoa_id UUID NOT NULL REFERENCES hoas(id) ON DELETE CASCADE,
    unit_number TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    supabase_user_id UUID UNIQUE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TYPE policy_status AS ENUM ('active', 'expiring', 'lapsed', 'missing');

CREATE TABLE IF NOT EXISTS policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    insurer TEXT,
    policy_number TEXT,
    expiration_date DATE,
    status policy_status NOT NULL DEFAULT 'missing',
    document_url TEXT,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hoa_id UUID NOT NULL REFERENCES hoas(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    file_url TEXT NOT NULL,
    uploaded_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed a demo HOA and unit for local dev
INSERT INTO hoas (id, name, address) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Sunset Villas HOA', '123 Palm Ave, Miami, FL 33101')
ON CONFLICT DO NOTHING;

INSERT INTO units (id, hoa_id, unit_number) VALUES
    ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', '101'),
    ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', '102'),
    ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', '103')
ON CONFLICT DO NOTHING;
