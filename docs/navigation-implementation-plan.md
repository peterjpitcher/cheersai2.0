# Navigation System Implementation Plan
> Note: Analytics navigation/items referenced in this plan are historical; the Analytics section is not part of the current app.
## For Senior Developer Review

### Executive Summary
This document outlines a comprehensive plan to refactor the CheersAI navigation system from a fragmented, page-specific approach to a unified two-tier architecture with persistent hero navigation and contextual sub-navigation.

---

## Current State Analysis

### Existing Navigation Components

#### Current Header Component (`/components/layout/header.tsx`)
```typescript
export default function Header({ user }: { user: any }) {
  const navigation = [
    { name: "Dashboard", href: "/dashboard" },
    { name: "Campaigns", href: "/campaigns" },
    { name: "Media", href: "/media" },
    // Analytics removed from header in current app
    { name: "Settings", href: "/settings" },
  ];

  return (
    <header className="bg-surface border-b border-border sticky top-0 z-50">
      {/* Single-level navigation with mobile hamburger menu */}
    </header>
  );
}
```

**Issues:**
- Single-tier navigation only
- No contextual awareness
- Not used consistently across pages
- No user greeting or personalization

#### Dashboard Custom Navigation
```typescript
// From /app/dashboard/page.tsx
<header className="border-b border-border bg-surface">
  <div className="container mx-auto px-4 py-4">
    <div className="flex items-center justify-between">
      <Logo variant="icon" className="h-8" />
      <h1>{userData.tenant.name}</h1>
      <p>Welcome back, {userData.full_name}</p>
    </div>
  </div>
</header>
```

**Issues:**
- Custom implementation per page
- Inconsistent with other pages
- No reusable pattern

---

## Proposed Architecture

### Component Hierarchy
```
<NavigationProvider>
  <HeroNav />                    // Tier 1: Always visible
  <SubNav />                      // Tier 2: Context-specific
  <main>{children}</main>
  <MobileNav />                   // Mobile: Bottom navigation
  <Footer />                      // Simplified footer
</NavigationProvider>
```

### Core Components

#### 1. Hero Navigation Component
```typescript
// /components/navigation/hero-nav.tsx
import { User } from '@/types';
import { Bell, LogOut, User as UserIcon } from 'lucide-react';

interface HeroNavProps {
  user: User;
  notificationCount?: number;
}

export function HeroNav({ user, notificationCount = 0 }: HeroNavProps) {
  const greeting = getTimeBasedGreeting();
  
  return (
    <header className="sticky top-0 z-50 h-14 bg-surface border-b border-border">
      <div className="container mx-auto px-4 h-full flex items-center justify-between">
        {/* Left Section */}
        <div className="flex items-center gap-4">
          <Logo variant="compact" className="h-8" />
          <span className="hidden md:block text-sm text-text-secondary">
            {greeting}, {user.full_name}
          </span>
        </div>
        
        {/* Right Section */}
        <div className="flex items-center gap-3">
          {notificationCount > 0 && (
            <button className="relative p-2 hover:bg-background rounded-medium">
              <Bell className="w-5 h-5" />
              <span className="absolute -top-1 -right-1 bg-primary text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {notificationCount}
              </span>
            </button>
          )}
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 p-2 hover:bg-background rounded-medium">
                <UserIcon className="w-5 h-5" />
                <ChevronDown className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => router.push('/settings')}>
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="w-4 h-4 mr-2" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

function getTimeBasedGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
```

