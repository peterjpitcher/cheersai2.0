"use client";

import {
  useTransition,
  useState,
  useRef,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useForm, type Resolver, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  fetchGeneratedContentDetails,
  handleInstantPostSubmission,
} from "@/app/(app)/create/actions";
import {
  instantPostFormSchema,
  type InstantPostFormValues,
  type InstantPostInput,
  type MediaAssetInput,
} from "@/lib/create/schema";
import type { MediaAssetSummary } from "@/lib/library/data";
import type { PlannerContentDetail } from "@/lib/planner/data";
import { AdvancedGenerationControls } from "@/features/create/advanced-generation-controls";
import { GeneratedContentReviewList } from "@/features/create/generated-content-review-list";
import { GenerationProgress } from "@/features/create/generation-progress";
import { MediaAttachmentSelector } from "@/features/create/media-attachment-selector";

const PLATFORM_LABELS: Record<InstantPostInput["platforms"][number], string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  gbp: "Google Business Profile",
};

interface InstantPostFormProps {
  mediaLibrary: MediaAssetSummary[];
  ownerTimezone: string;
  onLibraryUpdate?: Dispatch<SetStateAction<MediaAssetSummary[]>>;
}

export function InstantPostForm({ mediaLibrary, ownerTimezone, onLibraryUpdate }: InstantPostFormProps) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ status: string; scheduledFor: string | null } | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [progressActive, setProgressActive] = useState(false);
  const [progressValue, setProgressValue] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [generatedItems, setGeneratedItems] = useState<PlannerContentDetail[]>([]);
  const [library, setLibrary] = useState<MediaAssetSummary[]>(mediaLibrary);

  useEffect(() => {
    setLibrary(mediaLibrary);
  }, [mediaLibrary]);

  useEffect(() => () => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
    }
  }, []);

  const handleLibraryUpdate: Dispatch<SetStateAction<MediaAssetSummary[]>> = (updater) => {
    setLibrary((prev) => (typeof updater === "function" ? (updater as (value: MediaAssetSummary[]) => MediaAssetSummary[])(prev) : updater));
    if (onLibraryUpdate) {
      onLibraryUpdate(updater);
    }
  };

  const form = useForm<InstantPostFormValues>({
    resolver: zodResolver(instantPostFormSchema) as Resolver<InstantPostFormValues>,
    defaultValues: {
      title: "",
      prompt: "",
      publishMode: "now",
      platforms: ["facebook", "instagram"],
      media: [],
      ctaUrl: "",
      linkInBioUrl: "",
      toneAdjust: "default",
      lengthPreference: "standard",
      includeHashtags: true,
      includeEmojis: true,
      ctaStyle: "default",
      placement: "feed",
    },
  });

  const publishMode = form.watch("publishMode");
  const selectedMedia = form.watch("media") ?? [];
  const placement = form.watch("placement");

  useEffect(() => {
    if (placement === "story") {
      const currentPlatforms = form.getValues("platforms") ?? [];
      const filtered = currentPlatforms.filter(
        (platform): platform is InstantPostInput["platforms"][number] => platform !== "gbp",
      );
      const nextPlatforms: InstantPostInput["platforms"] = filtered.length ? filtered : ["instagram"];
      if (filtered.length !== currentPlatforms.length || filtered.length === 0) {
        form.setValue("platforms", nextPlatforms, { shouldDirty: true });
      }
    }
  }, [placement, form]);

  const startProgress = (message: string) => {
    setProgressMessage(message);
    setProgressValue(10);
    setProgressActive(true);
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
    }
    progressTimerRef.current = setInterval(() => {
      setProgressValue((prev) => Math.min(prev + Math.random() * 12 + 3, 90));
    }, 500);
  };

  const stopProgress = () => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    setProgressValue(100);
    setTimeout(() => {
      setProgressActive(false);
      setProgressValue(0);
      setProgressMessage("");
    }, 400);
  };

  const refreshGeneratedItem = async (contentId: string) => {
    const details = await fetchGeneratedContentDetails({ contentIds: [contentId] });
    const detail = details[0];
    if (!detail) return;
    setGeneratedItems((prev) => prev.map((item) => (item.id === contentId ? detail : item)));
  };

  const onSubmit = form.handleSubmit((values) => {
    setGenerationError(null);
    setGeneratedItems([]);
    const progressLabel = placement === "story" ? "Creating story…" : "Generating post variants…";
    startProgress(progressLabel);
    startTransition(async () => {
      try {
        const response = await handleInstantPostSubmission(values);
        setResult({
          status: response.status,
          scheduledFor: response.scheduledFor,
        });
        setProgressMessage("Preparing review…");
        setProgressValue((prev) => Math.max(prev, 70));
        const details = response.contentItemIds?.length
          ? await fetchGeneratedContentDetails({ contentIds: response.contentItemIds })
          : [];
        setGeneratedItems(details);
        const resetPlacement = values.placement ?? "feed";
        form.reset({
          title: "",
          prompt: "",
          publishMode: "now",
          platforms: ["facebook", "instagram"],
          media: [],
          ctaUrl: "",
          linkInBioUrl: "",
          scheduledFor: undefined,
          toneAdjust: "default",
          lengthPreference: "standard",
          includeHashtags: true,
          includeEmojis: true,
          ctaStyle: "default",
          placement: resetPlacement,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to generate content.";
        setGenerationError(message);
      } finally {
        stopProgress();
      }
    });
  });

  const handleMediaAttachmentsChange = (next: MediaAssetInput[]) => {
    if (placement !== "story") {
      form.clearErrors("media");
      form.setValue("media", next, { shouldDirty: true });
      return;
    }

    const previous = form.getValues("media") ?? [];
    const imagesOnly = next.filter((item) => item.mediaType === "image");
    let finalSelection = imagesOnly;

    if (imagesOnly.length !== next.length) {
      form.setError("media", { type: "manual", message: "Stories support images only." });
    }

    if (imagesOnly.length > 1) {
      const added = imagesOnly.find((item) => !previous.some((prevItem) => prevItem.assetId === item.assetId));
      finalSelection = added ? [added] : imagesOnly.slice(0, 1);
      form.setError("media", { type: "manual", message: "Stories can only include one image." });
    } else if (imagesOnly.length === 1) {
      form.clearErrors("media");
    } else {
      form.setError("media", { type: "manual", message: "Attach one image for this story." });
    }

    form.setValue("media", finalSelection, { shouldDirty: true });
  };

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
        <p className="text-sm font-semibold text-slate-900">Placement</p>
        <div className="flex flex-wrap gap-2">
          {([
            { id: "feed", label: "Feed post" },
            { id: "story", label: "Story" },
          ] as const).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => form.setValue("placement", option.id, { shouldDirty: true })}
              className={`rounded-full border border-brand-ambergold px-4 py-2 text-sm font-medium transition ${
                placement === option.id
                  ? "bg-brand-ambergold text-white shadow-md ring-1 ring-brand-ambergold/30"
                  : "bg-white text-brand-ambergold shadow-sm hover:bg-brand-ambergold/10"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {placement === "story" ? (
          <p className="text-xs text-slate-500">Stories auto-publish a single 9:16 image without copy.</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-900">What should we post?</label>
        <textarea
          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none disabled:bg-slate-100"
          rows={4}
          placeholder={
            placement === "story"
              ? "Stories publish without captions."
              : "Give us the context, vibe, and anything we must mention"
          }
          disabled={placement === "story"}
          {...form.register("prompt")}
        />
        {placement !== "story" && form.formState.errors.prompt ? (
          <p className="text-xs text-rose-500">{form.formState.errors.prompt.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-slate-900">Platforms</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PLATFORM_LABELS) as Array<InstantPostInput["platforms"][number]>).map((platform) => {
            const selected = (form.watch("platforms") ?? []).includes(platform);
            const disabled = placement === "story" && platform === "gbp";
            return (
              <button
                key={platform}
                type="button"
                onClick={() => !disabled && togglePlatform(form, platform)}
                disabled={disabled}
                className={`rounded-full border border-brand-ambergold px-4 py-2 text-sm font-medium transition ${
                  selected
                    ? "bg-brand-ambergold text-white shadow-md ring-1 ring-brand-ambergold/30"
                    : "bg-white text-brand-ambergold shadow-sm hover:bg-brand-ambergold/10"
                }`}
              >
                {PLATFORM_LABELS[platform]}
              </button>
            );
          })}
        </div>
        {placement === "story" ? (
          <p className="text-xs text-slate-500">Stories are available on Facebook and Instagram only.</p>
        ) : null}
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
          <div className="space-y-2">
            <input
              type="datetime-local"
              className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
              {...form.register("scheduledFor")}
            />
            <p className="text-xs text-slate-500">Timezone: {ownerTimezone.replace(/_/g, " ")}</p>
          </div>
        ) : null}
        {form.formState.errors.scheduledFor ? (
          <p className="text-xs text-rose-500">
            {form.formState.errors.scheduledFor.message as string}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-900" htmlFor="instant-cta-url">
          Optional CTA link
        </label>
        <input
          id="instant-cta-url"
          type="url"
          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none disabled:bg-slate-100"
          placeholder="https://example.com/booking"
          disabled={placement === "story"}
          {...form.register("ctaUrl")}
        />
        <p className="text-xs text-slate-500">Included on Facebook posts as the primary call to action.</p>
        {form.formState.errors.ctaUrl ? (
          <p className="text-xs text-rose-500">{form.formState.errors.ctaUrl.message}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-900" htmlFor="instant-link-in-bio-url">
          Link in bio destination
        </label>
        <p className="text-xs text-slate-500">
          Guests land here when they tap the tile on your link-in-bio page.
        </p>
        <input
          id="instant-link-in-bio-url"
          type="url"
          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 focus:border-slate-400 focus:outline-none disabled:bg-slate-100"
          placeholder="https://www.the-anchor.pub/book"
          disabled={placement === "story"}
          {...form.register("linkInBioUrl")}
        />
        {form.formState.errors.linkInBioUrl ? (
          <p className="text-xs text-rose-500">{form.formState.errors.linkInBioUrl.message}</p>
        ) : null}
      </div>

      {placement === "feed" ? <AdvancedGenerationControls form={form} /> : null}

      <MediaAttachmentSelector
        assets={library}
        selected={selectedMedia}
        onChange={handleMediaAttachmentsChange}
        label="Media attachments"
        description={
          placement === "story"
            ? "Stories publish a single processed 9:16 image from your Library."
            : "Pick processed images or video from your Library. We’ll automatically use the right rendition per platform."
        }
        onLibraryUpdate={handleLibraryUpdate}
      />
      {form.formState.errors.media ? (
        <p className="text-xs text-rose-500">{form.formState.errors.media.message as string}</p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-full bg-brand-ambergold px-6 py-2 text-sm font-semibold text-white transition hover:bg-brand-ambergold/90 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isPending
          ? placement === "story" ? "Creating story…" : "Generating post…"
          : placement === "story" ? "Create story" : "Generate post"}
      </button>

      <GenerationProgress active={progressActive} value={progressValue} message={progressMessage} />

      {generationError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {generationError}
        </div>
      ) : null}

      {result ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          Draft posts created. Review the generated content below and approve when you’re ready.
        </div>
      ) : null}

      {generatedItems.length ? (
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-900">Review & approve</h3>
          <p className="text-sm text-slate-500">
            Update attachments, then approve each post to schedule it automatically.
          </p>
          <GeneratedContentReviewList
            items={generatedItems}
            ownerTimezone={ownerTimezone}
            mediaLibrary={library}
            onLibraryUpdate={handleLibraryUpdate}
            onRefreshItem={refreshGeneratedItem}
          />
        </section>
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
