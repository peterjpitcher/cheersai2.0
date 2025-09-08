import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

const meta = {
  title: "UI/Button",
  component: Button,
  args: { children: "Click me" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Primary: Story = { args: { variant: "primary" } };
export const Destructive: Story = { args: { variant: "destructive" } };
export const Outline: Story = { args: { variant: "outline" } };
export const Ghost: Story = { args: { variant: "ghost" } };
export const Link: Story = { args: { variant: "link" } };
export const LoadingLeft: Story = { args: { loading: true } };
export const LoadingRight: Story = { args: { loading: true, iconPlacement: "right" } };
export const WithIcon: Story = {
  args: {
    children: (
      <>
        <Loader2 className="w-4 h-4" />
        With Icon
      </>
    ),
  },
};

