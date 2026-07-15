'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type { AdminBrand, AdminUser } from '@/lib/admin/data';
import {
  assignMembership,
  clearBookingIngestKey,
  createBrand,
  generateBookingIngestKey,
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

function BookingKeysCard({ brands, ingestEndpoint }: { brands: AdminBrand[]; ingestEndpoint: string }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ accountId: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});

  const active = brands.filter((b) => !b.archivedAt);

  function generate(accountId: string, isRotate: boolean) {
    if (
      isRotate &&
      !window.confirm('Rotate the key? The current key stops working immediately, until the brand updates their booking site.')
    ) {
      return;
    }
    setBusyId(accountId);
    start(async () => {
      setMsg({});
      const r = await generateBookingIngestKey(accountId);
      setBusyId(null);
      if (r.success && r.key) {
        setRevealed({ accountId, key: r.key });
        setCopied(false);
        router.refresh();
      } else {
        setMsg({ error: r.error ?? 'Could not generate key.' });
      }
    });
  }

  function disable(accountId: string) {
    if (!window.confirm('Disable booking ingestion for this brand? Incoming bookings will be rejected until you generate a new key.')) {
      return;
    }
    setBusyId(accountId);
    start(async () => {
      setMsg({});
      const r = await clearBookingIngestKey(accountId);
      setBusyId(null);
      if (r.success) {
        if (revealed?.accountId === accountId) setRevealed(null);
        setMsg({ ok: 'Booking ingestion disabled.' });
        router.refresh();
      } else {
        setMsg({ error: r.error ?? 'Could not disable.' });
      }
    });
  }

  async function copyKey(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={CARD} style={CARD_STYLE}>
      <h2 className="mb-1 text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>Booking-conversion keys</h2>
      <p className="mb-3 text-xs" style={{ color: 'var(--c-ink-3)' }}>
        Generate a key so a brand&rsquo;s booking site can send conversions. The site sends it as{' '}
        <code>Authorization: Bearer &lt;key&gt;</code> to <code>{ingestEndpoint}</code>.
      </p>

      {revealed && (
        <div className="mb-3 rounded-md border p-3" style={{ borderColor: 'var(--c-orange)', background: 'var(--c-paper-2)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--c-ink)' }}>
            New key for {active.find((b) => b.accountId === revealed.accountId)?.name ?? 'brand'} — copy it now, it won&rsquo;t be shown again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded border px-2 py-1 text-xs" style={CARD_STYLE}>{revealed.key}</code>
            <button type="button" className={`${BTN} border`} style={CARD_STYLE} onClick={() => copyKey(revealed.key)}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className={`${BTN} border`} style={CARD_STYLE} onClick={() => setRevealed(null)} aria-label="Dismiss key">
              Done
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
              <th scope="col" className="py-1 pr-3 font-medium">Brand</th>
              <th scope="col" className="py-1 pr-3 font-medium">Booking ingestion</th>
              <th scope="col" className="py-1 font-medium">Key</th>
            </tr>
          </thead>
          <tbody>
            {active.map((b) => (
              <tr key={b.accountId} className="border-t" style={{ borderTopColor: 'var(--c-line)' }}>
                <td className="py-2 pr-3 text-sm" style={{ color: 'var(--c-ink)' }}>{b.name ?? 'Brand'}</td>
                <td className="py-2 pr-3 text-xs" style={{ color: b.bookingIngestConfigured ? 'var(--c-ink)' : 'var(--c-ink-3)' }}>
                  {b.bookingIngestConfigured ? 'Configured' : 'Not set'}
                </td>
                <td className="py-2">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={isPending && busyId === b.accountId}
                      className={`${BTN} border`}
                      style={CARD_STYLE}
                      onClick={() => generate(b.accountId, b.bookingIngestConfigured)}
                    >
                      {b.bookingIngestConfigured ? 'Rotate key' : 'Generate key'}
                    </button>
                    {b.bookingIngestConfigured && (
                      <button
                        type="button"
                        disabled={isPending && busyId === b.accountId}
                        className={`${BTN} border`}
                        style={CARD_STYLE}
                        onClick={() => disable(b.accountId)}
                      >
                        Disable
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {active.length === 0 && (
              <tr><td colSpan={3} className="py-3 text-sm" style={{ color: 'var(--c-ink-3)' }}>No active brands.</td></tr>
            )}
          </tbody>
        </table>
      </div>
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

export function AdminClient({
  brands,
  users,
  ingestEndpoint,
}: {
  brands: AdminBrand[];
  users: AdminUser[];
  ingestEndpoint: string;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <CreateBrandForm />
        <InviteForm brands={brands} />
      </div>

      <BookingKeysCard brands={brands} ingestEndpoint={ingestEndpoint} />

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
