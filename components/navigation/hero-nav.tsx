import Logo from '@/components/ui/logo';
import { UserMenu } from './user-menu';
import { getGreetingForTimezone } from './navigation.config';

type MinimalUser = {
  firstName: string;
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
    <header className="sticky top-0 z-50 bg-surface border-b border-border">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between max-w-screen-2xl">
        {/* Left Section */}
        <div className="flex items-center gap-4">
          <a href="/dashboard" className="inline-block">
            <Logo variant="compact" className="h-11" />
          </a>
          <span className="hidden md:block text-sm text-text-secondary">
            {greeting}, {user.firstName}!
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