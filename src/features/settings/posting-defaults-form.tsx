"use client";

import { useEffect, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useToast } from "@/components/providers/toast-provider";
import type { PostingDefaults } from "@/lib/settings/data";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import {
  PostingDefaultsFormValues,
  postingDefaultsFormSchema,
} from "@/features/settings/schema";
import {
  BANNER_PALETTES,
  paletteFromColours,
  type BannerPaletteId,
} from "@/lib/banner/palette";
import { updatePostingDefaults } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";

interface PostingDefaultsFormProps {
  data: PostingDefaults;
}

const TIMEZONE_OPTIONS = [DEFAULT_TIMEZONE];

/* Shared style objects for design tokens */
const fieldsetStyle: React.CSSProperties = {
  backgroundColor: "var(--c-card)",
  border: "1px solid var(--c-line)",
  borderRadius: "var(--r-2xl)",
  boxShadow: "var(--sh-sm)",
};

const inputStyle: React.CSSProperties = {
  backgroundColor: "var(--c-paper)",
  border: "1px solid var(--c-line)",
  borderRadius: "var(--r-xl)",
  color: "var(--c-ink-2)",
};

const checkboxCardStyle: React.CSSProperties = {
  backgroundColor: "var(--c-paper)",
  border: "1px solid var(--c-line)",
  borderRadius: "var(--r-xl)",
};

