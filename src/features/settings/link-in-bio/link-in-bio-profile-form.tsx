"use client";

import Image from "next/image";
import { useMemo, useTransition } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import type { MediaAssetSummary } from "@/lib/library/data";
import type { LinkInBioProfile } from "@/lib/link-in-bio/types";
import { updateLinkInBioProfileSettings } from "@/app/(app)/settings/actions";
import {
  LinkInBioProfileFormValues,
  linkInBioProfileFormSchema,
} from "@/features/settings/schema";

const DEFAULT_PRIMARY = "#005131";
const DEFAULT_SECONDARY = "#a57626";

interface LinkInBioProfileFormProps {
  profile: LinkInBioProfile | null;
  mediaAssets: MediaAssetSummary[];
}

export function LinkInBioProfileForm({ profile, mediaAssets }: LinkInBioProfileFormProps) {
  const [isPending, startTransition] = useTransition();

  const form = useForm<LinkInBioProfileFormValues>({
    resolver: zodResolver(linkInBioProfileFormSchema) as Resolver<LinkInBioProfileFormValues>,
    defaultValues: {
      slug: profile?.slug ?? "the-anchor",
      displayName: profile?.displayName ?? undefined,
      bio: profile?.bio ?? undefined,
      heroMediaId: profile?.heroMediaId ?? undefined,
      theme: {
        primaryColor: (profile?.theme as { primaryColor?: string } | undefined)?.primaryColor ?? DEFAULT_PRIMARY,
        secondaryColor: (profile?.theme as { secondaryColor?: string } | undefined)?.secondaryColor ?? DEFAULT_SECONDARY,
      },
      phoneNumber: profile?.phoneNumber ?? undefined,
      whatsappNumber: profile?.whatsappNumber ?? undefined,
      bookingUrl: profile?.bookingUrl ?? undefined,
      menuUrl: profile?.menuUrl ?? undefined,
      parkingUrl: profile?.parkingUrl ?? undefined,
      facebookUrl: profile?.facebookUrl ?? undefined,
      instagramUrl: profile?.instagramUrl ?? undefined,
      websiteUrl: profile?.websiteUrl ?? undefined,
    },
  });

  const selectedHeroId = form.watch("heroMediaId");
  const selectedHero = useMemo(
    () => mediaAssets.find((asset) => asset.id === selectedHeroId),
    [mediaAssets, selectedHeroId],
  );

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      await updateLinkInBioProfileSettings(values);
    });
  });

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-brand-teal">Slug</label>
          <p className="text-xs text-brand-teal/70">Used in the public URL: cheersai.uk/l/&lt;slug&gt;.</p>
          <input
            className="w-full rounded-xl border border-brand-teal/30 bg-white px-3 py-2 text-sm text-brand-teal shadow-sm focus:border-brand-teal focus:outline-none"
            placeholder="the-anchor"
            {...form.register("slug")}
          />
          {form.formState.errors.slug ? (
            <p className="text-xs text-red-600">{form.formState.errors.slug.message}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-semibold text-brand-teal">Display name</label>
          <input
            className="w-full rounded-xl border border-brand-teal/30 bg-white px-3 py-2 text-sm text-brand-teal shadow-sm focus:border-brand-teal focus:outline-none"
            placeholder="The Anchor"
            {...form.register("displayName")}
          />
        </div>
        <div className="lg:col-span-2 space-y-2">
          <label className="text-sm font-semibold text-brand-teal">Bio</label>
          <textarea
            rows={3}
            className="w-full rounded-xl border border-brand-teal/30 bg-white px-3 py-2 text-sm text-brand-teal shadow-sm focus:border-brand-teal focus:outline-none"
            placeholder="Historic riverside pub serving the best Sunday roasts in Cambridge."
            {...form.register("bio")}
          />
          {form.formState.errors.bio ? (
            <p className="text-xs text-red-600">{form.formState.errors.bio.message}</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_2.4fr]">
        <div className="space-y-3">
          <label className="text-sm font-semibold text-brand-teal">Hero image</label>
          <select
            className="w-full rounded-xl border border-brand-teal/30 bg-white px-3 py-2 text-sm text-brand-teal focus:border-brand-teal focus:outline-none"
            {...form.register("heroMediaId")}
          >
            <option value="">No hero image</option>
            {mediaAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.fileName || asset.id}
              </option>
            ))}
          </select>
          {selectedHero ? (
            <div className="overflow-hidden rounded-xl border border-brand-teal/20 bg-brand-mist/10 p-2">
              {selectedHero.previewUrl ? (
                <Image
                  src={selectedHero.previewUrl}
                  alt={selectedHero.fileName ?? "Hero image preview"}
                  width={320}
                  height={200}
                  className="h-40 w-full rounded-lg object-cover"
                />
              ) : (
                <div className="flex h-40 items-center justify-center rounded-lg bg-brand-teal/10 text-sm text-brand-teal/70">
                  Preview unavailable
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-brand-teal/70">Select a library asset to feature at the top of your link-in-bio page.</p>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-brand-teal">Primary colour</label>
            <input
              type="color"
              className="h-12 w-full cursor-pointer rounded-xl border border-brand-teal/30 bg-white"
              {...form.register("theme.primaryColor")}
            />
            <p className="text-xs text-brand-teal/60">Main background (defaults to #005131).</p>
            {form.formState.errors.theme?.primaryColor ? (
              <p className="text-xs text-red-600">{form.formState.errors.theme.primaryColor.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-brand-teal">Secondary colour</label>
            <input
              type="color"
              className="h-12 w-full cursor-pointer rounded-xl border border-brand-teal/30 bg-white"
              {...form.register("theme.secondaryColor")}
            />
            <p className="text-xs text-brand-teal/60">CTA accent (defaults to #a57626).</p>
            {form.formState.errors.theme?.secondaryColor ? (
              <p className="text-xs text-red-600">{form.formState.errors.theme.secondaryColor.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-brand-teal">Phone (Call us)</label>
            <input
              className="w-full rounded-xl border border-brand-teal/30 bg-white px-3 py-2 text-sm text-brand-teal shadow-sm focus:border-brand-teal focus:outline-none"
              placeholder="01223 123456"
              {...form.register("phoneNumber")}
            />
            {form.formState.errors.phoneNumber ? (
              <p className="text-xs text-red-600">{form.formState.errors.phoneNumber.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-brand-teal">WhatsApp</label>
            <input
              className="w-full rounded-xl border border-brand-teal/30 bg-white px-3 py-2 text-sm text-brand-teal shadow-sm focus:border-brand-teal focus:outline-none"
              placeholder="+44 7712 345678"
              {...form.register("whatsappNumber")}
            />
            {form.formState.errors.whatsappNumber ? (
              <p className="text-xs text-red-600">{form.formState.errors.whatsappNumber.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-brand-teal">Book a table URL</label>
            <input
              className="w-full rounded-xl border border-brand-teal/30 bg-white px-3 py-2 text-sm text-brand-teal shadow-sm focus:border-brand-teal focus:outline-none"
              placeholder="https://"
              {...form.register("bookingUrl")}
            />
            {form.formState.errors.bookingUrl ? (
              <p className="text-xs text-red-600">{form.formState.errors.bookingUrl.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-brand-teal">Menu URL</label>
            <input
              className="w-full rounded-xl border border-brand-teal/30 bg-white px-3 py-2 text-sm text-brand-teal shadow-sm focus:border-brand-teal focus:outline-none"
              placeholder="https://"
              {...form.register("menuUrl")}
            />
            {form.formState.errors.menuUrl ? (
              <p className="text-xs text-red-600">{form.formState.errors.menuUrl.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-brand-teal">Book parking URL</label>
            <input
              className="w-full rounded-xl border border-brand-teal/30 bg-white px-3 py-2 text-sm text-brand-teal shadow-sm focus:border-brand-teal focus:outline-none"
              placeholder="https://"
              {...form.register("parkingUrl")}
            />
            {form.formState.errors.parkingUrl ? (
              <p className="text-xs text-red-600">{form.formState.errors.parkingUrl.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-brand-teal">Facebook URL</label>
            <input
              className="w-full rounded-xl border border-brand-teal/30 bg-white px-3 py-2 text-sm text-brand-teal shadow-sm focus:border-brand-teal focus:outline-none"
              placeholder="https://facebook.com/"
              {...form.register("facebookUrl")}
            />
            {form.formState.errors.facebookUrl ? (
              <p className="text-xs text-red-600">{form.formState.errors.facebookUrl.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-brand-teal">Instagram URL</label>
            <input
              className="w-full rounded-xl border border-brand-teal/30 bg-white px-3 py-2 text-sm text-brand-teal shadow-sm focus:border-brand-teal focus:outline-none"
              placeholder="https://instagram.com/"
              {...form.register("instagramUrl")}
            />
            {form.formState.errors.instagramUrl ? (
              <p className="text-xs text-red-600">{form.formState.errors.instagramUrl.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-brand-teal">Website URL</label>
            <input
              className="w-full rounded-xl border border-brand-teal/30 bg-white px-3 py-2 text-sm text-brand-teal shadow-sm focus:border-brand-teal focus:outline-none"
              placeholder="https://www.the-anchor.pub"
              {...form.register("websiteUrl")}
            />
            {form.formState.errors.websiteUrl ? (
              <p className="text-xs text-red-600">{form.formState.errors.websiteUrl.message}</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex justify-end border-t border-brand-teal/20 pt-4">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-full bg-brand-teal px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-teal/90 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isPending ? "Saving…" : "Save profile"}
        </button>
      </div>
    </form>
  );
}
