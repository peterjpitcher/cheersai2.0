'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type { AdminBrand, AdminUser } from '@/lib/admin/data';
import {
  assignMembership,
  clearBookingIngestKey,
  createBrand,
  exportBrandDataAction,
  generateBookingIngestKey,
  inviteUser,
  offboardBrandAction,
  purgeBrandAction,
  revokeMembership,
  sendPasswordLink,
  setBillingOverride,
  setBrandFeature,
  setSuperAdmin,
} from '@/app/(app)/admin/actions';
import { FEATURE_LABELS, type BrandFeature } from '@/lib/auth/brand-features';

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

const BILLING_STATE_LABELS: Record<string, string> = {
  comped: 'Free',
  active: 'Paying',
  trialing: 'Trial',
  past_due_grace: 'Payment late (grace)',
  lapsed: 'Lapsed',
  incomplete: 'Not set up',
  suspended: 'Suspended',
  archived: 'Archived',
};

function formatUkDate(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }).format(new Date(iso));
}

function BillingCard({ brands }: { brands: AdminBrand[] }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const active = brands.filter((b) => !b.archivedAt);

  function change(brand: AdminBrand, value: string) {
    const override = value === 'comped' || value === 'suspended' ? value : null;
    if (override === 'suspended' && !window.confirm(`Suspend ${brand.name ?? 'this brand'}? Its posts will be held while billing enforcement is on.`)) return;
    start(async () => {
      setMsg({});
      const r = await setBillingOverride(brand.accountId, override);
      if (r.success) {
        const releasedNote = r.released ? ` ${r.released} held post(s) released${r.stillHeld ? `, ${r.stillHeld} overdue still held for review` : ''}.` : '';
        setMsg({ ok: `Billing for ${brand.name ?? 'brand'} updated.${releasedNote}` });
        router.refresh();
      } else setMsg({ error: r.error });
    });
  }

  return (
    <div className={CARD} style={CARD_STYLE}>
      <h2 className='mb-1 text-sm font-semibold' style={{ color: 'var(--c-ink)' }}>Billing</h2>
      <p className='mb-3 text-xs' style={{ color: 'var(--c-ink-3)' }}>
        Stripe decides unless a brand is set to Free or Suspended here. Held posts only happen while billing enforcement is on.
      </p>
      <div className='overflow-x-auto'>
        <table className='w-full text-left'>
          <thead>
            <tr className='text-xs' style={{ color: 'var(--c-ink-3)' }}>
              <th className='py-1 pr-3 font-medium'>Brand</th>
              <th className='py-1 pr-3 font-medium'>State</th>
              <th className='py-1 pr-3 font-medium'>Plan</th>
              <th className='py-1 pr-3 font-medium'>Held posts</th>
              <th className='py-1 pr-3 font-medium'>Billing</th>
            </tr>
          </thead>
          <tbody>
            {active.map((b) => (
              <tr key={b.accountId} className='border-t' style={{ borderTopColor: 'var(--c-line)' }}>
                <td className='py-2 pr-3 text-sm' style={{ color: 'var(--c-ink)' }}>{b.name ?? 'Brand'}</td>
                <td className='py-2 pr-3 text-sm' style={{ color: 'var(--c-ink)' }}>{BILLING_STATE_LABELS[b.billing.state] ?? b.billing.state}</td>
                <td className='py-2 pr-3 text-xs' style={{ color: 'var(--c-ink-2)' }}>
                  {b.billing.subscription
                    ? `${b.billing.subscription.plan}, ${b.billing.subscription.status}${b.billing.subscription.currentPeriodEnd ? `, ${b.billing.subscription.cancelAtPeriodEnd ? 'ends' : 'renews'} ${formatUkDate(b.billing.subscription.currentPeriodEnd)}` : ''}`
                    : 'No subscription'}
                </td>
                <td className='py-2 pr-3 text-sm' style={{ color: 'var(--c-ink)' }}>{b.billing.heldPosts}</td>
                <td className='py-2 pr-3'>
                  <select
                    className={INPUT}
                    style={CARD_STYLE}
                    value={b.billing.override ?? 'stripe'}
                    disabled={isPending}
                    onChange={(e) => change(b, e.target.value)}
                    aria-label={`Billing for ${b.name ?? 'brand'}`}
                  >
                    <option value='stripe'>Stripe decides</option>
                    <option value='comped'>Free</option>
                    <option value='suspended'>Suspended</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Feedback {...msg} />
    </div>
  );
}

function OffboardingCard({ brands }: { brands: AdminBrand[] }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const [accountId, setAccountId] = useState('');
  const [typedName, setTypedName] = useState('');
  const brand = brands.find((b) => b.accountId === accountId) ?? null;
  const purgeDue = brand?.purgeDue === true;

  function exportData() {
    if (!brand) return;
    start(async () => {
      setMsg({});
      const r = await exportBrandDataAction(brand.accountId);
      if (r.success && r.json && r.fileName) {
        const url = URL.createObjectURL(new Blob([r.json], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = r.fileName;
        link.click();
        URL.revokeObjectURL(url);
        setMsg({ ok: `Export for ${brand.name ?? 'brand'} downloaded.` });
      } else setMsg({ error: r.error ?? 'The export failed.' });
    });
  }

  function offboard() {
    if (!brand) return;
    start(async () => {
      setMsg({});
      const r = await offboardBrandAction(brand.accountId, typedName);
      if (r.success) {
        setTypedName('');
        setMsg({ ok: `${brand.name ?? 'Brand'} offboarded. Its data can be deleted after ${formatUkDate(r.purgeAfter ?? null)}.` });
        router.refresh();
      } else setMsg({ error: r.error });
    });
  }

  function purge() {
    if (!brand) return;
    if (!window.confirm(`Permanently delete all data for ${brand.name ?? 'this brand'}? This cannot be undone.`)) return;
    start(async () => {
      setMsg({});
      const r = await purgeBrandAction(brand.accountId, typedName);
      if (r.success) {
        setTypedName('');
        setAccountId('');
        setMsg({ ok: `Deleted: ${r.filesDeleted ?? 0} files and ${r.loginsDeleted ?? 0} login(s).` });
        router.refresh();
      } else setMsg({ error: r.error });
    });
  }

  return (
    <div className={CARD} style={CARD_STYLE}>
      <h2 className="mb-1 text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>Offboarding</h2>
      <p className="mb-3 text-xs" style={{ color: 'var(--c-ink-3)' }}>
        Follow docs/runbooks/customer-offboarding.md. Offboarding stops posts, deletes tokens and hides the brand; its data can be deleted 30 days later.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <select className={INPUT} style={CARD_STYLE} value={accountId} onChange={(e) => { setAccountId(e.target.value); setTypedName(''); setMsg({}); }} aria-label="Brand to offboard">
          <option value="">Choose a brand…</option>
          {brands.map((b) => (
            <option key={b.accountId} value={b.accountId}>
              {(b.name ?? 'Brand') + (b.offboardedAt ? ` (offboarded, delete after ${formatUkDate(b.purgeAfter)})` : '')}
            </option>
          ))}
        </select>
        <input
          className={INPUT}
          style={CARD_STYLE}
          placeholder="Type the brand name to confirm"
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          disabled={!brand}
          aria-label="Type the brand name to confirm"
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={isPending || !brand} className={`${BTN} border`} style={CARD_STYLE} onClick={exportData}>
          Export data
        </button>
        <button
          type="button"
          disabled={isPending || !brand || Boolean(brand.offboardedAt) || !typedName}
          className={`${BTN} text-white`}
          style={{ background: 'var(--c-orange)' }}
          onClick={offboard}
        >
          Offboard
        </button>
        <button
          type="button"
          disabled={isPending || !brand || !purgeDue || !typedName}
          className={`${BTN} text-white`}
          style={{ background: 'var(--c-danger, #b91c1c)' }}
          onClick={purge}
        >
          Delete data
        </button>
      </div>
      <Feedback {...msg} />
    </div>
  );
}

function BrandFeaturesCard({ brands }: { brands: AdminBrand[] }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const active = brands.filter((b) => !b.archivedAt);
  const features = Object.keys(FEATURE_LABELS) as BrandFeature[];

  function toggle(brand: AdminBrand, feature: BrandFeature) {
    const enabled = !brand.features[feature];
    start(async () => {
      setMsg({});
      const r = await setBrandFeature(brand.accountId, feature, enabled);
      if (r.success) {
        setMsg({ ok: `${FEATURE_LABELS[feature]} ${enabled ? 'on' : 'off'} for ${brand.name ?? 'brand'}.` });
        router.refresh();
      } else setMsg({ error: r.error });
    });
  }

  return (
    <div className={CARD} style={CARD_STYLE}>
      <h2 className='mb-1 text-sm font-semibold' style={{ color: 'var(--c-ink)' }}>Brand features</h2>
      <p className='mb-3 text-xs' style={{ color: 'var(--c-ink-3)' }}>
        Paid ads, tournaments and the management app import are off for new brands. Switch them on per brand.
      </p>
      <div className='overflow-x-auto'>
        <table className='w-full text-left'>
          <thead>
            <tr className='text-xs' style={{ color: 'var(--c-ink-3)' }}>
              <th className='py-1 pr-3 font-medium'>Brand</th>
              {features.map((f) => (
                <th key={f} className='py-1 pr-3 font-medium'>{FEATURE_LABELS[f]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {active.map((b) => (
              <tr key={b.accountId} className='border-t' style={{ borderTopColor: 'var(--c-line)' }}>
                <td className='py-2 pr-3 text-sm' style={{ color: 'var(--c-ink)' }}>{b.name ?? 'Brand'}</td>
                {features.map((f) => (
                  <td key={f} className='py-2 pr-3'>
                    <input
                      type='checkbox'
                      checked={b.features[f]}
                      disabled={isPending}
                      onChange={() => toggle(b, f)}
                      aria-label={`${FEATURE_LABELS[f]} for ${b.name ?? 'brand'}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  const [linkMsg, setLinkMsg] = useState<{ error?: string; ok?: string }>({});
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
        <div className="mt-1">
          <button
            type="button"
            disabled={isPending}
            className="text-xs underline-offset-4 hover:underline disabled:opacity-60"
            style={{ color: 'var(--c-ink-3)' }}
            onClick={() =>
              start(async () => {
                setLinkMsg({});
                const r = await sendPasswordLink(user.userId);
                setLinkMsg(r.success ? { ok: 'Password link sent.' } : { error: r.error });
              })
            }
          >
            Send password link
          </button>
          <Feedback {...linkMsg} />
        </div>
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

      <BillingCard brands={brands} />
      <BrandFeaturesCard brands={brands} />
      <OffboardingCard brands={brands} />
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