function getPostingDefaultsFormDefaultValues(data: PostingDefaults): PostingDefaultsFormValues {
  return {
    timezone: data.timezone,
    facebookLocationId: data.facebookLocationId,
    instagramLocationId: data.instagramLocationId,
    defaultPostingTime: data.defaultPostingTime,
    venueLocation: data.venueLocation ?? "",
    venueLatitude: data.venueLatitude?.toString() ?? "",
    venueLongitude: data.venueLongitude?.toString() ?? "",
    notifications: { ...data.notifications },
    bannerDefaults: { ...data.bannerDefaults },
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function PostingDefaultsForm({ data }: PostingDefaultsFormProps) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const defaultValues = useMemo(() => getPostingDefaultsFormDefaultValues(data), [data]);

  const form = useForm<PostingDefaultsFormValues>({
    resolver: zodResolver(postingDefaultsFormSchema),
    defaultValues,
  });
  const { reset } = form;

  useEffect(() => {
    reset(defaultValues);
  }, [defaultValues, reset]);

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      try {
        await updatePostingDefaults(values);
        reset(values);
        router.refresh();
        toast.success("Posting defaults saved");
      } catch (error) {
        toast.error("Could not save posting defaults", {
          description: getErrorMessage(error, "Please try again."),
        });
      }
    });
  }, () => {
    toast.error("Posting defaults not saved", {
      description: "Check the highlighted fields and try again.",
    });
  });

  return (
    <form className="space-y-8" onSubmit={onSubmit} id="posting-defaults">
      <fieldset className="p-6" style={fieldsetStyle}>
        <legend className="text-lg font-semibold" style={{ color: "var(--c-ink)" }}>
          Scheduling & timezone
        </legend>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>Timezone</label>
            <input type="hidden" {...form.register("timezone")} />
            <select
              className="mt-2 w-full p-3 text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-70"
              style={inputStyle}
              value={defaultValues.timezone}
              onChange={() => undefined}
              disabled
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs" style={{ color: "var(--c-ink-3)" }}>
              Fixed to London time (Europe/London) for consistent scheduling.
            </p>
          </div>
          <div>
            <label className="text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>Venue location</label>
            <input
              type="text"
              placeholder="123 High Street, Leatherhead"
              className="mt-2 w-full p-3 text-sm focus:outline-none"
              style={inputStyle}
              {...form.register("venueLocation")}
            />
            <p className="mt-1 text-xs" style={{ color: "var(--c-ink-3)" }}>
              Used in generated copy. Enter the venue name, address, or town.
            </p>
            {form.formState.errors.venueLocation?.message ? (
              <p className="mt-1 text-xs" style={{ color: "var(--c-claret)" }}>
                {form.formState.errors.venueLocation.message}
              </p>
            ) : null}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>Meta Ads latitude</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="51.4625"
              className="mt-2 w-full p-3 text-sm focus:outline-none"
              style={inputStyle}
              {...form.register("venueLatitude")}
            />
            <p className="mt-1 text-xs" style={{ color: "var(--c-ink-3)" }}>
              Used with longitude as the exact centre point for paid ads radius targeting.
            </p>
            {form.formState.errors.venueLatitude?.message ? (
              <p className="mt-1 text-xs" style={{ color: "var(--c-claret)" }}>
                {form.formState.errors.venueLatitude.message}
              </p>
            ) : null}
          </div>
          <div>
            <label className="text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>Meta Ads longitude</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="-0.5021"
              className="mt-2 w-full p-3 text-sm focus:outline-none"
              style={inputStyle}
              {...form.register("venueLongitude")}
            />
            <p className="mt-1 text-xs" style={{ color: "var(--c-ink-3)" }}>
              Coordinates avoid Meta city lookup failures for full addresses and postcodes.
            </p>
            {form.formState.errors.venueLongitude?.message ? (
              <p className="mt-1 text-xs" style={{ color: "var(--c-claret)" }}>
                {form.formState.errors.venueLongitude.message}
              </p>
            ) : null}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>Facebook Page ID</label>
            <input
              type="text"
              placeholder="1234567890"
              className="mt-2 w-full p-3 text-sm focus:outline-none"
              style={inputStyle}
              {...form.register("facebookLocationId")}
            />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>Instagram Business ID</label>
            <input
              type="text"
              placeholder="1784..."
              className="mt-2 w-full p-3 text-sm focus:outline-none"
              style={inputStyle}
              {...form.register("instagramLocationId")}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="p-6" style={fieldsetStyle}>
        <legend className="text-lg font-semibold" style={{ color: "var(--c-ink)" }}>
          Notifications
        </legend>
        <div className="space-y-3">
          <Controller
            control={form.control}
            name="notifications.emailFailures"
            render={({ field }) => (
              <label className="flex items-start gap-3 p-4" style={checkboxCardStyle}>
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={field.value}
                  onChange={(event) => field.onChange(event.target.checked)}
                />
                <span>
                  <span className="block text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>
                    Publishing failures
                  </span>
                  <span className="text-xs" style={{ color: "var(--c-ink-3)" }}>
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
              <label className="flex items-start gap-3 p-4" style={checkboxCardStyle}>
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={field.value}
                  onChange={(event) => field.onChange(event.target.checked)}
                />
                <span>
                  <span className="block text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>
                    Token expiry warnings
                  </span>
                  <span className="text-xs" style={{ color: "var(--c-ink-3)" }}>
                    Give me a heads-up five days before access expires.
                  </span>
                </span>
              </label>
            )}
          />
        </div>
      </fieldset>
      <fieldset className="p-6" style={fieldsetStyle}>
        <legend className="text-lg font-semibold" style={{ color: "var(--c-ink)" }}>
          Banner defaults
        </legend>
        <p className="mb-4 text-sm" style={{ color: "var(--c-ink-3)" }}>
          Account-wide defaults for the proximity banner that appears over post
          imagery. Per-post overrides take precedence when set.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Controller
            control={form.control}
            name="bannerDefaults.bannersEnabled"
            render={({ field }) => (
              <label className="flex items-start gap-3 p-4" style={checkboxCardStyle}>
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={field.value}
                  onChange={(event) => field.onChange(event.target.checked)}
                />
                <span>
                  <span className="block text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>
                    Banners on by default
                  </span>
                  <span className="text-xs" style={{ color: "var(--c-ink-3)" }}>
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
              <div className="p-4" style={checkboxCardStyle}>
                <span className="block text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>
                  Default position
                </span>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {(["top", "bottom", "left", "right"] as const).map((position) => (
                    <label
                      key={position}
                      className="cursor-pointer px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide"
                      style={{
                        borderRadius: "var(--r-lg)",
                        border: field.value === position
                          ? "1px solid var(--c-ink)"
                          : "1px solid var(--c-line)",
                        backgroundColor: field.value === position
                          ? "var(--c-ink)"
                          : "var(--c-card)",
                        color: field.value === position
                          ? "white"
                          : "var(--c-ink-3)",
                      }}
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
            render={({ field: bgField }) => (
              <Controller
                control={form.control}
                name="bannerDefaults.bannerTextColour"
                render={({ field: textField }) => {
                  const selected = paletteFromColours(
                    bgField.value ?? BANNER_PALETTES.bronze.bg,
                    textField.value ?? BANNER_PALETTES.bronze.text,
                  );
                  return (
                    <div className="p-4" style={checkboxCardStyle}>
                      <span className="block text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>
                        Default colour
                      </span>
                      <p className="mt-1 text-xs" style={{ color: "var(--c-ink-3)" }}>
                        Choose between the two brand presets. Both background
                        and text colours update together.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(Object.keys(BANNER_PALETTES) as BannerPaletteId[]).map(
                          (id) => {
                            const preset = BANNER_PALETTES[id];
                            const isSelected = selected === id;
                            return (
                              <button
                                key={id}
                                type="button"
                                aria-pressed={isSelected}
                                aria-label={`${preset.label} banner colour`}
                                onClick={() => {
                                  bgField.onChange(preset.bg);
                                  textField.onChange(preset.text);
                                }}
                                className="flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide"
                                style={{
                                  borderRadius: "var(--r-lg)",
                                  border: isSelected
                                    ? "1px solid var(--c-ink)"
                                    : "1px solid var(--c-line)",
                                  backgroundColor: isSelected
                                    ? "var(--c-ink)"
                                    : "var(--c-card)",
                                  color: isSelected
                                    ? "white"
                                    : "var(--c-ink-3)",
                                }}
                              >
                                <span
                                  className="inline-block h-4 w-4 rounded"
                                  style={{ backgroundColor: preset.bg, border: "1px solid rgba(255,255,255,0.4)" }}
                                  aria-hidden="true"
                                />
                                <span>{preset.label}</span>
                              </button>
                            );
                          },
                        )}
                      </div>
                      {form.formState.errors.bannerDefaults?.bannerBg?.message ? (
                        <p className="mt-1 text-xs" style={{ color: "var(--c-claret)" }}>
                          {form.formState.errors.bannerDefaults.bannerBg.message}
                        </p>
                      ) : null}
                      {form.formState.errors.bannerDefaults?.bannerTextColour
                        ?.message ? (
                        <p className="mt-1 text-xs" style={{ color: "var(--c-claret)" }}>
                          {
                            form.formState.errors.bannerDefaults.bannerTextColour
                              .message
                          }
                        </p>
                      ) : null}
                    </div>
                  );
                }}
              />
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
