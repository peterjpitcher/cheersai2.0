-- Complete Production Schema Migration
-- Generated: 2025-01-04
-- This migration creates the complete database schema from scratch

BEGIN;
-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "moddatetime" WITH SCHEMA "extensions";
-- Create custom types
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'claim_category_enum' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "public"."claim_category_enum" AS ENUM (
        'Quality',
        'Dairy Base',
        'Texture',
        'Specific Ingredients',
        'Product Quality',
        'Ingredient Simplicity',
        'Dietary Restrictions',
        'Origin of ingredient',
        'No/No/No',
        'Stabilisers/Additives',
        'Heritage',
        'Craftmanship',
        'Best consumed',
        'Coating',
        'General',
        'Brand Promise',
        'Brand Tag Line',
        'Allergen Information',
        'Nutritional Information',
        'Sustainability/Sourcing',
        'Promotional'
    );
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'claim_level_enum' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "public"."claim_level_enum" AS ENUM (
        'brand',
        'product',
        'ingredient'
    );
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'claim_type_enum' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "public"."claim_type_enum" AS ENUM (
        'allowed',
        'disallowed'
    );
  END IF;
END;
$$;
COMMENT ON TYPE "public"."claim_type_enum" IS 'Claim types restricted to allowed and disallowed only. Mandatory and conditional types were removed on 2025-01-20.';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'content_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "public"."content_status" AS ENUM (
        'draft',
        'pending_review',
        'approved',
        'published',
        'rejected',
        'cancelled'
    );
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'feedback_priority' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "public"."feedback_priority" AS ENUM (
        'low',
        'medium',
        'high',
        'critical'
    );
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'feedback_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "public"."feedback_status" AS ENUM (
        'open',
        'in_progress',
        'resolved',
        'closed',
        'wont_fix'
    );
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'feedback_type' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "public"."feedback_type" AS ENUM (
        'bug',
        'enhancement'
    );
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'tool_run_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "public"."tool_run_status" AS ENUM (
        'success',
        'failure'
    );
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'user_brand_role_enum' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "public"."user_brand_role_enum" AS ENUM (
        'admin',
        'editor',
        'viewer'
    );
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'user_role' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "public"."user_role" AS ENUM (
        'admin',
        'editor',
        'viewer'
    );
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'vetting_agency_priority_level' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "public"."vetting_agency_priority_level" AS ENUM (
        'High',
        'Medium',
        'Low'
    );
  END IF;
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'workflow_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "public"."workflow_status" AS ENUM (
        'active',
        'draft',
        'archived'
    );
  END IF;
END;
$$;
-- Create tables in dependency order

-- Analytics table
CREATE TABLE IF NOT EXISTS "public"."analytics" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "content_id" "uuid",
    "views" integer DEFAULT 0,
    "shares" integer DEFAULT 0,
    "likes" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
