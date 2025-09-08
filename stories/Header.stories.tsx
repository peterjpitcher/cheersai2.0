import type { Meta, StoryObj } from "@storybook/react";
import AppHeader from "@/components/layout/app-header";

const meta = {
  title: "Layout/Header",
  component: AppHeader,
} satisfies Meta<typeof AppHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  args: {
    user: { email: "user@example.com" },
    breadcrumb: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/campaigns", label: "Campaigns" },
    ],
    title: "My Page",
    notificationCount: 3,
  },
};

