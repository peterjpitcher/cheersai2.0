"use client";

import { useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import type { PostingDefaults } from "@/lib/settings/data";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import {
  PostingDefaultsFormValues,
  postingDefaultsFormSchema,
} from "@/features/settings/schema";
import { updatePostingDefaults } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";

interface PostingDefaultsFormProps {
  data: PostingDefaults;
}

const TIMEZONE_OPTIONS = [DEFAULT_TIMEZONE];

const CTA_LABELS = {
  LEARN_MORE: "Learn more",
  BOOK: "Book",
  CALL: "Call",
  REDEEM: "Redeem",
} as const;

export function PostingDefaultsForm({ data }: PostingDefaultsFormProps) {
  const [isPending, startTransition] = useTransition();

  const form = useForm<PostingDefaultsFormValues>({
    resolver: zodResolver(postingDefaultsFormSchema),
    defaultValues: {
      timezone: data.timezone,
      facebookLocationId: data.facebookLocationId,
      instagramLocationId: data.instagramLocationId,
      gbpLocationId: data.gbpLocationId,
      notifications: data.notifications,
      gbpCtaDefaults: data.gbpCtaDefaults,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      await updatePostingDefaults(values);
    });
  });

  return (
    <form className="space-y-8" onSubmit={onSubmit} id="posting-defaults">
      <fieldset className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <legend className="text-lg font-semibold text-slate-900">
          Scheduling & timezone
        </legend>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-slate-700">Timezone</label>
            <select
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70"
              {...form.register("timezone")}
              disabled
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Fixed to London time (Europe/London) for consistent scheduling.
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Default GBP location ID</label>
            <input
              type="text"
              placeholder="locations/123"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
              {...form.register("gbpLocationId")}
            />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-slate-700">Facebook Page ID</label>
            <input
              type="text"
              placeholder="1234567890"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
              {...form.register("facebookLocationId")}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Instagram Business ID</label>
            <input
              type="text"
              placeholder="1784..."
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
              {...form.register("instagramLocationId")}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <legend className="text-lg font-semibold text-slate-900">
          GBP CTA defaults
        </legend>
        <div className="grid gap-4 md:grid-cols-3">
          {([
            ["standard", "Standard posts"],
            ["event", "Event posts"],
            ["offer", "Offer posts"],
          ] as const).map(([key, label]) => (
            <div key={key}>
              <p className="text-sm font-medium text-slate-700">{label}</p>
              <Controller
                control={form.control}
                name={`gbpCtaDefaults.${key}` as const}
                render={({ field }) => (
                  <select
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
                    value={field.value}
                    onChange={(event) => field.onChange(event.target.value)}
                  >
                    {Object.entries(CTA_LABELS).map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>
                )}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <legend className="text-lg font-semibold text-slate-900">
          Notifications
        </legend>
        <div className="space-y-3">
          <Controller
            control={form.control}
            name="notifications.emailFailures"
            render={({ field }) => (
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={field.value}
                  onChange={(event) => field.onChange(event.target.checked)}
                />
                <span>
                  <span className="block text-sm font-medium text-slate-700">
                    Publishing failures
                  </span>
                  <span className="text-xs text-slate-500">
                    Email me if a post fails after retries.
                  </span>
                </span>
              </label>
            )}
          />
          <Controller
            control={form.control}
            name="notifications.emailTokenExpiring"
            render={({ field }) => (
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={field.value}
                  onChange={(event) => field.onChange(event.target.checked)}
                />
                <span>
                  <span className="block text-sm font-medium text-slate-700">
                    Token expiry warnings
                  </span>
                  <span className="text-xs text-slate-500">
                    Give me a heads-up five days before access expires.
                  </span>
                </span>
              </label>
            )}
          />
        </div>
      </fieldset>
      <div className="flex justify-end">
        <Button type="submit" disabled={isPending} size="sm">
          {isPending ? "Saving…" : "Save posting defaults"}
        </Button>
      </div>
    </form>
  );
}
