import {
  CalendarDays,
  PenSquare,
  Megaphone,
  ImageIcon,
  Star,
  Trophy,
  Link2,
  Settings,
  MoreHorizontal,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface MobileNavItem extends NavItem {
  primary?: boolean;
  isOverflow?: boolean;
}

export const APP_NAV_ITEMS: NavItem[] = [
  { id: 'planner',     label: 'Planner',      href: '/planner',      icon: CalendarDays },
  { id: 'create',      label: 'Create',       href: '/create',       icon: PenSquare },
  { id: 'campaigns',   label: 'Campaigns',    href: '/campaigns',    icon: Megaphone },
  { id: 'library',     label: 'Library',      href: '/library',      icon: ImageIcon },
  { id: 'reviews',     label: 'Reviews',      href: '/reviews',      icon: Star },
  { id: 'tournaments', label: 'Tournaments',  href: '/tournaments',  icon: Trophy },
  { id: 'connections', label: 'Connections',   href: '/connections',  icon: Link2 },
  { id: 'settings',    label: 'Settings',     href: '/settings',     icon: Settings },
];

export const MOBILE_NAV_ITEMS: MobileNavItem[] = [
  { id: 'planner',     label: 'Planner',     href: '/planner',     icon: CalendarDays },
  { id: 'create',      label: 'Create',      href: '/create',      icon: PenSquare, primary: true },
  { id: 'library',     label: 'Library',     href: '/library',     icon: ImageIcon },
  { id: 'connections', label: 'Connections',  href: '/connections', icon: Link2 },
  { id: 'more',        label: 'More',        href: '#more',        icon: MoreHorizontal, isOverflow: true },
];

/**
 * Returns nav items that appear in the desktop/full nav but not in the mobile bottom bar.
 * These are displayed inside the mobile overflow "More" menu.
 */
export function getOverflowItems(): NavItem[] {
  const mobileIds = new Set(
    MOBILE_NAV_ITEMS.filter((item) => !item.isOverflow).map((item) => item.id),
  );
  return APP_NAV_ITEMS.filter((item) => !mobileIds.has(item.id));
}

/**
 * Determines whether a nav item should be marked active given the current pathname.
 * Never marks `/dashboard` itself as active for any nav item.
 */
export function isNavActive(navHref: string, pathname: string): boolean {
  // Never mark bare /dashboard as active
  if (pathname === '/dashboard') return false;

  if (navHref === '/planner') {
    return pathname === '/planner' || pathname.startsWith('/planner/');
  }
  return pathname === navHref || pathname.startsWith(navHref + '/');
}
