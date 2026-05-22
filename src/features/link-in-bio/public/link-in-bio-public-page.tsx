import {
  MediaFrame,
  MediaFrameImage,
  MediaFrameVideo,
  resolveMediaPlacement,
} from "@/components/media/media-frame";
import { BannerOverlay } from "@/features/planner/banner-overlay";
import type { PublicLinkInBioPageData } from "@/lib/link-in-bio/types";
import { renderTemplate } from "./templates";
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
          className="text-center text-sm font-semibold text-white transition hover:translate-y-[-1px]"
          style={{
            backgroundColor: secondaryColor,
            borderRadius: "var(--r-xl)",
            padding: "12px 24px",
            boxShadow: "var(--sh-sm)",
          }}
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
        <span className="text-xs font-medium uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.6)" }}>Upcoming first</span>
      </div>
      {data.campaigns.length ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.campaigns.map((campaign) => {
            const campaignPlacement = resolveMediaPlacement({ placement: campaign.media?.shape });
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
                <div
                  className="relative overflow-hidden p-2"
                  style={{
                    borderRadius: "var(--r-2xl)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    backgroundColor: "rgba(255,255,255,0.05)",
                  }}
                >
                  {campaign.media ? (
                    campaign.media.mediaType === "image" && resolvedConfig && hasBannerSignal ? (
                      <MediaFrame
                        placement={campaignPlacement}
                        size="preview"
                        className="border-white/10 bg-white/5"
                      >
                        <BannerOverlay
                          mediaUrl={campaign.media.url}
                          config={resolvedConfig}
                          label={campaign.bannerLabel ?? null}
                          className="h-full w-full"
                        />
                      </MediaFrame>
                    ) : campaign.media.mediaType === "video" ? (
                      <MediaFrameVideo
                        src={campaign.media.url}
                        placement={campaignPlacement}
                        size="preview"
                        className="border-white/10 bg-white/5"
                      />
                    ) : (
                      <MediaFrameImage
                        src={campaign.media.url}
                        alt={campaign.name}
                        placement={campaignPlacement}
                        size="preview"
                        className="border-white/10 bg-white/5"
                        unoptimized
                        sizes="(min-width: 1024px) 320px, 100vw"
                      />
                    )
                  ) : (
                    <div
                      className="flex min-h-[160px] items-center justify-center text-base font-semibold"
                      style={{
                        borderRadius: "var(--r-2xl)",
                        backgroundColor: "rgba(255,255,255,0.1)",
                        color: "rgba(255,255,255,0.7)",
                      }}
                    >
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
        <p
          className="p-4 text-sm"
          style={{
            borderRadius: "var(--r-2xl)",
            border: "1px solid rgba(255,255,255,0.1)",
            backgroundColor: "rgba(255,255,255,0.05)",
            color: "rgba(255,255,255,0.7)",
          }}
        >
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
            className="text-center text-sm font-semibold text-white transition"
            style={{
              border: "1px solid rgba(255,255,255,0.3)",
              borderRadius: "var(--r-xl)",
              padding: "12px 24px",
            }}
          >
            {cta.label}
          </a>
        ))}
      </div>
    </section>
  ) : null;

  // Select template component based on profile.template
  const templateContent = renderTemplate(data.profile.template, {
    profile: data.profile,
    tiles: data.tiles,
    campaigns: data.campaigns,
    logoMedia: data.logoMedia ?? null,
    heroMedia: data.heroMedia ?? null,
    slug: data.profile.slug,
    ctaButtons,
    campaignsSection,
    socialLinks,
  });

  return (
    <div
      className="min-h-screen px-6 pb-16 pt-12"
      style={{ backgroundColor: primaryColor }}
    >
      {templateContent}
      <footer className="mt-12 text-center" style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", paddingBottom: "16px" }}>
        Powered by CheersAI
      </footer>
      <LinkInBioRefreshTimer />
    </div>
  );
}
