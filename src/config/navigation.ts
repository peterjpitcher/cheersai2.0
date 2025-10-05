type NavAccent = "teal" | "caramel" | "oat" | "sandstone" | "mist";

interface NavItem {
  href: string;
  label: string;
  description: string;
  accent: NavAccent;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/planner",
    label: "Planner",
    description: "See upcoming posts, status, and quick actions.",
    accent: "teal",
  },
  {
    href: "/create",
    label: "Create",
    description: "Launch campaigns, weekly plans, or instant posts.",
    accent: "caramel",
  },
  {
    href: "/library",
    label: "Library",
    description: "Manage media, drafts, and prompt presets.",
    accent: "oat",
  },
  {
    href: "/connections",
    label: "Connections",
    description: "Review account health and reconnect providers.",
    accent: "sandstone",
  },
  {
    href: "/settings",
    label: "Settings",
    description: "Tune brand voice, defaults, and notifications.",
    accent: "mist",
  },
] as const;

export type { NavAccent, NavItem };
