export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12"
  }
  public: {
    Tables: {
      ai_generation_feedback: {
        Row: {
          campaign_id: string | null
          converted_to_guardrail: boolean | null
          created_at: string | null
          feedback_text: string | null
          feedback_type: string | null
          generated_content: string
          generation_type: string | null
          guardrail_id: string | null
          id: string
          platform: string | null
          post_id: string | null
          prompt_used: string | null
          suggested_improvement: string | null
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          campaign_id?: string | null
          converted_to_guardrail?: boolean | null
          created_at?: string | null
          feedback_text?: string | null
          feedback_type?: string | null
          generated_content: string
          generation_type?: string | null
          guardrail_id?: string | null
          id?: string
          platform?: string | null
          post_id?: string | null
          prompt_used?: string | null
          suggested_improvement?: string | null
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          campaign_id?: string | null
          converted_to_guardrail?: boolean | null
          created_at?: string | null
          feedback_text?: string | null
          feedback_type?: string | null
          generated_content?: string
          generation_type?: string | null
          guardrail_id?: string | null
          id?: string
          platform?: string | null
          post_id?: string | null
          prompt_used?: string | null
          suggested_improvement?: string | null
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_generation_feedback_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generation_feedback_guardrail_id_fkey"
            columns: ["guardrail_id"]
            isOneToOne: false
            referencedRelation: "content_guardrails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generation_feedback_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "campaign_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generation_feedback_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "ai_generation_feedback_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generation_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_platform_prompt_history: {
        Row: {
          change_description: string | null
          created_at: string | null
          created_by: string | null
          id: string
          prompt_id: string
          system_prompt: string
          user_prompt_template: string
          version: number
        }
        Insert: {
          change_description?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          prompt_id: string
          system_prompt: string
          user_prompt_template: string
          version: number
        }
        Update: {
          change_description?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          prompt_id?: string
          system_prompt?: string
          user_prompt_template?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_platform_prompt_history_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "ai_platform_prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_platform_prompts: {
        Row: {
          content_type: string
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          platform: string
          system_prompt: string
          temperature: number | null
          max_tokens: number | null
          updated_at: string | null
          user_prompt_template: string
          version: number
        }
        Insert: {
          content_type: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          platform: string
          system_prompt: string
          temperature?: number | null
          max_tokens?: number | null
          updated_at?: string | null
          user_prompt_template: string
          version?: number
        }
        Update: {
          content_type?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          platform?: string
          system_prompt?: string
          temperature?: number | null
          max_tokens?: number | null
          updated_at?: string | null
          user_prompt_template?: string
          version?: number
        }
        Relationships: []
      }
      analytics: {
        Row: {
          campaign_post_id: string | null
          created_at: string | null
          id: string
          metric_type: string
          metric_value: number | null
          platform: string
          recorded_at: string | null
          tenant_id: string | null
        }
        Insert: {
          campaign_post_id?: string | null
          created_at?: string | null
          id?: string
          metric_type: string
          metric_value?: number | null
          platform: string
          recorded_at?: string | null
          tenant_id?: string | null
        }
        Update: {
          campaign_post_id?: string | null
          created_at?: string | null
          id?: string
          metric_type?: string
          metric_value?: number | null
          platform?: string
          recorded_at?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_campaign_post_id_fkey"
            columns: ["campaign_post_id"]
            isOneToOne: false
            referencedRelation: "campaign_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "analytics_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      api_usage: {
        Row: {
          count: number | null
          created_at: string | null
          date: string | null
          endpoint: string
          id: string
          tenant_id: string | null
        }
        Insert: {
          count?: number | null
          created_at?: string | null
          date?: string | null
          endpoint: string
          id?: string
          tenant_id?: string | null
        }
        Update: {
          count?: number | null
          created_at?: string | null
          date?: string | null
          endpoint?: string
          id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "api_usage_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      _sql: {
        Row: {
          id: number
          query: string | null
          created_at: string | null
        }
        Insert: {
          id?: number
          query?: string | null
          created_at?: string | null
        }
        Update: {
          id?: number
          query?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      activity_logs: {
        Row: {
          id: string
          tenant_id: string | null
          user_id: string | null
          action: string
          details: Json | null
          created_at: string | null
        }
        Insert: {
          id?: string
          tenant_id?: string | null
          user_id?: string | null
          action: string
          details?: Json | null
          created_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string | null
          user_id?: string | null
          action?: string
          details?: Json | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "activity_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          id: string
          tenant_id: string | null
          user_id: string | null
          entity_type: string
          entity_id: string
          action: string
          meta: Json | null
          ts: string | null
        }
        Insert: {
          id?: string
          tenant_id?: string | null
          user_id?: string | null
          entity_type: string
          entity_id: string
          action: string
          meta?: Json | null
          ts?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string | null
          user_id?: string | null
          entity_type?: string
          entity_id?: string
          action?: string
          meta?: Json | null
          ts?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          id: string
          tenant_id: string | null
          user_id: string | null
          event: string
          metadata: Json | null
          created_at: string | null
        }
        Insert: {
          id?: string
          tenant_id?: string | null
          user_id?: string | null
          event: string
          metadata?: Json | null
          created_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string | null
          user_id?: string | null
          event?: string
          metadata?: Json | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_profiles: {
        Row: {
          brand_colors: Json | null
          brand_identity: string | null
          brand_voice: string | null
          business_name: string | null
          business_type: string | null
          content_boundaries: string[] | null
          created_at: string | null
          deleted_at: string | null
          id: string
          language_code: string | null
          menu_drink_url: string | null
          menu_food_url: string | null
          opening_hours: Json | null
          phone: string | null
          phone_e164: string | null
          primary_color: string | null
          serves_drinks: boolean | null
          serves_food: boolean | null
          target_audience: string | null
          tenant_id: string | null
          tone_attributes: string[] | null
          booking_url: string | null
          website_url: string | null
          whatsapp: string | null
          whatsapp_e164: string | null
          updated_at: string | null
        }
        Insert: {
          brand_colors?: Json | null
          brand_identity?: string | null
          brand_voice?: string | null
          business_name?: string | null
          business_type?: string | null
          content_boundaries?: string[] | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          language_code?: string | null
          menu_drink_url?: string | null
          menu_food_url?: string | null
          opening_hours?: Json | null
          phone?: string | null
          phone_e164?: string | null
          primary_color?: string | null
          serves_drinks?: boolean | null
          serves_food?: boolean | null
          target_audience?: string | null
          tenant_id?: string | null
          tone_attributes?: string[] | null
          booking_url?: string | null
          website_url?: string | null
          whatsapp?: string | null
          whatsapp_e164?: string | null
          updated_at?: string | null
        }
        Update: {
          brand_colors?: Json | null
          brand_identity?: string | null
          brand_voice?: string | null
          business_name?: string | null
          business_type?: string | null
          content_boundaries?: string[] | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          language_code?: string | null
          menu_drink_url?: string | null
          menu_food_url?: string | null
          opening_hours?: Json | null
          phone?: string | null
          phone_e164?: string | null
          primary_color?: string | null
          serves_drinks?: boolean | null
          serves_food?: boolean | null
          target_audience?: string | null
          tenant_id?: string | null
          tone_attributes?: string[] | null
          booking_url?: string | null
          website_url?: string | null
          whatsapp?: string | null
          whatsapp_e164?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "brand_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_voice_profiles: {
        Row: {
          avg_sentence_length: number | null
          characteristics: string[] | null
          created_at: string
          emoji_frequency: string | null
          emoji_usage: boolean | null
          hashtag_style: string | null
          id: string
          sample_count: number | null
          sentence_patterns: Json | null
          tenant_id: string
          tone_attributes: string[] | null
          trained_at: string | null
          updated_at: string
          vocabulary: string[] | null
        }
        Insert: {
          avg_sentence_length?: number | null
          characteristics?: string[] | null
          created_at?: string
          emoji_frequency?: string | null
          emoji_usage?: boolean | null
          hashtag_style?: string | null
          id?: string
          sample_count?: number | null
          sentence_patterns?: Json | null
          tenant_id: string
          tone_attributes?: string[] | null
          trained_at?: string | null
          updated_at?: string
          vocabulary?: string[] | null
        }
        Update: {
          avg_sentence_length?: number | null
          characteristics?: string[] | null
          created_at?: string
          emoji_frequency?: string | null
          emoji_usage?: boolean | null
          hashtag_style?: string | null
          id?: string
          sample_count?: number | null
          sentence_patterns?: Json | null
          tenant_id?: string
          tone_attributes?: string[] | null
          trained_at?: string | null
          updated_at?: string
          vocabulary?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_voice_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "brand_voice_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_voice_samples: {
        Row: {
          content: string
          created_at: string
          id: string
          platform: string | null
          tenant_id: string
          type: string | null
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          platform?: string | null
          tenant_id: string
          type?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          platform?: string | null
          tenant_id?: string
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_voice_samples_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "brand_voice_samples_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_posts: {
        Row: {
          approval_status: string | null
          approved_at: string | null
          approved_by: string | null
          campaign_id: string | null
          content: string
          created_at: string | null
          deleted_at: string | null
          id: string
          is_quick_post: boolean | null
          is_publishing: boolean | null
          media_assets: string[] | null
          media_url: string | null
          metadata: Json | null
          platform: string | null
          platforms: string[] | null
          post_timing: string
          scheduled_for: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          campaign_id?: string | null
          content: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          is_quick_post?: boolean | null
          is_publishing?: boolean | null
          media_assets?: string[] | null
          media_url?: string | null
          metadata?: Json | null
          platform?: string | null
          platforms?: string[] | null
          post_timing: string
          scheduled_for?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          campaign_id?: string | null
          content?: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          is_quick_post?: boolean | null
          is_publishing?: boolean | null
          media_assets?: string[] | null
          media_url?: string | null
          metadata?: Json | null
          platform?: string | null
          platforms?: string[] | null
          post_timing?: string
          scheduled_for?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_posts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_posts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_posts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "campaign_posts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_templates: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_public: boolean | null
          name: string
          post_templates: Json | null
          template_type: string
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_public?: boolean | null
          name: string
          post_templates?: Json | null
          template_type: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_public?: boolean | null
          name?: string
          post_templates?: Json | null
          template_type?: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "campaign_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          auto_generate: boolean | null
          campaign_type: string
          created_at: string | null
          created_by: string | null
          custom_dates: string[] | null
          deleted_at: string | null
          description: string | null
          end_date: string | null
          event_date: string | null
          hero_image_id: string | null
          id: string
          name: string
          primary_cta: string | null
          platforms: string[] | null
          selected_timings: string[] | null
          start_date: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          auto_generate?: boolean | null
          campaign_type: string
          created_at?: string | null
          created_by?: string | null
          custom_dates?: string[] | null
          deleted_at?: string | null
          description?: string | null
          end_date?: string | null
          event_date?: string | null
          hero_image_id?: string | null
          id?: string
          name: string
          primary_cta?: string | null
          platforms?: string[] | null
          selected_timings?: string[] | null
          start_date?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          auto_generate?: boolean | null
          campaign_type?: string
          created_at?: string | null
          created_by?: string | null
          custom_dates?: string[] | null
          deleted_at?: string | null
          description?: string | null
          end_date?: string | null
          event_date?: string | null
          hero_image_id?: string | null
          id?: string
          name?: string
          primary_cta?: string | null
          platforms?: string[] | null
          selected_timings?: string[] | null
          start_date?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_hero_image_id_fkey"
            columns: ["hero_image_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      content_guardrails: {
        Row: {
          context_type: string
          created_at: string | null
          feedback_text: string
          feedback_type: string
          id: string
          is_active: boolean | null
          last_applied_at: string | null
          metadata: Json | null
          original_content: string | null
          original_prompt: string | null
          platform: string | null
          tenant_id: string
          times_applied: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          context_type: string
          created_at?: string | null
          feedback_text: string
          feedback_type: string
          id?: string
          is_active?: boolean | null
          last_applied_at?: string | null
          metadata?: Json | null
          original_content?: string | null
          original_prompt?: string | null
          platform?: string | null
          tenant_id: string
          times_applied?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          context_type?: string
          created_at?: string | null
          feedback_text?: string
          feedback_type?: string
          id?: string
          is_active?: boolean | null
          last_applied_at?: string | null
          metadata?: Json | null
          original_content?: string | null
          original_prompt?: string | null
          platform?: string | null
          tenant_id?: string
          times_applied?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_guardrails_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "content_guardrails_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_guardrails_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      content_guardrails_history: {
        Row: {
          action: string
          created_at: string | null
          guardrail_id: string | null
          id: string
          new_value: Json | null
          previous_value: Json | null
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          guardrail_id?: string | null
          id?: string
          new_value?: Json | null
          previous_value?: Json | null
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          guardrail_id?: string | null
          id?: string
          new_value?: Json | null
          previous_value?: Json | null
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_guardrails_history_guardrail_id_fkey"
            columns: ["guardrail_id"]
            isOneToOne: false
            referencedRelation: "content_guardrails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_guardrails_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "content_guardrails_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_guardrails_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      data_exports: {
        Row: {
          created_at: string | null
          expires_at: string | null
          export_type: string
          file_url: string | null
          id: string
          metadata: Json | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          export_type: string
          file_url?: string | null
          id?: string
          metadata?: Json | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          export_type?: string
          file_url?: string | null
          id?: string
          metadata?: Json | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_exports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "data_exports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_exports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      data_deletion_logs: {
        Row: {
          id: string
          deletion_id: string
          platform: string
          platform_user_id: string
          status: string
          created_at: string | null
          metadata: Json | null
        }
        Insert: {
          id?: string
          deletion_id: string
          platform: string
          platform_user_id: string
          status?: string
          created_at?: string | null
          metadata?: Json | null
        }
        Update: {
          id?: string
          deletion_id?: string
          platform?: string
          platform_user_id?: string
          status?: string
          created_at?: string | null
          metadata?: Json | null
        }
        Relationships: []
      }
      data_retention_policies: {
        Row: {
          created_at: string | null
          data_type: string
          description: string | null
          id: string
          retention_days: number
          uk_ico_compliant: boolean | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          data_type: string
          description?: string | null
          id?: string
          retention_days: number
          uk_ico_compliant?: boolean | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          data_type?: string
          description?: string | null
          id?: string
          retention_days?: number
          uk_ico_compliant?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      event_briefs: {
        Row: {
          id: string
          event_id: string
          version: number
          text: string
          constraints_applied: string[]
          drinkaware_applicable: boolean
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          event_id: string
          version?: number
          text: string
          constraints_applied?: string[]
          drinkaware_applicable?: boolean
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          event_id?: string
          version?: number
          text?: string
          constraints_applied?: string[]
          drinkaware_applicable?: boolean
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_briefs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_occurrences: {
        Row: {
          id: string
          event_id: string
          start_date: string
          end_date: string | null
          country: string | null
          certainty: string | null
          metadata: Json | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          event_id: string
          start_date: string
          end_date?: string | null
          country?: string | null
          certainty?: string | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          event_id?: string
          start_date?: string
          end_date?: string | null
          country?: string | null
          certainty?: string | null
          metadata?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_occurrences_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          id: string
          slug: string
          name: string
          aliases: string[]
          category: string
          alcohol_flag: boolean
          dedupe_key: string | null
          date_type: string
          rrule: string | null
          fixed_date: string | null
          source_url: string | null
          uk_centric: boolean
          notes: string | null
          active: boolean
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          slug: string
          name: string
          aliases?: string[]
          category: string
          alcohol_flag?: boolean
          dedupe_key?: string | null
          date_type: string
          rrule?: string | null
          fixed_date?: string | null
          source_url?: string | null
          uk_centric?: boolean
          notes?: string | null
          active?: boolean
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          slug?: string
          name?: string
          aliases?: string[]
          category?: string
          alcohol_flag?: boolean
          dedupe_key?: string | null
          date_type?: string
          rrule?: string | null
          fixed_date?: string | null
          source_url?: string | null
          uk_centric?: boolean
          notes?: string | null
          active?: boolean
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      error_logs: {
        Row: {
          context: string | null
          created_at: string | null
          deleted_at: string | null
          error_message: string
          id: string
          metadata: Json | null
          severity: string | null
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          context?: string | null
          created_at?: string | null
          deleted_at?: string | null
          error_message: string
          id?: string
          metadata?: Json | null
          severity?: string | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          context?: string | null
          created_at?: string | null
          deleted_at?: string | null
          error_message?: string
          id?: string
          metadata?: Json | null
          severity?: string | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "error_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "error_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      global_content_settings: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          setting_key: string
          setting_value: Json
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          setting_key: string
          setting_value: Json
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          setting_key?: string
          setting_value?: Json
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "global_content_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      idea_instances: {
        Row: {
          id: string
          occurrence_id: string
          rank_score: number
          diversity_bucket: string | null
          tags: string[]
          selected: boolean
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          occurrence_id: string
          rank_score: number
          diversity_bucket?: string | null
          tags?: string[]
          selected?: boolean
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          occurrence_id?: string
          rank_score?: number
          diversity_bucket?: string | null
          tags?: string[]
          selected?: boolean
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "idea_instances_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "event_occurrences"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          id: string
          tenant_id: string
          idempotency_key: string
          request_hash: string
          response_json: Json | null
          created_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          idempotency_key: string
          request_hash: string
          response_json?: Json | null
          created_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          idempotency_key?: string
          request_hash?: string
          response_json?: Json | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "idempotency_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "idempotency_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inspiration_snoozes: {
        Row: {
          id: string
          user_id: string
          event_id: string
          date: string
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          event_id: string
          date: string
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          event_id?: string
          date?: string
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inspiration_snoozes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspiration_snoozes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          alt_text: string | null
          created_at: string | null
          deleted_at: string | null
          file_name: string
          file_size: number | null
          file_type: string | null
          file_url: string
          has_watermark: boolean | null
          id: string
          last_used_at: string | null
          metadata: Json | null
          original_url: string | null
          storage_path: string | null
          tags: string[] | null
          tenant_id: string | null
          updated_at: string | null
          watermark_position: string | null
        }
        Insert: {
          alt_text?: string | null
          created_at?: string | null
          deleted_at?: string | null
          file_name: string
          file_size?: number | null
          file_type?: string | null
          file_url: string
          has_watermark?: boolean | null
          id?: string
          last_used_at?: string | null
          metadata?: Json | null
          original_url?: string | null
          storage_path?: string | null
          tags?: string[] | null
          tenant_id?: string | null
          updated_at?: string | null
          watermark_position?: string | null
        }
        Update: {
          alt_text?: string | null
          created_at?: string | null
          deleted_at?: string | null
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          has_watermark?: boolean | null
          id?: string
          last_used_at?: string | null
          metadata?: Json | null
          original_url?: string | null
          storage_path?: string | null
          tags?: string[] | null
          tenant_id?: string | null
          updated_at?: string | null
          watermark_position?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "media_assets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          id: string
          user_id: string | null
          tenant_id: string | null
          type: string
          title: string | null
          message: string | null
          data: Json | null
          read: boolean | null
          created_at: string | null
          read_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          tenant_id?: string | null
          type: string
          title?: string | null
          message?: string | null
          data?: Json | null
          read?: boolean | null
          created_at?: string | null
          read_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          tenant_id?: string | null
          type?: string
          title?: string | null
          message?: string | null
          data?: Json | null
          read?: boolean | null
          created_at?: string | null
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_settings: {
        Row: {
          campaign_reminders: boolean | null
          created_at: string | null
          email_notifications: boolean | null
          id: string
          publishing_alerts: boolean | null
          push_notifications: boolean | null
          updated_at: string | null
          user_id: string | null
          weekly_summary: boolean | null
        }
        Insert: {
          campaign_reminders?: boolean | null
          created_at?: string | null
          email_notifications?: boolean | null
          id?: string
          publishing_alerts?: boolean | null
          push_notifications?: boolean | null
          updated_at?: string | null
          user_id?: string | null
          weekly_summary?: boolean | null
        }
        Update: {
          campaign_reminders?: boolean | null
          created_at?: string | null
          email_notifications?: boolean | null
          id?: string
          publishing_alerts?: boolean | null
          push_notifications?: boolean | null
          updated_at?: string | null
          user_id?: string | null
          weekly_summary?: boolean | null
        }
        Relationships: []
      }
      performance_metrics: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          id: string
          metadata: Json | null
          metric_type: string
          tenant_id: string | null
          user_id: string | null
          value: number
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          metadata?: Json | null
          metric_type: string
          tenant_id?: string | null
          user_id?: string | null
          value: number
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          metadata?: Json | null
          metric_type?: string
          tenant_id?: string | null
          user_id?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "performance_metrics_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "performance_metrics_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_metrics_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      posting_schedules: {
        Row: {
          active: boolean | null
          created_at: string | null
          day_of_week: number
          id: string
          platform: string
          tenant_id: string
          time: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          day_of_week: number
          id?: string
          platform: string
          tenant_id: string
          time: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          day_of_week?: number
          id?: string
          platform?: string
          tenant_id?: string
          time?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "posting_schedules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "posting_schedules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      post_approvals: {
        Row: {
          id: string
          tenant_id: string
          post_id: string
          required: number | null
          approved_count: number | null
          state: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          post_id: string
          required?: number | null
          approved_count?: number | null
          state?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          post_id?: string
          required?: number | null
          approved_count?: number | null
          state?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "post_approvals_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "campaign_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_approvals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "post_approvals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      post_comments: {
        Row: {
          id: string
          tenant_id: string
          post_id: string
          author_id: string
          type: string
          platform_scope: string | null
          body: string
          created_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          post_id: string
          author_id: string
          type: string
          platform_scope?: string | null
          body: string
          created_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          post_id?: string
          author_id?: string
          type?: string
          platform_scope?: string | null
          body?: string
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "post_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "campaign_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "post_comments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      post_revisions: {
        Row: {
          id: string
          post_id: string
          version: number
          diff: Json | null
          user_id: string | null
          ts: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          post_id: string
          version?: number
          diff?: Json | null
          user_id?: string | null
          ts?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          post_id?: string
          version?: number
          diff?: Json | null
          user_id?: string | null
          ts?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "post_revisions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "campaign_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_revisions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          id: string
          tenant_id: string
          campaign_id: string | null
          content: string | null
          platforms: string[] | null
          status: string | null
          publish_at: string | null
          published_at: string | null
          engagement_metrics: Json | null
          media_url: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          campaign_id?: string | null
          content?: string | null
          platforms?: string[] | null
          status?: string | null
          publish_at?: string | null
          published_at?: string | null
          engagement_metrics?: Json | null
          media_url?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          campaign_id?: string | null
          content?: string | null
          platforms?: string[] | null
          status?: string | null
          publish_at?: string | null
          published_at?: string | null
          engagement_metrics?: Json | null
          media_url?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "posts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "posts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pql_events: {
        Row: {
          id: string
          tenant_id: string
          user_id: string | null
          event_type: string
          metadata: Json | null
          created_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          user_id?: string | null
          event_type: string
          metadata?: Json | null
          created_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          user_id?: string | null
          event_type?: string
          metadata?: Json | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pql_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "pql_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pql_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      publishing_history: {
        Row: {
          campaign_post_id: string | null
          created_at: string | null
          deleted_at: string | null
          error_message: string | null
          id: string
          platform: string
          platform_post_id: string | null
          published_at: string | null
          retry_count: number | null
          social_connection_id: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          campaign_post_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          error_message?: string | null
          id?: string
          platform: string
          platform_post_id?: string | null
          published_at?: string | null
          retry_count?: number | null
          social_connection_id?: string | null
          status: string
          updated_at?: string | null
        }
        Update: {
          campaign_post_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          error_message?: string | null
          id?: string
          platform?: string
          platform_post_id?: string | null
          published_at?: string | null
          retry_count?: number | null
          social_connection_id?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "publishing_history_campaign_post_id_fkey"
            columns: ["campaign_post_id"]
            isOneToOne: false
            referencedRelation: "campaign_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishing_history_social_connection_id_fkey"
            columns: ["social_connection_id"]
            isOneToOne: false
            referencedRelation: "social_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      publishing_queue: {
        Row: {
          attempts: number | null
          campaign_post_id: string | null
          created_at: string | null
          deleted_at: string | null
          id: string
          last_error: string | null
          scheduled_for: string
          social_connection_id: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          attempts?: number | null
          campaign_post_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          last_error?: string | null
          scheduled_for: string
          social_connection_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          attempts?: number | null
          campaign_post_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          last_error?: string | null
          scheduled_for?: string
          social_connection_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "publishing_queue_campaign_post_id_fkey"
            columns: ["campaign_post_id"]
            isOneToOne: false
            referencedRelation: "campaign_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishing_queue_social_connection_id_fkey"
            columns: ["social_connection_id"]
            isOneToOne: false
            referencedRelation: "social_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          id: string
          role_id: string
          permission: string
          created_at: string | null
        }
        Insert: {
          id?: string
          role_id: string
          permission: string
          created_at?: string | null
        }
        Update: {
          id?: string
          role_id?: string
          permission?: string
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          id: string
          tenant_id: string
          name: string
          description: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          description?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          name?: string
          description?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      short_clicks: {
        Row: {
          id: string
          link_id: string
          ts: string
          ip: string | null
          user_agent: string | null
          ip_hash: string | null
          ua_hash: string | null
          referer: string | null
          platform_hint: string | null
          metadata: Json | null
        }
        Insert: {
          id?: string
          link_id: string
          ts: string
          ip?: string | null
          user_agent?: string | null
          ip_hash?: string | null
          ua_hash?: string | null
          referer?: string | null
          platform_hint?: string | null
          metadata?: Json | null
        }
        Update: {
          id?: string
          link_id?: string
          ts?: string
          ip?: string | null
          user_agent?: string | null
          ip_hash?: string | null
          ua_hash?: string | null
          referer?: string | null
          platform_hint?: string | null
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "short_clicks_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "short_links"
            referencedColumns: ["id"]
          },
        ]
      }
      short_links: {
        Row: {
          id: string
          tenant_id: string
          slug: string
          destination_url: string
          platform: string | null
          created_at: string | null
          created_by: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          slug: string
          destination_url: string
          platform?: string | null
          created_at?: string | null
          created_by?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          slug?: string
          destination_url?: string
          platform?: string | null
          created_at?: string | null
          created_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "short_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "short_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "short_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      social_accounts: {
        Row: {
          access_token: string | null
          access_token_secret: string | null
          account_id: string
          account_name: string | null
          created_at: string | null
          id: string
          instagram_id: string | null
          is_active: boolean | null
          location_id: string | null
          location_name: string | null
          metadata: Json | null
          page_id: string | null
          page_name: string | null
          platform: string
          profile_id: string | null
          refresh_token: string | null
          tenant_id: string | null
          token_expires_at: string | null
          updated_at: string | null
          username: string | null
        }
        Insert: {
          access_token?: string | null
          access_token_secret?: string | null
          account_id: string
          account_name?: string | null
          created_at?: string | null
          id?: string
          instagram_id?: string | null
          is_active?: boolean | null
          location_id?: string | null
          location_name?: string | null
          metadata?: Json | null
          page_id?: string | null
          page_name?: string | null
          platform: string
          profile_id?: string | null
          refresh_token?: string | null
          tenant_id?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
          username?: string | null
        }
        Update: {
          access_token?: string | null
          access_token_secret?: string | null
          account_id?: string
          account_name?: string | null
          created_at?: string | null
          id?: string
          instagram_id?: string | null
          is_active?: boolean | null
          location_id?: string | null
          location_name?: string | null
          metadata?: Json | null
          page_id?: string | null
          page_name?: string | null
          platform?: string
          profile_id?: string | null
          refresh_token?: string | null
          tenant_id?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "social_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      social_connections: {
        Row: {
          access_token: string | null
          access_token_encrypted: string | null
          account_id: string
          account_name: string
          created_at: string | null
          deleted_at: string | null
          id: string
          is_active: boolean | null
          metadata: Json | null
          page_access_token: string | null
          page_id: string | null
          page_name: string | null
          location_id: string | null
          location_name: string | null
          platform: string
          refresh_token: string | null
          refresh_token_encrypted: string | null
          tenant_id: string | null
          token_expires_at: string | null
          updated_at: string | null
        }
        Insert: {
          access_token?: string | null
          access_token_encrypted?: string | null
          account_id: string
          account_name: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          page_access_token?: string | null
          page_id?: string | null
          page_name?: string | null
          location_id?: string | null
          location_name?: string | null
          platform: string
          refresh_token?: string | null
          refresh_token_encrypted?: string | null
          tenant_id?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
        }
        Update: {
          access_token?: string | null
          access_token_encrypted?: string | null
          account_id?: string
          account_name?: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          page_access_token?: string | null
          page_id?: string | null
          page_name?: string | null
          location_id?: string | null
          location_name?: string | null
          platform?: string
          refresh_token?: string | null
          refresh_token_encrypted?: string | null
          tenant_id?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_connections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "social_connections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      social_posts: {
        Row: {
          id: string
          tenant_id: string
          platform: string
          content: string | null
          media_url: string | null
          external_id: string | null
          status: string | null
          published_at: string | null
          error: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          platform: string
          content?: string | null
          media_url?: string | null
          external_id?: string | null
          status?: string | null
          published_at?: string | null
          error?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          platform?: string
          content?: string | null
          media_url?: string | null
          external_id?: string | null
          status?: string | null
          published_at?: string | null
          error?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "social_posts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      social_media_cache: {
        Row: {
          id: string
          platform: string
          platform_user_id: string
          data: Json | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          platform: string
          platform_user_id: string
          data?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          platform?: string
          platform_user_id?: string
          data?: Json | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      superadmin_audit_log: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          id: string
          superadmin_id: string
          target_id: string | null
          target_table: string | null
          target_tenant_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          id?: string
          superadmin_id: string
          target_id?: string | null
          target_table?: string | null
          target_tenant_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          id?: string
          superadmin_id?: string
          target_id?: string | null
          target_table?: string | null
          target_tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "superadmin_audit_log_superadmin_id_fkey"
            columns: ["superadmin_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "superadmin_audit_log_target_tenant_id_fkey"
            columns: ["target_tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "superadmin_audit_log_target_tenant_id_fkey"
            columns: ["target_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          created_at: string | null
          id: string
          message: string
          metadata: Json | null
          priority: string | null
          resolved_at: string | null
          status: string | null
          subject: string
          subscription_tier: string
          support_channel: string | null
          tenant_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          message: string
          metadata?: Json | null
          priority?: string | null
          resolved_at?: string | null
          status?: string | null
          subject: string
          subscription_tier: string
          support_channel?: string | null
          tenant_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          message?: string
          metadata?: Json | null
          priority?: string | null
          resolved_at?: string | null
          status?: string | null
          subject?: string
          subscription_tier?: string
          support_channel?: string | null
          tenant_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "support_tickets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_quota: {
        Row: {
          tenant_id: string
          period_start: string
          tokens_used: number | null
          tokens_limit: number | null
          requests_used: number | null
          requests_limit: number | null
          updated_at: string | null
        }
        Insert: {
          tenant_id: string
          period_start: string
          tokens_used?: number | null
          tokens_limit?: number | null
          requests_used?: number | null
          requests_limit?: number | null
          updated_at?: string | null
        }
        Update: {
          tenant_id?: string
          period_start?: string
          tokens_used?: number | null
          tokens_limit?: number | null
          requests_used?: number | null
          requests_limit?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_quota_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "usage_quota_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      team_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string | null
          email: string
          expires_at: string | null
          id: string
          invited_by: string | null
          role: string | null
          tenant_id: string | null
          token: string
          updated_at: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string | null
          email: string
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          role?: string | null
          tenant_id?: string | null
          token: string
          updated_at?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string | null
          email?: string
          expires_at?: string | null
          id?: string
          invited_by?: string | null
          role?: string | null
          tenant_id?: string | null
          token?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "team_invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_logos: {
        Row: {
          created_at: string | null
          file_name: string | null
          file_url: string
          id: string
          is_active: boolean | null
          logo_type: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          file_name?: string | null
          file_url: string
          id?: string
          is_active?: boolean | null
          logo_type?: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          file_name?: string | null
          file_url?: string
          id?: string
          is_active?: boolean | null
          logo_type?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_logos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "tenant_logos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          id: string
          name: string
          owner_id: string | null
          slug: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          subscription_tier: string | null
          total_campaigns_created: number | null
          trial_ends_at: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          owner_id?: string | null
          slug: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          subscription_tier?: string | null
          total_campaigns_created?: number | null
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          owner_id?: string | null
          slug?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          subscription_tier?: string | null
          total_campaigns_created?: number | null
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      two_factor_auth: {
        Row: {
          backup_codes: string[]
          created_at: string | null
          enabled: boolean | null
          id: string
          secret: string
          updated_at: string | null
          user_id: string | null
          verified_at: string | null
        }
        Insert: {
          backup_codes: string[]
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          secret: string
          updated_at?: string | null
          user_id?: string | null
          verified_at?: string | null
        }
        Update: {
          backup_codes?: string[]
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          secret?: string
          updated_at?: string | null
          user_id?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      user_deletion_requests: {
        Row: {
          completed_at: string | null
          created_at: string | null
          data_export_provided: boolean | null
          deletion_reason: string | null
          id: string
          requested_at: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          data_export_provided?: boolean | null
          deletion_reason?: string | null
          id?: string
          requested_at?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          data_export_provided?: boolean | null
          deletion_reason?: string | null
          id?: string
          requested_at?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_deletion_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "user_deletion_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_deletion_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_engagement: {
        Row: {
          id: string
          user_id: string | null
          tenant_id: string | null
          action: string
          metadata: Json | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id?: string | null
          tenant_id?: string | null
          action: string
          metadata?: Json | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string | null
          tenant_id?: string | null
          action?: string
          metadata?: Json | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_engagement_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "user_engagement_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_engagement_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_prefs: {
        Row: {
          id: string
          user_id: string
          show_sports: boolean
          show_alcohol: boolean
          week_start: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          show_sports?: boolean
          show_alcohol?: boolean
          week_start?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          show_sports?: boolean
          show_alcohol?: boolean
          week_start?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          user_id: string
          tenant_id: string
          role_id: string
          created_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          tenant_id: string
          role_id: string
          created_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          tenant_id?: string
          role_id?: string
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_tenants: {
        Row: {
          created_at: string | null
          id: string
          joined_at: string | null
          role: string | null
          tenant_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          joined_at?: string | null
          role?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          joined_at?: string | null
          role?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_tenants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "user_tenants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          deleted_at: string | null
          email: string | null
          first_name: string | null
          full_name: string | null
          id: string
          is_superadmin: boolean | null
          last_name: string | null
          notification_preferences: Json | null
          phone: string | null
          role: string | null
          onboarding_complete: boolean | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          id: string
          is_superadmin?: boolean | null
          last_name?: string | null
          notification_preferences?: Json | null
          phone?: string | null
          role?: string | null
          onboarding_complete?: boolean | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          is_superadmin?: boolean | null
          last_name?: string | null
          notification_preferences?: Json | null
          phone?: string | null
          role?: string | null
          onboarding_complete?: boolean | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist_subscribers: {
        Row: {
          id: string
          email: string
          created_at: string | null
          source: string | null
        }
        Insert: {
          id?: string
          email: string
          created_at?: string | null
          source?: string | null
        }
        Update: {
          id?: string
          email?: string
          created_at?: string | null
          source?: string | null
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          id: string
          platform: string
          event_type: string
          payload: Json | null
          created_at: string | null
        }
        Insert: {
          id?: string
          platform: string
          event_type: string
          payload?: Json | null
          created_at?: string | null
        }
        Update: {
          id?: string
          platform?: string
          event_type?: string
          payload?: Json | null
          created_at?: string | null
        }
        Relationships: []
      }
      watermark_settings: {
        Row: {
          auto_apply: boolean | null
          created_at: string | null
          enabled: boolean | null
          id: string
          margin_pixels: number | null
          opacity: number | null
          position: string | null
          size_percent: number | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          auto_apply?: boolean | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          margin_pixels?: number | null
          opacity?: number | null
          position?: string | null
          size_percent?: number | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          auto_apply?: boolean | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          margin_pixels?: number | null
          opacity?: number | null
          position?: string | null
          size_percent?: number | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "watermark_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "superadmin_dashboard"
            referencedColumns: ["tenant_id"]
          },
          {
            foreignKeyName: "watermark_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      index_usage_stats: {
        Row: {
          index_scans: number | null
          index_size: string | null
          indexname: unknown | null
          schemaname: unknown | null
          tablename: unknown | null
          tuples_fetched: number | null
          tuples_read: number | null
          usage_category: string | null
        }
        Relationships: []
      }
      superadmin_dashboard: {
        Row: {
          campaign_count: number | null
          connection_count: number | null
          media_count: number | null
          post_count: number | null
          subscription_status: string | null
          subscription_tier: string | null
          tenant_created: string | null
          tenant_id: string | null
          tenant_name: string | null
          trial_ends_at: string | null
          user_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      cleanup_deleted_users: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      cleanup_expired_data: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      claim_due_queue: {
        Args: { batch_size?: number | null }
        Returns: {
          id: string
          attempts: number
        }[]
      }
      acquire_inspiration_lock: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      create_tenant_and_assign: {
        Args: {
          p_brand_color?: string
          p_brand_identity?: string
          p_brand_voice?: string
          p_business_type?: string
          p_name: string
          p_target_audience?: string
        }
        Returns: Json
      }
      delete_user_account: {
        Args: { p_user_id: string }
        Returns: Json
      }
      get_auth_tenant_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      increment_guardrails_usage: {
        Args: { guardrail_id: string } | { guardrail_ids: string[] }
        Returns: undefined
      }
      is_superadmin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      log_superadmin_action: {
        Args: {
          p_action: string
          p_details?: Json
          p_target_id?: string
          p_target_table?: string
          p_target_tenant_id?: string
        }
        Returns: undefined
      }
      release_inspiration_lock: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      soft_delete_user_account: {
        Args: { p_user_id: string }
        Returns: Json
      }
      test_tenant_creation_now: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
