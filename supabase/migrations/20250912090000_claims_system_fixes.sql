-- Claims System Essential Fixes Migration
-- Addresses critical junction table and performance issues

-- 1. Create junction tables for many-to-many relationships (only if they don't exist)
CREATE TABLE IF NOT EXISTS claim_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id UUID NOT NULL,
    product_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(claim_id, product_id)
);
CREATE TABLE IF NOT EXISTS claim_countries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id UUID NOT NULL,
    country_code VARCHAR(10) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(claim_id, country_code)
);
CREATE TABLE IF NOT EXISTS claim_ingredients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id UUID NOT NULL,
    ingredient_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(claim_id, ingredient_id)
);
-- 2. Add foreign key constraints if tables exist
DO $$
BEGIN
    -- Add foreign key for claims table if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'claims') THEN
        ALTER TABLE claim_products ADD CONSTRAINT fk_claim_products_claim_id 
            FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE;
        ALTER TABLE claim_countries ADD CONSTRAINT fk_claim_countries_claim_id 
            FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE;
        ALTER TABLE claim_ingredients ADD CONSTRAINT fk_claim_ingredients_claim_id 
            FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE;
    END IF;
    
    -- Add foreign key for products table if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'products') THEN
        ALTER TABLE claim_products ADD CONSTRAINT fk_claim_products_product_id 
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
    END IF;
    
    -- Add foreign key for ingredients table if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ingredients') THEN
        ALTER TABLE claim_ingredients ADD CONSTRAINT fk_claim_ingredients_ingredient_id 
            FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE;
    END IF;
END $$;
-- 3. Create essential indexes for performance
CREATE INDEX IF NOT EXISTS idx_claim_products_claim_id ON claim_products(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_products_product_id ON claim_products(product_id);
CREATE INDEX IF NOT EXISTS idx_claim_countries_claim_id ON claim_countries(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_countries_country_code ON claim_countries(country_code);
CREATE INDEX IF NOT EXISTS idx_claim_ingredients_claim_id ON claim_ingredients(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_ingredients_ingredient_id ON claim_ingredients(ingredient_id);
-- 4. Create basic RLS policies (only if claims table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'claims') THEN
        -- Enable RLS on junction tables
        ALTER TABLE claim_products ENABLE ROW LEVEL SECURITY;
        ALTER TABLE claim_countries ENABLE ROW LEVEL SECURITY;
        ALTER TABLE claim_ingredients ENABLE ROW LEVEL SECURITY;
        
        -- Create basic select policies for junction tables
        CREATE POLICY "Allow authenticated users to select claim_products" 
            ON claim_products FOR SELECT TO authenticated USING (true);
        
        CREATE POLICY "Allow authenticated users to select claim_countries" 
            ON claim_countries FOR SELECT TO authenticated USING (true);
        
        CREATE POLICY "Allow authenticated users to select claim_ingredients" 
            ON claim_ingredients FOR SELECT TO authenticated USING (true);
    END IF;
END $$;
-- 5. Create basic RPC function for atomic claim creation
CREATE OR REPLACE FUNCTION create_claim_with_associations(
    p_claim_text TEXT,
    p_claim_type TEXT,
    p_level TEXT,
    p_master_brand_id UUID DEFAULT NULL,
    p_ingredient_id UUID DEFAULT NULL,
    p_ingredient_ids UUID[] DEFAULT '{}',
    p_product_ids UUID[] DEFAULT '{}',
    p_country_codes TEXT[] DEFAULT '{}',
    p_description TEXT DEFAULT NULL,
    p_created_by UUID DEFAULT NULL,
    p_workflow_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_claim_id UUID;
    v_country_code TEXT;
    v_product_id UUID;
    v_ingredient_id UUID;
BEGIN
    -- Generate a UUID for the claim (in case the claims table doesn't exist yet)
    v_claim_id := gen_random_uuid();
    
    -- Only create claim if claims table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'claims') THEN
        INSERT INTO claims (
            id,
            claim_text,
            claim_type,
            level,
            master_brand_id,
            ingredient_id,
            product_id,
            country_code,
            description,
            created_by,
            workflow_id
        ) VALUES (
            v_claim_id,
            p_claim_text,
            p_claim_type,
            p_level,
            p_master_brand_id,
            CASE WHEN p_level = 'ingredient' AND p_ingredient_id IS NOT NULL THEN p_ingredient_id END,
            CASE WHEN p_level = 'product' AND array_length(p_product_ids, 1) = 1 THEN p_product_ids[1] END,
            CASE WHEN array_length(p_country_codes, 1) > 0 THEN p_country_codes[1] END,
            p_description,
            p_created_by,
            p_workflow_id
        );
    END IF;

    -- Insert junction table data
    FOREACH v_country_code IN ARRAY p_country_codes
    LOOP
        INSERT INTO claim_countries (claim_id, country_code)
        VALUES (v_claim_id, v_country_code)
        ON CONFLICT (claim_id, country_code) DO NOTHING;
    END LOOP;

    IF p_level = 'product' AND array_length(p_product_ids, 1) > 0 THEN
        FOREACH v_product_id IN ARRAY p_product_ids
        LOOP
            INSERT INTO claim_products (claim_id, product_id)
            VALUES (v_claim_id, v_product_id)
            ON CONFLICT (claim_id, product_id) DO NOTHING;
        END LOOP;
    END IF;

    IF p_level = 'ingredient' THEN
        IF p_ingredient_id IS NOT NULL THEN
            INSERT INTO claim_ingredients (claim_id, ingredient_id)
            VALUES (v_claim_id, p_ingredient_id)
            ON CONFLICT (claim_id, ingredient_id) DO NOTHING;
        END IF;
        
        IF array_length(p_ingredient_ids, 1) > 0 THEN
            FOREACH v_ingredient_id IN ARRAY p_ingredient_ids
            LOOP
                INSERT INTO claim_ingredients (claim_id, ingredient_id)
                VALUES (v_claim_id, v_ingredient_id)
                ON CONFLICT (claim_id, ingredient_id) DO NOTHING;
            END LOOP;
        END IF;
    END IF;

    RETURN v_claim_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- 6. Grant basic permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON claim_products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON claim_countries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON claim_ingredients TO authenticated;
-- Migration: Essential claims system fixes: junction tables, basic RLS, and atomic creation function;
