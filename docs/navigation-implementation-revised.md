# Navigation System Implementation Plan (Revised)
## Based on Senior Developer Feedback

### Executive Summary
Revised plan incorporating senior developer feedback to create a layout-driven, server-first navigation system that leverages Next.js App Router capabilities while maintaining excellent performance and accessibility.

---

## Key Architecture Changes

### 1. Layout-Driven Navigation (Not Context-Driven)
Instead of a global `NavigationProvider` guessing routes, each layout explicitly declares its navigation needs.

```
/app/(authed)/
  layout.tsx              → Renders HeroNav (server component)
  dashboard/
    layout.tsx            → Renders SubNav with preset="dashboard"
  campaigns/
    layout.tsx            → Renders SubNav with preset="campaignsRoot"
    [id]/
      layout.tsx          → Renders SubNav with preset="campaignDetail"
  settings/
    layout.tsx            → Renders SubNav with preset="settings"
```

### 2. Server-First Component Architecture
Most navigation renders on the server, with only interactive elements as client components.

---

## Core Implementation

### Navigation Configuration
```typescript
// components/navigation/navigation.config.ts
export type NavItem = {
  label: string;
  to: string; // Relative or absolute path
  icon?: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  requiresPlan?: 'starter' | 'professional' | 'enterprise';
  requiresRole?: 'admin' | 'editor' | 'viewer';
  requiresConnection?: boolean;
};

export type SubNavPreset = 
  | 'dashboard' 
  | 'campaignsRoot' 
  | 'campaignDetail' 
  | 'settings'
  | 'analytics'
  | 'monitoring';

export const subNavPresets: Record<SubNavPreset, NavItem[]> = {
  dashboard: [
    { label: 'Quick Post', to: '#quick-post', icon: Send },
    { label: 'New Campaign', to: '/campaigns/new', icon: Plus },
    { label: 'Media', to: '/media', icon: Image },
    { label: 'Campaigns', to: '/campaigns', icon: Calendar },
    { label: 'Analytics', to: '/analytics', icon: BarChart3, requiresConnection: true },
    { label: 'Monitoring', to: '/monitoring', icon: Activity, requiresPlan: 'professional' },
    { label: 'Settings', to: '/settings', icon: Settings },
  ],
  campaignDetail: [
    { label: 'Overview', to: '' }, // Empty = base path
    { label: 'Posts', to: 'posts' },
    { label: 'Schedule', to: 'schedule' },
    { label: 'Publishing', to: 'publishing', requiresConnection: true },
    { label: 'Analytics', to: 'analytics', requiresConnection: true },
    { label: 'Settings', to: 'settings', requiresRole: 'admin' },
  ],
  settings: [
    { label: 'Brand & Logo', to: '' },
    { label: 'Connections', to: 'connections' },
    { label: 'Voice Training', to: 'voice', requiresPlan: 'professional' },
    { label: 'Locations', to: 'locations', requiresPlan: 'professional' },
    { label: 'Posting Schedule', to: 'posting-schedule' },
    { label: 'Team', to: 'team', requiresRole: 'admin' },
    { label: 'Billing', to: 'billing', requiresRole: 'admin' },
    { label: 'Security', to: 'security' },
    { label: 'Notifications', to: 'notifications' },
  ],
  // ... other presets
};

// Permission checker
export function filterNavItems(
  items: NavItem[],
  context: {
    plan?: string;
    role?: string;
    hasConnections?: boolean;
  }
): NavItem[] {
  return items.filter(item => {
    if (item.requiresPlan && context.plan !== item.requiresPlan) return false;
    if (item.requiresRole && context.role !== item.requiresRole) return false;
    if (item.requiresConnection && !context.hasConnections) return false;
    return true;
  });
}
```

### Hero Navigation (Server Component)
```typescript
// components/navigation/hero-nav.tsx
import { Logo } from '@/components/ui/logo';
import { UserMenu } from './user-menu'; // Client component
import { getGreetingForTimezone } from './utils';

type MinimalUser = {
  fullName: string;
  email: string;
  avatarUrl?: string;
  timezone?: string;
};

interface HeroNavProps {
  user: MinimalUser;
  notificationCount?: number;
}

export default function HeroNav({ user, notificationCount = 0 }: HeroNavProps) {
  // Server-side greeting based on tenant timezone
  const greeting = getGreetingForTimezone(user.timezone || 'Europe/London');
  
  return (
    <header className="sticky top-0 z-50 h-14 bg-surface border-b border-border">
      <div className="container mx-auto px-4 h-full flex items-center justify-between max-w-screen-2xl">
        {/* Left Section */}
        <div className="flex items-center gap-4">
          <Logo variant="compact" className="h-8" />
          <span className="hidden md:block text-sm text-text-secondary">
            {greeting}, {user.fullName}
          </span>
        </div>
        
        {/* Right Section - Client Component */}
        <UserMenu 
          user={{ email: user.email, avatarUrl: user.avatarUrl }}
          notificationCount={notificationCount} 
        />
      </div>
    </header>
  );
}
```

