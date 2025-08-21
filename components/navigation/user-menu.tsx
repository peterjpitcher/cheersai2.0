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
import { logout } from '@/app/actions/auth';

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
    await logout();
  };
  
  return (
    <div className="flex items-center gap-3">
      {/* Notifications */}
      {notificationCount > 0 && (
        <button 
          className="relative p-2 hover:bg-background rounded-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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