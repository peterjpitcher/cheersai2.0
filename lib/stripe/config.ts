export const PRICING_TIERS = [
  {
    id: "free",
    name: "Free Trial",
    price: 0,
    priceId: "", // No Stripe price ID for free tier
    description: "Perfect for trying out CheersAI - No card required!",
    features: [
      "14-day free trial",
      "Up to 5 campaigns",
      "10 AI-generated posts",
      "Basic media library (10 images)",
      "1 social account connection",
      "Community support only",
    ],
    limits: {
      campaigns: 5,
      posts: 10,
      mediaAssets: 10,
      socialAccounts: 1,
      scheduling: false,
    },
    support: {
      email: false,
      priority: false,
      whatsapp: false,
      phone: false,
    },
    cta: "Start Free Trial",
    popular: false,
  },
  {
    id: "starter",
    name: "Starter",
    price: 29.99,
    priceMonthly: 29.99,
    priceAnnual: 323.89, // £29.99 * 12 * 0.9 (10% discount)
    priceIdMonthly: process.env.NEXT_PUBLIC_STRIPE_STARTER_MONTHLY_PRICE_ID || "",
    priceIdAnnual: process.env.NEXT_PUBLIC_STRIPE_STARTER_ANNUAL_PRICE_ID || "",
    priceId: process.env.NEXT_PUBLIC_STRIPE_STARTER_MONTHLY_PRICE_ID || "", // Fallback for compatibility
    description: "Great for single pubs",
    features: [
      "Everything in Free",
      "Up to 10 campaigns/month",
      "100 AI-generated posts/month",
      "Unlimited media storage",
      "All social platforms",
      "Advanced scheduling",
      "Community support",
    ],
    limits: {
      campaigns: 10, // Changed from 20 to 10 per requirements
      posts: 100,
      mediaAssets: -1, // Unlimited
      socialAccounts: -1, // All platforms
      scheduling: true, // Can schedule publishing
    },
    support: {
      email: false, // No email support for Starter
      priority: false,
      whatsapp: false,
      phone: false,
    },
    cta: "Upgrade to Starter",
    popular: true,
  },
  {
    id: "starter_images",
    name: "Starter + Images",
    price: 54.99,
    priceMonthly: 54.99,
    priceAnnual: 593.89, // £54.99 * 12 * 0.9
    priceIdMonthly: process.env.NEXT_PUBLIC_STRIPE_STARTER_IMAGES_MONTHLY_PRICE_ID || "",
    priceIdAnnual: process.env.NEXT_PUBLIC_STRIPE_STARTER_IMAGES_ANNUAL_PRICE_ID || "",
    description: "Starter plus AI image creation included",
    features: [
      "Everything in Starter",
      "AI image creation included",
    ],
    limits: {
      campaigns: 10,
      posts: 100,
      mediaAssets: -1,
      socialAccounts: -1,
      scheduling: true,
    },
    support: {
      email: false,
      priority: false,
      whatsapp: false,
      phone: false,
    },
    cta: "Upgrade to Starter + Images",
    popular: false,
  },
  {
    id: "pro",
    name: "Professional",
    price: 59.99,
    priceMonthly: 59.99,
    priceAnnual: 647.89, // £59.99 * 12 * 0.9 (10% discount)
    priceIdMonthly: process.env.NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE_ID || "",
    priceIdAnnual: process.env.NEXT_PUBLIC_STRIPE_PRO_ANNUAL_PRICE_ID || "",
    description: "For growing pub chains",
    features: [
      "Everything in Starter",
      "Unlimited campaigns",
      "500 AI-generated posts/month",
      "Priority email support",
      "WhatsApp support",
      "Custom brand voices",
    ],
    limits: {
      campaigns: -1, // Unlimited
      posts: 500,
      mediaAssets: -1,
      socialAccounts: -1,
      scheduling: true,
    },
    support: {
      email: true,
      priority: true, // Priority email and WhatsApp
      whatsapp: true,
      phone: false, // No phone support
    },
    cta: "Upgrade to Professional",
    popular: false,
  },
  {
    id: "pro_images",
    name: "Professional + Images",
    price: 84.99,
    priceMonthly: 84.99,
    priceAnnual: 917.89, // £84.99 * 12 * 0.9
    priceIdMonthly: process.env.NEXT_PUBLIC_STRIPE_PRO_IMAGES_MONTHLY_PRICE_ID || "",
    priceIdAnnual: process.env.NEXT_PUBLIC_STRIPE_PRO_IMAGES_ANNUAL_PRICE_ID || "",
    description: "Professional plus AI image creation included",
    features: [
      "Everything in Professional",
      "AI image creation included",
    ],
    limits: {
      campaigns: -1,
      posts: 500,
      mediaAssets: -1,
      socialAccounts: -1,
      scheduling: true,
    },
    support: {
      email: true,
      priority: true,
      whatsapp: true,
      phone: false,
    },
    cta: "Upgrade to Professional + Images",
    popular: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: null, // Custom pricing
    priceId: "",
    description: "For large hospitality groups",
    features: [
      "Everything in Professional",
      "Unlimited everything",
      "API access",
      "Custom integrations",
      "Dedicated account manager",
      "24/7 phone support",
      "SLA guarantee",
      "Custom AI training",
    ],
    limits: {
      campaigns: -1,
      posts: -1,
      mediaAssets: -1,
      socialAccounts: -1,
      scheduling: true,
    },
    support: {
      email: true,
      priority: true,
      whatsapp: true,
      phone: true, // Full support including phone
    },
    cta: "Contact Sales",
    popular: false,
  },
];

export function getTierByPriceId(priceId: string) {
  return PRICING_TIERS.find(tier => tier.priceId === priceId);
}

export function getTierById(tierId: string) {
  if (!tierId) return undefined;
  const normalized = tierId.toLowerCase();
  const synonym = normalized === 'professional' ? 'pro' : normalized;
  return PRICING_TIERS.find(tier => tier.id === synonym);
}

export function getTierLimits(tierId: string) {
  const tier = getTierById(tierId);
  return tier?.limits || PRICING_TIERS[0].limits;
}

export function getTierSupport(tierId: string) {
  const tier = getTierById(tierId);
  return tier?.support || PRICING_TIERS[0].support;
}

export function canCreateCampaign(tierId: string, currentCount: number): boolean {
  const limits = getTierLimits(tierId);
  if (limits.campaigns === -1) return true; // Unlimited
  return currentCount < limits.campaigns;
}
