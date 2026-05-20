'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { MOBILE_NAV_ITEMS, getOverflowItems, isNavActive } from '@/config/app-nav';
import { cn } from '@/lib/utils';

/**
 * 44px mobile bottom navigation bar with 4 items, a raised Create FAB,
 * and a "More" button that opens an overflow menu for hidden nav sections.
 * Fixed at viewport bottom, z-40, white background with top border.
 * Create button is a 48px orange circle raised 12px above the bar.
 */
export function BottomNav() {
  const pathname = usePathname();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeOverflow = useCallback(() => setOverflowOpen(false), []);

  // Close overflow on outside click
  useEffect(() => {
    if (!overflowOpen) return;

    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [overflowOpen]);

  // Close on escape key
  useEffect(() => {
    if (!overflowOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOverflowOpen(false);
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [overflowOpen]);

  const overflowItems = getOverflowItems();

  // Check if any overflow item is currently active
  const overflowActive = overflowItems.some((item) =>
    isNavActive(item.href, pathname),
  );

  return (
    <>
      {/* Backdrop overlay when overflow is open */}
      {overflowOpen && (
        <div
          className="fixed inset-0 z-40"
          style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
          aria-hidden="true"
        />
      )}

      {/* Overflow menu panel */}
      {overflowOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="More navigation options"
          className="fixed bottom-[44px] left-0 right-0 z-50 bg-white px-4 pb-2 pt-3"
          style={{ borderTop: '1px solid var(--c-line)' }}
        >
          <div className="grid grid-cols-4 gap-2">
            {overflowItems.map((item) => {
              const active = isNavActive(item.href, pathname);
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  role="menuitem"
                  onClick={closeOverflow}
                  className={cn(
                    'flex flex-col items-center justify-center gap-1 rounded-lg py-3 px-1',
                    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
                  )}
                  style={{ color: active ? 'var(--c-orange)' : 'var(--c-ink-3)' }}
                >
                  <item.icon size={18} strokeWidth={active ? 2.5 : 2} />
                  <span
                    className={cn(
                      'leading-tight',
                      active ? 'font-semibold' : 'font-medium',
                    )}
                    style={{ fontSize: '9px' }}
                  >
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom navigation bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 flex h-[44px] items-center justify-around bg-white"
        style={{ borderTop: '1px solid var(--c-line)' }}
        aria-label="Mobile navigation"
      >
        {MOBILE_NAV_ITEMS.map((item) => {
          // Raised Create FAB
          if (item.primary) {
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-label="Create"
                className={cn(
                  'flex h-12 w-12 -mt-3 items-center justify-center rounded-full shadow-md',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
                )}
                style={{ background: 'var(--c-orange)' }}
              >
                <Plus size={22} strokeWidth={2.5} className="text-white" />
              </Link>
            );
          }

          // Overflow "More" button
          if (item.isOverflow) {
            const moreActive = overflowOpen || overflowActive;
            return (
              <button
                key={item.id}
                type="button"
                aria-label="More navigation options"
                aria-expanded={overflowOpen}
                aria-haspopup="menu"
                onClick={() => setOverflowOpen((prev) => !prev)}
                className={cn(
                  'flex min-h-[44px] min-w-[44px] flex-col items-center justify-center px-2',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
                )}
                style={{ color: moreActive ? 'var(--c-orange)' : 'var(--c-ink-3)' }}
              >
                <item.icon size={18} strokeWidth={moreActive ? 2.5 : 2} />
                <span
                  className={cn(
                    'mt-0.5 leading-tight',
                    moreActive ? 'font-semibold' : 'font-medium',
                  )}
                  style={{ fontSize: '9px' }}
                >
                  {item.label}
                </span>
              </button>
            );
          }

          // Standard nav item: icon + 9px label, stacked
          const active = isNavActive(item.href, pathname);
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-[44px] min-w-[44px] flex-col items-center justify-center px-2',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
              )}
              style={{ color: active ? 'var(--c-orange)' : 'var(--c-ink-3)' }}
            >
              <item.icon size={18} strokeWidth={active ? 2.5 : 2} />
              <span
                className={cn(
                  'mt-0.5 leading-tight',
                  active ? 'font-semibold' : 'font-medium',
                )}
                style={{ fontSize: '9px' }}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
