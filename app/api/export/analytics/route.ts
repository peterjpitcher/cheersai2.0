import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/supabase/auth';

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId } = await getUser();
    if (!user || !tenantId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const format = searchParams.get('format') || 'json';
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const groupBy = searchParams.get('groupBy') || 'day'; // day, week, month

    const supabase = await createClient();

    // Fetch posts with engagement metrics
    let postsQuery = supabase
      .from('posts')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'published')
      .order('published_at', { ascending: true });

    if (startDate) {
      postsQuery = postsQuery.gte('published_at', startDate);
    }
    if (endDate) {
      postsQuery = postsQuery.lte('published_at', endDate);
    }

    const { data: posts, error: postsError } = await postsQuery;

    if (postsError) {
      console.error('Error fetching posts:', postsError);
      return NextResponse.json(
        { error: 'Failed to fetch analytics data' },
        { status: 500 }
      );
    }

    // Fetch campaign data
    const { data: campaigns } = await supabase
      .from('campaigns')
      .select('*')
      .eq('tenant_id', tenantId);

    // Calculate analytics
    const analytics = calculateDetailedAnalytics(posts, campaigns, groupBy);

    // Format the response based on requested format
    if (format === 'csv') {
      const csv = convertAnalyticsToCSV(analytics);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="analytics_${new Date().toISOString()}.csv"`,
        },
      });
    } else if (format === 'pdf') {
      // For PDF, we'll return structured data that frontend can convert
      return NextResponse.json({
        format: 'pdf',
        data: analytics,
        metadata: {
          title: 'PubHubAI Analytics Report',
          dateRange: `${startDate || 'All time'} to ${endDate || 'Present'}`,
          generatedAt: new Date().toISOString(),
        },
      });
    } else {
      // Return JSON format
      return NextResponse.json({
        analytics,
        exportDate: new Date().toISOString(),
        dateRange: {
          start: startDate || 'All time',
          end: endDate || 'Present',
        },
      });
    }
  } catch (error) {
    console.error('Error exporting analytics:', error);
    return NextResponse.json(
      { error: 'Failed to export analytics' },
      { status: 500 }
    );
  }
}

function calculateDetailedAnalytics(posts: any[], campaigns: any[], groupBy: string) {
  // Overall metrics
  const totalPosts = posts.length;
  const totalImpressions = posts.reduce((acc, post) => 
    acc + (post.engagement_metrics?.impressions || 0), 0
  );
  const totalEngagement = posts.reduce((acc, post) => 
    acc + (post.engagement_metrics?.engagement || 0), 0
  );
  const totalClicks = posts.reduce((acc, post) => 
    acc + (post.engagement_metrics?.clicks || 0), 0
  );
  const totalShares = posts.reduce((acc, post) => 
    acc + (post.engagement_metrics?.shares || 0), 0
  );

  // Platform breakdown
  const platformMetrics: Record<string, any> = {};
  posts.forEach(post => {
    (post.platforms || []).forEach((platform: string) => {
      if (!platformMetrics[platform]) {
        platformMetrics[platform] = {
          posts: 0,
          impressions: 0,
          engagement: 0,
          clicks: 0,
          shares: 0,
        };
      }
      platformMetrics[platform].posts += 1;
      platformMetrics[platform].impressions += post.engagement_metrics?.impressions || 0;
      platformMetrics[platform].engagement += post.engagement_metrics?.engagement || 0;
      platformMetrics[platform].clicks += post.engagement_metrics?.clicks || 0;
      platformMetrics[platform].shares += post.engagement_metrics?.shares || 0;
    });
  });

  // Time series data
  const timeSeriesData = generateTimeSeriesData(posts, groupBy);

  // Top performing posts
  const topPosts = [...posts]
    .sort((a, b) => 
      (b.engagement_metrics?.engagement || 0) - (a.engagement_metrics?.engagement || 0)
    )
    .slice(0, 10)
    .map(post => ({
      id: post.id,
      content: post.content.substring(0, 100),
      platforms: post.platforms,
      engagement: post.engagement_metrics?.engagement || 0,
      impressions: post.engagement_metrics?.impressions || 0,
      engagementRate: post.engagement_metrics?.impressions 
        ? ((post.engagement_metrics.engagement / post.engagement_metrics.impressions) * 100).toFixed(2)
        : 0,
      publishedAt: post.published_at,
    }));

  // Campaign performance
  const campaignPerformance = campaigns?.map(campaign => {
    const campaignPosts = posts.filter(p => p.campaign_id === campaign.id);
    const campaignImpressions = campaignPosts.reduce((acc, p) => 
      acc + (p.engagement_metrics?.impressions || 0), 0
    );
    const campaignEngagement = campaignPosts.reduce((acc, p) => 
      acc + (p.engagement_metrics?.engagement || 0), 0
    );

    return {
      id: campaign.id,
      name: campaign.name,
      totalPosts: campaignPosts.length,
      impressions: campaignImpressions,
      engagement: campaignEngagement,
      engagementRate: campaignImpressions 
        ? ((campaignEngagement / campaignImpressions) * 100).toFixed(2)
        : 0,
    };
  }) || [];

  return {
    summary: {
      totalPosts,
      totalImpressions,
      totalEngagement,
      totalClicks,
      totalShares,
      averageEngagementRate: totalImpressions 
        ? ((totalEngagement / totalImpressions) * 100).toFixed(2)
        : 0,
      averageClickRate: totalImpressions 
        ? ((totalClicks / totalImpressions) * 100).toFixed(2)
        : 0,
    },
    platformMetrics,
    timeSeriesData,
    topPosts,
    campaignPerformance,
  };
}

function generateTimeSeriesData(posts: any[], groupBy: string) {
  const groupedData: Record<string, any> = {};

  posts.forEach(post => {
    if (!post.published_at) return;

    const date = new Date(post.published_at);
    let key: string;

    if (groupBy === 'day') {
      key = date.toISOString().split('T')[0];
    } else if (groupBy === 'week') {
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      key = weekStart.toISOString().split('T')[0];
    } else { // month
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }

    if (!groupedData[key]) {
      groupedData[key] = {
        date: key,
        posts: 0,
        impressions: 0,
        engagement: 0,
        clicks: 0,
      };
    }

    groupedData[key].posts += 1;
    groupedData[key].impressions += post.engagement_metrics?.impressions || 0;
    groupedData[key].engagement += post.engagement_metrics?.engagement || 0;
    groupedData[key].clicks += post.engagement_metrics?.clicks || 0;
  });

  return Object.values(groupedData).sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
}

function convertAnalyticsToCSV(analytics: any): string {
  const sections = [];

  // Summary section
  sections.push('SUMMARY METRICS');
  sections.push('Metric,Value');
  Object.entries(analytics.summary).forEach(([key, value]) => {
    sections.push(`${key},${value}`);
  });
  sections.push('');

  // Platform metrics section
  sections.push('PLATFORM BREAKDOWN');
  sections.push('Platform,Posts,Impressions,Engagement,Clicks,Shares');
  Object.entries(analytics.platformMetrics).forEach(([platform, metrics]: [string, any]) => {
    sections.push(`${platform},${metrics.posts},${metrics.impressions},${metrics.engagement},${metrics.clicks},${metrics.shares}`);
  });
  sections.push('');

  // Time series section
  sections.push('TIME SERIES DATA');
  sections.push('Date,Posts,Impressions,Engagement,Clicks');
  analytics.timeSeriesData.forEach((data: any) => {
    sections.push(`${data.date},${data.posts},${data.impressions},${data.engagement},${data.clicks}`);
  });
  sections.push('');

  // Top posts section
  sections.push('TOP PERFORMING POSTS');
  sections.push('Content,Platforms,Engagement,Impressions,Engagement Rate,Published Date');
  analytics.topPosts.forEach((post: any) => {
    sections.push(`"${post.content}","${post.platforms.join('; ')}",${post.engagement},${post.impressions},${post.engagementRate}%,${post.publishedAt}`);
  });

  return sections.join('\n');
}