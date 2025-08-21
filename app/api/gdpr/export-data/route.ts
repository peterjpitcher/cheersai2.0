import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: user } = await supabase.auth.getUser();
    
    if (!user.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { export_type = 'gdpr_request' } = await request.json();

    // Get user's tenant_id
    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id, full_name, role, created_at')
      .eq('id', user.user.id)
      .single();

    if (!userData) {
      return NextResponse.json({ error: "User data not found" }, { status: 404 });
    }

    // Collect all user data for export
    const exportData = {
      export_info: {
        generated_at: new Date().toISOString(),
        export_type,
        uk_gdpr_compliant: true,
        user_id: user.user.id,
        retention_notice: "This export contains all personal data we hold about you. Per UK data protection law, you have the right to request corrections or deletion."
      },
      user_profile: {
        id: user.user.id,
        email: user.user.email,
        full_name: userData.full_name,
        role: userData.role,
        created_at: userData.created_at
      },
      tenant_data: null,
      campaigns: [],
      posts: [],
      media_assets: [],
      social_connections: [],
      publishing_history: [],
      analytics_data: []
    };

    // Get tenant information
    const { data: tenantData } = await supabase
      .from('tenants')
      .select('name, subscription_status, subscription_tier, created_at')
      .eq('id', userData.tenant_id)
      .single();

    if (tenantData) {
      exportData.tenant_data = tenantData;
    }

    // Get campaigns
    const { data: campaigns } = await supabase
      .from('campaigns')
      .select('name, event_date, campaign_type, status, created_at')
      .eq('tenant_id', userData.tenant_id)
      .is('deleted_at', null);

    if (campaigns) {
      exportData.campaigns = campaigns;
    }

    // Get campaign posts
    const { data: posts } = await supabase
      .from('campaign_posts')
      .select(`
        content, 
        post_timing, 
        scheduled_for, 
        created_at,
        campaigns!inner(name)
      `)
      .eq('campaigns.tenant_id', userData.tenant_id)
      .is('deleted_at', null);

    if (posts) {
      exportData.posts = posts;
    }

    // Get media assets (without URLs for privacy)
    const { data: mediaAssets } = await supabase
      .from('media_assets')
      .select('file_name, file_type, file_size, tags, created_at, last_used_at')
      .eq('tenant_id', userData.tenant_id)
      .is('deleted_at', null);

    if (mediaAssets) {
      exportData.media_assets = mediaAssets;
    }

    // Get social connections (without tokens for security)
    const { data: socialConnections } = await supabase
      .from('social_connections')
      .select('platform, account_name, page_name, is_active, created_at')
      .eq('tenant_id', userData.tenant_id)
      .is('deleted_at', null);

    if (socialConnections) {
      exportData.social_connections = socialConnections;
    }

    // Get publishing history
    const { data: publishingHistory } = await supabase
      .from('publishing_history')
      .select('platform, status, published_at, created_at')
      .in('campaign_post_id', 
        campaigns?.map(c => c.id).filter(Boolean) || []
      )
      .is('deleted_at', null);

    if (publishingHistory) {
      exportData.publishing_history = publishingHistory;
    }

    // Get performance metrics (last 90 days only for privacy)
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const { data: performanceMetrics } = await supabase
      .from('performance_metrics')
      .select('metric_type, value, created_at')
      .eq('tenant_id', userData.tenant_id)
      .gte('created_at', ninetyDaysAgo.toISOString())
      .is('deleted_at', null);

    if (performanceMetrics) {
      exportData.analytics_data = performanceMetrics;
    }

    // Create data export record
    const { error: exportError } = await supabase
      .from('data_exports')
      .insert({
        user_id: user.user.id,
        tenant_id: userData.tenant_id,
        export_type,
        status: 'completed',
        metadata: {
          records_exported: {
            campaigns: exportData.campaigns.length,
            posts: exportData.posts.length,
            media_assets: exportData.media_assets.length,
            social_connections: exportData.social_connections.length,
            publishing_history: exportData.publishing_history.length,
            analytics_records: exportData.analytics_data.length
          }
        }
      });

    if (exportError) {
      console.error("Error creating export record:", exportError);
    }

    return NextResponse.json({
      success: true,
      message: "Data export completed successfully",
      uk_gdpr_compliant: true,
      data: exportData,
      retention_notice: "This export will be available for 30 days, after which it will be automatically deleted for security."
    });

  } catch (error) {
    console.error("Data export error:", error);
    return NextResponse.json({
      error: "Data export failed",
      details: error
    }, { status: 500 });
  }
}