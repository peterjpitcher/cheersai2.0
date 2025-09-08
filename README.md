# CheersAI 🍺

AI-Powered Social Media Management Platform for UK Hospitality Businesses

Part of the Orange Jelly Family of tools that help hospitality businesses accelerate their growth through AI.

## Overview

CheersAI is a comprehensive social media management platform designed specifically for UK pubs, bars, restaurants, and hospitality businesses. It leverages AI to generate engaging content, automate scheduling, and manage multiple social media platforms from a single dashboard.

## Features

### 🤖 AI-Powered Content Generation
- Generate engaging social media posts using GPT-4
- Customize content tone and style to match your brand
- Platform-specific content optimization
- Hashtag and emoji suggestions

### 📱 Multi-Platform Publishing
- **Facebook** - Posts, photos, and events
- **Instagram** - Feed posts and stories (with media)
- **Twitter/X** - Tweets and threads
- **Google Business Profile (GBP)** - Local posts and offers

### 📅 Content Calendar & Scheduling
- Visual calendar view (month, week, day)
- Drag-and-drop post scheduling
- Bulk scheduling capabilities
- Timezone-aware scheduling

### 👥 Team Collaboration
- Role-based access control (Owner, Admin, Editor, Viewer)
- Team member invitations
- Activity tracking
- Shared content library

<!-- Analytics & Reporting feature removed. -->

### 💳 Subscription Management
- Flexible pricing tiers (Free, Starter, Professional)
- Stripe integration for payments
- Usage tracking and limits
- Trial period management

### 🔒 Security & Compliance
- Secure authentication with Supabase
- Rate limiting on API endpoints
- CORS configuration
- Password reset flow with email verification
- Two-factor authentication (optional)

### 📱 Progressive Web App (PWA)
- Installable on mobile and desktop
- Offline functionality
- Push notifications
- Background sync

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript
- **Styling**: Tailwind CSS, CSS Variables for theming
- **Backend**: Next.js API Routes, Serverless Functions
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **AI**: OpenAI GPT-4
- **Payments**: Stripe
- **Email**: Resend
- **Testing**: Jest, React Testing Library
- **Deployment**: Vercel

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Supabase account
- OpenAI API key
- Stripe account
- Resend account (for emails)
- Social media app credentials

### Installation

1. Clone the repository:
```bash
git clone https://github.com/peterjohnpitcher/cheersai.git
cd cheersai
```

2. Install dependencies:
```bash
npm install
```

3. Copy the environment variables:
```bash
cp .env.example .env.local
```

4. Configure your environment variables in `.env.local`:
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# OpenAI
OPENAI_API_KEY=your_openai_api_key

# Stripe
STRIPE_SECRET_KEY=your_stripe_secret_key
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
STRIPE_WEBHOOK_SECRET=your_webhook_secret

# Social Media APIs
NEXT_PUBLIC_FACEBOOK_APP_ID=your_facebook_app_id
FACEBOOK_APP_SECRET=your_facebook_app_secret

# Email Service
RESEND_API_KEY=your_resend_api_key

# App Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=your_random_cron_secret
```

5. Set up the database:
   - Create a new Supabase project
   - Run the SQL migrations from `/supabase/migrations`
   - Configure Row Level Security (RLS) policies

6. Run the development server:
```bash
npm run dev
```

7. Open [http://localhost:3000](http://localhost:3000) in your browser

## Project Structure

```
cheersai/
├── app/                    # Next.js App Router pages
│   ├── api/               # API routes
│   ├── auth/              # Authentication pages
│   ├── campaigns/         # Campaign management
│   ├── calendar/          # Content calendar
│   ├── dashboard/         # Main dashboard
│   ├── settings/          # User settings
│   └── team/              # Team management
├── components/            # React components
│   ├── ui/               # Reusable UI components
│   ├── dashboard/        # Dashboard-specific components
│   └── seo/              # SEO components
├── lib/                   # Utility functions and services
│   ├── supabase/         # Supabase client and auth
│   ├── social/           # Social media integrations
│   ├── email/            # Email service
│   └── subscription/     # Subscription management
├── docs/                  # Documentation
│   ├── setup/            # Setup and deployment guides
│   ├── integrations/     # Social media integration docs
│   ├── development/      # Development documentation
│   ├── fixes/            # Troubleshooting and fixes
│   └── INDEX.md          # Documentation index
├── public/               # Static files
├── supabase/             # Database migrations and config
└── __tests__/           # Test files
```

## Documentation

Comprehensive documentation is available in the `/docs` directory:

- 📚 [Documentation Index](./docs/INDEX.md) - Complete documentation overview
- 🚀 [Setup Guide](./docs/setup/SETUP_CHECKLIST.md) - Quick setup checklist
- 🔧 [Database Setup](./docs/setup/DATABASE_SETUP.md) - Database configuration
- 📱 [Social Integrations](./docs/integrations/) - Facebook, Instagram setup guides
- 🐛 [Troubleshooting](./docs/fixes/) - Common issues and solutions

## API Documentation

### Authentication Endpoints

- `POST /api/auth/signup` - Create new account
- `POST /api/auth/login` - Sign in
- `POST /api/auth/logout` - Sign out
- `POST /api/auth/reset-password` - Request password reset
- `PUT /api/auth/reset-password` - Update password with token

### Content Generation

- `POST /api/generate` - Generate AI content
  - Body: `{ prompt, platform, tone }`
  - Returns: `{ content, hashtags }`

### Social Media Publishing

- `POST /api/social` - Publish to social platforms
  - Body: `{ campaignId, content, platforms, media, publishAt }`
  - Returns: `{ results: [{ platform, success, postId }] }`

### Campaign Management

- `GET /api/campaigns` - List campaigns
- `POST /api/campaigns` - Create campaign
- `PUT /api/campaigns/[id]` - Update campaign
- `DELETE /api/campaigns/[id]` - Delete campaign

### Data Export

- `GET /api/export/campaigns?format=csv` - Export campaigns
- `GET /api/export/posts?format=csv` - Export posts
<!-- Analytics export removed. -->

## Testing

Run the test suite:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

## Deployment

### Vercel Deployment

1. Push your code to GitHub
2. Import the project to Vercel
3. Configure environment variables
4. Deploy

### Environment Variables for Production

Ensure all environment variables are properly set in your production environment:
- Use production API keys
- Set `NEXT_PUBLIC_APP_URL` to your production domain
- Configure webhook endpoints for Stripe
- Set up CRON jobs for scheduled posts

## Security Considerations

- All API routes are protected with authentication
- Rate limiting is implemented on sensitive endpoints
- Supabase RLS policies enforce data isolation
- API keys are never exposed to the client
- CORS is configured for production domains
- Input validation on all user inputs
- XSS protection through React's default escaping

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## License

This project is proprietary software. All rights reserved.

## Support

For support, email support@cheersai.orangejelly.co.uk or open an issue in the GitHub repository.

## Acknowledgments

- Built with [Next.js](https://nextjs.org/)
- Database by [Supabase](https://supabase.com/)
- AI powered by [OpenAI](https://openai.com/)
- Payments by [Stripe](https://stripe.com/)
- Email by [Resend](https://resend.com/)

---

Made with ❤️ for the hospitality industry
