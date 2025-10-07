type NavAccent = "teal" | "caramel" | "oat" | "sandstone" | "mist" | "ambergold";

interface NavItem {
  href: string;
  label: string;
  accent: NavAccent;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/planner",
    label: "Planner",
    accent: "teal",
  },
  {
    href: "/create",
    label: "Create",
    accent: "sandstone",
  },
  {
    href: "/library",
    label: "Library",
    accent: "oat",
  },
  {
    href: "/connections",
    label: "Connections",
    accent: "caramel",
  },
  {
    href: "/settings",
    label: "Settings",
    accent: "ambergold",
  },
] as const;

export type { NavAccent, NavItem };
