import Link from "next/link";

import { listPlannerNotifications } from "@/lib/planner/notifications";
import { mapCategoryToLevel } from "@/lib/planner/data";
import { PageHeader } from "@/components/layout/PageHeader";
import { ActivityCard, type PlannerActivityItem } from "@/features/planner/activity-feed";

export default async function PlannerNotificationsPage() {
  const notifications = await listPlannerNotifications();

  return (
    <div className="flex flex-col gap-6 h-full font-sans">
      <PageHeader
        title="Notification history"
        description="Recent automation events, publish outcomes, and alerts. Entries drop off after 50 items."
        action={
          <Link
            href="/planner"
            className="text-sm font-semibold underline"
            style={{ color: "var(--c-ink-3)" }}
          >
            Back to planner
          </Link>
        }
      />
      <div className="max-w-4xl">
        <div className="space-y-3">
          {notifications.length === 0 ? (
            <p
              className="rounded-lg border border-dashed p-6 text-sm"
              style={{
                borderColor: "var(--c-line)",
                backgroundColor: "var(--c-card)",
                color: "var(--c-ink-3)",
              }}
            >
              No notifications recorded yet.
            </p>
          ) : null}
          {notifications.map((notification) => {
            const item: PlannerActivityItem = {
              id: notification.id,
              message: notification.message,
              timestamp: notification.createdAt,
              level: mapCategoryToLevel(notification.category),
              category: notification.category,
              metadata: notification.metadata,
              readAt: notification.readAt,
            };

            return (
              <ActivityCard
                key={notification.id}
                item={item}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
