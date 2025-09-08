import type { Meta, StoryObj } from "@storybook/react";
import { ErrorState, NetworkError, PermissionError, RateLimitError } from "@/components/ui/error-states";

const meta = {
  title: "UI/Empty & Error States",
  component: ErrorState,
} satisfies Meta<typeof ErrorState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const GenericError: Story = {
  args: {
    title: "Something went wrong",
    description: "Please try again later.",
    variant: "error",
  },
};

export const Network: Story = {
  render: () => <NetworkError onRetry={() => {}} />,
};

export const Permission: Story = {
  render: () => <PermissionError />,
};

export const RateLimit: Story = {
  render: () => <RateLimitError />,
};

