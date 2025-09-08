import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/supabase/auth';
import { formatDateTime } from '@/lib/utils/format';

export const runtime = 'nodejs'

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
    const status = searchParams.get('status');
    const platform = searchParams.get('platform');

    const supabase = await createClient();

    // Build query
    let query = supabase
      .from('posts')
      .select(`
        *,
        campaigns(name, description)
      `)
      .eq('tenant_id', tenantId)
      .order('publish_at', { ascending: false });

    // Apply filters
    if (startDate) {
      query = query.gte('publish_at', startDate);
    }
    if (endDate) {
      query = query.lte('publish_at', endDate);
    }
    if (status) {
      query = query.eq('status', status);
    }
    if (platform) {
      query = query.contains('platforms', [platform]);
    }

    const { data: posts, error } = await query;

    if (error) {
      console.error('Error fetching posts:', error);
      return NextResponse.json(
        { error: 'Failed to fetch posts' },
        { status: 500 }
      );
    }

    // Format the response based on requested format
    if (format === 'csv') {
      const csv = convertPostsToCSV(posts);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="posts_${new Date().toISOString()}.csv"`,
        },
      });
    } else if (format === 'excel') {
      // For Excel, we'll return a TSV that Excel can open
      const tsv = convertPostsToTSV(posts);
      return new NextResponse(tsv, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.ms-excel',
          'Content-Disposition': `attachment; filename="posts_${new Date().toISOString()}.xls"`,
        },
      });
    } else {
      // Return JSON format with analytics
      const analytics = calculatePostAnalytics(posts);
      return NextResponse.json({
        posts,
        exportDate: new Date().toISOString(),
        totalPosts: posts.length,
        analytics,
      });
    }
  } catch (error) {
    console.error('Error exporting posts:', error);
    return NextResponse.json(
      { error: 'Failed to export posts' },
      { status: 500 }
    );
  }
}

function convertPostsToCSV(posts: any[]): string {
  const headers = [
    'Post ID',
    'Campaign',
    'Content',
    'Platforms',
    'Status',
    'Scheduled Date',
    'Published Date',
    'Impressions',
    'Engagement',
    'Clicks',
    'Media URL',
  ];

  const rows = posts.map(post => {
    const metrics = post.engagement_metrics || {};
    return [
      post.id,
      `"${post.campaigns?.name || 'N/A'}"`,
      `"${post.content.replace(/"/g, '""')}"`,
      (post.platforms || []).join('; '),
      post.status,
      post.publish_at ? formatDateTime(post.publish_at) : '',
      post.published_at ? formatDateTime(post.published_at) : '',
      metrics.impressions || 0,
      metrics.engagement || 0,
      metrics.clicks || 0,
      post.media_url || '',
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

function convertPostsToTSV(posts: any[]): string {
  const headers = [
    'Post ID',
    'Campaign',
    'Content',
    'Platforms',
    'Status',
    'Scheduled Date',
    'Published Date',
    'Impressions',
    'Engagement',
    'Clicks',
    'Media URL',
  ];

  const rows = posts.map(post => {
    const metrics = post.engagement_metrics || {};
    return [
      post.id,
      post.campaigns?.name || 'N/A',
      post.content.replace(/\t/g, ' '),
      (post.platforms || []).join('; '),
      post.status,
      post.publish_at ? formatDateTime(post.publish_at) : '',
      post.published_at ? formatDateTime(post.published_at) : '',
      metrics.impressions || 0,
      metrics.engagement || 0,
      metrics.clicks || 0,
      post.media_url || '',
    ].join('\t');
  });

  return [headers.join('\t'), ...rows].join('\n');
}

function calculatePostAnalytics(posts: any[]) {
  const totalPosts = posts.length;
  const publishedPosts = posts.filter(p => p.status === 'published').length;
  const scheduledPosts = posts.filter(p => p.status === 'scheduled').length;
  const failedPosts = posts.filter(p => p.status === 'failed').length;

  const platformDistribution: Record<string, number> = {};
  posts.forEach(post => {
    (post.platforms || []).forEach((platform: string) => {
      platformDistribution[platform] = (platformDistribution[platform] || 0) + 1;
    });
  });

  const totalImpressions = posts.reduce((acc, post) => 
    acc + (post.engagement_metrics?.impressions || 0), 0
  );
  const totalEngagement = posts.reduce((acc, post) => 
    acc + (post.engagement_metrics?.engagement || 0), 0
  );
  const totalClicks = posts.reduce((acc, post) => 
    acc + (post.engagement_metrics?.clicks || 0), 0
  );

  return {
    totalPosts,
    publishedPosts,
    scheduledPosts,
    failedPosts,
    platformDistribution,
    totalImpressions,
    totalEngagement,
    totalClicks,
    averageEngagementRate: totalPosts > 0 
      ? ((totalEngagement / totalImpressions) * 100).toFixed(2) 
      : 0,
  };
}
