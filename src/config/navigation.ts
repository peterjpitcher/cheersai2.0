type NavAccent = "teal" | "caramel" | "oat" | "sandstone" | "mist";

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
    accent: "caramel",
  },
  {
    href: "/library",
    label: "Library",
    accent: "oat",
  },
  {
    href: "/connections",
    label: "Connections",
    accent: "sandstone",
  },
  {
    href: "/settings",
    label: "Settings",
    accent: "mist",
  },
] as const;

export type { NavAccent, NavItem };
