import { POST, PUT } from '@/app/api/auth/reset-password/route';
import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Mock Supabase
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

// Mock fetch for email notifications
global.fetch = jest.fn();

describe('/api/auth/reset-password', () => {
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = {
      auth: {
        resetPasswordForEmail: jest.fn(),
        updateUser: jest.fn(),
      },
    };
    (createClient as jest.Mock).mockResolvedValue(mockSupabase);
    (global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({ success: true }),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST - Request Password Reset', () => {
    it('should send reset email for valid email', async () => {
      mockSupabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });

      const request = new NextRequest('http://localhost:3000/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(mockSupabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
        'test@example.com',
        expect.objectContaining({
          redirectTo: expect.stringContaining('/auth/reset-password'),
        })
      );
      expect(data.message).toContain('If an account exists');
      expect(response.status).toBe(200);
    });

    it('should return error for missing email', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.error).toBe('Email is required');
      expect(response.status).toBe(400);
    });

    it('should handle Supabase errors gracefully', async () => {
      mockSupabase.auth.resetPasswordForEmail.mockResolvedValue({
        error: { message: 'Database error' },
      });

      const request = new NextRequest('http://localhost:3000/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }),
      });

      const response = await POST(request);
      const data = await response.json();

      // Should still return success message for security
      expect(data.message).toContain('If an account exists');
      expect(response.status).toBe(200);
    });
  });

  describe('PUT - Update Password', () => {
    it('should update password with valid token', async () => {
      mockSupabase.auth.updateUser.mockResolvedValue({ error: null });

      const request = new NextRequest('http://localhost:3000/api/auth/reset-password', {
        method: 'PUT',
        body: JSON.stringify({
          password: 'newPassword123',
          token: 'valid-token',
        }),
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(mockSupabase.auth.updateUser).toHaveBeenCalledWith({
        password: 'newPassword123',
      });
      expect(data.message).toBe('Password updated successfully');
      expect(response.status).toBe(200);
    });

    it('should return error for missing password', async () => {
      const request = new NextRequest('http://localhost:3000/api/auth/reset-password', {
        method: 'PUT',
        body: JSON.stringify({ token: 'valid-token' }),
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(data.error).toBe('Password and token are required');
      expect(response.status).toBe(400);
    });

    it('should handle update errors', async () => {
      mockSupabase.auth.updateUser.mockResolvedValue({
        error: { message: 'Token expired' },
      });

      const request = new NextRequest('http://localhost:3000/api/auth/reset-password', {
        method: 'PUT',
        body: JSON.stringify({
          password: 'newPassword123',
          token: 'expired-token',
        }),
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(data.error).toContain('Failed to update password');
      expect(response.status).toBe(400);
    });
  });
});