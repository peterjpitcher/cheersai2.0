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
      venueLocation: data.venueLocation ?? "",
      venueLatitude: data.venueLatitude?.toString() ?? "",
      venueLongitude: data.venueLongitude?.toString() ?? "",
      notifications: data.notifications,
      gbpCtaDefaults: data.gbpCtaDefaults,
      bannerDefaults: data.bannerDefaults,
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
            <label className="text-sm font-medium text-slate-700">Venue location</label>
            <input
              type="text"
              placeholder="123 High Street, Leatherhead"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
              {...form.register("venueLocation")}
            />
            <p className="mt-1 text-xs text-slate-500">
              Used in generated copy. Enter the venue name, address, or town.
            </p>
            {form.formState.errors.venueLocation?.message ? (
              <p className="mt-1 text-xs text-red-600">
                {form.formState.errors.venueLocation.message}
              </p>
            ) : null}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-slate-700">Meta Ads latitude</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="51.4625"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
              {...form.register("venueLatitude")}
            />
            <p className="mt-1 text-xs text-slate-500">
              Used with longitude as the exact centre point for paid ads radius targeting.
            </p>
            {form.formState.errors.venueLatitude?.message ? (
              <p className="mt-1 text-xs text-red-600">
                {form.formState.errors.venueLatitude.message}
              </p>
            ) : null}
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Meta Ads longitude</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="-0.5021"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
              {...form.register("venueLongitude")}
            />
            <p className="mt-1 text-xs text-slate-500">
              Coordinates avoid Meta city lookup failures for full addresses and postcodes.
            </p>
            {form.formState.errors.venueLongitude?.message ? (
              <p className="mt-1 text-xs text-red-600">
                {form.formState.errors.venueLongitude.message}
              </p>
            ) : null}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-slate-700">Default GBP location ID</label>
            <input
              type="text"
              placeholder="locations/123"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
              {...form.register("gbpLocationId")}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Facebook Page ID</label>
            <input
              type="text"
              placeholder="1234567890"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
              {...form.register("facebookLocationId")}
            />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
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
      <fieldset className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <legend className="text-lg font-semibold text-slate-900">
          Banner defaults
        </legend>
        <p className="mb-4 text-sm text-slate-500">
          Account-wide defaults for the proximity banner that appears over post
          imagery. Per-post overrides take precedence when set.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Controller
            control={form.control}
            name="bannerDefaults.bannersEnabled"
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
                    Banners on by default
                  </span>
                  <span className="text-xs text-slate-500">
                    New scheduled posts inherit this setting.
                  </span>
                </span>
              </label>
            )}
          />
          <Controller
            control={form.control}
            name="bannerDefaults.bannerPosition"
            render={({ field }) => (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <span className="block text-sm font-medium text-slate-700">
                  Default position
                </span>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {(["top", "bottom", "left", "right"] as const).map((position) => (
                    <label
                      key={position}
                      className={`cursor-pointer rounded-lg border px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide ${
                        field.value === position
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"
                      }`}
                    >
                      <input
                        type="radio"
                        name={field.name}
                        value={position}
                        checked={field.value === position}
                        onChange={() => field.onChange(position)}
                        className="sr-only"
                      />
                      {position}
                    </label>
                  ))}
                </div>
              </div>
            )}
          />
          <Controller
            control={form.control}
            name="bannerDefaults.bannerBg"
            render={({ field }) => (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <label
                  className="block text-sm font-medium text-slate-700"
                  htmlFor="banner-default-bg"
                >
                  Default background
                </label>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    id="banner-default-bg"
                    type="color"
                    value={field.value ?? "#000000"}
                    onChange={(event) => field.onChange(event.target.value)}
                    className="h-10 w-16 cursor-pointer rounded border border-slate-200"
                  />
                  <span className="text-xs uppercase tracking-wide text-slate-500">
                    {field.value}
                  </span>
                </div>
                {form.formState.errors.bannerDefaults?.bannerBg?.message ? (
                  <p className="mt-1 text-xs text-red-600">
                    {form.formState.errors.bannerDefaults.bannerBg.message}
                  </p>
                ) : null}
              </div>
            )}
          />
          <Controller
            control={form.control}
            name="bannerDefaults.bannerTextColour"
            render={({ field }) => (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <label
                  className="block text-sm font-medium text-slate-700"
                  htmlFor="banner-default-text"
                >
                  Default text colour
                </label>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    id="banner-default-text"
                    type="color"
                    value={field.value ?? "#FFFFFF"}
                    onChange={(event) => field.onChange(event.target.value)}
                    className="h-10 w-16 cursor-pointer rounded border border-slate-200"
                  />
                  <span className="text-xs uppercase tracking-wide text-slate-500">
                    {field.value}
                  </span>
                </div>
                {form.formState.errors.bannerDefaults?.bannerTextColour?.message ? (
                  <p className="mt-1 text-xs text-red-600">
                    {form.formState.errors.bannerDefaults.bannerTextColour.message}
                  </p>
                ) : null}
              </div>
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