### User Menu (Client Component)
```typescript
// components/navigation/user-menu.tsx
'use client';

import { useRouter } from 'next/navigation';
import { Bell, LogOut, User as UserIcon, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { logout } from '@/app/actions/auth'; // Server action

interface UserMenuProps {
  user: {
    email: string;
    avatarUrl?: string;
  };
  notificationCount?: number;
}

export function UserMenu({ user, notificationCount = 0 }: UserMenuProps) {
  const router = useRouter();
  
  const handleLogout = async () => {
    await logout(); // Server action
    router.push('/auth/login');
  };
  
  return (
    <div className="flex items-center gap-3">
      {/* Notifications */}
      {notificationCount > 0 && (
        <button 
          className="relative p-2 hover:bg-background rounded-medium transition-colors"
          aria-label={`${notificationCount} notifications`}
        >
          <Bell className="w-5 h-5" />
          <span className="absolute -top-1 -right-1 bg-primary text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {notificationCount > 9 ? '9+' : notificationCount}
          </span>
        </button>
      )}
      
      {/* User Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 p-2 rounded-medium hover:bg-background transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="w-5 h-5 rounded-full" />
          ) : (
            <UserIcon className="w-5 h-5" />
          )}
          <ChevronDown className="w-4 h-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => router.push('/settings')}>
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push('/settings/team')}>
            Team
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleLogout} className="text-destructive">
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

### Sub Navigation (Minimal Client)
```typescript
// components/navigation/sub-nav.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { subNavPresets, type SubNavPreset, type NavItem } from './navigation.config';
import { cn } from '@/lib/utils';

interface SubNavProps {
  base: string;
  preset: SubNavPreset;
  itemsOverride?: NavItem[]; // For server-filtered items
  className?: string;
}