-- Master claim brands (formerly global_claim_brands)
CREATE TABLE IF NOT EXISTS "public"."master_claim_brands" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "mixerai_brand_id" "uuid"
);
COMMENT ON TABLE "public"."master_claim_brands" IS 'Stores master brand entities for claims management. (Renamed from global_claim_brands)';
COMMENT ON COLUMN "public"."master_claim_brands"."id" IS 'Unique identifier for the global claim brand.';
COMMENT ON COLUMN "public"."master_claim_brands"."name" IS 'Name of the global claim brand (e.g., "Häagen-Dazs", "Betty Crocker"). Must be unique.';
COMMENT ON COLUMN "public"."master_claim_brands"."created_at" IS 'Timestamp of when the global claim brand was created.';
COMMENT ON COLUMN "public"."master_claim_brands"."updated_at" IS 'Timestamp of when the global claim brand was last updated.';
COMMENT ON COLUMN "public"."master_claim_brands"."mixerai_brand_id" IS 'Foreign key linking to the main MixerAI brands table. Enables permissions based on main brand ownership and cascades deletes.';
-- Brands table
CREATE TABLE IF NOT EXISTS "public"."brands" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "website_url" "text",
    "country" "text",
    "language" "text",
    "brand_identity" "text",
    "tone_of_voice" "text",
    "guardrails" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "brand_color" "text" DEFAULT '#3498db'::"text",
    "brand_summary" "text",
    "brand_admin_id" "uuid",
    "normalized_website_domain" "text",
    "content_vetting_agencies" "text"[],
    "approved_content_types" "jsonb",
    "master_claim_brand_id" "uuid",
    "website_urls" "jsonb" DEFAULT '[]'::"jsonb",
    "logo_url" "text",
    "additional_website_urls" "text"[] DEFAULT ARRAY[]::"text"[],
    CONSTRAINT "check_website_urls_is_array" CHECK (("jsonb_typeof"("website_urls") = 'array'::"text"))
);
ALTER TABLE ONLY "public"."brands" FORCE ROW LEVEL SECURITY;
COMMENT ON COLUMN "public"."brands"."brand_color" IS 'HEX color code for brand visual identity, generated by AI or manually set';
COMMENT ON COLUMN "public"."brands"."brand_summary" IS 'Short summary of the brand for display in listings';
COMMENT ON COLUMN "public"."brands"."brand_admin_id" IS 'Designated admin for handling rejected content in workflows';
COMMENT ON COLUMN "public"."brands"."content_vetting_agencies" IS 'Array of IDs or names of selected content vetting agencies associated with the brand.';
COMMENT ON COLUMN "public"."brands"."approved_content_types" IS 'JSONB array or object storing approved content types for the brand (e.g., array of content type IDs or names).';
COMMENT ON COLUMN "public"."brands"."master_claim_brand_id" IS 'Foreign key to the master_claim_brands table, linking a brand to its corresponding master claim brand for claims management.';
COMMENT ON COLUMN "public"."brands"."website_urls" IS 'Array of website URLs with structure: [{id: string, url: string, isPrimary?: boolean}]';
COMMENT ON COLUMN "public"."brands"."logo_url" IS 'URL to brand logo image stored in Supabase Storage or external URL';
COMMENT ON COLUMN "public"."brands"."additional_website_urls" IS 'Additional website URLs associated with the brand';
-- Junction table for brand master claim brands (NOTE: Fixed from brand_master_claims to master_claim_brands)
CREATE TABLE IF NOT EXISTS "public"."brand_master_claim_brands" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "master_claim_brand_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);
COMMENT ON TABLE "public"."brand_master_claim_brands" IS 'Junction table linking MixerAI brands to master claim brands in a many-to-many relationship';
-- Content vetting agencies
CREATE TABLE IF NOT EXISTS "public"."content_vetting_agencies" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "country_code" character varying(2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "priority" "public"."vetting_agency_priority_level"
);
-- Brand selected agencies
CREATE TABLE IF NOT EXISTS "public"."brand_selected_agencies" (
    "brand_id" "uuid" NOT NULL,
    "agency_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);
-- Countries
CREATE TABLE IF NOT EXISTS "public"."countries" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "code" character(2) NOT NULL,
    "name" character varying(255) NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
-- Ingredients
CREATE TABLE IF NOT EXISTS "public"."ingredients" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
COMMENT ON TABLE "public"."ingredients" IS 'Stores information about ingredients that can be used in products.';
COMMENT ON COLUMN "public"."ingredients"."name" IS 'Name of the ingredient, must be unique.';
COMMENT ON COLUMN "public"."ingredients"."description" IS 'Optional description for the ingredient.';
-- Products
CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "master_brand_id" "uuid"
);
COMMENT ON TABLE "public"."products" IS 'Stores information about individual products, linked to a global_claim_brand.';
COMMENT ON COLUMN "public"."products"."name" IS 'Name of the product, unique within its brand.';
COMMENT ON COLUMN "public"."products"."description" IS 'Optional description for the product.';
COMMENT ON COLUMN "public"."products"."master_brand_id" IS 'Foreign key referencing the master_claim_brands(id) this product belongs to. (Renamed from global_brand_id)';
-- Product ingredients junction table
CREATE TABLE IF NOT EXISTS "public"."product_ingredients" (
    "product_id" "uuid" NOT NULL,
    "ingredient_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);
COMMENT ON TABLE "public"."product_ingredients" IS 'Join table linking products to their ingredients.';
-- Claims workflows
CREATE TABLE IF NOT EXISTS "public"."claims_workflows" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "brand_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL
);
COMMENT ON TABLE "public"."claims_workflows" IS 'Workflow definitions specifically for claims approval processes';
COMMENT ON COLUMN "public"."claims_workflows"."brand_id" IS 'Optional brand association - claims workflows are typically global';
-- Claims workflow steps
CREATE TABLE IF NOT EXISTS "public"."claims_workflow_steps" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "step_order" integer NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "role" "text" NOT NULL,
    "approval_required" boolean DEFAULT true NOT NULL,
    "assigned_user_ids" "uuid"[] DEFAULT ARRAY[]::"uuid"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "claims_workflow_steps_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'editor'::"text", 'viewer'::"text", 'legal'::"text", 'compliance'::"text", 'marketing'::"text", 'lrc'::"text", 'bdt'::"text", 'mat'::"text", 'sme'::"text"])))
);
COMMENT ON TABLE "public"."claims_workflow_steps" IS 'Steps within claims approval workflows';
COMMENT ON COLUMN "public"."claims_workflow_steps"."role" IS 'Role required to complete this step (includes legal, lrc, bdt, mat, sme)';
-- Claims
CREATE TABLE IF NOT EXISTS "public"."claims" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "claim_text" "text" NOT NULL,
    "claim_type" "public"."claim_type_enum" NOT NULL,
    "level" "public"."claim_level_enum" NOT NULL,
    "product_id" "uuid",
    "ingredient_id" "uuid",
    "country_code" "text",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "master_brand_id" "uuid",
    "created_by" "uuid",
    "workflow_id" "uuid",
    "current_workflow_step" "uuid",
    "workflow_status" "public"."content_status" DEFAULT 'draft'::"public"."content_status",
    "completed_workflow_steps" "uuid"[] DEFAULT ARRAY[]::"uuid"[],
    "updated_by" "uuid",
    CONSTRAINT "chk_claim_level_reference" CHECK (((("level" = 'brand'::"public"."claim_level_enum") AND ("master_brand_id" IS NOT NULL) AND ("product_id" IS NULL) AND ("ingredient_id" IS NULL)) OR (("level" = 'product'::"public"."claim_level_enum") AND ("product_id" IS NOT NULL) AND ("master_brand_id" IS NULL) AND ("ingredient_id" IS NULL)) OR (("level" = 'ingredient'::"public"."claim_level_enum") AND ("ingredient_id" IS NOT NULL) AND ("master_brand_id" IS NULL) AND ("product_id" IS NULL))))
);
COMMENT ON TABLE "public"."claims" IS 'Stores marketing claims related to brands, products, or ingredients.';
COMMENT ON COLUMN "public"."claims"."claim_text" IS 'The actual text of the claim.';
COMMENT ON COLUMN "public"."claims"."claim_type" IS 'allowed: Can be used freely, disallowed: Cannot be used, conditional: Has specific conditions, mandatory: Must be included';
COMMENT ON COLUMN "public"."claims"."level" IS 'brand: Applies to entire brand, product: Specific to a product/SKU, ingredient: Specific to an ingredient';
COMMENT ON COLUMN "public"."claims"."product_id" IS 'DEPRECATED: Use claim_products junction table instead';
COMMENT ON COLUMN "public"."claims"."ingredient_id" IS 'FK to ingredients table if claim is at ingredient level. NULL otherwise.';
COMMENT ON COLUMN "public"."claims"."country_code" IS 'DEPRECATED: Use claim_countries junction table instead';
COMMENT ON COLUMN "public"."claims"."description" IS 'Optional internal notes or context about the claim.';
COMMENT ON COLUMN "public"."claims"."master_brand_id" IS 'FK to master_claim_brands(id) if claim is at brand level. (Renamed from global_brand_id)';
COMMENT ON COLUMN "public"."claims"."created_by" IS 'Tracks the user ID of the user who originally created the claim. References auth.users.';
COMMENT ON COLUMN "public"."claims"."workflow_id" IS 'Optional workflow for claim approval process';
COMMENT ON COLUMN "public"."claims"."current_workflow_step" IS 'Current step in the approval workflow';
COMMENT ON COLUMN "public"."claims"."workflow_status" IS 'Status of the claim in the workflow';
-- Claim junction tables
CREATE TABLE IF NOT EXISTS "public"."claim_countries" (
    "claim_id" "uuid" NOT NULL,
    "country_code" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);
