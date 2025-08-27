/**
 * Tests for validation schemas
 */

import { 
  loginSchema, 
  signupSchema, 
  createCampaignSchema,
  generateContentSchema,
  platformSchema,
  connectSocialSchema
} from '@/lib/validation/schemas';

describe('Validation Schemas', () => {
  describe('Platform Schema', () => {
    it('should accept valid platforms', () => {
      const validPlatforms = ['facebook', 'instagram', 'twitter', 'linkedin', 'google_my_business'];
      
      validPlatforms.forEach(platform => {
        expect(() => platformSchema.parse(platform)).not.toThrow();
      });
    });

    it('should reject invalid platforms', () => {
      const invalidPlatforms = ['tiktok', 'snapchat', 'youtube', ''];
      
      invalidPlatforms.forEach(platform => {
        expect(() => platformSchema.parse(platform)).toThrow();
      });
    });
  });

  describe('Login Schema', () => {
    it('should validate correct login data', () => {
      const validLogin = {
        email: 'user@example.com',
        password: 'password123'
      };

      const result = loginSchema.parse(validLogin);
      expect(result).toEqual(validLogin);
    });

    it('should reject invalid email', () => {
      const invalidLogin = {
        email: 'invalid-email',
        password: 'password123'
      };

      expect(() => loginSchema.parse(invalidLogin)).toThrow();
    });

    it('should reject short password', () => {
      const invalidLogin = {
        email: 'user@example.com',
        password: '123'
      };

      expect(() => loginSchema.parse(invalidLogin)).toThrow();
    });
  });

  describe('Signup Schema', () => {
    it('should validate correct signup data', () => {
      const validSignup = {
        email: 'user@example.com',
        password: 'Password123',
        firstName: 'John',
        lastName: 'Doe',
        businessName: 'The Crown Pub'
      };

      const result = signupSchema.parse(validSignup);
      expect(result).toMatchObject({
        email: 'user@example.com',
        firstName: 'John',
        lastName: 'Doe',
        businessName: 'The Crown Pub'
      });
    });

    it('should require uppercase, lowercase, and number in password', () => {
      const invalidPasswords = [
        'password', // no uppercase, no number
        'PASSWORD123', // no lowercase
        'Password', // no number
        'password123' // no uppercase
      ];

      invalidPasswords.forEach(password => {
        const signup = {
          email: 'user@example.com',
          password,
          firstName: 'John',
          lastName: 'Doe',
          businessName: 'Test Business'
        };

        expect(() => signupSchema.parse(signup)).toThrow();
      });
    });

    it('should sanitize string inputs', () => {
      const signupWithScripts = {
        email: 'user@example.com',
        password: 'Password123',
        firstName: '<script>alert("xss")</script>John',
        lastName: 'Doe<script>',
        businessName: 'Business<script>evil()</script>'
      };

      const result = signupSchema.parse(signupWithScripts);
      
      // Scripts should be removed
      expect(result.firstName).toBe('John');
      expect(result.lastName).toBe('Doe');
      expect(result.businessName).toBe('Business');
    });

    it('should reject empty required fields', () => {
      const incompleteSignup = {
        email: 'user@example.com',
        password: 'Password123',
        firstName: '',
        lastName: 'Doe',
        businessName: 'Business'
      };

      expect(() => signupSchema.parse(incompleteSignup)).toThrow();
    });
  });

  describe('Campaign Schema', () => {
    it('should validate correct campaign data', () => {
      const validCampaign = {
        name: 'Summer Special Campaign',
        description: 'Promoting our summer menu',
        platforms: ['facebook', 'instagram'],
        status: 'draft'
      };

      const result = createCampaignSchema.parse(validCampaign);
      expect(result).toMatchObject(validCampaign);
    });

    it('should require at least one platform', () => {
      const invalidCampaign = {
        name: 'Campaign',
        platforms: []
      };

      expect(() => createCampaignSchema.parse(invalidCampaign)).toThrow();
    });

    it('should reject invalid status', () => {
      const invalidCampaign = {
        name: 'Campaign',
        platforms: ['facebook'],
        status: 'invalid_status'
      };

      expect(() => createCampaignSchema.parse(invalidCampaign)).toThrow();
    });

    it('should default status to draft', () => {
      const campaign = {
        name: 'Campaign',
        platforms: ['facebook']
      };

      const result = createCampaignSchema.parse(campaign);
      expect(result.status).toBe('draft');
    });

    it('should validate date formats', () => {
      const campaignWithDates = {
        name: 'Campaign',
        platforms: ['facebook'],
        startDate: '2024-01-01T10:00:00Z',
        endDate: '2024-01-31T18:00:00Z'
      };

      const result = createCampaignSchema.parse(campaignWithDates);
      expect(result.startDate).toBe('2024-01-01T10:00:00Z');
      expect(result.endDate).toBe('2024-01-31T18:00:00Z');
    });
  });

  describe('Content Generation Schema', () => {
    it('should validate correct generation request', () => {
      const validRequest = {
        platform: 'facebook',
        businessContext: 'We are a traditional British pub',
        tone: 'friendly',
        includeEmojis: true,
        includeHashtags: true,
        maxLength: 280,
        temperature: 0.8
      };

      const result = generateContentSchema.parse(validRequest);
      expect(result).toMatchObject(validRequest);
    });

    it('should use default values', () => {
      const minimalRequest = {
        platform: 'facebook'
      };

      const result = generateContentSchema.parse(minimalRequest);
      expect(result.includeEmojis).toBe(true);
      expect(result.includeHashtags).toBe(true);
      expect(result.temperature).toBe(0.8);
    });

    it('should validate temperature range', () => {
      const invalidRequests = [
        { platform: 'facebook', temperature: -1 },
        { platform: 'facebook', temperature: 3 }
      ];

      invalidRequests.forEach(request => {
        expect(() => generateContentSchema.parse(request)).toThrow();
      });
    });

    it('should validate max length range', () => {
      const invalidRequests = [
        { platform: 'facebook', maxLength: 5 }, // too short
        { platform: 'facebook', maxLength: 10000 } // too long
      ];

      invalidRequests.forEach(request => {
        expect(() => generateContentSchema.parse(request)).toThrow();
      });
    });

    it('should validate tone options', () => {
      const validTones = ['professional', 'casual', 'friendly', 'enthusiastic', 'informative'];
      
      validTones.forEach(tone => {
        const request = { platform: 'facebook', tone };
        expect(() => generateContentSchema.parse(request)).not.toThrow();
      });
    });

    it('should reject invalid tone', () => {
      const request = { platform: 'facebook', tone: 'sarcastic' };
      expect(() => generateContentSchema.parse(request)).toThrow();
    });
  });

  describe('Social Connection Schema', () => {
    it('should validate social connection data', () => {
      const validConnection = {
        platform: 'facebook',
        accessToken: 'token123',
        refreshToken: 'refresh456',
        accountName: 'The Crown Pub',
        accountId: '123456789'
      };

      const result = connectSocialSchema.parse(validConnection);
      expect(result).toMatchObject(validConnection);
    });

    it('should sanitize account name', () => {
      const connection = {
        platform: 'facebook',
        accessToken: 'token123',
        accountName: '<script>hack()</script>Clean Name',
        accountId: '123456789'
      };

      const result = connectSocialSchema.parse(connection);
      expect(result.accountName).toBe('Clean Name');
    });

    it('should require access token', () => {
      const invalidConnection = {
        platform: 'facebook',
        accessToken: '',
        accountName: 'Test',
        accountId: '123'
      };

      expect(() => connectSocialSchema.parse(invalidConnection)).toThrow();
    });
  });

  describe('XSS Prevention', () => {
    it('should remove script tags', () => {
      const maliciousInput = '<script>alert("xss")</script>Clean text';
      const schema = createCampaignSchema.pick({ name: true });
      
      const result = schema.parse({ name: maliciousInput });
      expect(result.name).toBe('Clean text');
    });

    it('should remove javascript: URLs', () => {
      const maliciousInput = 'javascript:alert("xss")Clean text';
      const schema = createCampaignSchema.pick({ name: true });
      
      const result = schema.parse({ name: maliciousInput });
      expect(result.name).toBe('Clean text');
    });

    it('should remove event handlers', () => {
      const maliciousInput = 'onclick="hack()" Clean text';
      const schema = createCampaignSchema.pick({ name: true });
      
      const result = schema.parse({ name: maliciousInput });
      expect(result.name).toBe('Clean text');
    });
  });
});