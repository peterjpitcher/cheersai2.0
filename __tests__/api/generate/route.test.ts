import { POST } from '@/app/api/generate/route';
import { NextRequest } from 'next/server';
import { getUser } from '@/lib/supabase/auth';
import { checkPostLimit } from '@/lib/subscription/check-limits';
import OpenAI from 'openai';

// Mock dependencies
jest.mock('@/lib/supabase/auth');
jest.mock('@/lib/subscription/check-limits');
jest.mock('openai');

describe('/api/generate', () => {
  let mockOpenAI: any;

  beforeEach(() => {
    // Mock OpenAI
    mockOpenAI = {
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    };
    (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(() => mockOpenAI);

    // Mock user authentication
    (getUser as jest.Mock).mockResolvedValue({
      user: { id: 'test-user-id' },
      tenantId: 'test-tenant-id',
    });

    // Mock subscription limits
    (checkPostLimit as jest.Mock).mockResolvedValue({
      allowed: true,
      currentUsage: 5,
      limit: 100,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should generate content for valid request', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Generated social media content',
          },
        },
      ],
    });

    const request = new NextRequest('http://localhost:3000/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        prompt: 'Write a post about coffee',
        platform: 'facebook',
        tone: 'casual',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4-turbo-preview',
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('social media content expert'),
          }),
        ]),
      })
    );
    expect(data.content).toBe('Generated social media content');
    expect(response.status).toBe(200);
  });

  it('should return 401 if user is not authenticated', async () => {
    (getUser as jest.Mock).mockResolvedValue({
      user: null,
      tenantId: null,
    });

    const request = new NextRequest('http://localhost:3000/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        prompt: 'Write a post',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.error).toBe('Unauthorized');
    expect(response.status).toBe(401);
  });

  it('should enforce subscription limits', async () => {
    (checkPostLimit as jest.Mock).mockResolvedValue({
      allowed: false,
      currentUsage: 100,
      limit: 100,
      message: 'You have reached your monthly post limit',
    });

    const request = new NextRequest('http://localhost:3000/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        prompt: 'Write a post',
        platform: 'twitter',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.error).toContain('monthly post limit');
    expect(response.status).toBe(403);
  });

  it('should handle OpenAI API errors', async () => {
    mockOpenAI.chat.completions.create.mockRejectedValue(
      new Error('OpenAI API error')
    );

    const request = new NextRequest('http://localhost:3000/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        prompt: 'Write a post',
        platform: 'instagram',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.error).toContain('Failed to generate content');
    expect(response.status).toBe(500);
  });

  it('should validate required fields', async () => {
    const request = new NextRequest('http://localhost:3000/api/generate', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.error).toContain('Prompt is required');
    expect(response.status).toBe(400);
  });

  it('should generate platform-specific content', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Short tweet content',
          },
        },
      ],
    });

    const request = new NextRequest('http://localhost:3000/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        prompt: 'Write about AI',
        platform: 'twitter',
        tone: 'professional',
      }),
    });

    await POST(request);

    expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining('Twitter'),
          }),
        ]),
      })
    );
  });
});