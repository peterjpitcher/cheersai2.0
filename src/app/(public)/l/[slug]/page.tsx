import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LinkInBioPublicPage } from "@/features/link-in-bio/public";
import { getPublicLinkInBioPageData } from "@/lib/link-in-bio/public";
import { trackPageView } from "@/lib/link-in-bio/click-tracking";

/**
 * Public link-in-bio pages use short-lived signed Supabase media URLs and
 * time-sensitive campaign windows, so render them fresh for every request.
 */
export const dynamic = "force-dynamic";

interface LinkInBioPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: LinkInBioPageProps): Promise<Metadata> {
  const { slug } = await params;
  try {
    const data = await getPublicLinkInBioPageData(slug.toLowerCase());
    if (!data) {
      return {
        title: "Link in bio",
      };
    }
    return {
      title: `${data.profile.displayName ?? "Link in bio"} | CheersAI`,
      description: data.profile.bio ?? undefined,
    };
  } catch {
    return {
      title: "Link in bio",
    };
  }
}

export default async function LinkInBioPage({ params }: LinkInBioPageProps) {
  const resolved = await params;
  const slug = resolved.slug.toLowerCase();
  const data = await getPublicLinkInBioPageData(slug);

  if (!data) {
    notFound();
  }

  // Unpublished pages return 404 (D-10)
  if (!data.profile.isPublished) {
    notFound();
  }

  // Fire-and-forget page view tracking -- do not await to avoid blocking render for LCP
  void trackPageView(slug, null);

  return <LinkInBioPublicPage data={data} />;
}
