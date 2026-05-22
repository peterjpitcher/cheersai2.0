"use client";

import Image from "next/image";
import { useMemo, useState, useTransition } from "react";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "@/components/providers/auth-provider";
import type { MediaAssetSummary } from "@/lib/library/data";
import type { LinkInBioProfile } from "@/lib/link-in-bio/types";
import { updateLinkInBioProfileSettings } from "@/app/(app)/settings/actions";
import { LINK_IN_BIO_MEDIA_TAG } from "@/lib/library/system-tags";
import {
  LinkInBioProfileFormValues,
  linkInBioProfileFormSchema,
} from "@/features/settings/schema";
import { Button } from "@/components/ui/button";
import { MediaFrameImage, resolveMediaPlacement } from "@/components/media/media-frame";
import { MediaUploadPanel } from "@/features/library/media-upload-panel";

const DEFAULT_PRIMARY = "#005131";
const DEFAULT_SECONDARY = "#a57626";

interface LinkInBioProfileFormProps {
  profile: LinkInBioProfile | null;
  mediaAssets: MediaAssetSummary[];
}

/* Shared style objects for design tokens */
const inputStyle: React.CSSProperties = {
  backgroundColor: "var(--c-card)",
  border: "1px solid var(--c-line)",
  borderRadius: "var(--r-xl)",
  color: "var(--c-ink)",
  boxShadow: "var(--sh-xs)",
};

const colorInputStyle: React.CSSProperties = {
  backgroundColor: "var(--c-card)",
  border: "1px solid var(--c-line)",
  borderRadius: "var(--r-xl)",
};

