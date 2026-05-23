import Image from "next/image";
import {
  ArrowUpRight,
  CalendarCheck2,
  CalendarDays,
  Car,
  Facebook,
  Globe2,
  ImageIcon,
  Instagram,
  MapPin,
  Menu,
  MessageCircle,
  Phone,
  Tag,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import { DateTime } from "luxon";

import {
  MediaFrame,
  MediaFrameImage,
  MediaFrameVideo,
  resolveMediaPlacement,
} from "@/components/media/media-frame";
import { BannerOverlay } from "@/features/planner/banner-overlay";
import type {
  PublicCampaignCard,
  PublicLinkInBioPageData,
  PublicLinkInBioTile,
  PublicWebsiteEvent,
  QuickActionLayout,
} from "@/lib/link-in-bio/types";
import { cn } from "@/lib/utils";
import { renderTemplate } from "./templates";
import { LinkInBioRefreshTimer } from "./link-in-bio-refresh-timer";
import { ClickTracker } from "./click-tracker";

function normalisePhone(value: string) {
  return value.replace(/[^0-9+]/g, "");
}

function buildWhatsappUrl(raw: string) {
  const digits = raw.replace(/[^0-9]/g, "");
  return digits.length ? `https://wa.me/${digits}` : null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

const CTA_ORDER: Array<{
  key: keyof PublicLinkInBioPageData["profile"] | "phone" | "whatsapp";
  label: string;
  icon: LucideIcon;
  renderHref: (profile: PublicLinkInBioPageData["profile"]) => string | null;
}> = [
  {
    key: "phone",
    label: "Call us",
    icon: Phone,
    renderHref: (profile) => {
      if (!profile.phoneNumber) return null;
      const phone = normalisePhone(profile.phoneNumber);
      return phone.length ? `tel:${phone}` : null;
    },
  },
  {
    key: "directionsUrl",
    label: "Find us",
    icon: MapPin,
    renderHref: (profile) => profile.directionsUrl ?? null,
  },
  {
    key: "whatsapp",
    label: "WhatsApp us",
    icon: MessageCircle,
    renderHref: (profile) => {
      if (!profile.whatsappNumber) return null;
      return buildWhatsappUrl(profile.whatsappNumber);
    },
  },
  {
    key: "bookingUrl",
    label: "Book a table",
    icon: CalendarCheck2,
    renderHref: (profile) => profile.bookingUrl ?? null,
  },
  {
    key: "menuUrl",
    label: "See our menu",
    icon: Utensils,
    renderHref: (profile) => profile.menuUrl ?? null,
  },
  {
    key: "parkingUrl",
    label: "Book parking",
    icon: Car,
    renderHref: (profile) => profile.parkingUrl ?? null,
  },
  {
    key: "facebookUrl",
    label: "Facebook",
    icon: Facebook,
    renderHref: (profile) => profile.facebookUrl ?? null,
  },
  {
    key: "instagramUrl",
    label: "Instagram",
    icon: Instagram,
    renderHref: (profile) => profile.instagramUrl ?? null,
  },
  {
    key: "websiteUrl",
    label: "Website",
    icon: Globe2,
    renderHref: (profile) => profile.websiteUrl ?? null,
  },
];

const SOCIAL_KEYS = new Set<keyof PublicLinkInBioPageData["profile"] | "phone" | "whatsapp">([
  "facebookUrl",
  "instagramUrl",
  "websiteUrl",
]);

function resolveFontFamily(fontFamily: PublicLinkInBioPageData["profile"]["fontFamily"]) {
  switch (fontFamily) {
    case "playfair":
      return "Georgia, 'Times New Roman', serif";
    case "dm-serif":
      return "'Times New Roman', Georgia, serif";
    case "space-grotesk":
      return "'Space Grotesk', var(--font-sans)";
    case "inter":
    default:
      return "var(--font-sans)";
  }
}

function resolveQuickActionLayout(value: unknown): QuickActionLayout {
  return value === "single" ? "single" : "double";
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = DateTime.fromISO(value).setLocale("en-GB");
  return parsed.isValid ? parsed : null;
}

function formatTime(value: DateTime) {
  if (value.hour === 0 && value.minute === 0) return null;
  return value.toFormat(value.minute === 0 ? "ha" : "h:mma").toLowerCase();
}

function formatCampaignTiming(campaign: PublicCampaignCard) {
  const start = parseDate(campaign.displayStartsAt) ?? parseDate(campaign.scheduledFor);
  const end = parseDate(campaign.displayEndsAt) ?? parseDate(campaign.endAt);

  if (campaign.campaignType === "promotion" && end) {
    return `Ends ${end.toFormat("ccc d LLL")}`;
  }

  if (campaign.campaignType === "weekly" && start) {
    const time = formatTime(start);
    return time ? `${start.toFormat("cccc")} at ${time}` : start.toFormat("cccc");
  }

  if (start) {
    const time = formatTime(start);
    return time ? `${start.toFormat("ccc d LLL")} at ${time}` : start.toFormat("ccc d LLL");
  }

  return null;
}

function formatSlotLabel(value: string | null) {
  if (!value) return "Live now";
  if (/^(manual|plan|slot|day)-?\d*$/i.test(value.trim())) return "Live now";
  return value;
}

function campaignTypeLabel(type: string) {
  switch (type) {
    case "event":
      return "Event";
    case "promotion":
      return "Offer";
    case "weekly":
      return "Weekly";
    case "instant":
      return "Update";
    default:
      return "Campaign";
  }
}

function CampaignTypeIcon({ type, className }: { type: string; className: string }) {
  switch (type) {
    case "promotion":
      return <Tag className={className} aria-hidden="true" />;
    case "weekly":
      return <CalendarCheck2 className={className} aria-hidden="true" />;
    case "instant":
      return <ImageIcon className={className} aria-hidden="true" />;
    case "event":
    default:
      return <CalendarDays className={className} aria-hidden="true" />;
  }
}

function CampaignMedia({ campaign }: { campaign: PublicCampaignCard }) {
  const campaignPlacement = resolveMediaPlacement({ placement: campaign.media?.shape });
  const resolvedConfig = campaign.bannerConfig ?? null;
  const hasBannerSignal = Boolean(
    resolvedConfig
    && (
      campaign.bannerLabel
      || (resolvedConfig.textOverride && resolvedConfig.textOverride.length > 0)
    ),
  );

  if (!campaign.media) {
    return (
      <div className="flex aspect-square w-full items-center justify-center bg-black/20 text-[#d7b56d]">
        <CampaignTypeIcon type={campaign.campaignType} className="size-10" />
      </div>
    );
  }

  if (campaign.media.mediaType === "image" && resolvedConfig && hasBannerSignal) {
    return (
      <MediaFrame placement={campaignPlacement} size="fluid" className="rounded-none border-0 bg-black/20">
        <BannerOverlay
          mediaUrl={campaign.media.url}
          config={resolvedConfig}
          label={campaign.bannerLabel ?? null}
          className="h-full w-full"
        />
      </MediaFrame>
    );
  }

  if (campaign.media.mediaType === "video") {
    return (
      <MediaFrameVideo
        src={campaign.media.url}
        placement={campaignPlacement}
        size="fluid"
        className="rounded-none border-0 bg-black/20"
      />
    );
  }

  return (
    <MediaFrameImage
      src={campaign.media.url}
      alt={campaign.name}
      placement={campaignPlacement}
      size="fluid"
      className="rounded-none border-0 bg-black/20"
      unoptimized
      sizes="(min-width: 1024px) 360px, 100vw"
    />
  );
}

function CampaignCard({ campaign, secondaryColor }: { campaign: PublicCampaignCard; secondaryColor: string }) {
  const timing = formatCampaignTiming(campaign);
  const body = (
    <article className="h-full overflow-hidden rounded-[var(--r-lg)] border border-[#d7b56d]/25 bg-[#062f20]/85 text-[#fff7e8] shadow-[0_22px_48px_rgba(0,0,0,0.26)] backdrop-blur-sm transition duration-150 group-hover:-translate-y-0.5 group-hover:border-[#d7b56d]/45">
      <div className="relative bg-black/20">
        <CampaignMedia campaign={campaign} />
        <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-[var(--r-md)] border border-[#d7b56d]/35 bg-[#082719]/90 px-2.5 py-1 text-xs font-semibold text-[#fff7e8] shadow-[0_8px_20px_rgba(0,0,0,0.24)]">
          <CampaignTypeIcon type={campaign.campaignType} className="size-3.5" />
          {campaignTypeLabel(campaign.campaignType)}
        </div>
        {campaign.bannerLabel ? (
          <div className="absolute bottom-3 left-3 rounded-[var(--r-md)] bg-[#d7b56d] px-2.5 py-1 text-xs font-semibold text-[#173620] shadow-[0_8px_20px_rgba(0,0,0,0.24)]">
            {campaign.bannerLabel}
          </div>
        ) : null}
      </div>

      <div className="flex min-h-[174px] flex-col gap-3 p-4 text-left">
        <div className="space-y-2">
          {timing ? (
            <p className="inline-flex items-center gap-1.5 text-xs font-medium text-[#f2d994]/80">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              {timing}
            </p>
          ) : null}
          <h3 className="text-lg font-semibold leading-tight tracking-normal text-[#fff7e8]">
            {campaign.name}
          </h3>
          {campaign.summary ? (
            <p className="line-clamp-2 text-sm leading-5 text-[#f7ead0]/70">
              {campaign.summary}
            </p>
          ) : null}
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-[#d7b56d]/20 pt-3">
          <span className="shrink-0 text-xs font-medium text-[#f7ead0]/60">
            {formatSlotLabel(campaign.slotLabel)}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold" style={{ color: secondaryColor }}>
            {campaign.ctaLabel ?? "Learn more"}
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </span>
        </div>
      </div>
    </article>
  );

  if (!campaign.linkUrl) {
    return <div className="h-full">{body}</div>;
  }

  return (
    <a key={campaign.id} href={campaign.linkUrl} target="_blank" rel="noreferrer" className="group block h-full">
      {body}
    </a>
  );
}

function resolveTileHref(tile: PublicLinkInBioTile) {
  if (tile.ctaUrl.trim()) return tile.ctaUrl.trim();

  if (tile.tileType === "embed_map") {
    const query = readString(tile.embedData?.query) ?? tile.title;
    const placeId = readString(tile.embedData?.placeId);
    const params = new URLSearchParams({ api: "1", query });
    if (placeId) params.set("query_place_id", placeId);
    return `https://www.google.com/maps/search/?${params.toString()}`;
  }

  if (tile.tileType === "embed_menu") {
    return readString(tile.embedData?.pdfUrl);
  }

  if (tile.tileType === "embed_social") {
    return readString(tile.embedData?.postUrl);
  }

  return null;
}

function TileTypeIcon({ tile, className }: { tile: PublicLinkInBioTile; className: string }) {
  if (tile.tileType === "embed_map") return <MapPin className={className} aria-hidden="true" />;
  if (tile.tileType === "embed_menu") return <Menu className={className} aria-hidden="true" />;
  if (tile.tileType === "embed_events") return <CalendarDays className={className} aria-hidden="true" />;
  if (tile.tileType === "embed_social") {
    return tile.embedData?.platform === "facebook"
      ? <Facebook className={className} aria-hidden="true" />
      : <Instagram className={className} aria-hidden="true" />;
  }
  if (tile.tileType === "media") return <ImageIcon className={className} aria-hidden="true" />;
  return <ArrowUpRight className={className} aria-hidden="true" />;
}

function TileVisual({ tile, secondaryColor }: { tile: PublicLinkInBioTile; secondaryColor: string }) {
  if (tile.media?.url) {
    return (
      <div className="relative size-24 shrink-0 overflow-hidden rounded-[var(--r-lg)] bg-black/20 sm:size-28">
        <Image
          src={tile.media.url}
          alt=""
          fill
          sizes="(min-width: 640px) 112px, 96px"
          className="object-contain"
          unoptimized
        />
      </div>
    );
  }

  return (
    <span
      className="inline-flex size-24 shrink-0 items-center justify-center rounded-[var(--r-lg)] text-white sm:size-28"
      style={{ backgroundColor: secondaryColor }}
    >
      <TileTypeIcon tile={tile} className="size-8" />
    </span>
  );
}

function AlwaysOnTiles({
  tiles,
  slug,
  secondaryColor,
}: {
  tiles: PublicLinkInBioTile[];
  slug: string;
  secondaryColor: string;
}) {
  if (!tiles.length) return null;

  return (
    <section className="mx-auto w-full max-w-5xl space-y-3 pt-2">
      <div className="flex items-end justify-between gap-3 text-left">
        <h2 className="text-xl font-semibold tracking-normal text-[#fff7e8]">Quick links</h2>
        <span className="text-xs font-medium text-[#f7ead0]/60">{tiles.length} always on</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tiles.map((tile) => {
          const href = resolveTileHref(tile);
          const content = (
            <div className="flex min-h-[132px] items-center gap-4 rounded-[var(--r-lg)] border border-[#d7b56d]/25 bg-[#062f20]/70 px-3 py-3 text-left text-[#fff7e8] shadow-[0_18px_38px_rgba(0,0,0,0.2)] backdrop-blur-sm transition duration-150 group-hover:-translate-y-0.5 group-hover:border-[#d7b56d]/45">
              <TileVisual tile={tile} secondaryColor={secondaryColor} />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-base font-semibold leading-tight text-[#fff7e8]">{tile.title}</p>
                {tile.subtitle ? (
                  <p className="mt-1 line-clamp-2 text-sm leading-5 text-[#f7ead0]/70">{tile.subtitle}</p>
                ) : null}
                <p className="mt-2 truncate text-xs font-semibold uppercase tracking-normal" style={{ color: secondaryColor }}>{tile.ctaLabel}</p>
              </div>
              <ArrowUpRight className="size-4 shrink-0 text-[#f2d994]/80" aria-hidden="true" />
            </div>
          );

          if (!href) {
            return <div key={tile.id}>{content}</div>;
          }

          return (
            <ClickTracker key={tile.id} slug={slug} tileId={tile.id} href={href}>
              {content}
            </ClickTracker>
          );
        })}
      </div>
    </section>
  );
}

function formatWebsiteEventTiming(event: PublicWebsiteEvent) {
  const start = parseDate(event.startsAt);
  if (!start) return null;
  const time = formatTime(start);
  return time ? `${start.toFormat("ccc d LLL")} at ${time}` : start.toFormat("ccc d LLL");
}

function formatStatusLabel(status: string | null) {
  if (!status || status === "scheduled") return null;
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function WebsiteEventCard({ event, secondaryColor }: { event: PublicWebsiteEvent; secondaryColor: string }) {
  const timing = formatWebsiteEventTiming(event);
  const statusLabel = formatStatusLabel(event.status);

  return (
    <a
      href={event.ctaUrl}
      target="_blank"
      rel="noreferrer"
      className="group grid overflow-hidden rounded-[var(--r-lg)] border border-[#d7b56d]/25 bg-[#062f20]/75 text-left text-[#fff7e8] shadow-[0_20px_44px_rgba(0,0,0,0.24)] backdrop-blur-sm transition duration-150 hover:-translate-y-0.5 hover:border-[#d7b56d]/45 sm:grid-cols-[184px_1fr]"
    >
      <div className="relative aspect-square w-full bg-black/20 sm:h-[184px]">
        {event.imageUrl ? (
          <Image
            src={event.imageUrl}
            alt=""
            fill
            sizes="(min-width: 1024px) 184px, 100vw"
            className="object-contain"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[#d7b56d]">
            <CalendarDays className="size-10" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="flex min-h-[184px] flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {timing ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#f2d994]/80">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              {timing}
            </span>
          ) : null}
          {statusLabel ? (
            <span className="rounded-[var(--r-sm)] border border-[#d7b56d]/30 px-2 py-0.5 text-xs font-semibold text-[#f7ead0]/75">
              {statusLabel}
            </span>
          ) : null}
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-semibold leading-tight tracking-normal text-[#fff7e8]">
            {event.name}
          </h3>
          {event.summary ? (
            <p className="line-clamp-2 text-sm leading-5 text-[#f7ead0]/70">{event.summary}</p>
          ) : null}
          {event.categoryLabel ? (
            <p className="text-xs font-medium text-[#f7ead0]/50">{event.categoryLabel}</p>
          ) : null}
        </div>
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-[#d7b56d]/20 pt-3">
          <span className="text-xs font-medium text-[#f7ead0]/60">Upcoming event</span>
          <span className="inline-flex items-center gap-1 text-sm font-semibold" style={{ color: secondaryColor }}>
            {event.ctaLabel}
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </span>
        </div>
      </div>
    </a>
  );
}

function CampaignGroup({
  eyebrow,
  title,
  countLabel,
  campaigns,
  secondaryColor,
}: {
  eyebrow: string;
  title: string;
  countLabel: string;
  campaigns: PublicCampaignCard[];
  secondaryColor: string;
}) {
  if (!campaigns.length) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3 text-left">
        <div>
          <p className="text-xs font-medium text-[#f7ead0]/60">{eyebrow}</p>
          <h2 className="text-2xl font-semibold tracking-normal text-[#fff7e8]">{title}</h2>
        </div>
        <span className="rounded-[var(--r-md)] border border-[#d7b56d]/25 px-2.5 py-1 text-xs font-medium text-[#f7ead0]/70">
          {countLabel}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {campaigns.map((campaign) => (
          <CampaignCard key={campaign.id} campaign={campaign} secondaryColor={secondaryColor} />
        ))}
      </div>
    </section>
  );
}

function WebsiteEventsSection({
  events,
  secondaryColor,
}: {
  events: PublicWebsiteEvent[];
  secondaryColor: string;
}) {
  if (!events.length) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3 text-left">
        <div>
          <p className="text-xs font-medium text-[#f7ead0]/60">Coming up</p>
          <h2 className="text-2xl font-semibold tracking-normal text-[#fff7e8]">What&apos;s on</h2>
        </div>
        <span className="rounded-[var(--r-md)] border border-[#d7b56d]/25 px-2.5 py-1 text-xs font-medium text-[#f7ead0]/70">
          {events.length} events
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {events.map((event) => (
          <WebsiteEventCard key={event.id} event={event} secondaryColor={secondaryColor} />
        ))}
      </div>
    </section>
  );
}

export function LinkInBioPublicPage({ data }: { data: PublicLinkInBioPageData }) {
  const primaryColor = typeof data.profile.theme?.primaryColor === "string" && data.profile.theme.primaryColor.length
    ? (data.profile.theme.primaryColor as string)
    : "#005131";
  const secondaryColor = typeof data.profile.theme?.secondaryColor === "string" && data.profile.theme.secondaryColor.length
    ? (data.profile.theme.secondaryColor as string)
    : "#a57626";
  const quickActionLayout = resolveQuickActionLayout(data.profile.theme?.quickActionLayout);

  const ctas = CTA_ORDER.map((entry) => {
    const href = entry.renderHref(data.profile);
    if (!href) return null;
    return { key: entry.key, label: entry.label, href, icon: entry.icon };
  }).filter(Boolean) as Array<{ key: typeof CTA_ORDER[number]["key"]; label: string; href: string; icon: LucideIcon }>;

  const primaryCtas = ctas.filter((cta) => !SOCIAL_KEYS.has(cta.key));
  const socialCtas = ctas.filter((cta) => SOCIAL_KEYS.has(cta.key));
  const liveCampaigns = data.campaigns;
  const websiteEvents = data.websiteEvents ?? [];

  const ctaButtons = primaryCtas.length ? (
    <section className="mx-auto w-full max-w-3xl">
      <div
        className={cn(
          "grid w-full gap-2",
          quickActionLayout === "single" ? "grid-cols-1" : "grid-cols-2",
        )}
      >
        {primaryCtas.map((cta) => {
          const Icon = cta.icon;
          const spansDoubleColumn = quickActionLayout === "double" && cta.key === "menuUrl";
          return (
            <a
              key={cta.label}
              href={cta.href}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "group flex min-h-[54px] items-center gap-2 rounded-[var(--r-lg)] border px-2 py-2 text-left text-xs font-semibold text-[#fff7e8] shadow-[0_16px_34px_rgba(0,0,0,0.24)] transition duration-150 hover:-translate-y-0.5 min-[390px]:min-h-[56px] min-[390px]:gap-2.5 min-[390px]:px-2.5 min-[390px]:text-sm sm:gap-3 sm:px-3 sm:py-2.5",
                spansDoubleColumn && "col-span-2",
              )}
              style={{
                background: `linear-gradient(180deg, ${secondaryColor}, color-mix(in srgb, ${secondaryColor} 72%, #1d1205))`,
                borderColor: `color-mix(in srgb, ${secondaryColor} 56%, #fff2c0)`,
              }}
            >
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--r-md)] bg-black/15 text-white min-[390px]:size-9">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 truncate">{cta.label}</span>
              <ArrowUpRight className="size-4 shrink-0 text-white/75 transition group-hover:text-white" aria-hidden="true" />
            </a>
          );
        })}
      </div>
    </section>
  ) : null;

  const campaignsSection = (
    <section className="w-full space-y-8">
      <CampaignGroup
        eyebrow="Live now"
        title="Live campaigns"
        countLabel={`${liveCampaigns.length} live`}
        campaigns={liveCampaigns}
        secondaryColor={secondaryColor}
      />
      <WebsiteEventsSection events={websiteEvents} secondaryColor={secondaryColor} />
      {!liveCampaigns.length && !websiteEvents.length ? (
        <p className="rounded-[var(--r-lg)] border border-[#d7b56d]/25 bg-[#062f20]/70 p-4 text-sm text-[#f7ead0]/75">
          No live campaigns right now. Check back soon.
        </p>
      ) : null}
    </section>
  );

  const tilesSection = (
    <AlwaysOnTiles tiles={data.tiles} slug={data.profile.slug} secondaryColor={secondaryColor} />
  );

  const socialLinks = socialCtas.length ? (
    <section className="w-full">
      <div className="flex flex-wrap justify-center gap-2">
        {socialCtas.map((cta) => {
          const Icon = cta.icon;
          return (
            <a
              key={cta.label}
              href={cta.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-[var(--r-lg)] border border-[#d7b56d]/25 bg-[#062f20]/65 px-3 py-2 text-sm font-semibold text-[#fff7e8] transition duration-150 hover:border-[#d7b56d]/45"
            >
              <Icon className="size-4" aria-hidden="true" />
              {cta.label}
            </a>
          );
        })}
      </div>
    </section>
  ) : null;

  const templateContent = renderTemplate(data.profile.template, {
    profile: data.profile,
    tiles: data.tiles,
    campaigns: data.campaigns,
    logoMedia: data.logoMedia ?? null,
    heroMedia: data.heroMedia ?? null,
    slug: data.profile.slug,
    ctaButtons,
    tilesSection,
    campaignsSection,
    socialLinks,
  });

  return (
    <div
      className="min-h-screen px-4 pb-12 pt-6 sm:px-6 sm:pt-8"
      style={{
        backgroundColor: primaryColor,
        backgroundImage: `linear-gradient(180deg, color-mix(in srgb, ${secondaryColor} 22%, ${primaryColor}) 0%, ${primaryColor} 26%, color-mix(in srgb, ${primaryColor} 78%, #031712) 64%, #04140f 100%)`,
        boxShadow: "inset 0 90px 140px rgba(255, 242, 203, 0.08), inset 0 -140px 180px rgba(0, 0, 0, 0.32)",
        fontFamily: resolveFontFamily(data.profile.fontFamily),
        letterSpacing: 0,
      }}
    >
      <div className="relative">
        {templateContent}
        <footer className="mt-10 text-center text-[11px] text-[#f7ead0]/35">
          Powered by{" "}
          <a
            href="https://orangejelly.co.uk"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-[#f7ead0]/55 transition hover:text-[#f7ead0]/80"
          >
            orangejelly.co.uk
          </a>
        </footer>
      </div>
      <LinkInBioRefreshTimer />
    </div>
  );
}
