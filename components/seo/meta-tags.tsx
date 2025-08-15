import Head from 'next/head';

interface MetaTagsProps {
  title?: string;
  description?: string;
  keywords?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogUrl?: string;
  twitterCard?: 'summary' | 'summary_large_image' | 'app' | 'player';
  twitterSite?: string;
  twitterCreator?: string;
  canonicalUrl?: string;
  noindex?: boolean;
  nofollow?: boolean;
  jsonLd?: any;
}

const defaultMeta = {
  title: 'CheersAI - AI-Powered Social Media Management for Hospitality',
  description: 'Streamline your social media presence with AI-generated content, automated scheduling, and cross-platform publishing. Manage Facebook, Instagram, Twitter, LinkedIn, and Google My Business from one dashboard.',
  keywords: 'social media management, AI content generation, social media scheduling, Facebook marketing, Instagram marketing, Twitter automation, LinkedIn publishing, Google My Business, content calendar, social media analytics',
  ogImage: '/og-image.png',
  twitterCard: 'summary_large_image' as const,
  twitterSite: '@cheersai',
};

export function MetaTags({
  title,
  description,
  keywords,
  ogTitle,
  ogDescription,
  ogImage,
  ogUrl,
  twitterCard,
  twitterSite,
  twitterCreator,
  canonicalUrl,
  noindex = false,
  nofollow = false,
  jsonLd,
}: MetaTagsProps) {
  const pageTitle = title ? `${title} | CheersAI` : defaultMeta.title;
  const pageDescription = description || defaultMeta.description;
  const pageKeywords = keywords || defaultMeta.keywords;
  const pageOgTitle = ogTitle || pageTitle;
  const pageOgDescription = ogDescription || pageDescription;
  const pageOgImage = ogImage || defaultMeta.ogImage;
  const pageOgUrl = ogUrl || (typeof window !== 'undefined' ? window.location.href : '');
  const pageTwitterCard = twitterCard || defaultMeta.twitterCard;
  const pageTwitterSite = twitterSite || defaultMeta.twitterSite;

  const robotsContent = `${noindex ? 'noindex' : 'index'},${nofollow ? 'nofollow' : 'follow'}`;

  const defaultJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'CheersAI',
    description: pageDescription,
    url: 'https://cheersai.orangejelly.co.uk',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.8',
      ratingCount: '127',
    },
  };

  return (
    <Head>
      {/* Primary Meta Tags */}
      <title>{pageTitle}</title>
      <meta name="title" content={pageTitle} />
      <meta name="description" content={pageDescription} />
      <meta name="keywords" content={pageKeywords} />
      <meta name="robots" content={robotsContent} />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta charSet="utf-8" />

      {/* Open Graph / Facebook */}
      <meta property="og:type" content="website" />
      <meta property="og:url" content={pageOgUrl} />
      <meta property="og:title" content={pageOgTitle} />
      <meta property="og:description" content={pageOgDescription} />
      <meta property="og:image" content={pageOgImage} />
      <meta property="og:site_name" content="CheersAI" />
      <meta property="og:locale" content="en_US" />

      {/* Twitter */}
      <meta property="twitter:card" content={pageTwitterCard} />
      <meta property="twitter:url" content={pageOgUrl} />
      <meta property="twitter:title" content={pageOgTitle} />
      <meta property="twitter:description" content={pageOgDescription} />
      <meta property="twitter:image" content={pageOgImage} />
      {pageTwitterSite && <meta property="twitter:site" content={pageTwitterSite} />}
      {twitterCreator && <meta property="twitter:creator" content={twitterCreator} />}

      {/* Canonical URL */}
      {canonicalUrl && <link rel="canonical" href={canonicalUrl} />}

      {/* Additional Meta Tags */}
      <meta name="author" content="CheersAI Team" />
      <meta name="publisher" content="CheersAI" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      <meta name="apple-mobile-web-app-title" content="CheersAI" />
      <meta name="format-detection" content="telephone=no" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="theme-color" content="#3B82F6" />

      {/* Favicon */}
      <link rel="icon" href="/favicon.ico" />
      <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
      <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      <link rel="manifest" href="/manifest.json" />

      {/* JSON-LD Structured Data */}
      {(jsonLd || defaultJsonLd) && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd || defaultJsonLd),
          }}
        />
      )}
    </Head>
  );
}