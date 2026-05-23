"use client";

import { useEffect, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useToast } from "@/components/providers/toast-provider";
import type { BrandProfile } from "@/lib/settings/data";
import {
  BrandProfileFormValues,
  brandProfileFormSchema,
} from "@/features/settings/schema";
import { updateBrandProfile } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";

interface BrandVoiceFormProps {
  data: BrandProfile;
}

const RANGE_STOPS = [0, 0.25, 0.5, 0.75, 1];

/* Shared input style using design tokens */
const textareaStyle: React.CSSProperties = {
  backgroundColor: "var(--c-paper)",
  border: "1px solid var(--c-line)",
  borderRadius: "var(--r-xl)",
  color: "var(--c-ink-2)",
};

const fieldsetStyle: React.CSSProperties = {
  backgroundColor: "var(--c-card)",
  border: "1px solid var(--c-line)",
  borderRadius: "var(--r-2xl)",
  boxShadow: "var(--sh-sm)",
};

function getBrandProfileDefaultValues(data: BrandProfile): BrandProfileFormValues {
  return {
    toneFormal: data.toneFormal,
    tonePlayful: data.tonePlayful,
    keyPhrases: [...data.keyPhrases],
    bannedTopics: [...data.bannedTopics],
    bannedPhrases: [...data.bannedPhrases],
    defaultHashtags: [...data.defaultHashtags],
    defaultEmojis: [...data.defaultEmojis],
    instagramSignature: data.instagramSignature,
    facebookSignature: data.facebookSignature,
    gbpCta: data.gbpCta,
  };
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function BrandVoiceForm({ data }: BrandVoiceFormProps) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const defaultValues = useMemo(() => getBrandProfileDefaultValues(data), [data]);

  const form = useForm<BrandProfileFormValues>({
    resolver: zodResolver(brandProfileFormSchema),
    defaultValues,
  });
  const { reset } = form;

  useEffect(() => {
    reset(defaultValues);
  }, [defaultValues, reset]);

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      try {
        await updateBrandProfile(values);
        reset(values);
        router.refresh();
        toast.success("Brand voice saved");
      } catch (error) {
        toast.error("Could not save brand voice", {
          description: getErrorMessage(error, "Please try again."),
        });
      }
    });
  }, () => {
    toast.error("Brand voice not saved", {
      description: "Check the highlighted fields and try again.",
    });
  });

  return (
    <form className="space-y-8" onSubmit={onSubmit} id="brand-voice">
      <fieldset className="grid gap-6 p-6" style={fieldsetStyle}>
        <legend className="text-lg font-semibold" style={{ color: "var(--c-ink)" }}>Tone sliders</legend>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>
              Formal ↔ Casual
            </label>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-xs" style={{ color: "var(--c-ink-3)" }}>Formal</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                className="h-1 w-full cursor-pointer appearance-none rounded-full"
                style={{ backgroundColor: "var(--c-paper-2)" }}
                {...form.register("toneFormal", {
                  valueAsNumber: true,
                })}
              />
              <span className="text-xs" style={{ color: "var(--c-ink-3)" }}>Casual</span>
            </div>
            <div className="mt-2 flex justify-between text-[11px]" style={{ color: "var(--c-ink-4)" }}>
              {RANGE_STOPS.map((stop) => (
                <span key={stop}>{stop}</span>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>
              Serious ↔ Playful
            </label>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-xs" style={{ color: "var(--c-ink-3)" }}>Serious</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                className="h-1 w-full cursor-pointer appearance-none rounded-full"
                style={{ backgroundColor: "var(--c-paper-2)" }}
                {...form.register("tonePlayful", {
                  valueAsNumber: true,
                })}
              />
              <span className="text-xs" style={{ color: "var(--c-ink-3)" }}>Playful</span>
            </div>
            <div className="mt-2 flex justify-between text-[11px]" style={{ color: "var(--c-ink-4)" }}>
              {RANGE_STOPS.map((stop) => (
                <span key={stop}>{stop}</span>
              ))}
            </div>
          </div>
        </div>
      </fieldset>

      <fieldset className="grid gap-6 p-6" style={fieldsetStyle}>
        <legend className="text-lg font-semibold" style={{ color: "var(--c-ink)" }}>Language controls</legend>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>Key phrases</label>
            <p className="text-xs" style={{ color: "var(--c-ink-3)" }}>
              Comma separated – we&apos;ll weave these into AI prompts.
            </p>
            <Controller
              control={form.control}
              name="keyPhrases"
              render={({ field }) => (
                <textarea
                  className="mt-2 min-h-[80px] w-full p-3 text-sm focus:outline-none"
                  style={{
                    ...textareaStyle,
                    outlineColor: "var(--c-orange)",
                  }}
                  value={field.value.join(", ")}
                  onChange={(event) =>
                    field.onChange(
                      event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    )
                  }
                />
              )}
            />
            {form.formState.errors.keyPhrases?.message ? (
              <p className="mt-1 text-xs" style={{ color: "var(--c-claret)" }}>
                {form.formState.errors.keyPhrases.message}
              </p>
            ) : null}
          </div>
          <div>
            <label className="text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>Topics to avoid</label>
            <p className="text-xs" style={{ color: "var(--c-ink-3)" }}>Comma separated list.</p>
            <Controller
              control={form.control}
              name="bannedTopics"
              render={({ field }) => (
                <textarea
                  className="mt-2 min-h-[80px] w-full p-3 text-sm focus:outline-none"
                  style={{
                    ...textareaStyle,
                    outlineColor: "var(--c-orange)",
                  }}
                  value={field.value.join(", ")}
                  onChange={(event) =>
                    field.onChange(
                      event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    )
                  }
                />
              )}
            />
            {form.formState.errors.bannedTopics?.message ? (
              <p className="mt-1 text-xs" style={{ color: "var(--c-claret)" }}>
                {form.formState.errors.bannedTopics.message}
              </p>
            ) : null}
          </div>
        </div>
        <div>
          <label className="text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>Banned phrases</label>
          <p className="text-xs" style={{ color: "var(--c-ink-3)" }}>
            Comma separated. These are removed from AI output on top of our built-in list (e.g. &ldquo;unforgettable experience&rdquo;, &ldquo;epic night&rdquo;).
          </p>
          <Controller
            control={form.control}
            name="bannedPhrases"
            render={({ field }) => (
              <textarea
                className="mt-2 min-h-[80px] w-full p-3 text-sm focus:outline-none"
                style={{
                  ...textareaStyle,
                  outlineColor: "var(--c-orange)",
                }}
                placeholder="e.g. top-notch, mouth-watering, second to none"
                value={field.value.join(", ")}
                onChange={(event) =>
                  field.onChange(
                    event.target.value
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean),
                  )
                }
              />
            )}
          />
          {form.formState.errors.bannedPhrases?.message ? (
            <p className="mt-1 text-xs" style={{ color: "var(--c-claret)" }}>
              {form.formState.errors.bannedPhrases.message}
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>Default hashtags</label>
            <Controller
              control={form.control}
              name="defaultHashtags"
              render={({ field }) => (
                <textarea
                  className="mt-2 min-h-[80px] w-full p-3 text-sm focus:outline-none"
                  style={{
                    ...textareaStyle,
                    outlineColor: "var(--c-orange)",
                  }}
                  value={field.value.join("\n")}
                  onChange={(event) =>
                    field.onChange(
                      event.target.value
                        .split(/\r?\n/)
                        .map((item) => item.trim())
                        .filter(Boolean),
                    )
                  }
                />
              )}
            />
            {form.formState.errors.defaultHashtags?.message ? (
              <p className="mt-1 text-xs" style={{ color: "var(--c-claret)" }}>
                {form.formState.errors.defaultHashtags.message}
              </p>
            ) : null}
          </div>
          <div>
            <label className="text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>Default emojis</label>
            <Controller
              control={form.control}
              name="defaultEmojis"
              render={({ field }) => (
                <textarea
                  className="mt-2 min-h-[80px] w-full p-3 text-sm focus:outline-none"
                  style={{
                    ...textareaStyle,
                    outlineColor: "var(--c-orange)",
                  }}
                  value={field.value.join(" ")}
                  onChange={(event) =>
                    field.onChange(
                      event.target.value
                        .split(/\s+/)
                        .map((item) => item.trim())
                        .filter(Boolean),
                    )
                  }
                />
              )}
            />
            {form.formState.errors.defaultEmojis?.message ? (
              <p className="mt-1 text-xs" style={{ color: "var(--c-claret)" }}>
                {form.formState.errors.defaultEmojis.message}
              </p>
            ) : null}
          </div>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 p-6" style={fieldsetStyle}>
        <legend className="text-lg font-semibold" style={{ color: "var(--c-ink)" }}>
          Platform signatures & CTA
        </legend>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>
              Instagram signature
            </label>
            <textarea
              className="mt-2 min-h-[80px] w-full p-3 text-sm focus:outline-none"
              style={{
                ...textareaStyle,
                outlineColor: "var(--c-orange)",
              }}
              {...form.register("instagramSignature")}
            />
          </div>
          <div>
            <label className="text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>
              Facebook signature
            </label>
            <textarea
              className="mt-2 min-h-[80px] w-full p-3 text-sm focus:outline-none"
              style={{
                ...textareaStyle,
                outlineColor: "var(--c-orange)",
              }}
              {...form.register("facebookSignature")}
            />
          </div>
          <div>
            <label className="text-sm font-medium" style={{ color: "var(--c-ink-2)" }}>
              GBP default CTA
            </label>
            <select
              className="mt-2 w-full p-3 text-sm focus:outline-none"
              style={{
                backgroundColor: "var(--c-paper)",
                border: "1px solid var(--c-line)",
                borderRadius: "var(--r-xl)",
                color: "var(--c-ink-2)",
              }}
              {...form.register("gbpCta")}
            >
              <option value="LEARN_MORE">Learn more</option>
              <option value="BOOK">Book</option>
              <option value="CALL">Call</option>
              <option value="REDEEM">Redeem</option>
            </select>
          </div>
        </div>
      </fieldset>
      <div className="flex justify-end">
        <Button type="submit" disabled={isPending} size="sm">
          {isPending ? "Saving…" : "Save brand voice"}
        </Button>
      </div>
    </form>
  );
}