CREATE TABLE IF NOT EXISTS "public"."claim_ingredients" (
    "claim_id" "uuid" NOT NULL,
    "ingredient_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);
COMMENT ON TABLE "public"."claim_ingredients" IS 'Junction table to support multiple ingredients per claim';
CREATE TABLE IF NOT EXISTS "public"."claim_products" (
    "claim_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);
-- Claim reviews
CREATE TABLE IF NOT EXISTS "public"."claim_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "master_claim_brand_id" "uuid" NOT NULL,
    "country_code" character varying(2) NOT NULL,
    "review_data" "jsonb" NOT NULL,
    "reviewed_by" "uuid" NOT NULL,
    "reviewed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
COMMENT ON TABLE "public"."claim_reviews" IS 'Stores AI-generated claim review results for master claim brands by country';
COMMENT ON COLUMN "public"."claim_reviews"."review_data" IS 'JSON object containing the full review details including individual claim reviews';
-- Claim workflow history
CREATE TABLE IF NOT EXISTS "public"."claim_workflow_history" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "claim_id" "uuid" NOT NULL,
    "workflow_step_id" "uuid",
    "step_name" "text",
    "action_status" "text" NOT NULL,
    "feedback" "text",
    "reviewer_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_claim_text" "text",
    "comment" "text"
);
COMMENT ON TABLE "public"."claim_workflow_history" IS 'Audit trail of claim approval workflow actions';
-- Market claim overrides
CREATE TABLE IF NOT EXISTS "public"."market_claim_overrides" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "master_claim_id" "uuid" NOT NULL,
    "market_country_code" "text" NOT NULL,
    "target_product_id" "uuid" NOT NULL,
    "is_blocked" boolean DEFAULT true NOT NULL,
    "replacement_claim_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
COMMENT ON TABLE "public"."market_claim_overrides" IS 'Stores claim overrides by market. Use __ALL_COUNTRIES__ for global blocks. Precedence: Country-specific > Global > Base claims';
-- Global override audit
CREATE TABLE IF NOT EXISTS "public"."global_override_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "override_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "affected_countries" "text"[] NOT NULL,
    "previous_state" "jsonb",
    "new_state" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "global_override_audit_action_check" CHECK (("action" = ANY (ARRAY['created'::"text", 'updated'::"text", 'deleted'::"text"])))
);
-- Profiles
CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "job_title" "text",
    "company" "text",
    "email" "text",
    "notification_settings" "jsonb" DEFAULT '{"weeklyDigest": false, "productUpdates": true, "marketingEmails": false, "emailNotifications": true, "workflowNotifications": true}'::"jsonb",
    "email_notifications_enabled" boolean DEFAULT true,
    "email_frequency" "text" DEFAULT 'immediate'::"text",
    "email_preferences" "jsonb" DEFAULT '{"task_assignments": true, "workflow_updates": true, "deadline_reminders": true}'::"jsonb",
    CONSTRAINT "profiles_email_frequency_check" CHECK (("email_frequency" = ANY (ARRAY['immediate'::"text", 'daily'::"text", 'weekly'::"text"])))
);
COMMENT ON COLUMN "public"."profiles"."avatar_url" IS 'URL to user profile avatar image stored in Supabase Storage';
COMMENT ON COLUMN "public"."profiles"."job_title" IS 'User''s job title or role within their organization';
COMMENT ON COLUMN "public"."profiles"."company" IS 'Company or organization where the user is employed';
COMMENT ON COLUMN "public"."profiles"."email" IS 'Email address of the user, used for workflows and notifications';
COMMENT ON COLUMN "public"."profiles"."notification_settings" IS 'User notification preferences as JSON object';
COMMENT ON COLUMN "public"."profiles"."email_notifications_enabled" IS 'Whether the user wants to receive email notifications';
COMMENT ON COLUMN "public"."profiles"."email_frequency" IS 'How often the user wants to receive email notifications (immediate, daily digest, weekly digest)';
COMMENT ON COLUMN "public"."profiles"."email_preferences" IS 'JSON object containing email notification preferences for different event types';
-- User brand permissions
CREATE TABLE IF NOT EXISTS "public"."user_brand_permissions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "brand_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "role" "public"."user_brand_role_enum" DEFAULT 'viewer'::"public"."user_brand_role_enum" NOT NULL
);
-- User system roles
CREATE TABLE IF NOT EXISTS "public"."user_system_roles" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_system_roles_role_check" CHECK (("role" = 'superadmin'::"text"))
);
-- Content templates
CREATE TABLE IF NOT EXISTS "public"."content_templates" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "icon" "text",
    "fields" "jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "brand_id" "uuid",
    CONSTRAINT "check_fields_structure" CHECK ((("fields" IS NOT NULL) AND ("jsonb_typeof"("fields") = 'object'::"text") AND ("fields" ? 'inputFields'::"text") AND ("fields" ? 'outputFields'::"text") AND ("jsonb_typeof"(("fields" -> 'inputFields'::"text")) = 'array'::"text") AND ("jsonb_typeof"(("fields" -> 'outputFields'::"text")) = 'array'::"text")))
);
ALTER TABLE ONLY "public"."content_templates" FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE "public"."content_templates" IS 'Stores content template definitions with customizable fields';
COMMENT ON COLUMN "public"."content_templates"."fields" IS 'Template field definitions with structure: {inputFields: InputField[], outputFields: OutputField[]}';
-- Content types
CREATE TABLE IF NOT EXISTS "public"."content_types" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
-- Workflows
CREATE TABLE IF NOT EXISTS "public"."workflows" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "brand_id" "uuid",
    "name" "text" NOT NULL,
    "steps" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "template_id" "uuid",
    "description" "text",
    "status" "public"."workflow_status" DEFAULT 'draft'::"public"."workflow_status" NOT NULL
);
ALTER TABLE ONLY "public"."workflows" FORCE ROW LEVEL SECURITY;
COMMENT ON COLUMN "public"."workflows"."created_by" IS 'The user who created this workflow';
COMMENT ON COLUMN "public"."workflows"."status" IS 'The current status of the workflow (e.g., active, draft, archived).';
-- Workflow steps
CREATE TABLE IF NOT EXISTS "public"."workflow_steps" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "step_order" integer NOT NULL,
    "role" "text",
    "description" "text",
    "is_optional" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "approval_required" boolean DEFAULT false,
    "step_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"(),
    "assigned_user_ids" "uuid"[]
);
-- Workflow user assignments
CREATE TABLE IF NOT EXISTS "public"."workflow_user_assignments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "workflow_id" "uuid",
    "step_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
-- Workflow invitations
CREATE TABLE IF NOT EXISTS "public"."workflow_invitations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "workflow_id" "uuid",
    "email" "text" NOT NULL,
    "role" "text" NOT NULL,
    "invite_token" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone NOT NULL,
    "step_id" "uuid",
    "user_id" "uuid"
);
-- User invitations
CREATE TABLE IF NOT EXISTS "public"."user_invitations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "email" "text" NOT NULL,
    "invite_token" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "invitation_source" "text" NOT NULL,
    "source_id" "uuid",
    "invited_by" "uuid",
    "role" "text" NOT NULL,
    "last_reminder_at" timestamp with time zone,
    "reminder_count" integer DEFAULT 0,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_invitations_invitation_source_check" CHECK (("invitation_source" = ANY (ARRAY['workflow'::"text", 'brand'::"text", 'system'::"text"]))),
    CONSTRAINT "user_invitations_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'editor'::"text", 'viewer'::"text", 'superadmin'::"text"]))),
    CONSTRAINT "user_invitations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'expired'::"text"])))
);
ALTER TABLE ONLY "public"."user_invitations" FORCE ROW LEVEL SECURITY;
-- Content
CREATE TABLE IF NOT EXISTS "public"."content" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "brand_id" "uuid",
    "workflow_id" "uuid",
    "created_by" "uuid",
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "meta_title" "text",
    "meta_description" "text",
    "status" "public"."content_status" DEFAULT 'draft'::"public"."content_status" NOT NULL,
    "current_step" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "template_id" "uuid",
    "content_data" "jsonb",
    "version" integer DEFAULT 1,
    "published_version" integer,
    "content_type_id" "uuid",
    "assigned_to" "uuid"[],
    "fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "due_date" timestamp with time zone
);
ALTER TABLE ONLY "public"."content" FORCE ROW LEVEL SECURITY;
COMMENT ON COLUMN "public"."content"."assigned_to" IS 'Array of user IDs assigned to the current step of the content. No direct FK to profiles; integrity checked by app.';
COMMENT ON COLUMN "public"."content"."fields" IS 'Stores data for custom fields defined in a content template.';
COMMENT ON COLUMN "public"."content"."due_date" IS 'Optional due date for content completion';
-- Content ownership history
CREATE TABLE IF NOT EXISTS "public"."content_ownership_history" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "content_id" "uuid",
    "previous_owner" "uuid",
    "new_owner" "uuid",
    "changed_by" "uuid",
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);
-- Content versions
CREATE TABLE IF NOT EXISTS "public"."content_versions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "content_id" "uuid" NOT NULL,
    "workflow_step_identifier" "text" NOT NULL,
    "step_name" "text",
    "version_number" integer NOT NULL,
    "content_json" "jsonb",
    "action_status" "text" NOT NULL,
    "feedback" "text",
    "reviewer_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