export function LinkInBioProfileForm({ profile, mediaAssets }: LinkInBioProfileFormProps) {
  const user = useAuth();
  const [isPending, startTransition] = useTransition();
  const [uploadedAssets, setUploadedAssets] = useState<MediaAssetSummary[]>([]);

  const form = useForm<LinkInBioProfileFormValues>({
    resolver: zodResolver(linkInBioProfileFormSchema) as Resolver<LinkInBioProfileFormValues>,
    defaultValues: {
      slug: profile?.slug ?? "the-anchor",
      displayName: profile?.displayName ?? undefined,
      bio: profile?.bio ?? undefined,
      logoUrl: profile?.logoUrl ?? undefined,
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

  const imageAssets = useMemo(
    () => [...uploadedAssets, ...mediaAssets]
      .filter((asset) => asset.mediaType === "image")
      .filter((asset, index, assets) => assets.findIndex((item) => item.id === asset.id) === index),
    [mediaAssets, uploadedAssets],
  );
  const selectedLogoRef = useWatch({ control: form.control, name: "logoUrl" });
  const selectedHeroId = useWatch({ control: form.control, name: "heroMediaId" });
  const selectedLogo = useMemo(
    () => imageAssets.find((asset) => asset.storagePath === selectedLogoRef),
    [imageAssets, selectedLogoRef],
  );
  const logoPreviewUrl = selectedLogo?.previewUrl
    ?? (typeof selectedLogoRef === "string" && /^https?:\/\//i.test(selectedLogoRef) ? selectedLogoRef : undefined);
  const selectedHero = useMemo(
    () => imageAssets.find((asset) => asset.id === selectedHeroId),
    [imageAssets, selectedHeroId],
  );

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      await updateLinkInBioProfileSettings(values);
    });
  });

  const handleLogoUpload = (asset: MediaAssetSummary) => {
    if (asset.mediaType !== "image") return;
    setUploadedAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
    form.setValue("logoUrl", asset.storagePath, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
  };

  const handleHeroUpload = (asset: MediaAssetSummary) => {
    if (asset.mediaType !== "image") return;
    setUploadedAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
    form.setValue("heroMediaId", asset.id, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
  };

  const clearLogo = () => {
    form.setValue("logoUrl", undefined, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
  };

  const clearHero = () => {
    form.setValue("heroMediaId", undefined, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>Slug</label>
          <p className="text-xs" style={{ color: "var(--c-ink-3)" }}>Used in the public URL: https://www.cheersai.uk/l/&lt;slug&gt;.</p>
          <input
            className="w-full px-3 py-2 text-sm focus:outline-none"
            style={inputStyle}
            placeholder="the-anchor"
            {...form.register("slug")}
          />
          {form.formState.errors.slug ? (
            <p className="text-xs" style={{ color: "var(--c-claret)" }}>{form.formState.errors.slug.message}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>Display name</label>
          <input
            className="w-full px-3 py-2 text-sm focus:outline-none"
            style={inputStyle}
            placeholder="The Anchor"
            {...form.register("displayName")}
          />
        </div>
        <div className="lg:col-span-2 space-y-2">
          <label className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>Bio</label>
          <textarea
            rows={3}
            className="w-full px-3 py-2 text-sm focus:outline-none"
            style={inputStyle}
            placeholder="Historic riverside pub serving the best Sunday roasts in Cambridge."
            {...form.register("bio")}
          />
          {form.formState.errors.bio ? (
            <p className="text-xs" style={{ color: "var(--c-claret)" }}>{form.formState.errors.bio.message}</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_2.4fr]">
        <div className="space-y-6">
          <div className="space-y-3">
            <input type="hidden" {...form.register("logoUrl")} />
            <div className="flex items-center justify-between gap-3">
              <div>
                <label className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>Logo</label>
                <p className="text-xs" style={{ color: "var(--c-ink-3)" }}>
                  Upload a logo for this page. It will not appear in the regular Library.
                </p>
              </div>
              {logoPreviewUrl ? (
                <Button type="button" size="sm" variant="outline" onClick={clearLogo}>
                  Remove
                </Button>
              ) : null}
            </div>
            {logoPreviewUrl ? (
              <div
                className="flex min-h-28 items-center justify-center p-4"
                style={{
                  backgroundColor: "var(--c-paper)",
                  border: "1px solid var(--c-line)",
                  borderRadius: "var(--r-xl)",
                }}
              >
                <Image
                  src={logoPreviewUrl}
                  alt={selectedLogo?.fileName ?? "Logo preview"}
                  width={240}
                  height={120}
                  className="max-h-24 w-auto max-w-full object-contain"
                  sizes="240px"
                  unoptimized
                />
              </div>
            ) : (
              <p className="text-xs" style={{ color: "var(--c-ink-3)" }}>Upload a logo to use in place of the venue name.</p>
            )}
            <MediaUploadPanel
              accountId={user?.accountId ?? ""}
              onUploadComplete={handleLogoUpload}
              showLibraryTab={false}
              showUrlTab={false}
              uploadTags={[LINK_IN_BIO_MEDIA_TAG]}
            />
            {form.formState.errors.logoUrl ? (
              <p className="text-xs" style={{ color: "var(--c-claret)" }}>{form.formState.errors.logoUrl.message}</p>
            ) : null}
          </div>
          <div className="space-y-3">
            <input type="hidden" {...form.register("heroMediaId")} />
            <div className="flex items-center justify-between gap-3">
              <div>
                <label className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>Hero image</label>
                <p className="text-xs" style={{ color: "var(--c-ink-3)" }}>
                  Upload a hero image for the top of the page. It will not appear in the regular Library.
                </p>
              </div>
              {selectedHero ? (
                <Button type="button" size="sm" variant="outline" onClick={clearHero}>
                  Remove
                </Button>
              ) : null}
            </div>
            {selectedHero ? (
              <div
                className="overflow-hidden p-3"
                style={{
                  backgroundColor: "var(--c-paper)",
                  border: "1px solid var(--c-line)",
                  borderRadius: "var(--r-xl)",
                }}
              >
                {selectedHero.previewUrl ? (
                  <MediaFrameImage
                    src={selectedHero.previewUrl}
                    alt={selectedHero.fileName ?? "Hero image preview"}
                    placement={resolveMediaPlacement({ placement: selectedHero.previewShape })}
                    size="preview"
                    className="border-[var(--c-line)] bg-[var(--c-card)]"
                    sizes="(min-width: 1024px) 360px, 100vw"
                    unoptimized
                  />
                ) : (
                  <div
                    className="flex h-40 items-center justify-center text-sm"
                    style={{
                      backgroundColor: "var(--c-paper-2)",
                      borderRadius: "var(--r-lg)",
                      color: "var(--c-ink-3)",
                    }}
                  >
                    Preview unavailable
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs" style={{ color: "var(--c-ink-3)" }}>Upload an image to feature at the top of your link-in-bio page.</p>
            )}
            <MediaUploadPanel
              accountId={user?.accountId ?? ""}
              onUploadComplete={handleHeroUpload}
              showLibraryTab={false}
              showUrlTab={false}
              uploadTags={[LINK_IN_BIO_MEDIA_TAG]}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>Primary colour</label>
            <input
              type="color"
              className="h-12 w-full cursor-pointer"
              style={colorInputStyle}
              {...form.register("theme.primaryColor")}
            />
            <p className="text-xs" style={{ color: "var(--c-ink-3)" }}>Main background (defaults to #005131).</p>
            {form.formState.errors.theme?.primaryColor ? (
              <p className="text-xs" style={{ color: "var(--c-claret)" }}>{form.formState.errors.theme.primaryColor.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>Secondary colour</label>
            <input
              type="color"
              className="h-12 w-full cursor-pointer"
              style={colorInputStyle}
              {...form.register("theme.secondaryColor")}
            />
            <p className="text-xs" style={{ color: "var(--c-ink-3)" }}>CTA accent (defaults to #a57626).</p>
            {form.formState.errors.theme?.secondaryColor ? (
              <p className="text-xs" style={{ color: "var(--c-claret)" }}>{form.formState.errors.theme.secondaryColor.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>Phone (Call us)</label>
            <input
              className="w-full px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
              placeholder="01223 123456"
              {...form.register("phoneNumber")}
            />
            {form.formState.errors.phoneNumber ? (
              <p className="text-xs" style={{ color: "var(--c-claret)" }}>{form.formState.errors.phoneNumber.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>WhatsApp</label>
            <input
              className="w-full px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
              placeholder="+44 7712 345678"
              {...form.register("whatsappNumber")}
            />
            {form.formState.errors.whatsappNumber ? (
              <p className="text-xs" style={{ color: "var(--c-claret)" }}>{form.formState.errors.whatsappNumber.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>Book a table URL</label>
            <input
              className="w-full px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
              placeholder="https://"
              {...form.register("bookingUrl")}
            />
            {form.formState.errors.bookingUrl ? (
              <p className="text-xs" style={{ color: "var(--c-claret)" }}>{form.formState.errors.bookingUrl.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>Menu URL</label>
            <input
              className="w-full px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
              placeholder="https://"
              {...form.register("menuUrl")}
            />
            {form.formState.errors.menuUrl ? (
              <p className="text-xs" style={{ color: "var(--c-claret)" }}>{form.formState.errors.menuUrl.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>Book parking URL</label>
            <input
              className="w-full px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
              placeholder="https://"
              {...form.register("parkingUrl")}
            />
            {form.formState.errors.parkingUrl ? (
              <p className="text-xs" style={{ color: "var(--c-claret)" }}>{form.formState.errors.parkingUrl.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>Find us URL</label>
            <p className="text-xs" style={{ color: "var(--c-ink-3)" }}>Paste a Google Maps directions link so guests can navigate straight to you.</p>
            <input
              className="w-full px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
              placeholder="https://maps.google.com/?q=The+Anchor"
              {...form.register("directionsUrl")}
            />
            {form.formState.errors.directionsUrl ? (
              <p className="text-xs" style={{ color: "var(--c-claret)" }}>{form.formState.errors.directionsUrl.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>Facebook URL</label>
            <input
              className="w-full px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
              placeholder="https://facebook.com/"
              {...form.register("facebookUrl")}
            />
            {form.formState.errors.facebookUrl ? (
              <p className="text-xs" style={{ color: "var(--c-claret)" }}>{form.formState.errors.facebookUrl.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>Instagram URL</label>
            <input
              className="w-full px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
              placeholder="https://instagram.com/"
              {...form.register("instagramUrl")}
            />
            {form.formState.errors.instagramUrl ? (
              <p className="text-xs" style={{ color: "var(--c-claret)" }}>{form.formState.errors.instagramUrl.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>Website URL</label>
            <input
              className="w-full px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
              placeholder="https://www.the-anchor.pub"
              {...form.register("websiteUrl")}
            />
            {form.formState.errors.websiteUrl ? (
              <p className="text-xs" style={{ color: "var(--c-claret)" }}>{form.formState.errors.websiteUrl.message}</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-4" style={{ borderTop: "1px solid var(--c-line)" }}>
        <Button type="submit" disabled={isPending} size="sm">
          {isPending ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}
