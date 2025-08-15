import { POST } from '@/app/api/social/route';
import { NextRequest } from 'next/server';
import { getUser } from '@/lib/supabase/auth';
import { createClient } from '@/lib/supabase/server';

// Mock dependencies
jest.mock('@/lib/supabase/auth');
jest.mock('@/lib/supabase/server');
jest.mock('@/lib/social/facebook', () => ({
  publishToFacebook: jest.fn(),
}));
jest.mock('@/lib/social/instagram', () => ({
  publishToInstagram: jest.fn(),
}));
jest.mock('@/lib/social/twitter', () => ({
  publishToTwitter: jest.fn(),
}));

import { publishToFacebook } from '@/lib/social/facebook';
import { publishToInstagram } from '@/lib/social/instagram';
import { publishToTwitter } from '@/lib/social/twitter';

describe('/api/social', () => {
  let mockSupabase: any;

  beforeEach(() => {
    // Mock Supabase client
    mockSupabase = {
      from: jest.fn(() => ({
        insert: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn(),
      })),
    };
    (createClient as jest.Mock).mockResolvedValue(mockSupabase);

    // Mock user authentication
    (getUser as jest.Mock).mockResolvedValue({
      user: { id: 'test-user-id' },
      tenantId: 'test-tenant-id',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should publish to single platform successfully', async () => {
    (publishToFacebook as jest.Mock).mockResolvedValue({
      success: true,
      postId: 'fb-123',
      url: 'https://facebook.com/post/123',
    });

    mockSupabase.from().single.mockResolvedValue({
      data: { id: 'post-123' },
    });

    const request = new NextRequest('http://localhost:3000/api/social', {
      method: 'POST',
      body: JSON.stringify({
        campaignId: 'campaign-123',
        content: 'Test post content',
        platforms: ['facebook'],
        publishAt: new Date().toISOString(),
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(publishToFacebook).toHaveBeenCalledWith(
      'Test post content',
      undefined,
      'test-tenant-id'
    );
    expect(data.results).toHaveLength(1);
    expect(data.results[0].success).toBe(true);
    expect(response.status).toBe(200);
  });

  it('should publish to multiple platforms', async () => {
    (publishToFacebook as jest.Mock).mockResolvedValue({
      success: true,
      postId: 'fb-123',
    });
    (publishToTwitter as jest.Mock).mockResolvedValue({
      success: true,
      postId: 'tw-456',
    });

    mockSupabase.from().single.mockResolvedValue({
      data: { id: 'post-123' },
    });

    const request = new NextRequest('http://localhost:3000/api/social', {
      method: 'POST',
      body: JSON.stringify({
        campaignId: 'campaign-123',
        content: 'Multi-platform post',
        platforms: ['facebook', 'twitter'],
        publishAt: new Date().toISOString(),
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(publishToFacebook).toHaveBeenCalled();
    expect(publishToTwitter).toHaveBeenCalled();
    expect(data.results).toHaveLength(2);
    expect(response.status).toBe(200);
  });

  it('should handle platform publishing failures', async () => {
    (publishToFacebook as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Facebook API error',
    });

    mockSupabase.from().single.mockResolvedValue({
      data: { id: 'post-123' },
    });

    const request = new NextRequest('http://localhost:3000/api/social', {
      method: 'POST',
      body: JSON.stringify({
        campaignId: 'campaign-123',
        content: 'Test post',
        platforms: ['facebook'],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.results[0].success).toBe(false);
    expect(data.results[0].error).toContain('Facebook API error');
    expect(response.status).toBe(207); // Multi-status for partial success
  });

  it('should schedule posts for future publishing', async () => {
    const futureDate = new Date();
    futureDate.setHours(futureDate.getHours() + 24);

    mockSupabase.from().single.mockResolvedValue({
      data: { id: 'post-123', status: 'scheduled' },
    });

    const request = new NextRequest('http://localhost:3000/api/social', {
      method: 'POST',
      body: JSON.stringify({
        campaignId: 'campaign-123',
        content: 'Scheduled post',
        platforms: ['twitter'],
        publishAt: futureDate.toISOString(),
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(publishToTwitter).not.toHaveBeenCalled();
    expect(data.scheduled).toBe(true);
    expect(response.status).toBe(200);
  });

  it('should validate required fields', async () => {
    const request = new NextRequest('http://localhost:3000/api/social', {
      method: 'POST',
      body: JSON.stringify({
        content: 'Missing campaign ID',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.error).toContain('Campaign ID is required');
    expect(response.status).toBe(400);
  });

  it('should require authentication', async () => {
    (getUser as jest.Mock).mockResolvedValue({
      user: null,
      tenantId: null,
    });

    const request = new NextRequest('http://localhost:3000/api/social', {
      method: 'POST',
      body: JSON.stringify({
        campaignId: 'campaign-123',
        content: 'Test',
        platforms: ['facebook'],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.error).toBe('Unauthorized');
    expect(response.status).toBe(401);
  });

  it('should handle Instagram image requirements', async () => {
    (publishToInstagram as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Instagram requires an image',
    });

    mockSupabase.from().single.mockResolvedValue({
      data: { id: 'post-123' },
    });

    const request = new NextRequest('http://localhost:3000/api/social', {
      method: 'POST',
      body: JSON.stringify({
        campaignId: 'campaign-123',
        content: 'Instagram post without image',
        platforms: ['instagram'],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.results[0].error).toContain('Instagram requires an image');
    expect(response.status).toBe(207);
  });
});