import { POST } from '@/app/api/stripe/webhook/route';
import { NextRequest } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createClient } from '@/lib/supabase/server';

// Mock dependencies
jest.mock('@/lib/stripe');
jest.mock('@/lib/supabase/server');

describe('/api/stripe/webhook', () => {
  let mockSupabase: any;
  let mockStripe: any;

  beforeEach(() => {
    // Mock Supabase
    mockSupabase = {
      from: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn(),
      })),
    };
    (createClient as jest.Mock).mockResolvedValue(mockSupabase);

    // Mock Stripe
    mockStripe = {
      webhooks: {
        constructEvent: jest.fn(),
      },
    };
    (stripe as any).webhooks = mockStripe.webhooks;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should handle customer.subscription.created event', async () => {
    const event = {
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'active',
          items: {
            data: [
              {
                price: {
                  id: 'price_starter',
                  product: 'prod_starter',
                },
              },
            ],
          },
          current_period_end: 1234567890,
        },
      },
    };

    mockStripe.webhooks.constructEvent.mockReturnValue(event);
    mockSupabase.from().single.mockResolvedValue({
      data: { id: 'tenant-123' },
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'stripe-signature': 'test-signature',
      },
      body: JSON.stringify(event),
    });

    const response = await POST(request);

    expect(mockSupabase.from).toHaveBeenCalledWith('tenants');
    expect(mockSupabase.from().update).toHaveBeenCalledWith(
      expect.objectContaining({
        stripe_subscription_id: 'sub_123',
        subscription_tier: 'starter',
        subscription_status: 'active',
      })
    );
    expect(response.status).toBe(200);
  });

  it('should handle customer.subscription.updated event', async () => {
    const event = {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'active',
          items: {
            data: [
              {
                price: {
                  id: 'price_pro',
                  product: 'prod_pro',
                },
              },
            ],
          },
          current_period_end: 1234567890,
        },
      },
    };

    mockStripe.webhooks.constructEvent.mockReturnValue(event);
    mockSupabase.from().single.mockResolvedValue({
      data: { id: 'tenant-123' },
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'stripe-signature': 'test-signature',
      },
      body: JSON.stringify(event),
    });

    const response = await POST(request);

    expect(mockSupabase.from().update).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription_tier: 'pro',
      })
    );
    expect(response.status).toBe(200);
  });

  it('should handle customer.subscription.deleted event', async () => {
    const event = {
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'canceled',
        },
      },
    };

    mockStripe.webhooks.constructEvent.mockReturnValue(event);
    mockSupabase.from().single.mockResolvedValue({
      data: { id: 'tenant-123' },
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'stripe-signature': 'test-signature',
      },
      body: JSON.stringify(event),
    });

    const response = await POST(request);

    expect(mockSupabase.from().update).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription_tier: 'free',
        subscription_status: 'canceled',
        stripe_subscription_id: null,
      })
    );
    expect(response.status).toBe(200);
  });

  it('should handle payment_intent.succeeded event', async () => {
    const event = {
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_123',
          amount: 2000,
          currency: 'usd',
          customer: 'cus_123',
          metadata: {
            tenantId: 'tenant-123',
          },
        },
      },
    };

    mockStripe.webhooks.constructEvent.mockReturnValue(event);

    const request = new NextRequest('http://localhost:3000/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'stripe-signature': 'test-signature',
      },
      body: JSON.stringify(event),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
  });

  it('should validate webhook signature', async () => {
    mockStripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('Invalid signature');
    });

    const request = new NextRequest('http://localhost:3000/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'stripe-signature': 'invalid-signature',
      },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(data.error).toContain('Webhook signature verification failed');
    expect(response.status).toBe(400);
  });

  it('should handle invoice.payment_failed event', async () => {
    const event = {
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'inv_123',
          customer: 'cus_123',
          subscription: 'sub_123',
          attempt_count: 2,
        },
      },
    };

    mockStripe.webhooks.constructEvent.mockReturnValue(event);

    const request = new NextRequest('http://localhost:3000/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'stripe-signature': 'test-signature',
      },
      body: JSON.stringify(event),
    });

    const response = await POST(request);

    // Should log the failure but still return 200
    expect(response.status).toBe(200);
  });

  it('should ignore unhandled event types', async () => {
    const event = {
      type: 'some.other.event',
      data: {
        object: {
          id: 'obj_123',
        },
      },
    };

    mockStripe.webhooks.constructEvent.mockReturnValue(event);

    const request = new NextRequest('http://localhost:3000/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'stripe-signature': 'test-signature',
      },
      body: JSON.stringify(event),
    });

    const response = await POST(request);

    expect(mockSupabase.from).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });
});