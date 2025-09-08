import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/supabase/auth';
import { formatDate } from '@/lib/utils/format';

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

    const supabase = await createClient();

    // Build query
    let query = supabase
      .from('campaigns')
      .select(`
        *,
        posts(
          id,
          content,
          media_url,
          platforms,
          status,
          publish_at,
          published_at,
          engagement_metrics
        )
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    // Apply date filters if provided
    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    if (endDate) {
      query = query.lte('created_at', endDate);
    }

    const { data: campaigns, error } = await query;

    if (error) {
      console.error('Error fetching campaigns:', error);
      return NextResponse.json(
        { error: 'Failed to fetch campaigns' },
        { status: 500 }
      );
    }

    // Format the response based on requested format
    if (format === 'csv') {
      const csv = convertCampaignsToCSV(campaigns);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="campaigns_${new Date().toISOString()}.csv"`,
        },
      });
    } else {
      // Return JSON format
      return NextResponse.json({
        campaigns,
        exportDate: new Date().toISOString(),
        totalCampaigns: campaigns.length,
        totalPosts: campaigns.reduce((acc, c) => acc + (c.posts?.length || 0), 0),
      });
    }
  } catch (error) {
    console.error('Error exporting campaigns:', error);
    return NextResponse.json(
      { error: 'Failed to export campaigns' },
      { status: 500 }
    );
  }
}

function convertCampaignsToCSV(campaigns: any[]): string {
  const headers = [
    'Campaign ID',
    'Campaign Name',
    'Description',
    'Status',
    'Created Date',
    'Total Posts',
    'Published Posts',
    'Scheduled Posts',
    'Failed Posts',
  ];

    const rows = campaigns.map(campaign => {
    const posts = campaign.posts || [];
    const publishedCount = posts.filter((p: any) => p.status === 'published').length;
    const scheduledCount = posts.filter((p: any) => p.status === 'scheduled').length;
    const failedCount = posts.filter((p: any) => p.status === 'failed').length;

    return [
      campaign.id,
      `"${campaign.name || ''}"`,
      `"${campaign.description || ''}"`,
      campaign.status || 'active',
      formatDate(campaign.created_at),
      posts.length,
      publishedCount,
      scheduledCount,
      failedCount,
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}