export default function SubNav({ base, preset, itemsOverride, className }: SubNavProps) {
  const pathname = usePathname();
  const items = itemsOverride || subNavPresets[preset];
  
  const buildHref = (to: string): string => {
    if (!to) return base; // Empty string = base path
    if (to.startsWith('/') || to.startsWith('#')) return to; // Absolute or anchor
    return `${base.replace(/\/$/, '')}/${to}`; // Relative to base
  };
  
  const isActive = (href: string): boolean => {
    if (href.startsWith('#')) return false; // Anchors never active
    if (pathname === href) return true;
    // Check if current path is nested under this href
    return pathname.startsWith(`${href}/`);
  };
  
  return (
    <nav 
      className={cn('border-b border-border bg-surface/50 backdrop-blur-sm', className)}
      aria-label="Section navigation"
    >
      <div className="container mx-auto px-4 max-w-screen-2xl">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
          {items.map((item) => {
            const href = buildHref(item.to);
            const active = isActive(href);
            
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors min-h-[44px]',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border'
                )}
                aria-current={active ? 'page' : undefined}
              >
                {item.icon && <item.icon className="w-4 h-4" aria-hidden="true" />}
                {item.label}
                {item.badge && (
                  <span className="ml-1 px-2 py-0.5 text-xs bg-primary/10 text-primary rounded-full">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
```

### Mobile Navigation
```typescript
// components/navigation/mobile-nav.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Calendar, Plus, Image, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

export default function MobileNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  
  const mainItems = [
    { icon: Home, label: 'Home', href: '/dashboard' },
    { icon: Calendar, label: 'Campaigns', href: '/campaigns' },
    { icon: Plus, label: 'Create', href: '/campaigns/new', primary: true },
    { icon: Image, label: 'Media', href: '/media' },
  ];
  
  const moreItems = [
    { label: 'Analytics', href: '/analytics' },
    { label: 'Monitoring', href: '/monitoring' },
    { label: 'Settings', href: '/settings' },
    { label: 'Team', href: '/settings/team' },
    { label: 'Help', href: '/help' },
  ];
  
  return (
    <nav 
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex justify-around items-center h-16 px-2">
        {mainItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          
          if (item.primary) {
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center justify-center p-2 min-w-[44px] min-h-[44px]"
                aria-label={item.label}
              >
                <div className="bg-primary text-white rounded-full p-3 shadow-lg">
                  <item.icon className="w-5 h-5" aria-hidden="true" />
                </div>
              </Link>
            );
          }
          
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center p-2 min-w-[64px] min-h-[44px]',
                isActive ? 'text-primary' : 'text-text-secondary'
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <item.icon className="w-5 h-5 mb-1" aria-hidden="true" />
              <span className="text-xs">{item.label}</span>
            </Link>
          );
        })}
        
        {/* More Menu */}
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger className="flex flex-col items-center justify-center p-2 min-w-[64px] min-h-[44px] text-text-secondary">
            <Menu className="w-5 h-5 mb-1" aria-hidden="true" />
            <span className="text-xs">More</span>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-auto">
            <nav className="flex flex-col gap-2 py-4">
              {moreItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className="px-4 py-3 text-left hover:bg-background rounded-medium transition-colors"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
```

### Layout Examples

#### Authenticated Layout
```typescript
// app/(authed)/layout.tsx
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import HeroNav from '@/components/navigation/hero-nav';
import MobileNav from '@/components/navigation/mobile-nav';
import Footer from '@/components/layout/footer';

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect('/auth/login');
  }
  
  // Fetch minimal user data for navigation
  const { data: userData } = await supabase
    .from('users')
    .select('full_name, email, avatar_url, timezone')
    .eq('id', user.id)
    .single();
  
  // Get notification count (example)
  const { count: notificationCount } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('read', false);
  
  return (
    <div className="min-h-screen flex flex-col">
      <HeroNav 
        user={{
          fullName: userData?.full_name || 'User',
          email: userData?.email || user.email!,
          avatarUrl: userData?.avatar_url,
          timezone: userData?.timezone,
        }}
        notificationCount={notificationCount || 0}
      />
      <div className="flex-1 pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0">
        {children}
      </div>
      <Footer />
      <MobileNav />
    </div>
  );
}
```

#### Dashboard Layout
```typescript
// app/(authed)/dashboard/layout.tsx
import SubNav from '@/components/navigation/sub-nav';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SubNav base="/dashboard" preset="dashboard" />
      <main className="container mx-auto px-4 py-6 max-w-screen-2xl">
        {children}
      </main>
    </>
  );
}
```

#### Campaign Detail Layout
```typescript
// app/(authed)/campaigns/[id]/layout.tsx
import { createClient } from '@/lib/supabase/server';
import SubNav from '@/components/navigation/sub-nav';
import { filterNavItems, subNavPresets } from '@/components/navigation/navigation.config';

export default async function CampaignDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const supabase = await createClient();
  
  // Get user permissions
  const { data: { user } } = await supabase.auth.getUser();
  const { data: userData } = await supabase
    .from('users')
    .select('role, tenant:tenants(subscription_tier)')
    .eq('id', user!.id)
    .single();
  
  // Check if has connections
  const { count: connectionCount } = await supabase
    .from('social_accounts')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', userData?.tenant?.id);
  
  // Filter items based on permissions
  const items = filterNavItems(subNavPresets.campaignDetail, {
    plan: userData?.tenant?.subscription_tier,
    role: userData?.role,
    hasConnections: (connectionCount || 0) > 0,
  });
  
  return (
    <>
      <SubNav 
        base={`/campaigns/${params.id}`} 
        preset="campaignDetail"
        itemsOverride={items}
      />
      <main className="container mx-auto px-4 py-6 max-w-screen-2xl">
        {children}
      </main>
    </>
  );
}
```

### Simplified Footer
```typescript
// components/layout/footer.tsx
import Link from 'next/link';

export default function Footer() {
  const currentYear = new Date().getFullYear();
  
  return (
    <footer className="border-t border-border bg-surface mt-auto">
      <div className="container mx-auto px-4 py-4 max-w-screen-2xl">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-text-secondary">
          <p>© {currentYear} Orange Jelly Limited</p>
          <nav className="flex gap-4" aria-label="Footer">
            <Link href="/terms" className="hover:text-primary transition-colors">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-primary transition-colors">
              Privacy
            </Link>
            <Link href="/help" className="hover:text-primary transition-colors">
              Get Help
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
```

### Server Actions
```typescript
// app/actions/auth.ts
'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/');
  redirect('/auth/login');
}
```

---

## Testing Strategy

### Unit Tests
```typescript
// components/navigation/__tests__/sub-nav.test.tsx
import { render, screen } from '@testing-library/react';
import { usePathname } from 'next/navigation';
import SubNav from '../sub-nav';

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

