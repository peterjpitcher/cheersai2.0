import Image from "next/image";

import { BannerOverlay } from "@/features/planner/banner-overlay";
import type { PublicLinkInBioPageData } from "@/lib/link-in-bio/types";
import { getTemplateComponent } from "./templates";
import { LinkInBioRefreshTimer } from "./link-in-bio-refresh-timer";

function normalisePhone(value: string) {
  return value.replace(/[^0-9+]/g, "");
}

function buildWhatsappUrl(raw: string) {
  const digits = raw.replace(/[^0-9]/g, "");
  return digits.length ? `https://wa.me/${digits}` : null;
}

const CTA_ORDER: Array<{
  key: keyof PublicLinkInBioPageData["profile"] | "phone" | "whatsapp";
  label: string;
  renderHref: (profile: PublicLinkInBioPageData["profile"]) => string | null;
}> = [
  {
    key: "phone",
    label: "Call us",
    renderHref: (profile) => {
      if (!profile.phoneNumber) return null;
      const phone = normalisePhone(profile.phoneNumber);
      return phone.length ? `tel:${phone}` : null;
    },
  },
  {
    key: "directionsUrl",
    label: "Find us",
    renderHref: (profile) => profile.directionsUrl ?? null,
  },
  {
    key: "whatsapp",
    label: "WhatsApp us",
    renderHref: (profile) => {
      if (!profile.whatsappNumber) return null;
      return buildWhatsappUrl(profile.whatsappNumber);
    },
  },
  {
    key: "bookingUrl",
    label: "Book a table",
    renderHref: (profile) => profile.bookingUrl ?? null,
  },
  {
    key: "menuUrl",
    label: "See our menu",
    renderHref: (profile) => profile.menuUrl ?? null,
  },
  {
    key: "parkingUrl",
    label: "Book parking",
    renderHref: (profile) => profile.parkingUrl ?? null,
  },
  {
    key: "facebookUrl",
    label: "Facebook",
    renderHref: (profile) => profile.facebookUrl ?? null,
  },
  {
    key: "instagramUrl",
    label: "Instagram",
    renderHref: (profile) => profile.instagramUrl ?? null,
  },
  {
    key: "websiteUrl",
    label: "Visit website",
    renderHref: (profile) => profile.websiteUrl ?? null,
  },
];

const SOCIAL_KEYS = new Set<keyof PublicLinkInBioPageData["profile"] | "phone" | "whatsapp">([
  "facebookUrl",
  "instagramUrl",
  "websiteUrl",
]);

function getMediaDimensions(shape: "square" | "story" | null | undefined) {
  if (shape === "story") {
    return { width: 720, height: 1280 };
  }
  return { width: 1200, height: 900 };
}

export function LinkInBioPublicPage({ data }: { data: PublicLinkInBioPageData }) {
  const primaryColor = typeof data.profile.theme?.primaryColor === "string" && data.profile.theme.primaryColor.length
    ? (data.profile.theme.primaryColor as string)
    : "#005131";
  const secondaryColor = typeof data.profile.theme?.secondaryColor === "string" && data.profile.theme.secondaryColor.length
    ? (data.profile.theme.secondaryColor as string)
    : "#a57626";

  const ctas = CTA_ORDER.map((entry) => {
    const href = entry.renderHref(data.profile);
    if (!href) return null;
    return { key: entry.key, label: entry.label, href };
  }).filter(Boolean) as Array<{ key: typeof CTA_ORDER[number]["key"]; label: string; href: string }>;

  const primaryCtas = ctas.filter((cta) => !SOCIAL_KEYS.has(cta.key));
  const socialCtas = ctas.filter((cta) => SOCIAL_KEYS.has(cta.key));

  // CTA buttons section (shared across all templates)
  const ctaButtons = primaryCtas.length ? (
    <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
      {primaryCtas.map((cta) => (
        <a
          key={cta.label}
          href={cta.href}
          target="_blank"
          rel="noreferrer"
          className="rounded-full px-6 py-3 text-sm font-semibold shadow-lg transition hover:translate-y-[-1px]"
          style={{ backgroundColor: secondaryColor }}
        >
          {cta.label}
        </a>
      ))}
    </div>
  ) : null;

  // Campaigns section (shared across all templates)
  const campaignsSection = (
    <section className="w-full space-y-4">
      <div className="flex items-center justify-between text-left">
        <h2 className="text-xl font-semibold">Campaigns</h2>
        <span className="text-xs font-medium uppercase tracking-wide text-white/60">Upcoming first</span>
      </div>
      {data.campaigns.length ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.campaigns.map((campaign) => {
            const campaignDims = getMediaDimensions(campaign.media?.shape);
            const resolvedConfig = campaign.bannerConfig ?? null;
            const hasBannerSignal = Boolean(
              resolvedConfig
              && (
                campaign.bannerLabel
                || (resolvedConfig.textOverride && resolvedConfig.textOverride.length > 0)
              ),
            );
            const body = (
              <>
                <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-2">
                  {campaign.media ? (
                    resolvedConfig && hasBannerSignal ? (
                      <BannerOverlay
                        mediaUrl={campaign.media.url}
                        config={resolvedConfig}
                        label={campaign.bannerLabel ?? null}
                        className="mx-auto h-auto w-full rounded-xl"
                      />
                    ) : (
                      <Image
                        src={campaign.media.url}
                        alt={campaign.name}
                        width={campaignDims.width}
                        height={campaignDims.height}
                        className="mx-auto h-auto w-full rounded-xl object-contain"
                        unoptimized
                        sizes="(min-width: 1024px) 320px, 100vw"
                      />
                    )
                  ) : (
                    <div className="flex min-h-[160px] items-center justify-center rounded-2xl bg-white/10 text-base font-semibold text-white/70">
                      {campaign.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="mt-3 text-left">
                  <p className="text-base font-semibold text-white">{campaign.name}</p>
                </div>
              </>
            );

            if (campaign.linkUrl) {
              return (
                <a
                  key={campaign.id}
                  href={campaign.linkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex flex-col"
                >
                  {body}
                </a>
              );
            }

            return (
              <div
                key={campaign.id}
                className="flex flex-col"
              >
                {body}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
          No live campaigns right now. Check back soon.
        </p>
      )}
    </section>
  );

  // Social links section (shared across all templates)
  const socialLinks = socialCtas.length ? (
    <section className="w-full space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {socialCtas.map((cta) => (
          <a
            key={cta.label}
            href={cta.href}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-white/30 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/60"
          >
            {cta.label}
          </a>
        ))}
      </div>
    </section>
  ) : null;

  // Select template component based on profile.template
  const TemplateComponent = getTemplateComponent(data.profile.template);

  return (
    <div
      className="min-h-screen px-6 pb-16 pt-12"
      style={{ backgroundColor: primaryColor }}
    >
      <TemplateComponent
        profile={data.profile}
        tiles={data.tiles}
        campaigns={data.campaigns}
        heroMedia={data.heroMedia ?? null}
        slug={data.profile.slug}
        ctaButtons={ctaButtons}
        campaignsSection={campaignsSection}
        socialLinks={socialLinks}
      />
      <LinkInBioRefreshTimer />
    </div>
  );
}
