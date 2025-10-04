"use client";

import { useTransition, useState } from "react";
import { useForm, type Resolver, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { handlePromotionCampaignSubmission } from "@/app/(app)/create/actions";
import {
  promotionCampaignFormSchema,
  type PromotionCampaignFormValues,
  type PromotionCampaignInput,
} from "@/lib/create/schema";
import type { MediaAssetSummary } from "@/lib/library/data";
import { AdvancedGenerationControls } from "@/features/create/advanced-generation-controls";
import { MediaAttachmentSelector } from "@/features/create/media-attachment-selector";

const PLATFORM_LABELS: Record<PromotionCampaignInput["platforms"][number], string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  gbp: "Google Business Profile",
};

interface PromotionCampaignFormProps {
  mediaLibrary: MediaAssetSummary[];
}

export function PromotionCampaignForm({ mediaLibrary }: PromotionCampaignFormProps) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ status: string; scheduledFor: string | null } | null>(
    null,
  );

  const form = useForm<PromotionCampaignFormValues>({
    resolver: zodResolver(promotionCampaignFormSchema) as Resolver<PromotionCampaignFormValues>,
    defaultValues: {
      name: "",
      offerSummary: "",
      startDate: new Date().toISOString().slice(0, 10),
      endDate: new Date().toISOString().slice(0, 10),
      prompt: "",
      platforms: ["facebook", "instagram"],
      heroMedia: [],
      toneAdjust: "default",
      lengthPreference: "standard",
      includeHashtags: true,
      includeEmojis: true,
      ctaStyle: "default",
    },
  });

  const selectedMedia = form.watch("heroMedia") ?? [];

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const response = await handlePromotionCampaignSubmission(values);
      setResult({ status: response.status, scheduledFor: response.scheduledFor });
      form.reset({
        name: "",
        offerSummary: "",
        startDate: new Date().toISOString().slice(0, 10),
        endDate: new Date().toISOString().slice(0, 10),
        prompt: "",
        platforms: ["facebook", "instagram"],
        heroMedia: [],
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
        <label className="text-sm font-semibold text-slate-900">Promotion name</label>
        <input
          type="text"
          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
          placeholder="e.g. Two-for-one cocktails"
          {...form.register("name")}
        />
        {form.formState.errors.name ? (
          <p className="text-xs text-rose-500">{form.formState.errors.name.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-900">Offer summary</label>
        <textarea
          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
          rows={3}
          placeholder="Share the headline details guests care about"
          {...form.register("offerSummary")}
        />
        {form.formState.errors.offerSummary ? (
          <p className="text-xs text-rose-500">{form.formState.errors.offerSummary.message}</p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-900">Start date</label>
          <input
            type="date"
            className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
            {...form.register("startDate")}
          />
          {form.formState.errors.startDate ? (
            <p className="text-xs text-rose-500">{form.formState.errors.startDate.message}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-900">End date</label>
          <input
            type="date"
            className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
            {...form.register("endDate")}
          />
          {form.formState.errors.endDate ? (
            <p className="text-xs text-rose-500">{form.formState.errors.endDate.message}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-900">Extra prompt context</label>
        <textarea
          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
          rows={3}
          placeholder="Optional: emphasise T&Cs, messaging style, etc."
          {...form.register("prompt")}
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-slate-900">Platforms</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PLATFORM_LABELS) as Array<PromotionCampaignInput["platforms"][number]>).map(
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

      <MediaAttachmentSelector
        assets={mediaLibrary}
        selected={selectedMedia}
        onChange={(next) => form.setValue("heroMedia", next, { shouldDirty: true })}
        label="Hero media"
        description="Attach promotional visuals so every platform uses the correct rendition."
      />

      <AdvancedGenerationControls form={form} />

      <button
        type="submit"
        disabled={isPending}
        className="rounded-full bg-slate-900 px-6 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isPending ? "Generating schedule…" : "Generate timeline"}
      </button>

      {result ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          <p className="font-semibold">Promotion campaign created</p>
          <p>
            Status: {result.status}. First post goes out {" "}
            {result.scheduledFor ? new Date(result.scheduledFor).toLocaleString() : "soon"}.
          </p>
        </div>
      ) : null}
    </form>
  );
}

function togglePlatform(
  form: UseFormReturn<PromotionCampaignFormValues>,
  platform: PromotionCampaignInput["platforms"][number],
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
