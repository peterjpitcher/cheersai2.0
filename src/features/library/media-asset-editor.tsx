"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Loader2, Pencil, Tag, Trash2 } from "lucide-react";

import { deleteMediaAsset, updateMediaAsset } from "@/app/(app)/library/actions";
import type { MediaAssetSummary } from "@/lib/library/data";

interface MediaAssetEditorProps {
  asset: MediaAssetSummary;
  onAssetUpdated?: (asset: MediaAssetSummary) => void;
  suppressRefresh?: boolean;
  variant?: "default" | "compact";
  onAssetDeleted?: (assetId: string) => void;
  footerSlot?: ReactNode;
}

export function MediaAssetEditor({
  asset,
  onAssetUpdated,
  suppressRefresh = false,
  variant = "default",
  onAssetDeleted,
  footerSlot,
}: MediaAssetEditorProps) {
  const router = useRouter();
  const [name, setName] = useState(asset.fileName);
  const [tagsInput, setTagsInput] = useState(asset.tags.join(", "));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<"update" | "delete" | null>(null);
  const [isNameEditing, setIsNameEditing] = useState(false);
  const [isTagsEditing, setIsTagsEditing] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const tagsInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setName(asset.fileName);
    setTagsInput(asset.tags.join(", "));
    setIsNameEditing(false);
    setIsTagsEditing(false);
    setMessage(null);
    setError(null);
  }, [asset.fileName, asset.tags]);

  useEffect(() => {
    if (isNameEditing) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [isNameEditing]);

  useEffect(() => {
    if (isTagsEditing) {
      tagsInputRef.current?.focus();
      tagsInputRef.current?.select();
    }
  }, [isTagsEditing]);

  const previewTags = useMemo(
    () =>
      tagsInput
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    [tagsInput],
  );

  const persistUpdates = () => {
    const trimmedName = name.trim();
    const currentName = asset.fileName ?? "";
    const normalizedName = trimmedName.length ? trimmedName : currentName;

    const currentTags = asset.tags ?? [];
    const parsedTags = previewTags;
    const hasNameChanged = normalizedName !== currentName;
    const hasTagsChanged =
      parsedTags.length !== currentTags.length ||
      parsedTags.some((tag, index) => tag !== (currentTags[index] ?? ""));

    if (!hasNameChanged && !hasTagsChanged) {
      return;
    }

    setError(null);
    setMessage(null);
    setPendingAction("update");

    startTransition(async () => {
      try {
        const updated = await updateMediaAsset({
          assetId: asset.id,
          fileName: normalizedName,
          tags: parsedTags,
        });
        if (updated) {
          setName(updated.fileName);
          setTagsInput(updated.tags.join(", "));
          onAssetUpdated?.(updated);
        }
        setMessage("Saved");
        if (!suppressRefresh) {
          router.refresh();
        }
      } catch (err) {
        const description = err instanceof Error ? err.message : "Unable to update media";
        setError(description);
      } finally {
        setPendingAction(null);
      }
    });
  };

  const closeNameEditor = (shouldPersist: boolean) => {
    setIsNameEditing(false);
    if (shouldPersist) {
      persistUpdates();
    }
  };

  const closeTagsEditor = (shouldPersist: boolean) => {
    setIsTagsEditing(false);
    if (shouldPersist) {
      persistUpdates();
    }
  };

  const handleDelete = () => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Delete this media? It will be removed from your library.");
      if (!confirmed) {
        return;
      }
    }

    setError(null);
    setMessage(null);
    setPendingAction("delete");

    startTransition(async () => {
      try {
        const result = await deleteMediaAsset({ assetId: asset.id });
        if (result.status === "in_use") {
          const reason =
            result.reason === "campaign"
              ? "This media is used as a campaign hero image. Remove it from the campaign first."
              : "This media is attached to drafted or scheduled posts. Detach it before deleting.";
          setError(reason);
          return;
        }

        onAssetDeleted?.(asset.id);
        if (!suppressRefresh) {
          router.refresh();
        }
      } catch (err) {
        const description = err instanceof Error ? err.message : "Unable to delete media";
        setError(description);
      } finally {
        setPendingAction(null);
      }
    });
  };

  const handleNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      closeNameEditor(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setName(asset.fileName);
      closeNameEditor(false);
    }
  };

  const handleTagsKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      closeTagsEditor(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setTagsInput(asset.tags.join(", "));
      closeTagsEditor(false);
    }
  };

  const renderNameBlock = (className: string) =>
    isNameEditing ? (
      <input
        ref={nameInputRef}
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => closeNameEditor(true)}
        onKeyDown={handleNameKeyDown}
        className={className}
        placeholder="Asset name"
        autoComplete="off"
      />
    ) : (
      <p className="truncate font-semibold text-slate-900">{name || "Untitled media"}</p>
    );

  const renderTagsBlock = (className: string) =>
    isTagsEditing ? (
      <input
        ref={tagsInputRef}
        type="text"
        value={tagsInput}
        onChange={(event) => setTagsInput(event.target.value)}
        onBlur={() => closeTagsEditor(true)}
        onKeyDown={handleTagsKeyDown}
        className={className}
        placeholder="promo, story, offer"
        autoComplete="off"
      />
    ) : (
      <div className="flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
        {previewTags.length ? (
          previewTags.map((tag) => (
            <span key={`${asset.id}-tag-${tag}`} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
              #{tag}
            </span>
          ))
        ) : (
          <span className="text-slate-400">Add tags</span>
        )}
      </div>
    );

  const isUpdating = pendingAction === "update";

  const actions = (
    <div className="flex items-center justify-end gap-2 pt-1">
      {footerSlot}
      <button
        type="button"
        onClick={() => (isTagsEditing ? closeTagsEditor(true) : setIsTagsEditing(true))}
        className="rounded-full border border-slate-200 p-1.5 text-slate-500 transition hover:border-slate-400 hover:text-slate-900 disabled:opacity-60"
        aria-label={isTagsEditing ? "Save tags" : "Edit tags"}
        title={isTagsEditing ? "Save tags" : "Edit tags"}
        disabled={isPending && pendingAction !== "delete"}
      >
        {isUpdating && isTagsEditing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Tag className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => (isNameEditing ? closeNameEditor(true) : setIsNameEditing(true))}
        className="rounded-full border border-slate-200 p-1.5 text-slate-500 transition hover:border-slate-400 hover:text-slate-900 disabled:opacity-60"
        aria-label={isNameEditing ? "Save name" : "Rename"}
        title={isNameEditing ? "Save name" : "Rename"}
        disabled={isPending && pendingAction !== "delete"}
      >
        {isUpdating && !isTagsEditing && isNameEditing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Pencil className="h-3.5 w-3.5" />
        )}
      </button>
      <button
        type="button"
        onClick={handleDelete}
        className="rounded-full border border-rose-200 p-1.5 text-rose-600 transition hover:border-rose-300 hover:bg-rose-50 disabled:opacity-60"
        aria-label="Delete media"
        title="Delete media"
        disabled={pendingAction === "delete" && isPending}
      >
        {pendingAction === "delete" && isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  );

  if (variant === "compact") {
    return (
      <div className="space-y-3 text-xs">
        {renderNameBlock("w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 focus:border-brand-teal focus:outline-none focus:ring-1 focus:ring-brand-teal")}
        {renderTagsBlock("w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 focus:border-brand-teal focus:outline-none focus:ring-1 focus:ring-brand-teal")}
        {error ? <p className="text-[11px] text-rose-600">{error}</p> : null}
        {message ? <p className="text-[11px] text-emerald-600">{message}</p> : null}
        {actions}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {renderNameBlock("w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-teal focus:outline-none focus:ring-1 focus:ring-brand-teal")}
      {renderTagsBlock("w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-teal focus:outline-none focus:ring-1 focus:ring-brand-teal")}
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      {message ? <p className="text-xs text-emerald-600">{message}</p> : null}
      {actions}
    </div>
  );
}
