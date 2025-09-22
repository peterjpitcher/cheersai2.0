import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUser } from '@/lib/supabase/auth';
import { formatDate } from '@/lib/utils/format';
import { createRequestLogger, logger } from '@/lib/observability/logger'
import { ok, unauthorized, serverError } from '@/lib/http'

export const runtime = 'nodejs'

type CampaignPostRow = {
  id: string
  content: string | null
  media_url: string | null
  platforms: string[] | null
  status: string | null
  publish_at: string | null
  published_at: string | null
  engagement_metrics: Record<string, unknown> | null
}

type CampaignRow = {
  id: string
  name: string | null
  description: string | null
  status: string | null
  created_at: string | null
  posts: CampaignPostRow[] | null
}

export async function GET(request: NextRequest) {
  const reqLogger = createRequestLogger(request as unknown as Request)
  try {
    const { user, tenantId } = await getUser();
    if (!user || !tenantId) {
      return unauthorized('Unauthorized', undefined, request)
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

    const { data: campaigns, error } = await query.returns<CampaignRow[]>();

    if (error) {
      reqLogger.error('Error fetching campaigns for export', {
        area: 'campaigns',
        op: 'export.fetch',
        status: 'fail',
        error,
        tenantId,
      })
      logger.error('Error fetching campaigns for export', {
        area: 'campaigns',
        op: 'export.fetch',
        status: 'fail',
        error,
      })
      return serverError('Failed to fetch campaigns', { message: error.message }, request)
    }

    // Format the response based on requested format
    if (format === 'csv') {
      reqLogger.info('Campaign export (CSV)', {
        area: 'campaigns',
        op: 'export.csv',
        status: 'ok',
        tenantId,
        meta: { count: campaigns.length },
      })
      const csv = convertCampaignsToCSV(campaigns);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="campaigns_${new Date().toISOString()}.csv"`,
        },
      });
    } else {
      reqLogger.info('Campaign export (JSON)', {
        area: 'campaigns',
        op: 'export.json',
        status: 'ok',
        tenantId,
        meta: { count: campaigns.length },
      })
      // Return JSON format
      return ok({
        campaigns,
        exportDate: new Date().toISOString(),
        totalCampaigns: campaigns.length,
        totalPosts: campaigns.reduce((acc, c) => acc + (c.posts?.length || 0), 0),
      }, request);
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    reqLogger.error('Error exporting campaigns', {
      area: 'campaigns',
      op: 'export',
      status: 'fail',
      error: err,
    })
    logger.error('Error exporting campaigns', {
      area: 'campaigns',
      op: 'export',
      status: 'fail',
      error: err,
    })
    return serverError('Failed to export campaigns', { message: err.message }, request)
  }
}

function convertCampaignsToCSV(campaigns: CampaignRow[]): string {
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

  const escape = (value: string | null | undefined) => `"${String(value ?? '').replace(/"/g, '""')}"`

  const rows = campaigns.map((campaign) => {
    const posts = campaign.posts ?? [];
    const publishedCount = posts.filter((post) => post.status === 'published').length;
    const scheduledCount = posts.filter((post) => post.status === 'scheduled').length;
    const failedCount = posts.filter((post) => post.status === 'failed').length;

    return [
      campaign.id,
      escape(campaign.name),
      escape(campaign.description),
      campaign.status || 'active',
      formatDate(campaign.created_at ?? new Date().toISOString()),
      posts.length,
      publishedCount,
      scheduledCount,
      failedCount,
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}
