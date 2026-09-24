import {
  CalendarDays,
  PenSquare,
  Megaphone,
  ImageIcon,
  Trophy,
  Link2,
  Settings,
  ShieldCheck,
  MoreHorizontal,
  type LucideIcon,
} from 'lucide-react';

import type { BrandFeatures } from '@/lib/auth/types';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Per-brand switch the item needs; hidden when the active brand has it off. */
  feature?: keyof BrandFeatures;
}

export interface MobileNavItem extends NavItem {
  primary?: boolean;
  isOverflow?: boolean;
}

export const APP_NAV_ITEMS: NavItem[] = [
  { id: 'planner',     label: 'Planner',      href: '/planner',      icon: CalendarDays },
  { id: 'create',      label: 'Create',       href: '/create',       icon: PenSquare },
  { id: 'campaigns',   label: 'Campaigns',    href: '/campaigns',    icon: Megaphone, feature: 'paidAds' },
  { id: 'library',     label: 'Library',      href: '/library',      icon: ImageIcon },
  { id: 'tournaments', label: 'Tournaments',  href: '/tournaments',  icon: Trophy, feature: 'tournaments' },
  { id: 'connections', label: 'Connections',   href: '/connections',  icon: Link2 },
  { id: 'settings',    label: 'Settings',     href: '/settings',     icon: Settings },
];

/** Super-admin-only nav item, appended for global admins (see TopRail). */
export const ADMIN_NAV_ITEM: NavItem = { id: 'admin', label: 'Admin', href: '/admin', icon: ShieldCheck };

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
export function getOverflowItems(features?: BrandFeatures | null): NavItem[] {
  const mobileIds = new Set(
    MOBILE_NAV_ITEMS.filter((item) => !item.isOverflow).map((item) => item.id),
  );
  return visibleNavItems(APP_NAV_ITEMS, features).filter((item) => !mobileIds.has(item.id));
}

/**
 * Drop items whose per-brand feature switch is off. With no features known
 * (signed out, or no active brand) every gated item is hidden.
 */
export function visibleNavItems<T extends NavItem>(items: T[], features?: BrandFeatures | null): T[] {
  return items.filter((item) => !item.feature || features?.[item.feature] === true);
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