#### 2. Contextual Sub-Navigation Component
```typescript
// /components/navigation/sub-nav.tsx
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface SubNavProps {
  className?: string;
}

interface NavConfig {
  [key: string]: {
    items: NavItem[];
    layout: 'tabs' | 'pills' | 'sidebar';
  };
}

interface NavItem {
  label: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: string | number;
}

const navConfig: NavConfig = {
  '/dashboard': {
    layout: 'pills',
    items: [
      { label: 'Quick Post', href: '#quick-post', icon: Send },
      { label: 'New Campaign', href: '/campaigns/new', icon: Plus },
      { label: 'Media', href: '/media', icon: Image },
      { label: 'Campaigns', href: '/campaigns', icon: Calendar },
      { label: 'Analytics', href: '/analytics', icon: BarChart3 },
      { label: 'Monitoring', href: '/monitoring', icon: Activity },
      { label: 'Settings', href: '/settings', icon: Settings },
    ],
  },
  '/campaigns/[id]': {
    layout: 'tabs',
    items: [
      { label: 'Overview', href: '', icon: Home },
      { label: 'Posts', href: '/posts', icon: FileText },
      { label: 'Schedule', href: '/schedule', icon: Calendar },
      { label: 'Publishing', href: '/publishing', icon: Send },
      { label: 'Analytics', href: '/analytics', icon: BarChart3 },
      { label: 'Settings', href: '/settings', icon: Settings },
    ],
  },
  '/settings': {
    layout: 'tabs',
    items: [
      { label: 'Brand & Logo', href: '/settings', icon: Palette },
      { label: 'Connections', href: '/settings/connections', icon: Link2 },
      { label: 'Voice Training', href: '/settings/voice', icon: Mic },
      { label: 'Locations', href: '/settings/locations', icon: MapPin },
      { label: 'Schedule', href: '/settings/posting-schedule', icon: Clock },
      { label: 'Team', href: '/settings/team', icon: Users },
      { label: 'Billing', href: '/settings/billing', icon: CreditCard },
      { label: 'Security', href: '/settings/security', icon: Shield },
    ],
  },
};

export function SubNav({ className }: SubNavProps) {
  const pathname = usePathname();
  const config = getNavConfig(pathname);
  
  if (!config) return null;
  
  return (
    <nav className={cn(
      'border-b border-border bg-surface/50 backdrop-blur-sm',
      className
    )}>
      <div className="container mx-auto px-4">
        {config.layout === 'tabs' && (
          <TabNavigation items={config.items} currentPath={pathname} />
        )}
        {config.layout === 'pills' && (
          <PillNavigation items={config.items} currentPath={pathname} />
        )}
      </div>
    </nav>
  );
}

function TabNavigation({ items, currentPath }: { items: NavItem[]; currentPath: string }) {
  return (
    <div className="flex gap-1 overflow-x-auto scrollbar-hide">
      {items.map((item) => {
        const isActive = currentPath === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border'
            )}
          >
            {item.icon && <item.icon className="w-4 h-4" />}
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
  );
}
```

#### 3. Mobile Navigation Component
```typescript
// /components/navigation/mobile-nav.tsx
import { usePathname } from 'next/navigation';
import { Home, Calendar, Plus, Image, Menu } from 'lucide-react';

export function MobileNav() {
  const pathname = usePathname();
  
  const navItems = [
    { icon: Home, label: 'Home', href: '/dashboard' },
    { icon: Calendar, label: 'Campaigns', href: '/campaigns' },
    { icon: Plus, label: 'Create', href: '/campaigns/new', primary: true },
    { icon: Image, label: 'Media', href: '/media' },
    { icon: Menu, label: 'More', href: '#menu' },
  ];
  
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-surface border-t border-border md:hidden z-40">
      <div className="flex justify-around items-center h-16 px-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          
          if (item.primary) {
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center justify-center p-2"
              >
                <div className="bg-primary text-white rounded-full p-3 shadow-lg">
                  <item.icon className="w-5 h-5" />
                </div>
              </Link>
            );
          }
          
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center p-2 min-w-[64px]',
                isActive ? 'text-primary' : 'text-text-secondary'
              )}
            >
              <item.icon className="w-5 h-5 mb-1" />
              <span className="text-xs">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
```

#### 4. Navigation Provider (Context)
```typescript
// /components/navigation/navigation-provider.tsx
import { createContext, useContext, useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';

interface NavigationContextType {
  isMenuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  currentSection: string;
  subNavVisible: boolean;
  setSubNavVisible: (visible: boolean) => void;
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isMenuOpen, setMenuOpen] = useState(false);
  const [subNavVisible, setSubNavVisible] = useState(true);
  
  // Determine current section from pathname
  const currentSection = pathname.split('/')[1] || 'dashboard';
  
  // Close mobile menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);
  
  return (
    <NavigationContext.Provider
      value={{
        isMenuOpen,
        setMenuOpen,
        currentSection,
        subNavVisible,
        setSubNavVisible,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
}

export const useNavigation = () => {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider');
  }
  return context;
};
```

