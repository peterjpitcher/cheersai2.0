'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Calendar, Plus, Image, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from '@/components/ui/sheet';

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
    { label: 'Settings', href: '/settings' },
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
            <SheetHeader>
              <SheetTitle>More Options</SheetTitle>
            </SheetHeader>
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
