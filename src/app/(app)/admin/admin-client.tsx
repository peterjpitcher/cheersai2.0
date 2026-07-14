'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type { AdminBrand, AdminUser } from '@/lib/admin/data';
import {
  assignMembership,
  createBrand,
  inviteUser,
  revokeMembership,
  setSuperAdmin,
} from '@/app/(app)/admin/actions';

const CARD = 'rounded-lg border p-4';
const CARD_STYLE = { borderColor: 'var(--c-line)' } as const;
const INPUT =
  'w-full rounded border px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const BTN =
  'rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Feedback({ error, ok }: { error?: string; ok?: string }) {
  if (error) return <p className="mt-2 text-sm" style={{ color: 'var(--c-danger, #b91c1c)' }}>{error}</p>;
  if (ok) return <p className="mt-2 text-sm" style={{ color: 'var(--c-orange)' }}>{ok}</p>;
  return null;
}

function CreateBrandForm() {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [timezone, setTimezone] = useState('Europe/London');
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});

  return (
    <div className={CARD} style={CARD_STYLE}>
      <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>Create brand</h2>
      <div className="grid gap-2 sm:grid-cols-3">
        <input className={INPUT} style={CARD_STYLE} placeholder="Brand name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={INPUT} style={CARD_STYLE} placeholder="Contact email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={INPUT} style={CARD_STYLE} placeholder="Timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
      </div>
      <button
        type="button"
        disabled={isPending}
        className={`${BTN} mt-3 text-white`}
        style={{ background: 'var(--c-orange)' }}
        onClick={() =>
          start(async () => {
            setMsg({});
            const r = await createBrand({ name, email, timezone });
            if (r.success) {
              setName(''); setEmail('');
              setMsg({ ok: 'Brand created.' });
              router.refresh();
            } else setMsg({ error: r.error });
          })
        }
      >
        {isPending ? 'Creating…' : 'Create brand'}
      </button>
      <Feedback {...msg} />
    </div>
  );
}

function InviteForm({ brands }: { brands: AdminBrand[] }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [email, setEmail] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className={CARD} style={CARD_STYLE}>
      <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>Invite new user</h2>
      <input className={INPUT} style={CARD_STYLE} placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
      <fieldset className="mt-2">
        <legend className="mb-1 text-xs" style={{ color: 'var(--c-ink-3)' }}>Grant access to</legend>
        <div className="flex flex-wrap gap-2">
          {brands.filter((b) => !b.archivedAt).map((b) => (
            <label key={b.accountId} className="flex items-center gap-1 text-sm" style={{ color: 'var(--c-ink)' }}>
              <input type="checkbox" checked={selected.has(b.accountId)} onChange={() => toggle(b.accountId)} />
              {b.name ?? 'Brand'}
            </label>
          ))}
        </div>
      </fieldset>
      <button
        type="button"
        disabled={isPending}
        className={`${BTN} mt-3 text-white`}
        style={{ background: 'var(--c-orange)' }}
        onClick={() =>
          start(async () => {
            setMsg({});
            const r = await inviteUser({ email, accountIds: [...selected] });
            if (r.success) {
              setEmail(''); setSelected(new Set());
              setMsg({ ok: 'Invite sent.' });
              router.refresh();
            } else setMsg({ error: r.error });
          })
        }
      >
        {isPending ? 'Inviting…' : 'Send invite'}
      </button>
      <Feedback {...msg} />
    </div>
  );
}

function UserRow({ user, brands }: { user: AdminUser; brands: AdminBrand[] }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [assignTo, setAssignTo] = useState('');
  const brandName = (id: string) => brands.find((b) => b.accountId === id)?.name ?? id;
  const unassigned = brands.filter((b) => !b.archivedAt && !user.brandIds.includes(b.accountId));

  function run(fn: () => Promise<{ success?: boolean; error?: string }>) {
    start(async () => {
      const r = await fn();
      if (r.success) router.refresh();
    });
  }

  return (
    <tr style={{ borderTopColor: 'var(--c-line)' }} className="border-t align-top">
      <td className="py-2 pr-3 text-sm" style={{ color: 'var(--c-ink)' }}>
        {user.email ?? user.userId}
        {user.isSuperAdmin && (
          <span className="ml-2 rounded px-1.5 py-0.5 text-xs" style={{ background: 'var(--c-paper-2)', color: 'var(--c-ink-2)' }}>admin</span>
        )}
      </td>
      <td className="py-2 pr-3">
        <div className="flex flex-wrap gap-1">
          {user.brandIds.map((id) => (
            <button
              key={id}
              type="button"
              disabled={isPending}
              className="rounded-full border px-2 py-0.5 text-xs"
              style={CARD_STYLE}
              title="Revoke access"
              onClick={() => run(() => revokeMembership(user.userId, id))}
            >
              {brandName(id)} ✕
            </button>
          ))}
          {user.brandIds.length === 0 && <span className="text-xs" style={{ color: 'var(--c-ink-3)' }}>none</span>}
        </div>
      </td>
      <td className="py-2 pr-3">
        {unassigned.length > 0 && (
          <div className="flex gap-1">
            <select className={INPUT} style={CARD_STYLE} value={assignTo} onChange={(e) => setAssignTo(e.target.value)} aria-label="Grant brand access">
              <option value="">Add brand…</option>
              {unassigned.map((b) => (
                <option key={b.accountId} value={b.accountId}>{b.name ?? 'Brand'}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={isPending || !assignTo}
              className={`${BTN} border`}
              style={CARD_STYLE}
              onClick={() => { if (assignTo) { run(() => assignMembership(user.userId, assignTo)); setAssignTo(''); } }}
            >
              Add
            </button>
          </div>
        )}
      </td>
      <td className="py-2">
        <button
          type="button"
          disabled={isPending}
          className={`${BTN} border`}
          style={CARD_STYLE}
          onClick={() => run(() => setSuperAdmin(user.userId, !user.isSuperAdmin))}
        >
          {user.isSuperAdmin ? 'Remove admin' : 'Make admin'}
        </button>
      </td>
    </tr>
  );
}

export function AdminClient({ brands, users }: { brands: AdminBrand[]; users: AdminUser[] }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <CreateBrandForm />
        <InviteForm brands={brands} />
      </div>

      <div className={CARD} style={CARD_STYLE}>
        <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>Users &amp; access</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
                <th scope="col" className="py-1 pr-3 font-medium">User</th>
                <th scope="col" className="py-1 pr-3 font-medium">Brands</th>
                <th scope="col" className="py-1 pr-3 font-medium">Grant access</th>
                <th scope="col" className="py-1 font-medium">Admin</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRow key={u.userId} user={u} brands={brands} />
              ))}
              {users.length === 0 && (
                <tr><td colSpan={4} className="py-3 text-sm" style={{ color: 'var(--c-ink-3)' }}>No users yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
