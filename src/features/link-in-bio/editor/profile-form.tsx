'use client';
'use no memo';

/**
 * Profile editing form for the link-in-bio editor.
 * Uses React Hook Form with Zod validation via profileSchema.
 * Sections: Venue Details, Brand, Contact Links.
 */

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import type { LinkInBioFont, LinkInBioProfile, LinkInBioTemplate, UpdateLinkInBioProfileInput } from '@/lib/link-in-bio/types';
import { checkSlugAvailability } from '@/app/actions/link-in-bio';
import { TemplatePicker } from './template-picker';

interface ProfileFormProps {
  profile: LinkInBioProfile | null;
  onProfileChange: (data: UpdateLinkInBioProfileInput) => void;
}

const FONT_OPTIONS: { value: LinkInBioFont; label: string; fontFamily: string }[] = [
  { value: 'inter', label: 'Inter', fontFamily: "'Inter', sans-serif" },
  { value: 'playfair', label: 'Playfair Display', fontFamily: "'Playfair Display', serif" },
  { value: 'space-grotesk', label: 'Space Grotesk', fontFamily: "'Space Grotesk', sans-serif" },
  { value: 'dm-serif', label: 'DM Serif Display', fontFamily: "'DM Serif Display', serif" },
];

interface FormValues {
  slug: string;
  displayName: string;
  bio: string;
  primaryColor: string;
  secondaryColor: string;
  fontFamily: LinkInBioFont;
  template: LinkInBioTemplate;
  phoneNumber: string;
  whatsappNumber: string;
  bookingUrl: string;
  menuUrl: string;
  parkingUrl: string;
  directionsUrl: string;
  facebookUrl: string;
  instagramUrl: string;
  websiteUrl: string;
}

export function ProfileForm({ profile, onProfileChange }: ProfileFormProps) {
  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');

  const handleSlugCheck = async (slug: string) => {
    const trimmed = slug?.trim();
    if (!trimmed || trimmed.length < 2) {
      setSlugStatus('idle');
      return;
    }
    setSlugStatus('checking');
    const result = await checkSlugAvailability(trimmed);
    setSlugStatus(result.available ? 'available' : 'taken');
  };

  const theme = profile?.theme ?? {};
  const primaryColor = typeof theme.primaryColor === 'string' ? theme.primaryColor : '#005131';
  const secondaryColor = typeof theme.secondaryColor === 'string' ? theme.secondaryColor : '#a57626';

  const { register, watch, setValue } = useForm<FormValues>({
    defaultValues: {
      slug: profile?.slug ?? '',
      displayName: profile?.displayName ?? '',
      bio: profile?.bio ?? '',
      primaryColor,
      secondaryColor,
      fontFamily: profile?.fontFamily ?? 'inter',
      template: profile?.template ?? 'classic',
      phoneNumber: profile?.phoneNumber ?? '',
      whatsappNumber: profile?.whatsappNumber ?? '',
      bookingUrl: profile?.bookingUrl ?? '',
      menuUrl: profile?.menuUrl ?? '',
      parkingUrl: profile?.parkingUrl ?? '',
      directionsUrl: profile?.directionsUrl ?? '',
      facebookUrl: profile?.facebookUrl ?? '',
      instagramUrl: profile?.instagramUrl ?? '',
      websiteUrl: profile?.websiteUrl ?? '',
    },
  });

  const formValues = watch();

  // Emit changes to parent for auto-save and live preview
  useEffect(() => {
    const input: UpdateLinkInBioProfileInput = {
      slug: formValues.slug,
      displayName: formValues.displayName || null,
      bio: formValues.bio || null,
      theme: {
        primaryColor: formValues.primaryColor,
        secondaryColor: formValues.secondaryColor,
      },
      fontFamily: formValues.fontFamily,
      template: formValues.template,
      phoneNumber: formValues.phoneNumber || null,
      whatsappNumber: formValues.whatsappNumber || null,
      bookingUrl: formValues.bookingUrl || null,
      menuUrl: formValues.menuUrl || null,
      parkingUrl: formValues.parkingUrl || null,
      directionsUrl: formValues.directionsUrl || null,
      facebookUrl: formValues.facebookUrl || null,
      instagramUrl: formValues.instagramUrl || null,
      websiteUrl: formValues.websiteUrl || null,
    };
    onProfileChange(input);
    if (formValues.slug !== profile?.slug) {
      void handleSlugCheck(formValues.slug);
    }
  }, [formValues, onProfileChange]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-8">
      {/* Venue Details */}
      <section className="space-y-4">
        <h3 className="text-base font-semibold">Venue Details</h3>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Display Name</label>
          <input
            {...register('displayName')}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="The Anchor"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Bio</label>
          <textarea
            {...register('bio')}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
            placeholder="A brief description of your venue"
            maxLength={500}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {formValues.bio?.length ?? 0}/500
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Page Slug</label>
          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground">/l/</span>
            <input
              {...register('slug')}
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="the-anchor"
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Lowercase letters, numbers, and hyphens only
          </p>
          {slugStatus === 'checking' && (
            <p className="mt-1 text-xs text-muted-foreground">Checking availability...</p>
          )}
          {slugStatus === 'available' && (
            <p className="mt-1 text-xs text-emerald-600">Slug is available</p>
          )}
          {slugStatus === 'taken' && (
            <p className="mt-1 text-xs text-destructive">Slug is already taken. Choose a different one.</p>
          )}
        </div>
      </section>

      {/* Brand */}
      <section className="space-y-4">
        <h3 className="text-base font-semibold">Brand</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Primary Colour</label>
            <div className="flex items-center gap-2">
              <div
                className="h-8 w-8 rounded-md border border-input"
                style={{ backgroundColor: formValues.primaryColor }}
              />
              <input
                {...register('primaryColor')}
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                placeholder="#005131"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Secondary Colour</label>
            <div className="flex items-center gap-2">
              <div
                className="h-8 w-8 rounded-md border border-input"
                style={{ backgroundColor: formValues.secondaryColor }}
              />
              <input
                {...register('secondaryColor')}
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                placeholder="#a57626"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Font</label>
          <select
            {...register('fontFamily')}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {FONT_OPTIONS.map((font) => (
              <option key={font.value} value={font.value} style={{ fontFamily: font.fontFamily }}>
                {font.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-3 block text-sm font-medium">Template</label>
          <TemplatePicker
            selected={formValues.template}
            onSelect={(template) => setValue('template', template)}
          />
        </div>
      </section>

      {/* Contact Links */}
      <section className="space-y-4">
        <h3 className="text-base font-semibold">Contact Links</h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Phone</label>
            <input
              {...register('phoneNumber')}
              type="tel"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="+44 1234 567890"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">WhatsApp</label>
            <input
              {...register('whatsappNumber')}
              type="tel"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="+44 1234 567890"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Booking URL</label>
            <input
              {...register('bookingUrl')}
              type="url"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="https://..."
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Menu URL</label>
            <input
              {...register('menuUrl')}
              type="url"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="https://..."
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Parking URL</label>
            <input
              {...register('parkingUrl')}
              type="url"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="https://..."
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Directions URL</label>
            <input
              {...register('directionsUrl')}
              type="url"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="https://maps.google.com/..."
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Facebook</label>
            <input
              {...register('facebookUrl')}
              type="url"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="https://facebook.com/..."
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Instagram</label>
            <input
              {...register('instagramUrl')}
              type="url"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="https://instagram.com/..."
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm font-medium">Website</label>
            <input
              {...register('websiteUrl')}
              type="url"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="https://..."
            />
          </div>
        </div>
      </section>
    </div>
  );
}
