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
import Image from 'next/image';

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
          className="relative rounded-medium p-2 transition-colors hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={`${notificationCount} notifications`}
        >
          <Bell className="size-5" />
          <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-primary text-xs text-white">
            {notificationCount > 9 ? '9+' : notificationCount}
          </span>
        </button>
      )}
      
      {/* User Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 rounded-medium p-2 transition-colors hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {user.avatarUrl ? (
            <span className="relative inline-block size-5 overflow-hidden rounded-full">
              <Image src={user.avatarUrl} alt="" fill sizes="20px" className="object-cover" />
            </span>
          ) : (
            <UserIcon className="size-5" />
          )}
          <ChevronDown className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => router.push('/settings')}>
            Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleLogout} className="text-destructive">
            <LogOut className="mr-2 size-4" />
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