COMMENT ON TABLE "public"."content_versions" IS 'Tracks versions of content as it moves through approval steps';
-- User tasks
CREATE TABLE IF NOT EXISTS "public"."user_tasks" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "content_id" "uuid" NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "workflow_step_id" "uuid" NOT NULL,
    "workflow_step_name" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "due_date" timestamp with time zone
);
COMMENT ON TABLE "public"."user_tasks" IS 'Stores tasks assigned to users for specific content workflow steps.';
COMMENT ON COLUMN "public"."user_tasks"."workflow_step_id" IS 'Identifier of the workflow step, currently expected to be the 0-based index of the step in the workflow.steps JSONB array.';
COMMENT ON COLUMN "public"."user_tasks"."status" IS 'Status of the task, e.g., pending, in_progress, completed, rejected.';
-- Feedback items
CREATE TABLE IF NOT EXISTS "public"."feedback_items" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "type" "public"."feedback_type" NOT NULL,
    "title" "text",
    "description" "text",
    "priority" "public"."feedback_priority" NOT NULL,
    "status" "public"."feedback_status" DEFAULT 'open'::"public"."feedback_status" NOT NULL,
    "affected_area" "text",
    "steps_to_reproduce" "text",
    "expected_behavior" "text",
    "actual_behavior" "text",
    "attachments_metadata" "jsonb",
    "app_version" "text",
    "user_impact_details" "text",
    "url" "text",
    "browser_info" "text",
    "os_info" "text",
    "resolution_details" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "assigned_to" "uuid",
    "updated_by" "uuid"
);
COMMENT ON TABLE "public"."feedback_items" IS 'Stores bug reports and enhancement requests submitted by users.';
-- Notifications
CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "type" "text" NOT NULL,
    "is_read" boolean DEFAULT false,
    "action_url" "text",
    "action_label" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_archived" boolean DEFAULT false NOT NULL,
    "archived_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"()
);
COMMENT ON TABLE "public"."notifications" IS 'Stores user notifications for in-app notification system';
COMMENT ON COLUMN "public"."notifications"."type" IS 'Notification type: success, error, warning, or info';
COMMENT ON COLUMN "public"."notifications"."is_archived" IS 'Soft delete flag - archived notifications are hidden but not deleted';
-- Invitation logs
CREATE TABLE IF NOT EXISTS "public"."invitation_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "email" "text" NOT NULL,
    "success" boolean NOT NULL,
    "error_message" "text",
    "invited_by" "uuid",
    "brand_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);
-- Security logs
CREATE TABLE IF NOT EXISTS "public"."security_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text" NOT NULL,
    "user_id" "uuid",
    "ip_address" "text",
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "timestamp" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);
COMMENT ON TABLE "public"."security_logs" IS 'Audit trail for security-related events like login attempts, password changes, and permission modifications';
-- Tool run history (with batch support)
CREATE TABLE IF NOT EXISTS "public"."tool_run_history" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "tool_name" "text" NOT NULL,
    "brand_id" "uuid",
    "inputs" "jsonb" NOT NULL,
    "outputs" "jsonb" NOT NULL,
    "run_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "public"."tool_run_status" DEFAULT 'success'::"public"."tool_run_status" NOT NULL,
    "error_message" "text",
    "batch_id" "uuid",
    "batch_sequence" integer,
    CONSTRAINT "check_tool_name" CHECK (("tool_name" = ANY (ARRAY['alt_text_generator'::"text", 'metadata_generator'::"text", 'content_transcreator'::"text"])))
);
COMMENT ON TABLE "public"."tool_run_history" IS 'Stores the history of runs for various AI tools.';
COMMENT ON COLUMN "public"."tool_run_history"."user_id" IS 'The user who ran the tool. Becomes NULL if the user is deleted.';
COMMENT ON COLUMN "public"."tool_run_history"."tool_name" IS 'Identifier for the tool that was run (e.g., alt_text_generator).';
COMMENT ON COLUMN "public"."tool_run_history"."brand_id" IS 'Optional brand associated with this tool run. Becomes NULL if the brand is deleted.';
COMMENT ON COLUMN "public"."tool_run_history"."inputs" IS 'JSON object containing the input parameters for the tool run.';
COMMENT ON COLUMN "public"."tool_run_history"."outputs" IS 'JSON object containing the results generated by the tool.';
COMMENT ON COLUMN "public"."tool_run_history"."run_at" IS 'Timestamp of when the tool run was executed.';
COMMENT ON COLUMN "public"."tool_run_history"."status" IS 'Status of the tool run (success or failure).';
COMMENT ON COLUMN "public"."tool_run_history"."error_message" IS 'Error message if the tool run failed.';
COMMENT ON COLUMN "public"."tool_run_history"."batch_id" IS 'Groups multiple tool runs that were executed together as a batch';
COMMENT ON COLUMN "public"."tool_run_history"."batch_sequence" IS 'Order of execution within a batch (1, 2, 3, etc.)';
-- Add all primary keys
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'analytics_pkey' AND conrelid = 'public.analytics'::regclass
  ) THEN
    ALTER TABLE ONLY "public"."analytics"
      ADD CONSTRAINT "analytics_pkey" PRIMARY KEY ("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'brand_master_claim_brands_brand_id_master_claim_brand_id_key' 
      AND conrelid = 'public.brand_master_claim_brands'::regclass
  ) THEN
    ALTER TABLE ONLY "public"."brand_master_claim_brands"
      ADD CONSTRAINT "brand_master_claim_brands_brand_id_master_claim_brand_id_key" UNIQUE ("brand_id", "master_claim_brand_id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'brand_master_claim_brands_pkey' 
      AND conrelid = 'public.brand_master_claim_brands'::regclass
  ) THEN
    ALTER TABLE ONLY "public"."brand_master_claim_brands"
      ADD CONSTRAINT "brand_master_claim_brands_pkey" PRIMARY KEY ("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'brand_selected_agencies_pkey' 
      AND conrelid = 'public.brand_selected_agencies'::regclass
  ) THEN
    ALTER TABLE ONLY "public"."brand_selected_agencies"
      ADD CONSTRAINT "brand_selected_agencies_pkey" PRIMARY KEY ("brand_id", "agency_id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'brands_pkey' 
      AND conrelid = 'public.brands'::regclass
  ) THEN
    ALTER TABLE ONLY "public"."brands"
      ADD CONSTRAINT "brands_pkey" PRIMARY KEY ("id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'claim_countries_pkey' 
      AND conrelid = 'public.claim_countries'::regclass
  ) THEN
    ALTER TABLE ONLY "public"."claim_countries"
      ADD CONSTRAINT "claim_countries_pkey" PRIMARY KEY ("claim_id", "country_code");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'claim_ingredients_pkey' 
      AND conrelid = 'public.claim_ingredients'::regclass
  ) THEN
    ALTER TABLE ONLY "public"."claim_ingredients"
      ADD CONSTRAINT "claim_ingredients_pkey" PRIMARY KEY ("claim_id", "ingredient_id");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'claim_products_pkey' 
      AND conrelid = 'public.claim_products'::regclass
  ) THEN
    ALTER TABLE ONLY "public"."claim_products"
      ADD CONSTRAINT "claim_products_pkey" PRIMARY KEY ("claim_id", "product_id");
  END IF;
