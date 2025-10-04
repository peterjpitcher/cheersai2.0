"use client";

import { useTransition, useState } from "react";
import { useForm, type Resolver, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { handleInstantPostSubmission } from "@/app/(app)/create/actions";
import {
  instantPostFormSchema,
  type InstantPostFormValues,
  type InstantPostInput,
} from "@/lib/create/schema";
import type { MediaAssetSummary } from "@/lib/library/data";
import { AdvancedGenerationControls } from "@/features/create/advanced-generation-controls";
import { MediaAttachmentSelector } from "@/features/create/media-attachment-selector";

const PLATFORM_LABELS: Record<InstantPostInput["platforms"][number], string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  gbp: "Google Business Profile",
};

interface InstantPostFormProps {
  mediaLibrary: MediaAssetSummary[];
}

export function InstantPostForm({ mediaLibrary }: InstantPostFormProps) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ status: string; scheduledFor: string | null } | null>(
    null,
  );

  const form = useForm<InstantPostFormValues>({
    resolver: zodResolver(instantPostFormSchema) as Resolver<InstantPostFormValues>,
    defaultValues: {
      title: "",
      prompt: "",
      publishMode: "now",
      platforms: ["facebook", "instagram"],
      media: [],
      toneAdjust: "default",
      lengthPreference: "standard",
      includeHashtags: true,
      includeEmojis: true,
      ctaStyle: "default",
    },
  });

  const publishMode = form.watch("publishMode");
  const selectedMedia = form.watch("media") ?? [];

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const response = await handleInstantPostSubmission(values);
      setResult({
        status: response.status,
        scheduledFor: response.scheduledFor,
      });
      form.reset({
        title: "",
        prompt: "",
        publishMode: "now",
        platforms: ["facebook", "instagram"],
        media: [],
        scheduledFor: undefined,
        toneAdjust: "default",
        lengthPreference: "standard",
        includeHashtags: true,
        includeEmojis: true,
        ctaStyle: "default",
      });
    });
  });

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-900">Title</label>
        <input
          type="text"
          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
          placeholder="e.g. Friday Night Hype"
          {...form.register("title")}
        />
        {form.formState.errors.title ? (
          <p className="text-xs text-rose-500">{form.formState.errors.title.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-900">What should we post?</label>
        <textarea
          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
          rows={4}
          placeholder="Give us the context, vibe, and anything we must mention"
          {...form.register("prompt")}
        />
        {form.formState.errors.prompt ? (
          <p className="text-xs text-rose-500">{form.formState.errors.prompt.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-slate-900">Platforms</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PLATFORM_LABELS) as Array<InstantPostInput["platforms"][number]>).map(
            (platform) => {
              const selected = (form.watch("platforms") ?? []).includes(platform);
              return (
                <button
                  key={platform}
                  type="button"
                  onClick={() => togglePlatform(form, platform)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                    selected
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 text-slate-600"
                  }`}
                >
                  {PLATFORM_LABELS[platform]}
                </button>
              );
            },
          )}
        </div>
        {form.formState.errors.platforms ? (
          <p className="text-xs text-rose-500">{form.formState.errors.platforms.message}</p>
        ) : null}
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold text-slate-900">When should it publish?</p>
        <div className="flex gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              value="now"
              checked={publishMode === "now"}
              onChange={() => form.setValue("publishMode", "now")}
            />
            Publish now
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              value="schedule"
              checked={publishMode === "schedule"}
              onChange={() => form.setValue("publishMode", "schedule")}
            />
            Schedule for later
          </label>
        </div>
        {publishMode === "schedule" ? (
          <input
            type="datetime-local"
            className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
            {...form.register("scheduledFor")}
          />
        ) : null}
        {form.formState.errors.scheduledFor ? (
          <p className="text-xs text-rose-500">
            {form.formState.errors.scheduledFor.message as string}
          </p>
        ) : null}
      </div>

      <AdvancedGenerationControls form={form} />

      <MediaAttachmentSelector
        assets={mediaLibrary}
        selected={selectedMedia}
        onChange={(next) => form.setValue("media", next, { shouldDirty: true })}
        label="Media attachments"
        description="Pick processed images or video from your Library. We’ll automatically use the right rendition per platform."
      />

      <button
        type="submit"
        disabled={isPending}
        className="rounded-full bg-slate-900 px-6 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isPending ? "Generating post…" : "Generate post"}
      </button>

      {result ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          <p className="font-semibold">Instant post created</p>
          <p>
            Status: {result.status}. {" "}
            {result.scheduledFor ? `Scheduled for ${new Date(result.scheduledFor).toLocaleString()}` : null}
          </p>
        </div>
      ) : null}
    </form>
  );
}

function togglePlatform(
  form: UseFormReturn<InstantPostFormValues>,
  platform: InstantPostInput["platforms"][number],
) {
  const current = form.getValues("platforms") ?? [];
  if (current.includes(platform)) {
    form.setValue(
      "platforms",
      current.filter((item) => item !== platform),
    );
  } else {
    form.setValue("platforms", [...current, platform]);
  }
}
