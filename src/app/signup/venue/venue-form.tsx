'use client';

import { useActionState } from 'react';
import Link from 'next/link';

import { AuthMessage } from '@/components/auth/auth-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { safeNextPath } from '@/lib/auth/email-links';
import { FULL_NAME_MAX, PASSWORD_MAX, PASSWORD_MIN, VENUE_NAME_MAX, VENUE_TYPES } from '@/lib/signup/venue-form';

import { createSelfServeVenue, type CreateVenueResult } from './actions';

interface FormState extends CreateVenueResult {
  /** What was typed (never the passwords), so the fields refill after an error. */
  values?: { email: string; fullName: string; venueName: string; venueType: string; business: boolean };
}

const SELECT_CLASS =
  'flex h-[34px] w-full rounded-md border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:border-[var(--c-orange)] focus-visible:shadow-[0_0_0_3px_var(--c-orange-soft)]';

/**
 * The venue set-up form (spec §4.4). The server action trusts nothing here:
 * the login comes from the session, and every field is checked again.
 */
export function VenueForm(): React.JSX.Element {
  const [state, formAction, pending] = useActionState(async (_previous: FormState | null, formData: FormData): Promise<FormState> => {
    const values = {
      email: String(formData.get('email') ?? ''),
      fullName: String(formData.get('fullName') ?? ''),
      venueName: String(formData.get('venueName') ?? ''),
      venueType: String(formData.get('venueType') ?? ''),
      business: formData.get('business') === 'on',
    };
    const result = await createSelfServeVenue(formData);
    if (result.success) {
      // A full page load, so the app opens on the new brand. Same-origin paths only.
      window.location.assign(safeNextPath(result.next, '/settings#billing'));
    }
    return { ...result, values };
  }, null);

  const values = state?.values;
  const done = state?.success === true;

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Your email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          autoFocus
          defaultValue={values?.email ?? ''}
          aria-describedby="email-help"
        />
        <p id="email-help" className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
          Type the email address you signed up with, to show this is your sign-up.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="fullName">Your name</Label>
        <Input
          id="fullName"
          name="fullName"
          type="text"
          required
          maxLength={FULL_NAME_MAX}
          autoComplete="name"
          defaultValue={values?.fullName ?? ''}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Choose a password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={PASSWORD_MIN}
          maxLength={PASSWORD_MAX}
          autoComplete="new-password"
          aria-describedby="password-help"
        />
        <p id="password-help" className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
          At least {PASSWORD_MIN} characters.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">Confirm your password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={PASSWORD_MIN}
          maxLength={PASSWORD_MAX}
          autoComplete="new-password"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="venueName">Venue name</Label>
        <Input
          id="venueName"
          name="venueName"
          type="text"
          required
          maxLength={VENUE_NAME_MAX}
          autoComplete="organization"
          defaultValue={values?.venueName ?? ''}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="venueType">Type of venue</Label>
        <select
          id="venueType"
          name="venueType"
          required
          className={SELECT_CLASS}
          defaultValue={values?.venueType ?? ''}
          key={values?.venueType ?? 'venue-type'}
        >
          <option value="" disabled>
            Choose one
          </option>
          {VENUE_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-start gap-3">
        <input
          id="business"
          name="business"
          type="checkbox"
          required
          className="mt-0.5 h-4 w-4 shrink-0"
          defaultChecked={values?.business ?? false}
          key={values?.business ? 'business-on' : 'business-off'}
        />
        <label htmlFor="business" className="text-sm" style={{ color: 'var(--c-ink-2)' }}>
          I am signing up for a business, not as a consumer (see section 2 of the{' '}
          <Link href="/terms#business-customers" className="underline" target="_blank" rel="noopener">
            terms
          </Link>
          ).
        </label>
      </div>
      <Button type="submit" variant="primary" size="lg" full disabled={pending || done}>
        {pending ? 'Setting up your venue...' : done ? 'Opening Billing...' : 'Set up my venue'}
      </Button>
      {state?.error && <AuthMessage tone="error">{state.error}</AuthMessage>}
    </form>
  );
}