END $$;
ALTER TABLE ONLY "public"."claim_reviews"
    ADD CONSTRAINT "claim_reviews_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."claim_workflow_history"
    ADD CONSTRAINT "claim_workflow_history_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_uniqueness" UNIQUE ("claim_text", "level", "master_brand_id", "product_id", "ingredient_id", "country_code", "claim_type");
ALTER TABLE ONLY "public"."claims_workflow_steps"
    ADD CONSTRAINT "claims_workflow_steps_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."claims_workflow_steps"
    ADD CONSTRAINT "claims_workflow_steps_workflow_id_step_order_key" UNIQUE ("workflow_id", "step_order");
ALTER TABLE ONLY "public"."claims_workflows"
    ADD CONSTRAINT "claims_workflows_name_key" UNIQUE ("name");
ALTER TABLE ONLY "public"."claims_workflows"
    ADD CONSTRAINT "claims_workflows_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."content_ownership_history"
    ADD CONSTRAINT "content_ownership_history_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."content"
    ADD CONSTRAINT "content_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."content_templates"
    ADD CONSTRAINT "content_templates_name_unique" UNIQUE ("name");
ALTER TABLE ONLY "public"."content_templates"
    ADD CONSTRAINT "content_templates_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."content_types"
    ADD CONSTRAINT "content_types_name_key" UNIQUE ("name");
ALTER TABLE ONLY "public"."content_types"
    ADD CONSTRAINT "content_types_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."content_versions"
    ADD CONSTRAINT "content_versions_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."content_vetting_agencies"
    ADD CONSTRAINT "content_vetting_agencies_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."countries"
    ADD CONSTRAINT "countries_code_key" UNIQUE ("code");
ALTER TABLE ONLY "public"."countries"
    ADD CONSTRAINT "countries_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."feedback_items"
    ADD CONSTRAINT "feedback_items_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."master_claim_brands"
    ADD CONSTRAINT "global_claim_brands_name_key" UNIQUE ("name");
ALTER TABLE ONLY "public"."master_claim_brands"
    ADD CONSTRAINT "global_claim_brands_name_unique" UNIQUE ("name");
ALTER TABLE ONLY "public"."master_claim_brands"
    ADD CONSTRAINT "global_claim_brands_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."global_override_audit"
    ADD CONSTRAINT "global_override_audit_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."ingredients"
    ADD CONSTRAINT "ingredients_name_unique" UNIQUE ("name");
ALTER TABLE ONLY "public"."ingredients"
    ADD CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."invitation_logs"
    ADD CONSTRAINT "invitation_logs_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."market_claim_overrides"
    ADD CONSTRAINT "market_claim_overrides_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."market_claim_overrides"
    ADD CONSTRAINT "market_claim_overrides_uniqueness" UNIQUE ("master_claim_id", "market_country_code", "target_product_id");
ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."product_ingredients"
    ADD CONSTRAINT "product_ingredients_pkey" PRIMARY KEY ("product_id", "ingredient_id");
ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_global_brand_id_name_unique" UNIQUE ("master_brand_id", "name");
ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_name_master_brand_id_key" UNIQUE ("name", "master_brand_id");
ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."security_logs"
    ADD CONSTRAINT "security_logs_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."tool_run_history"
    ADD CONSTRAINT "tool_run_history_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."content_vetting_agencies"
    ADD CONSTRAINT "unique_agency_name_country" UNIQUE ("name", "country_code");
ALTER TABLE ONLY "public"."ingredients"
    ADD CONSTRAINT "uq_ingredients_name" UNIQUE ("name");
ALTER TABLE ONLY "public"."user_tasks"
    ADD CONSTRAINT "uq_user_content_step" UNIQUE ("user_id", "content_id", "workflow_step_id");
-- Add primary key constraint only if id column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_brand_permissions'
    AND column_name = 'id'
    AND table_schema = 'public'
  ) THEN
    ALTER TABLE ONLY "public"."user_brand_permissions"
        ADD CONSTRAINT "user_brand_permissions_pkey" PRIMARY KEY ("id");
  END IF;
END $$;
-- Add unique constraint for user_id, brand_id (always safe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
    AND t.relname = 'user_brand_permissions'
    AND c.conname = 'user_brand_permissions_user_id_brand_id_key'
  ) THEN
    ALTER TABLE ONLY "public"."user_brand_permissions"
        ADD CONSTRAINT "user_brand_permissions_user_id_brand_id_key" UNIQUE ("user_id", "brand_id");
  END IF;
END $$;
ALTER TABLE ONLY "public"."user_invitations"
    ADD CONSTRAINT "user_invitations_invite_token_key" UNIQUE ("invite_token");
ALTER TABLE ONLY "public"."user_invitations"
    ADD CONSTRAINT "user_invitations_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."user_system_roles"
    ADD CONSTRAINT "user_system_roles_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."user_system_roles"
    ADD CONSTRAINT "user_system_roles_user_id_role_key" UNIQUE ("user_id", "role");
ALTER TABLE ONLY "public"."user_tasks"
    ADD CONSTRAINT "user_tasks_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."user_tasks"
    ADD CONSTRAINT "user_tasks_user_content_step_unique" UNIQUE ("user_id", "content_id", "workflow_step_id");
ALTER TABLE ONLY "public"."workflow_invitations"
    ADD CONSTRAINT "workflow_invitations_invite_token_key" UNIQUE ("invite_token");
ALTER TABLE ONLY "public"."workflow_invitations"
    ADD CONSTRAINT "workflow_invitations_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."workflow_steps"
    ADD CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."workflow_steps"
    ADD CONSTRAINT "workflow_steps_workflow_id_step_order_key" UNIQUE ("workflow_id", "step_order");
ALTER TABLE ONLY "public"."workflow_user_assignments"
    ADD CONSTRAINT "workflow_user_assignments_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."workflow_user_assignments"
    ADD CONSTRAINT "workflow_user_assignments_workflow_id_step_id_user_id_key" UNIQUE ("workflow_id", "step_id", "user_id");
