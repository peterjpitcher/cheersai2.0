-- =====================================================
-- FIX INDEXES AND FOREIGN KEY ISSUES
-- This migration addresses:
-- 1. Removes unused indexes (52 instances)
-- 2. Adds indexes for unindexed foreign keys (22 instances)
-- =====================================================

-- === PART 1: DROP UNUSED INDEXES ===
-- These indexes have never been used and can be safely removed

DROP INDEX IF EXISTS idx_ai_feedback_campaign;
DROP INDEX IF EXISTS idx_ai_feedback_tenant;
DROP INDEX IF EXISTS idx_ai_feedback_unconverted;
DROP INDEX IF EXISTS idx_ai_platform_prompt_history_prompt_id;
DROP INDEX IF EXISTS idx_ai_platform_prompt_history_version;
DROP INDEX IF EXISTS idx_ai_platform_prompts_active;
DROP INDEX IF EXISTS idx_ai_platform_prompts_content_type;
DROP INDEX IF EXISTS idx_ai_platform_prompts_default;
DROP INDEX IF EXISTS idx_ai_platform_prompts_platform;
DROP INDEX IF EXISTS idx_analytics_campaign_post_id;
DROP INDEX IF EXISTS idx_analytics_tenant_id;
DROP INDEX IF EXISTS idx_api_usage_tenant_id;
DROP INDEX IF EXISTS idx_brand_voice_samples_type;
DROP INDEX IF EXISTS idx_campaign_posts_approved_by;
DROP INDEX IF EXISTS idx_campaign_posts_calendar;
DROP INDEX IF EXISTS idx_campaign_posts_is_quick_post;
DROP INDEX IF EXISTS idx_campaign_posts_metadata;
DROP INDEX IF EXISTS idx_campaign_posts_platform;
DROP INDEX IF EXISTS idx_campaign_posts_scheduled;
DROP INDEX IF EXISTS idx_error_logs_created_at;
DROP INDEX IF EXISTS idx_errors_severity;
DROP INDEX IF EXISTS idx_guardrails_active;
DROP INDEX IF EXISTS idx_guardrails_context;
DROP INDEX IF EXISTS idx_guardrails_feedback_type;
DROP INDEX IF EXISTS idx_guardrails_history_created;
DROP INDEX IF EXISTS idx_guardrails_history_guardrail;
DROP INDEX IF EXISTS idx_guardrails_history_tenant;
DROP INDEX IF EXISTS idx_guardrails_platform;
DROP INDEX IF EXISTS idx_media_assets_last_used;
DROP INDEX IF EXISTS idx_media_assets_storage_path;
DROP INDEX IF EXISTS idx_media_assets_watermark;
DROP INDEX IF EXISTS idx_metrics_type;
DROP INDEX IF EXISTS idx_performance_metrics_created_at;
DROP INDEX IF EXISTS idx_posting_schedules_active;
DROP INDEX IF EXISTS idx_posting_schedules_day_time;
DROP INDEX IF EXISTS idx_publishing_history_campaign_post_id;
DROP INDEX IF EXISTS idx_social_accounts_location;
DROP INDEX IF EXISTS idx_support_tickets_created_at;
DROP INDEX IF EXISTS idx_support_tickets_metadata;
DROP INDEX IF EXISTS idx_support_tickets_priority;
DROP INDEX IF EXISTS idx_support_tickets_status;
DROP INDEX IF EXISTS idx_support_tickets_tenant_id;
DROP INDEX IF EXISTS idx_support_tickets_user_id;
DROP INDEX IF EXISTS idx_team_invitations_email;
DROP INDEX IF EXISTS idx_team_invitations_tenant_id;
DROP INDEX IF EXISTS idx_team_invitations_token;
DROP INDEX IF EXISTS idx_tenant_logos_active;
DROP INDEX IF EXISTS idx_tenants_deleted_at;
DROP INDEX IF EXISTS idx_users_deleted_at;
DROP INDEX IF EXISTS idx_users_email;
DROP INDEX IF EXISTS idx_users_first_name;
DROP INDEX IF EXISTS idx_users_superadmin;

-- === PART 2: ADD INDEXES FOR FOREIGN KEYS ===
-- These foreign keys need indexes for better performance

-- ai_generation_feedback table
CREATE INDEX IF NOT EXISTS idx_ai_generation_feedback_guardrail_id 
    ON ai_generation_feedback(guardrail_id);
CREATE INDEX IF NOT EXISTS idx_ai_generation_feedback_post_id 
    ON ai_generation_feedback(post_id);
CREATE INDEX IF NOT EXISTS idx_ai_generation_feedback_user_id 
    ON ai_generation_feedback(user_id);

-- ai_platform_prompt_history table
CREATE INDEX IF NOT EXISTS idx_ai_platform_prompt_history_created_by 
    ON ai_platform_prompt_history(created_by);

-- ai_platform_prompts table
CREATE INDEX IF NOT EXISTS idx_ai_platform_prompts_created_by 
    ON ai_platform_prompts(created_by);

-- campaign_templates table
CREATE INDEX IF NOT EXISTS idx_campaign_templates_tenant_id 
    ON campaign_templates(tenant_id);

-- campaigns table
CREATE INDEX IF NOT EXISTS idx_campaigns_hero_image_id 
    ON campaigns(hero_image_id);

-- content_guardrails table
CREATE INDEX IF NOT EXISTS idx_content_guardrails_user_id 
    ON content_guardrails(user_id);

-- content_guardrails_history table
CREATE INDEX IF NOT EXISTS idx_content_guardrails_history_user_id 
    ON content_guardrails_history(user_id);

-- data_exports table
CREATE INDEX IF NOT EXISTS idx_data_exports_tenant_id 
    ON data_exports(tenant_id);
CREATE INDEX IF NOT EXISTS idx_data_exports_user_id 
    ON data_exports(user_id);

-- error_logs table
CREATE INDEX IF NOT EXISTS idx_error_logs_user_id 
    ON error_logs(user_id);

-- global_content_settings table
CREATE INDEX IF NOT EXISTS idx_global_content_settings_updated_by 
    ON global_content_settings(updated_by);

-- performance_metrics table
CREATE INDEX IF NOT EXISTS idx_performance_metrics_user_id 
    ON performance_metrics(user_id);

-- publishing_history table
CREATE INDEX IF NOT EXISTS idx_publishing_history_social_connection_id 
    ON publishing_history(social_connection_id);

-- publishing_queue table
CREATE INDEX IF NOT EXISTS idx_publishing_queue_campaign_post_id 
    ON publishing_queue(campaign_post_id);
CREATE INDEX IF NOT EXISTS idx_publishing_queue_social_connection_id 
    ON publishing_queue(social_connection_id);

-- superadmin_audit_log table
CREATE INDEX IF NOT EXISTS idx_superadmin_audit_log_superadmin_id 
    ON superadmin_audit_log(superadmin_id);
CREATE INDEX IF NOT EXISTS idx_superadmin_audit_log_target_tenant_id 
    ON superadmin_audit_log(target_tenant_id);

-- team_invitations table
CREATE INDEX IF NOT EXISTS idx_team_invitations_invited_by 
    ON team_invitations(invited_by);

-- user_deletion_requests table
CREATE INDEX IF NOT EXISTS idx_user_deletion_requests_tenant_id 
    ON user_deletion_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_deletion_requests_user_id 
    ON user_deletion_requests(user_id);