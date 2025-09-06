import { z } from 'zod';

// Common validation patterns
const emailSchema = z.string().email('Invalid email address');
const uuidSchema = z.string().uuid('Invalid UUID');
const urlSchema = z.string().url('Invalid URL');
const dateSchema = z.string().datetime('Invalid datetime format');

// Sanitize strings to prevent injection attacks
const sanitizeString = (val: string) =>
  val.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
     .replace(/javascript:/gi, '')
     .replace(/on\w+\s*=/gi, '')
     .trim();

const sanitizedString = z.string().transform(sanitizeString);

// Helper to create sanitized string with constraints
const createSanitizedString = () => ({
  min: (length: number, message: string) => 
    z.string().min(length, message).transform(sanitizeString),
  max: (length: number) => 
    z.string().max(length).transform(sanitizeString),
  optional: () => 
    z.string().optional().transform(val => val ? sanitizeString(val) : val),
});

// Platform validation
export const platformSchema = z.enum([
  'facebook',
  'instagram',
  'twitter',
  'google_my_business'
]);

// Auth schemas
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const signupSchema = z.object({
  email: emailSchema,
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  firstName: z.string().min(1, 'First name is required').max(50).transform(sanitizeString),
  lastName: z.string().min(1, 'Last name is required').max(50).transform(sanitizeString),
  businessName: z.string().min(1, 'Business name is required').max(100).transform(sanitizeString),
});

export const resetPasswordSchema = z.object({
  email: emailSchema,
});

export const updatePasswordSchema = z.object({
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

// Campaign schemas
export const createCampaignSchema = z.object({
  name: z.string().min(1, 'Campaign name is required').max(100).transform(sanitizeString),
  description: z.string().max(500).optional().transform(val => val ? sanitizeString(val) : val),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  platforms: z.array(platformSchema).min(1, 'At least one platform is required'),
  status: z.enum(['draft', 'active', 'paused', 'completed']).default('draft'),
});

export const updateCampaignSchema = createCampaignSchema.partial();

// Post schemas
export const createPostSchema = z.object({
  campaignId: uuidSchema,
  content: z.string().min(1, 'Content is required').max(5000).transform(sanitizeString),
  platforms: z.array(platformSchema).min(1, 'At least one platform is required'),
  mediaUrls: z.array(urlSchema).max(10).optional(),
  scheduledFor: dateSchema.optional(),
  hashtags: z.array(z.string().max(50).transform(sanitizeString)).max(30).optional(),
});

export const publishPostSchema = z.object({
  postId: uuidSchema,
  connectionIds: z.array(uuidSchema).min(1, 'At least one connection is required'),
  publishNow: z.boolean().default(false),
  scheduledFor: dateSchema.optional(),
});

// AI Generation schemas
export const generateContentSchema = z.object({
  platform: platformSchema,
  businessContext: sanitizedString.max(1000).optional(),
  tone: z.enum(['professional', 'casual', 'friendly', 'enthusiastic', 'informative']).optional(),
  includeEmojis: z.boolean().default(true),
  includeHashtags: z.boolean().default(true),
  maxLength: z.number().min(10).max(5000).optional(),
  prompt: sanitizedString.max(1000).optional(),
  eventDate: dateSchema.optional(),
  eventType: sanitizedString.max(100).optional(),
  temperature: z.number().min(0).max(2).default(0.8),
});

export const quickGenerateSchema = z.object({
  prompt: sanitizedString.max(500).optional(),
  tone: z.enum(['friendly', 'professional', 'casual', 'enthusiastic']).optional(),
});

// Social connection schemas
export const connectSocialSchema = z.object({
  platform: platformSchema,
  accessToken: z.string().min(1, 'Access token is required'),
  refreshToken: z.string().optional(),
  expiresAt: dateSchema.optional(),
  accountName: sanitizedString.max(100),
  accountId: z.string(),
});

export const socialConnectRequestSchema = z.object({
  platform: platformSchema,
});

export const disconnectSocialSchema = z.object({
  connectionId: uuidSchema,
});

// Media schemas
export const uploadMediaSchema = z.object({
  type: z.enum(['image', 'video']),
  fileName: sanitizedString.max(255),
  fileSize: z.number().max(100 * 1024 * 1024), // 100MB max
  mimeType: z.string().regex(/^(image|video)\/.+/),
});

export const watermarkSchema = z.object({
  mediaUrl: urlSchema,
  position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']).default('bottom-right'),
  opacity: z.number().min(0).max(1).default(0.8),
  scale: z.number().min(0.1).max(2).default(1),
});

// Settings schemas
export const updateProfileSchema = z.object({
  firstName: sanitizedString.max(50).optional(),
  lastName: sanitizedString.max(50).optional(),
  email: emailSchema.optional(),
  phoneNumber: z.string().regex(/^[\d\s\-\+\(\)]+$/).optional(),
  timezone: z.string().optional(),
  avatarUrl: urlSchema.optional(),
});

export const updateBusinessSchema = z.object({
  name: sanitizedString.max(100).optional(),
  description: sanitizedString.max(500).optional(),
  website: urlSchema.optional(),
  address: sanitizedString.max(200).optional(),
  city: sanitizedString.max(100).optional(),
  postcode: z.string().regex(/^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i).optional(),
  phoneNumber: z.string().regex(/^[\d\s\-\+\(\)]+$/).optional(),
});

export const postingScheduleSchema = z.object({
  dayOfWeek: z.number().min(0).max(6),
  times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).max(10),
  platforms: z.array(platformSchema),
  enabled: z.boolean().default(true),
});

// Stripe schemas
export const createCheckoutSchema = z.object({
  priceId: z.string().min(1, 'Price ID is required'),
  quantity: z.number().min(1).default(1),
  billingPeriod: z.enum(['monthly', 'annual']).default('monthly'),
});

export const cancelSubscriptionSchema = z.object({
  reason: sanitizedString.max(500).optional(),
  feedback: sanitizedString.max(1000).optional(),
  cancelAtEnd: z.boolean().default(true),
});

// Support schemas
export const createTicketSchema = z.object({
  subject: sanitizedString.min(1, 'Subject is required').max(200),
  message: sanitizedString.min(1, 'Message is required').max(5000),
  category: z.enum(['bug', 'feature', 'billing', 'other']).default('other'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  attachmentUrls: z.array(urlSchema).max(5).optional(),
});

// Admin schemas
export const updateAIPromptSchema = z.object({
  platform: platformSchema,
  contentType: z.string().max(50),
  promptTemplate: sanitizedString.max(2000),
  systemPrompt: sanitizedString.max(2000).optional(),
  temperature: z.number().min(0).max(2).default(0.8),
  maxTokens: z.number().min(10).max(4000).default(500),
  isActive: z.boolean().default(true),
});

export const updateContentGuardrailSchema = z.object({
  rule: sanitizedString.max(200),
  category: z.enum(['safety', 'brand', 'legal', 'quality']),
  severity: z.enum(['low', 'medium', 'high']),
  action: z.enum(['warn', 'block', 'modify']),
  isActive: z.boolean().default(true),
  message: sanitizedString.max(500).optional(),
});

// Pagination schemas
export const paginationSchema = z.object({
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// Search schemas
export const searchSchema = z.object({
  query: sanitizedString.max(200),
  filters: z.record(z.unknown()).optional(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
});

// Export type inference helpers
export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type CreatePostInput = z.infer<typeof createPostSchema>;
export type GenerateContentInput = z.infer<typeof generateContentSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