describe('SubNav', () => {
  it('marks correct item as active for exact match', () => {
    (usePathname as jest.Mock).mockReturnValue('/campaigns');
    render(<SubNav base="/campaigns" preset="campaignsRoot" />);
    
    const campaignsLink = screen.getByRole('link', { name: /campaigns/i });
    expect(campaignsLink).toHaveAttribute('aria-current', 'page');
  });
  
  it('marks parent as active for nested routes', () => {
    (usePathname as jest.Mock).mockReturnValue('/campaigns/123/schedule');
    render(<SubNav base="/campaigns/123" preset="campaignDetail" />);
    
    const scheduleLink = screen.getByRole('link', { name: /schedule/i });
    expect(scheduleLink).toHaveAttribute('aria-current', 'page');
  });
  
  it('builds correct hrefs from relative paths', () => {
    (usePathname as jest.Mock).mockReturnValue('/campaigns/123');
    render(<SubNav base="/campaigns/123" preset="campaignDetail" />);
    
    const postsLink = screen.getByRole('link', { name: /posts/i });
    expect(postsLink).toHaveAttribute('href', '/campaigns/123/posts');
  });
  
  it('respects itemsOverride for permission filtering', () => {
    (usePathname as jest.Mock).mockReturnValue('/settings');
    const limitedItems = [
      { label: 'Brand & Logo', to: '' },
      { label: 'Security', to: 'security' },
    ];
    
    render(<SubNav base="/settings" preset="settings" itemsOverride={limitedItems} />);
    
    expect(screen.getByRole('link', { name: /brand/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /team/i })).not.toBeInTheDocument();
  });
});
```

---

## Analytics Implementation
```typescript
// lib/analytics.ts
export function trackNavigation(params: {
  tier: 'hero' | 'subnav' | 'mobile' | 'footer';
  label: string;
  href: string;
  position?: number;
  pathnameBefore: string;
}) {
  if (typeof window !== 'undefined' && window.analytics) {
    window.analytics.track('nav_click', params);
  }
}

// Usage in SubNav
import { trackNavigation } from '@/lib/analytics';

// In the Link onClick
onClick={(e) => {
  trackNavigation({
    tier: 'subnav',
    label: item.label,
    href,
    position: index,
    pathnameBefore: pathname,
  });
}}
```

---

## Migration Plan (Revised)

### Phase 1: Foundation (3 days)
- [ ] Create navigation config with presets
- [ ] Build HeroNav (server) and UserMenu (client)
- [ ] Build SubNav with proper active state logic
- [ ] Create MobileNav with safe-area support

### Phase 2: Layout Integration (3 days)
- [ ] Create authenticated layout with HeroNav
- [ ] Add SubNav to dashboard layout
- [ ] Add SubNav to campaigns layout (root + detail)
- [ ] Add SubNav to settings layout with permission filtering

### Phase 3: Testing & Polish (2 days)
- [ ] Unit tests for navigation components
- [ ] E2E tests for navigation flows
- [ ] Add analytics tracking
- [ ] Performance optimization

### Phase 4: Rollout (2 days)
- [ ] Feature flag implementation
- [ ] Gradual rollout by tenant
- [ ] Monitor metrics
- [ ] Full deployment

---

## Key Improvements from Feedback

1. ✅ **Layout-driven** instead of Context-driven routing
2. ✅ **Server components** where possible
3. ✅ **Proper path matching** with startsWith logic
4. ✅ **Accessibility fixes** - semantic HTML, aria-current, focus styles
5. ✅ **Mobile safe-area** support
6. ✅ **Permission filtering** server-side
7. ✅ **Server action** for logout
8. ✅ **Minimal client state** - only UI toggles
9. ✅ **Type safety** - no `any` types
10. ✅ **Analytics** standardized events

---

## Questions Resolved

1. **State Management**: URL + layouts, minimal Context for UI only ✅
2. **Animations**: CSS-first approach ✅
3. **Mobile Gestures**: Deferred, using Sheet for "More" menu ✅
4. **A/B Testing**: Feature flag per tenant ✅
5. **Analytics**: Standardized nav_click events ✅
6. **Caching**: Server-computed per request ✅
7. **Offline**: Normal links, optional offline indicator ✅

---

*This revised plan addresses all senior developer feedback and provides a cleaner, more maintainable architecture that leverages Next.js App Router capabilities properly.*