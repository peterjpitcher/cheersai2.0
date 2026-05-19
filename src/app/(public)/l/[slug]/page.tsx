import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LinkInBioPublicPage } from "@/features/link-in-bio/public";
import { getPublicLinkInBioPageData } from "@/lib/link-in-bio/public";
import { trackPageView } from "@/lib/link-in-bio/click-tracking";

/** ISR with 5-minute safety net revalidation (LIB-06). On-demand revalidation on publish. */
export const revalidate = 300;

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