ALTER TABLE ONLY "public"."workflows"
    ADD CONSTRAINT "workflows_pkey" PRIMARY KEY ("id");
-- Add all foreign key constraints
ALTER TABLE ONLY "public"."analytics"
    ADD CONSTRAINT "analytics_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."brand_master_claim_brands"
    ADD CONSTRAINT "brand_master_claim_brands_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."brand_master_claim_brands"
    ADD CONSTRAINT "brand_master_claim_brands_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");
ALTER TABLE ONLY "public"."brand_master_claim_brands"
    ADD CONSTRAINT "brand_master_claim_brands_master_claim_brand_id_fkey" FOREIGN KEY ("master_claim_brand_id") REFERENCES "public"."master_claim_brands"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."brand_selected_agencies"
    ADD CONSTRAINT "brand_selected_agencies_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "public"."content_vetting_agencies"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."brand_selected_agencies"
    ADD CONSTRAINT "brand_selected_agencies_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "brands_brand_admin_id_fkey" FOREIGN KEY ("brand_admin_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "brands_master_claim_brand_id_fkey" FOREIGN KEY ("master_claim_brand_id") REFERENCES "public"."master_claim_brands"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."claim_countries"
    ADD CONSTRAINT "claim_countries_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."claim_ingredients"
    ADD CONSTRAINT "claim_ingredients_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."claim_ingredients"
    ADD CONSTRAINT "claim_ingredients_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."claim_products"
    ADD CONSTRAINT "claim_products_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."claim_products"
    ADD CONSTRAINT "claim_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."claim_reviews"
    ADD CONSTRAINT "claim_reviews_master_claim_brand_id_fkey" FOREIGN KEY ("master_claim_brand_id") REFERENCES "public"."master_claim_brands"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."claim_reviews"
    ADD CONSTRAINT "claim_reviews_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id");
ALTER TABLE ONLY "public"."claim_workflow_history"
    ADD CONSTRAINT "claim_workflow_history_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."claim_workflow_history"
    ADD CONSTRAINT "claim_workflow_history_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."claim_workflow_history"
    ADD CONSTRAINT "claim_workflow_history_workflow_step_id_fkey" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."claims_workflow_steps"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_current_workflow_step_fkey" FOREIGN KEY ("current_workflow_step") REFERENCES "public"."claims_workflow_steps"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_master_brand_id_fkey" FOREIGN KEY ("master_brand_id") REFERENCES "public"."master_claim_brands"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."claims_workflows"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."claims_workflow_steps"
    ADD CONSTRAINT "claims_workflow_steps_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."claims_workflows"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."claims_workflows"
    ADD CONSTRAINT "claims_workflows_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."claims_workflows"
    ADD CONSTRAINT "claims_workflows_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."content"
    ADD CONSTRAINT "content_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."content"
    ADD CONSTRAINT "content_content_type_id_fkey" FOREIGN KEY ("content_type_id") REFERENCES "public"."content_types"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."content"
    ADD CONSTRAINT "content_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."content"
    ADD CONSTRAINT "content_current_step_fkey" FOREIGN KEY ("current_step") REFERENCES "public"."workflow_steps"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."content"
    ADD CONSTRAINT "content_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."content_templates"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."content"
    ADD CONSTRAINT "content_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."content_ownership_history"
    ADD CONSTRAINT "content_ownership_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."content_ownership_history"
    ADD CONSTRAINT "content_ownership_history_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."content_ownership_history"
    ADD CONSTRAINT "content_ownership_history_new_owner_fkey" FOREIGN KEY ("new_owner") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."content_ownership_history"
    ADD CONSTRAINT "content_ownership_history_previous_owner_fkey" FOREIGN KEY ("previous_owner") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."content_templates"
    ADD CONSTRAINT "content_templates_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."content_templates"
    ADD CONSTRAINT "content_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."content_versions"
    ADD CONSTRAINT "content_versions_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."content_versions"
    ADD CONSTRAINT "content_versions_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."feedback_items"
    ADD CONSTRAINT "feedback_items_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."feedback_items"
    ADD CONSTRAINT "feedback_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."feedback_items"
    ADD CONSTRAINT "feedback_items_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."global_override_audit"
    ADD CONSTRAINT "global_override_audit_override_id_fkey" FOREIGN KEY ("override_id") REFERENCES "public"."market_claim_overrides"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."global_override_audit"
    ADD CONSTRAINT "global_override_audit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");
ALTER TABLE ONLY "public"."invitation_logs"
    ADD CONSTRAINT "invitation_logs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."invitation_logs"
    ADD CONSTRAINT "invitation_logs_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."market_claim_overrides"
    ADD CONSTRAINT "market_claim_overrides_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."market_claim_overrides"
    ADD CONSTRAINT "market_claim_overrides_master_claim_id_fkey" FOREIGN KEY ("master_claim_id") REFERENCES "public"."claims"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."market_claim_overrides"
    ADD CONSTRAINT "market_claim_overrides_replacement_claim_id_fkey" FOREIGN KEY ("replacement_claim_id") REFERENCES "public"."claims"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."market_claim_overrides"
    ADD CONSTRAINT "market_claim_overrides_target_product_id_fkey" FOREIGN KEY ("target_product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."master_claim_brands"
    ADD CONSTRAINT "master_claim_brands_mixerai_brand_id_fkey" FOREIGN KEY ("mixerai_brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."product_ingredients"
    ADD CONSTRAINT "product_ingredients_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."product_ingredients"
    ADD CONSTRAINT "product_ingredients_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_master_brand_id_fkey" FOREIGN KEY ("master_brand_id") REFERENCES "public"."master_claim_brands"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."security_logs"
    ADD CONSTRAINT "security_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."tool_run_history"
    ADD CONSTRAINT "tool_run_history_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."tool_run_history"
    ADD CONSTRAINT "tool_run_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
-- Add foreign key constraints only if they don't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
    AND t.relname = 'user_brand_permissions'
    AND c.conname = 'user_brand_permissions_brand_id_fkey'
  ) THEN
    ALTER TABLE ONLY "public"."user_brand_permissions"
        ADD CONSTRAINT "user_brand_permissions_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
    AND t.relname = 'user_brand_permissions'
    AND c.conname = 'user_brand_permissions_user_id_fkey'
  ) THEN
    ALTER TABLE ONLY "public"."user_brand_permissions"
        ADD CONSTRAINT "user_brand_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE ONLY "public"."user_invitations"
    ADD CONSTRAINT "user_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."user_invitations"
    ADD CONSTRAINT "user_invitations_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."user_system_roles"
    ADD CONSTRAINT "user_system_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."user_tasks"
    ADD CONSTRAINT "user_tasks_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."user_tasks"
    ADD CONSTRAINT "user_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."user_tasks"
    ADD CONSTRAINT "user_tasks_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."user_tasks"
    ADD CONSTRAINT "user_tasks_workflow_step_id_fkey" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."workflow_invitations"
    ADD CONSTRAINT "workflow_invitations_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."workflow_invitations"
    ADD CONSTRAINT "workflow_invitations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."workflow_invitations"
    ADD CONSTRAINT "workflow_invitations_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."workflow_steps"
    ADD CONSTRAINT "workflow_steps_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."workflow_user_assignments"
    ADD CONSTRAINT "workflow_user_assignments_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."workflow_user_assignments"
    ADD CONSTRAINT "workflow_user_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."workflow_user_assignments"
    ADD CONSTRAINT "workflow_user_assignments_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."workflows"
    ADD CONSTRAINT "workflows_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."workflows"
    ADD CONSTRAINT "workflows_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."workflows"
    ADD CONSTRAINT "workflows_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."content_templates"("id") ON DELETE SET NULL;