#### 5. Updated Footer Component
```typescript
// /components/layout/footer.tsx
export function Footer() {
  const currentYear = new Date().getFullYear();
  
  return (
    <footer className="border-t border-border bg-surface mt-auto">
      <div className="container mx-auto px-4 py-4">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-text-secondary">
          <p>© {currentYear} Orange Jelly Limited</p>
          <div className="flex gap-4">
            <Link href="/terms" className="hover:text-primary transition-colors">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-primary transition-colors">
              Privacy
            </Link>
            <Link href="/help" className="hover:text-primary transition-colors">
              Get Help
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
```

### Layout Integration
```typescript
// /app/layout.tsx
import { NavigationProvider } from '@/components/navigation/navigation-provider';
import { HeroNav } from '@/components/navigation/hero-nav';
import { SubNav } from '@/components/navigation/sub-nav';
import { MobileNav } from '@/components/navigation/mobile-nav';
import { Footer } from '@/components/layout/footer';

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
  
  return (
    <NavigationProvider>
      <div className="min-h-screen flex flex-col">
        <HeroNav user={user} />
        <SubNav />
        <main className="flex-1 container mx-auto px-4 py-6 mb-16 md:mb-0">
          {children}
        </main>
        <Footer />
        <MobileNav />
      </div>
    </NavigationProvider>
  );
}
```

---

## Technical Considerations

### 1. State Management
- **Context API** for navigation state (menu open/closed, active section)
- **URL-based** for active page detection (using Next.js usePathname)
- **Local Storage** for user preferences (collapsed state, etc.)

### 2. Performance Optimization
```typescript
// Lazy load heavy components
const QuickPostModal = dynamic(() => import('@/components/quick-post-modal'), {
  ssr: false,
});

// Use CSS for animations instead of JS
.nav-transition {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

// Memoize navigation items
const navItems = useMemo(() => 
  generateNavItems(user.role, pathname), 
  [user.role, pathname]
);
```

### 3. Responsive Design Strategy
```css
/* Mobile First Approach */
.nav-container {
  @apply flex flex-col;
}

/* Tablet */
@media (min-width: 768px) {
  .nav-container {
    @apply flex-row;
  }
}

/* Desktop */
@media (min-width: 1024px) {
  .nav-container {
    @apply gap-6;
  }
}
```

### 4. Accessibility Requirements
```typescript
// ARIA labels and keyboard navigation
<nav role="navigation" aria-label="Main navigation">
  <ul role="menubar">
    <li role="none">
      <a 
        role="menuitem" 
        aria-current={isActive ? 'page' : undefined}
        tabIndex={0}
      >
        {item.label}
      </a>
    </li>
  </ul>
</nav>

// Focus management
useEffect(() => {
  if (isMenuOpen) {
    menuRef.current?.focus();
  }
}, [isMenuOpen]);
```

### 5. Testing Strategy
```typescript
// Unit tests for navigation logic
describe('Navigation', () => {
  it('should show correct greeting based on time', () => {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(9);
    expect(getTimeBasedGreeting()).toBe('Good morning');
  });
  
  it('should highlight active navigation item', () => {
    render(<SubNav />, { wrapper: createWrapper('/dashboard') });
    expect(screen.getByText('Dashboard')).toHaveClass('text-primary');
  });
  
  it('should close mobile menu on route change', () => {
    const { result } = renderHook(() => useNavigation());
    act(() => result.current.setMenuOpen(true));
    expect(result.current.isMenuOpen).toBe(true);
    
    // Simulate route change
    act(() => router.push('/campaigns'));
    expect(result.current.isMenuOpen).toBe(false);
  });
});
```

---

## Migration Plan

### Phase 1: Foundation (Week 1)
1. Create navigation component directory structure
2. Build core components with tests
3. Set up NavigationProvider context
4. Create feature flag for gradual rollout

### Phase 2: Integration (Week 2)
1. Integrate with existing layout
2. Replace dashboard custom navigation
3. Update all page headers
4. Ensure backward compatibility

### Phase 3: Mobile (Week 3)
1. Implement mobile bottom navigation
2. Add gesture support
3. Test on various devices
4. PWA optimization

