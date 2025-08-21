'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { subNavPresets, type SubNavPreset, type NavItem, type IconName } from './navigation.config';
import { cn } from '@/lib/utils';
import {
  Send,
  Plus,
  Image,
  Calendar,
  BarChart3,
  Activity,
  Settings,
  Home,
  FileText,
  Clock,
  Palette,
  Link2,
  Mic,
  MapPin,
  Users,
  CreditCard,
  Shield,
  Bell,
} from 'lucide-react';

// Map icon names to components
const iconMap: Record<IconName, React.ComponentType<{ className?: string }>> = {
  Send,
  Plus,
  Image,
  Calendar,
  BarChart3,
  Activity,
  Settings,
  Home,
  FileText,
  Clock,
  Palette,
  Link2,
  Mic,
  MapPin,
  Users,
  CreditCard,
  Shield,
  Bell,
};

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
    // But don't match if href is "/" and pathname is something else
    if (href === '/') return pathname === '/';
    return pathname.startsWith(`${href}/`);
  };
  
  if (!items || items.length === 0) return null;
  
  return (
    <nav 
      className={cn('border-b border-border bg-surface/50 backdrop-blur-sm', className)}
      aria-label="Section navigation"
    >
      <div className="container mx-auto px-4 max-w-screen-2xl">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
          {items.map((item, index) => {
            const href = buildHref(item.to);
            const active = isActive(href);
            
            return (
              <Link
                key={`${href}-${index}`}
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
                {item.icon && (() => {
                  const Icon = iconMap[item.icon];
                  return Icon ? <Icon className="w-4 h-4" aria-hidden="true" /> : null;
                })()}
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