-- Create indexes for performance
CREATE INDEX "idx_brand_master_claim_brands_brand_id" ON "public"."brand_master_claim_brands" USING "btree" ("brand_id");
CREATE INDEX "idx_brand_master_claim_brands_master_claim_brand_id" ON "public"."brand_master_claim_brands" USING "btree" ("master_claim_brand_id");
CREATE INDEX "idx_brand_selected_agencies_agency_id" ON "public"."brand_selected_agencies" USING "btree" ("agency_id");
CREATE INDEX "idx_brand_selected_agencies_brand_id" ON "public"."brand_selected_agencies" USING "btree" ("brand_id");
CREATE INDEX "idx_brands_master_claim_brand_id" ON "public"."brands" USING "btree" ("master_claim_brand_id");
CREATE INDEX "idx_brands_name" ON "public"."brands" USING "btree" ("name");
CREATE INDEX "idx_brands_normalized_website_domain" ON "public"."brands" USING "btree" ("normalized_website_domain");
CREATE INDEX "idx_brands_website_urls_gin" ON "public"."brands" USING "gin" ("website_urls");
CREATE INDEX "idx_claim_countries_claim_id" ON "public"."claim_countries" USING "btree" ("claim_id");
CREATE INDEX "idx_claim_countries_composite" ON "public"."claim_countries" USING "btree" ("claim_id", "country_code");
CREATE INDEX "idx_claim_countries_country_code" ON "public"."claim_countries" USING "btree" ("country_code");
CREATE INDEX "idx_claim_ingredients_claim_id" ON "public"."claim_ingredients" USING "btree" ("claim_id");
CREATE INDEX "idx_claim_ingredients_composite" ON "public"."claim_ingredients" USING "btree" ("claim_id", "ingredient_id");
CREATE INDEX "idx_claim_ingredients_ingredient_id" ON "public"."claim_ingredients" USING "btree" ("ingredient_id");
CREATE INDEX "idx_claim_products_claim_id" ON "public"."claim_products" USING "btree" ("claim_id");
CREATE INDEX "idx_claim_products_composite" ON "public"."claim_products" USING "btree" ("claim_id", "product_id");
CREATE INDEX "idx_claim_products_product_id" ON "public"."claim_products" USING "btree" ("product_id");
CREATE INDEX "idx_claim_reviews_brand" ON "public"."claim_reviews" USING "btree" ("master_claim_brand_id");
CREATE INDEX "idx_claim_reviews_country" ON "public"."claim_reviews" USING "btree" ("country_code");
CREATE INDEX "idx_claim_reviews_country_code" ON "public"."claim_reviews" USING "btree" ("country_code");
CREATE INDEX "idx_claim_reviews_date" ON "public"."claim_reviews" USING "btree" ("reviewed_at" DESC);
CREATE INDEX "idx_claim_reviews_master_claim_brand_id" ON "public"."claim_reviews" USING "btree" ("master_claim_brand_id");
CREATE INDEX "idx_claim_reviews_reviewed_at" ON "public"."claim_reviews" USING "btree" ("reviewed_at" DESC);
CREATE INDEX "idx_claim_reviews_reviewed_by" ON "public"."claim_reviews" USING "btree" ("reviewed_by");
CREATE INDEX "idx_claim_reviews_reviewer" ON "public"."claim_reviews" USING "btree" ("reviewed_by");
CREATE INDEX "idx_claim_workflow_history_claim_id" ON "public"."claim_workflow_history" USING "btree" ("claim_id");
CREATE INDEX "idx_claim_workflow_history_created_at" ON "public"."claim_workflow_history" USING "btree" ("created_at" DESC);
CREATE INDEX "idx_claims_brand_level" ON "public"."claims" USING "btree" ("master_brand_id", "level") WHERE ("master_brand_id" IS NOT NULL);
CREATE INDEX "idx_claims_current_workflow_step" ON "public"."claims" USING "btree" ("current_workflow_step");
CREATE INDEX "idx_claims_ingredient_level" ON "public"."claims" USING "btree" ("ingredient_id", "level") WHERE ("ingredient_id" IS NOT NULL);
CREATE INDEX "idx_claims_master_brand_id" ON "public"."claims" USING "btree" ("master_brand_id");
CREATE INDEX "idx_claims_product_id" ON "public"."claims" USING "btree" ("product_id");
CREATE INDEX "idx_claims_product_level" ON "public"."claims" USING "btree" ("level") WHERE ("level" = 'product'::"public"."claim_level_enum");
CREATE INDEX "idx_claims_workflow_id" ON "public"."claims" USING "btree" ("workflow_id");
CREATE INDEX "idx_claims_workflow_status" ON "public"."claims" USING "btree" ("workflow_status");
CREATE INDEX "idx_claims_workflow_steps_assigned_users" ON "public"."claims_workflow_steps" USING "gin" ("assigned_user_ids");
CREATE INDEX "idx_claims_workflow_steps_workflow_id" ON "public"."claims_workflow_steps" USING "btree" ("workflow_id");
CREATE INDEX "idx_claims_workflows_brand_id" ON "public"."claims_workflows" USING "btree" ("brand_id");
CREATE INDEX "idx_claims_workflows_created_by" ON "public"."claims_workflows" USING "btree" ("created_by");
CREATE INDEX "idx_content_brand_created" ON "public"."content" USING "btree" ("brand_id", "created_at" DESC);
COMMENT ON INDEX "public"."idx_content_brand_created" IS 'Improves content listing sorted by creation date';
CREATE INDEX "idx_content_brand_id" ON "public"."content" USING "btree" ("brand_id");
CREATE INDEX "idx_content_brand_status" ON "public"."content" USING "btree" ("brand_id", "status");
COMMENT ON INDEX "public"."idx_content_brand_status" IS 'Improves content filtering by brand and status';
CREATE INDEX "idx_content_created_by" ON "public"."content" USING "btree" ("created_by");
CREATE INDEX "idx_content_due_date" ON "public"."content" USING "btree" ("due_date");
CREATE INDEX "idx_content_ownership_content_id" ON "public"."content_ownership_history" USING "btree" ("content_id");
CREATE INDEX "idx_content_ownership_new_owner" ON "public"."content_ownership_history" USING "btree" ("new_owner");
CREATE INDEX "idx_content_ownership_previous_owner" ON "public"."content_ownership_history" USING "btree" ("previous_owner");
CREATE INDEX "idx_content_template_id" ON "public"."content" USING "btree" ("template_id");
CREATE INDEX "idx_content_templates_brand_id" ON "public"."content_templates" USING "btree" ("brand_id") WHERE ("brand_id" IS NOT NULL);
CREATE INDEX "idx_content_templates_name" ON "public"."content_templates" USING "btree" ("name");
CREATE INDEX "idx_content_versions_content_created" ON "public"."content_versions" USING "btree" ("content_id", "created_at" DESC);
CREATE INDEX "idx_content_versions_content_id_version" ON "public"."content_versions" USING "btree" ("content_id", "version_number");
CREATE INDEX "idx_content_versions_step_id_created" ON "public"."content_versions" USING "btree" ("content_id", "workflow_step_identifier", "created_at");
CREATE INDEX "idx_content_workflow_id" ON "public"."content" USING "btree" ("workflow_id");
CREATE INDEX "idx_feedback_items_assigned_to" ON "public"."feedback_items" USING "btree" ("assigned_to");
CREATE INDEX "idx_feedback_items_updated_by" ON "public"."feedback_items" USING "btree" ("updated_by");
CREATE INDEX "idx_global_override_audit_override_id" ON "public"."global_override_audit" USING "btree" ("override_id");
CREATE INDEX "idx_global_override_audit_user_id" ON "public"."global_override_audit" USING "btree" ("user_id");
CREATE INDEX "idx_invitation_logs_email" ON "public"."invitation_logs" USING "btree" ("email");
CREATE INDEX "idx_market_claim_overrides_global" ON "public"."market_claim_overrides" USING "btree" ("master_claim_id", "target_product_id", "market_country_code") WHERE ("market_country_code" = '__ALL_COUNTRIES__'::"text");
CREATE INDEX "idx_notifications_created" ON "public"."notifications" USING "btree" ("created_at" DESC);
CREATE INDEX "idx_notifications_created_at" ON "public"."notifications" USING "btree" ("created_at" DESC);
CREATE INDEX "idx_notifications_is_archived" ON "public"."notifications" USING "btree" ("is_archived");
CREATE INDEX "idx_notifications_is_read" ON "public"."notifications" USING "btree" ("is_read");
CREATE INDEX "idx_notifications_user_id" ON "public"."notifications" USING "btree" ("user_id");
CREATE INDEX "idx_notifications_user_unread" ON "public"."notifications" USING "btree" ("user_id", "is_read") WHERE ("is_read" = false);
COMMENT ON INDEX "public"."idx_notifications_user_unread" IS 'Improves unread notification queries';
CREATE INDEX "idx_products_master_brand_id" ON "public"."products" USING "btree" ("master_brand_id");
CREATE INDEX "idx_products_name" ON "public"."products" USING "btree" ("name");
CREATE INDEX "idx_profiles_notification_settings" ON "public"."profiles" USING "gin" ("notification_settings");
CREATE INDEX "idx_security_logs_event_type" ON "public"."security_logs" USING "btree" ("event_type");
CREATE INDEX "idx_security_logs_ip_address" ON "public"."security_logs" USING "btree" ("ip_address");
CREATE INDEX "idx_security_logs_timestamp" ON "public"."security_logs" USING "btree" ("timestamp");
CREATE INDEX "idx_security_logs_user_id" ON "public"."security_logs" USING "btree" ("user_id");
CREATE INDEX "idx_tool_run_history_run_at" ON "public"."tool_run_history" USING "btree" ("run_at");
CREATE INDEX "idx_tool_run_history_tool_name" ON "public"."tool_run_history" USING "btree" ("tool_name");
CREATE INDEX "idx_tool_run_history_user_id" ON "public"."tool_run_history" USING "btree" ("user_id");
CREATE INDEX "idx_user_brand_permissions_brand_id" ON "public"."user_brand_permissions" USING "btree" ("brand_id");
CREATE INDEX "idx_user_brand_permissions_user_brand" ON "public"."user_brand_permissions" USING "btree" ("user_id", "brand_id");
COMMENT ON INDEX "public"."idx_user_brand_permissions_user_brand" IS 'Improves permission checks for user-brand combinations';
CREATE INDEX "idx_user_brand_permissions_user_id" ON "public"."user_brand_permissions" USING "btree" ("user_id");
CREATE INDEX "idx_user_invitations_email" ON "public"."user_invitations" USING "btree" ("email");
CREATE INDEX "idx_user_invitations_source" ON "public"."user_invitations" USING "btree" ("invitation_source", "source_id");
CREATE INDEX "idx_user_invitations_status" ON "public"."user_invitations" USING "btree" ("status");
CREATE INDEX "idx_user_tasks_due_date" ON "public"."user_tasks" USING "btree" ("due_date") WHERE (("due_date" IS NOT NULL) AND ("status" = 'pending'::"text"));
CREATE INDEX "idx_user_tasks_user_id_status" ON "public"."user_tasks" USING "btree" ("user_id", "status");
CREATE INDEX "idx_user_tasks_user_status" ON "public"."user_tasks" USING "btree" ("user_id", "status") WHERE ("status" = 'pending'::"text");
COMMENT ON INDEX "public"."idx_user_tasks_user_status" IS 'Improves pending task queries for users';
CREATE INDEX "idx_workflow_invitations_email" ON "public"."workflow_invitations" USING "btree" ("email");
CREATE INDEX "idx_workflow_invitations_expires_at" ON "public"."workflow_invitations" USING "btree" ("expires_at");
CREATE INDEX "idx_workflow_invitations_status" ON "public"."workflow_invitations" USING "btree" ("status");
CREATE INDEX "idx_workflow_invitations_user_id" ON "public"."workflow_invitations" USING "btree" ("user_id");
CREATE INDEX "idx_workflow_steps_order" ON "public"."workflow_steps" USING "btree" ("step_order");
CREATE INDEX "idx_workflow_steps_workflow" ON "public"."workflow_steps" USING "btree" ("workflow_id", "step_order");
CREATE INDEX "idx_workflow_steps_workflow_id" ON "public"."workflow_steps" USING "btree" ("workflow_id");
CREATE INDEX "idx_workflow_user_assignments_composite" ON "public"."workflow_user_assignments" USING "btree" ("workflow_id", "step_id", "user_id");
CREATE INDEX "idx_workflows_brand_id" ON "public"."workflows" USING "btree" ("brand_id");
CREATE INDEX "idx_workflows_brand_template" ON "public"."workflows" USING "btree" ("brand_id", "template_id");
COMMENT ON INDEX "public"."idx_workflows_brand_template" IS 'Improves workflow queries filtered by brand and template';
CREATE INDEX "idx_workflows_status" ON "public"."workflows" USING "btree" ("status");
CREATE INDEX "idx_workflows_template_id" ON "public"."workflows" USING "btree" ("template_id");
CREATE INDEX "tool_run_history_batch_id_idx" ON "public"."tool_run_history" USING "btree" ("batch_id");
CREATE INDEX "tool_run_history_batch_id_sequence_idx" ON "public"."tool_run_history" USING "btree" ("batch_id", "batch_sequence");
COMMIT;
