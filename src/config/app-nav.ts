import {
  CalendarDays,
  PenSquare,
  Megaphone,
  ImageIcon,
  Star,
  Trophy,
  Link2,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

export const APP_NAV_ITEMS: NavItem[] = [
  { id: 'planner',     label: 'Planner',      href: '/planner',               icon: CalendarDays },
  { id: 'create',      label: 'Create',       href: '/create',                icon: PenSquare },
  { id: 'campaigns',   label: 'Campaigns',    href: '/campaigns',             icon: Megaphone },
  { id: 'library',     label: 'Library',      href: '/library',               icon: ImageIcon },
  { id: 'reviews',     label: 'Reviews',      href: '/reviews',               icon: Star },
  { id: 'tournaments', label: 'Tournaments',  href: '/dashboard/tournaments', icon: Trophy },
  { id: 'connections', label: 'Connections',   href: '/connections',           icon: Link2 },
];

export const MOBILE_NAV_ITEMS: (NavItem & { primary?: boolean })[] = [
  { id: 'planner',     label: 'Planner',     href: '/planner',     icon: CalendarDays },
  { id: 'create',      label: 'Create',      href: '/create',      icon: PenSquare, primary: true },
  { id: 'library',     label: 'Library',     href: '/library',     icon: ImageIcon },
  { id: 'connections', label: 'Connections', href: '/connections',  icon: Link2 },
];

/**
 * Determines whether a nav item should be marked active given the current pathname.
 * Never marks `/dashboard` itself as active for any nav item.
 */
export function isNavActive(navHref: string, pathname: string): boolean {
  // Never mark bare /dashboard as active
  if (pathname === '/dashboard') return false;

  if (navHref === '/dashboard/tournaments') {
    return pathname.startsWith('/dashboard/tournaments');
  }
  if (navHref === '/planner') {
    return pathname === '/planner' || pathname.startsWith('/planner/');
  }
  return pathname === navHref || pathname.startsWith(navHref + '/');
}
