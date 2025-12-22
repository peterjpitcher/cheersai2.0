"use client";

import Image from "next/image";
import { useMemo, useTransition } from "react";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import type { MediaAssetSummary } from "@/lib/library/data";
import type { LinkInBioProfile } from "@/lib/link-in-bio/types";
import { updateLinkInBioProfileSettings } from "@/app/(app)/settings/actions";
import {
  LinkInBioProfileFormValues,
  linkInBioProfileFormSchema,
} from "@/features/settings/schema";
import { Button } from "@/components/ui/button";

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
      directionsUrl: profile?.directionsUrl ?? undefined,
      facebookUrl: profile?.facebookUrl ?? undefined,
      instagramUrl: profile?.instagramUrl ?? undefined,
      websiteUrl: profile?.websiteUrl ?? undefined,
    },
  });

  const selectedHeroId = useWatch({ control: form.control, name: "heroMediaId" });
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
          <label className="text-sm font-semibold text-foreground">Slug</label>
          <p className="text-xs text-muted-foreground">Used in the public URL: https://www.cheersai.uk/l/&lt;slug&gt;.</p>
          <input
            className="w-full rounded-xl border border-white/40 bg-white px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none dark:border-slate-800/70 dark:bg-slate-900/60"
            placeholder="the-anchor"
            {...form.register("slug")}
          />
          {form.formState.errors.slug ? (
            <p className="text-xs text-red-600">{form.formState.errors.slug.message}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-semibold text-foreground">Display name</label>
          <input
            className="w-full rounded-xl border border-white/40 bg-white px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none dark:border-slate-800/70 dark:bg-slate-900/60"
            placeholder="The Anchor"
            {...form.register("displayName")}
          />
        </div>
        <div className="lg:col-span-2 space-y-2">
          <label className="text-sm font-semibold text-foreground">Bio</label>
          <textarea
            rows={3}
            className="w-full rounded-xl border border-white/40 bg-white px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none dark:border-slate-800/70 dark:bg-slate-900/60"
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
          <label className="text-sm font-semibold text-foreground">Hero image</label>
          <select
            className="w-full rounded-xl border border-white/40 bg-white px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none dark:border-slate-800/70 dark:bg-slate-900/60"
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
            <div className="overflow-hidden rounded-xl border border-white/30 bg-white/70 p-3 backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-900/70">
              {selectedHero.previewUrl ? (
                <div className="flex max-h-52 w-full items-center justify-center overflow-hidden rounded-lg bg-white">
                  <Image
                    src={selectedHero.previewUrl}
                    alt={selectedHero.fileName ?? "Hero image preview"}
                    width={360}
                    height={360}
                    className="h-auto w-full object-contain"
                    sizes="(min-width: 1024px) 360px, 100vw"
                  />
                </div>
              ) : (
                <div className="flex h-40 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
                  Preview unavailable
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Select a library asset to feature at the top of your link-in-bio page.</p>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">Primary colour</label>
            <input
              type="color"
              className="h-12 w-full cursor-pointer rounded-xl border border-white/40 bg-white dark:border-slate-800/70 dark:bg-slate-900/60"
              {...form.register("theme.primaryColor")}
            />
            <p className="text-xs text-muted-foreground">Main background (defaults to #005131).</p>
            {form.formState.errors.theme?.primaryColor ? (
              <p className="text-xs text-red-600">{form.formState.errors.theme.primaryColor.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">Secondary colour</label>
            <input
              type="color"
              className="h-12 w-full cursor-pointer rounded-xl border border-white/40 bg-white dark:border-slate-800/70 dark:bg-slate-900/60"
              {...form.register("theme.secondaryColor")}
            />
            <p className="text-xs text-muted-foreground">CTA accent (defaults to #a57626).</p>
            {form.formState.errors.theme?.secondaryColor ? (
              <p className="text-xs text-red-600">{form.formState.errors.theme.secondaryColor.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">Phone (Call us)</label>
            <input
              className="w-full rounded-xl border border-white/40 bg-white px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none dark:border-slate-800/70 dark:bg-slate-900/60"
              placeholder="01223 123456"
              {...form.register("phoneNumber")}
            />
            {form.formState.errors.phoneNumber ? (
              <p className="text-xs text-red-600">{form.formState.errors.phoneNumber.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">WhatsApp</label>
            <input
              className="w-full rounded-xl border border-white/40 bg-white px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none dark:border-slate-800/70 dark:bg-slate-900/60"
              placeholder="+44 7712 345678"
              {...form.register("whatsappNumber")}
            />
            {form.formState.errors.whatsappNumber ? (
              <p className="text-xs text-red-600">{form.formState.errors.whatsappNumber.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">Book a table URL</label>
            <input
              className="w-full rounded-xl border border-white/40 bg-white px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none dark:border-slate-800/70 dark:bg-slate-900/60"
              placeholder="https://"
              {...form.register("bookingUrl")}
            />
            {form.formState.errors.bookingUrl ? (
              <p className="text-xs text-red-600">{form.formState.errors.bookingUrl.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">Menu URL</label>
            <input
              className="w-full rounded-xl border border-white/40 bg-white px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none dark:border-slate-800/70 dark:bg-slate-900/60"
              placeholder="https://"
              {...form.register("menuUrl")}
            />
            {form.formState.errors.menuUrl ? (
              <p className="text-xs text-red-600">{form.formState.errors.menuUrl.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">Book parking URL</label>
            <input
              className="w-full rounded-xl border border-white/40 bg-white px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none dark:border-slate-800/70 dark:bg-slate-900/60"
              placeholder="https://"
              {...form.register("parkingUrl")}
            />
            {form.formState.errors.parkingUrl ? (
              <p className="text-xs text-red-600">{form.formState.errors.parkingUrl.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">Find us URL</label>
            <p className="text-xs text-muted-foreground">Paste a Google Maps directions link so guests can navigate straight to you.</p>
            <input
              className="w-full rounded-xl border border-white/40 bg-white px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none dark:border-slate-800/70 dark:bg-slate-900/60"
              placeholder="https://maps.google.com/?q=The+Anchor"
              {...form.register("directionsUrl")}
            />
            {form.formState.errors.directionsUrl ? (
              <p className="text-xs text-red-600">{form.formState.errors.directionsUrl.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">Facebook URL</label>
            <input
              className="w-full rounded-xl border border-white/40 bg-white px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none dark:border-slate-800/70 dark:bg-slate-900/60"
              placeholder="https://facebook.com/"
              {...form.register("facebookUrl")}
            />
            {form.formState.errors.facebookUrl ? (
              <p className="text-xs text-red-600">{form.formState.errors.facebookUrl.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">Instagram URL</label>
            <input
              className="w-full rounded-xl border border-white/40 bg-white px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none dark:border-slate-800/70 dark:bg-slate-900/60"
              placeholder="https://instagram.com/"
              {...form.register("instagramUrl")}
            />
            {form.formState.errors.instagramUrl ? (
              <p className="text-xs text-red-600">{form.formState.errors.instagramUrl.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">Website URL</label>
            <input
              className="w-full rounded-xl border border-white/40 bg-white px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none dark:border-slate-800/70 dark:bg-slate-900/60"
              placeholder="https://www.the-anchor.pub"
              {...form.register("websiteUrl")}
            />
            {form.formState.errors.websiteUrl ? (
              <p className="text-xs text-red-600">{form.formState.errors.websiteUrl.message}</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex justify-end border-t border-white/30 pt-4 dark:border-slate-800/70">
        <Button type="submit" disabled={isPending} size="sm">
          {isPending ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}