### Phase 4: Polish (Week 4)
1. Add animations and transitions
2. Implement keyboard shortcuts
3. Add analytics tracking
4. Performance optimization

---

## Risk Assessment

### Technical Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| Layout shift on navigation | High | Use fixed heights, skeleton loaders |
| Performance degradation | Medium | Lazy loading, CSS animations |
| Mobile compatibility | High | Extensive device testing |
| State synchronization | Medium | URL as source of truth |

### User Experience Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| User confusion | High | Gradual rollout with tooltips |
| Lost functionality | Medium | Feature parity audit |
| Accessibility issues | High | WCAG compliance testing |

---

## Performance Metrics

### Target Metrics
- **First Contentful Paint**: < 1.2s
- **Time to Interactive**: < 2.5s
- **Cumulative Layout Shift**: < 0.1
- **Navigation response time**: < 100ms

### Monitoring
```typescript
// Performance monitoring
export function trackNavigationMetrics() {
  if (typeof window !== 'undefined' && window.performance) {
    const navigationTiming = performance.getEntriesByType('navigation')[0];
    
    // Track to analytics
    analytics.track('Navigation Performance', {
      domContentLoaded: navigationTiming.domContentLoadedEventEnd,
      loadComplete: navigationTiming.loadEventEnd,
      navigationStart: navigationTiming.fetchStart,
    });
  }
}
```

---

## Dependencies & Requirements

### NPM Packages
```json
{
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "lucide-react": "^0.400.0",
    "@radix-ui/react-dropdown-menu": "^2.0.0",
    "clsx": "^2.0.0",
    "tailwind-merge": "^2.0.0"
  },
  "devDependencies": {
    "@testing-library/react": "^14.0.0",
    "jest": "^29.0.0"
  }
}
```

### Browser Support
- Chrome 90+
- Safari 14+
- Firefox 88+
- Edge 90+
- Mobile Safari 14+
- Chrome Mobile 90+

---

## Security Considerations

1. **XSS Prevention**: Sanitize user names in greetings
2. **CSRF Protection**: Verify navigation state changes
3. **Rate Limiting**: Prevent rapid navigation clicks
4. **Session Management**: Clear navigation state on logout

---

## Questions for Review

1. **State Management**: Should we use Context API or consider Zustand/Redux for navigation state?
2. **Animation Library**: CSS-only or add Framer Motion for smoother transitions?
3. **Mobile Gestures**: Implement swipe gestures for mobile navigation?
4. **A/B Testing**: Should we set up feature flags for gradual rollout?
5. **Analytics**: What navigation metrics should we track?
6. **Caching Strategy**: How aggressive should we be with navigation caching?
7. **Offline Support**: How should navigation behave in offline mode (PWA)?

---

## Appendix

### Current File Structure
```
/components/
  layout/
    header.tsx       # Current header (to be deprecated)
    footer.tsx       # Current footer (to be updated)
  
/app/
  dashboard/
    page.tsx        # Has custom navigation
  campaigns/
    page.tsx        # Uses different navigation
  settings/
    page.tsx        # Another navigation variant
```

### Proposed File Structure
```
/components/
  navigation/
    hero-nav.tsx           # Persistent top bar
    sub-nav.tsx           # Contextual navigation
    mobile-nav.tsx        # Mobile bottom bar
    navigation-provider.tsx # Context provider
    navigation-utils.ts   # Helper functions
    __tests__/           # Navigation tests
  layout/
    footer.tsx           # Updated footer
```

### Design Tokens
```typescript
// Navigation-specific design tokens
export const navigationTokens = {
  height: {
    hero: '56px',
    subNav: '48px',
    mobileNav: '64px',
  },
  zIndex: {
    hero: 50,
    subNav: 40,
    mobileNav: 45,
    dropdown: 60,
  },
  animation: {
    duration: '200ms',
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
};
```

---

## Conclusion

This navigation overhaul represents a significant improvement in user experience and code maintainability. The two-tier architecture provides clear hierarchy while remaining flexible enough for future growth. The implementation is technically sound, performant, and follows modern best practices.

**Estimated Development Time**: 4 weeks
**Estimated Testing Time**: 1 week
**Total Timeline**: 5 weeks

---

*Document prepared for senior developer review. Please provide feedback on technical approach, potential issues, and suggested improvements.*
