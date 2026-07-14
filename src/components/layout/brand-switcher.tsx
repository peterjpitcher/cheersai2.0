'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { useAuth } from '@/components/providers/auth-provider';
import { switchActiveBrand } from '@/lib/auth/actions';
import { cn } from '@/lib/utils';

/** Above this many brands, show a search box in the menu (super-admin god-mode). */
const SEARCH_THRESHOLD = 12;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars = parts.slice(0, 2).map((p) => p[0]).join('');
  return (chars || name.slice(0, 2)).toUpperCase();
}

const PILL_CLASS =
  'flex items-center gap-2 rounded-full py-1 pl-1 pr-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none';

function Avatar({ label }: { label: string }) {
  return (
    <div
      className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium"
      style={{ background: 'var(--c-paper-2)', color: 'var(--c-ink-2)' }}
      aria-hidden="true"
    >
      {initials(label)}
    </div>
  );
}

/**
 * Header brand switcher. Reads the user's brands + active brand from the auth
 * context. One brand -> a plain non-interactive label. Several -> an accessible
 * menu; selecting one calls switchActiveBrand (which re-verifies membership
 * server-side) and refreshes so every server component re-renders for the new
 * brand.
 */
export function BrandSwitcher() {
  const auth = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  const brands = useMemo(() => auth?.brands ?? [], [auth]);
  const activeId = auth?.activeAccountId ?? null;
  const active = brands.find((b) => b.accountId === activeId) ?? brands[0] ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter((b) => (b.name ?? 'Brand').toLowerCase().includes(q));
  }, [brands, search]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    function onClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  if (!active) return null;

  const activeLabel = active.name ?? 'Brand';

  // Single brand -> plain label, no switcher affordance.
  if (brands.length <= 1) {
    return (
      <div className={PILL_CLASS} style={{ border: '1px solid var(--c-line)' }}>
        <Avatar label={activeLabel} />
        <span className="hidden text-sm font-medium sm:inline" style={{ color: 'var(--c-ink)' }}>
          {activeLabel}
        </span>
      </div>
    );
  }

  function select(accountId: string) {
    if (accountId === activeId) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const result = await switchActiveBrand(accountId);
      setOpen(false);
      setSearch('');
      if (result?.success) {
        // Flush client caches so no previous-brand data survives the switch,
        // then re-render server components for the new active brand.
        queryClient.clear();
        router.refresh();
      }
    });
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Active brand: ${activeLabel}. Switch brand`}
        disabled={isPending}
        onClick={() => setOpen((value) => !value)}
        className={cn(PILL_CLASS, 'disabled:cursor-not-allowed disabled:opacity-60')}
        style={{ border: '1px solid var(--c-line)' }}
      >
        <Avatar label={activeLabel} />
        <span className="hidden text-sm font-medium sm:inline" style={{ color: 'var(--c-ink)' }}>
          {activeLabel}
        </span>
        <ChevronDown size={14} style={{ color: 'var(--c-ink-3)' }} aria-hidden="true" />
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-md border bg-white shadow-md"
          style={{ borderColor: 'var(--c-line)' }}
        >
          {brands.length > SEARCH_THRESHOLD && (
            <div className="border-b p-2" style={{ borderColor: 'var(--c-line)' }}>
              <input
                type="text"
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search brands"
                aria-label="Search brands"
                className="w-full rounded border px-2 py-1 text-sm focus-visible:outline-none"
                style={{ borderColor: 'var(--c-line)', color: 'var(--c-ink)' }}
              />
            </div>
          )}
          <ul role="listbox" aria-label="Brands" className="max-h-72 overflow-auto py-1">
            {filtered.map((brand) => {
              const selected = brand.accountId === activeId;
              return (
                <li key={brand.accountId} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => select(brand.accountId)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--c-paper-2)] focus-visible:bg-[var(--c-paper-2)] focus-visible:outline-none"
                  >
                    <span className="flex-1 truncate" style={{ color: 'var(--c-ink)' }}>
                      {brand.name ?? 'Brand'}
                    </span>
                    {selected && <Check size={14} style={{ color: 'var(--c-orange)' }} aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm" style={{ color: 'var(--c-ink-3)' }}>
                No brands found
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
