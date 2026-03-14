"use client";

import { useState, useTransition } from "react";

import {
  listTemplates,
  saveTemplate,
  deleteTemplate,
  incrementTemplateUseCount,
  type ContentTemplate,
} from "@/app/(app)/create/template-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TemplateSelectorProps {
  onSelect: (template: ContentTemplate) => void;
  currentPrompt: string;
  currentPlatforms: string[];
  currentToneAdjust: string;
}

export function TemplateSelector({
  onSelect,
  currentPrompt,
  currentPlatforms,
  currentToneAdjust,
}: TemplateSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [templates, setTemplates] = useState<ContentTemplate[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Save form state
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();

  // Delete pending state per template id
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleOpen = () => {
    setIsOpen(true);
    startTransition(async () => {
      try {
        const data = await listTemplates();
        setTemplates(data);
        setLoadError(null);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load templates.");
      }
    });
  };

  const handleClose = () => {
    setIsOpen(false);
    setIsSaveOpen(false);
    setSaveName("");
    setSaveError(null);
    setLoadError(null);
  };

  const handleLoad = (template: ContentTemplate) => {
    onSelect(template);
    // Fire-and-forget use count increment
    void incrementTemplateUseCount(template.id);
    handleClose();
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this template? This cannot be undone.")) return;
    setDeletingId(id);
    startTransition(async () => {
      const result = await deleteTemplate(id);
      setDeletingId(null);
      if (result.error) {
        setLoadError(result.error);
        return;
      }
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    });
  };

  const handleSave = () => {
    setSaveError(null);
    const name = saveName.trim();
    if (!name) {
      setSaveError("Enter a name for this template.");
      return;
    }
    if (!currentPrompt.trim()) {
      setSaveError("The current prompt is empty — fill it in before saving.");
      return;
    }

    startSaveTransition(async () => {
      const result = await saveTemplate({
        name,
        prompt: currentPrompt,
        platforms: currentPlatforms,
        toneAdjust: currentToneAdjust,
      });

      if (result.error) {
        setSaveError(result.error);
        return;
      }

      // Optimistically add to list if already open
      if (result.id) {
        const newTemplate: ContentTemplate = {
          id: result.id,
          name,
          prompt: currentPrompt,
          platforms: currentPlatforms,
          toneAdjust: currentToneAdjust,
          ctaUrl: null,
          notes: null,
          useCount: 0,
          createdAt: new Date().toISOString(),
        };
        setTemplates((prev) => [newTemplate, ...prev]);
      }

      setIsSaveOpen(false);
      setSaveName("");
    });
  };

  return (
    <div className="space-y-2">
      {/* Trigger row */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="bg-white shadow-sm text-xs h-8 px-3"
          onClick={handleOpen}
        >
          Load saved prompt
        </Button>
        <Button
          type="button"
          variant="outline"
          className="bg-white shadow-sm text-xs h-8 px-3"
          onClick={() => setIsSaveOpen((prev) => !prev)}
        >
          Save as template
        </Button>
      </div>

      {/* Save-as-template inline form */}
      {isSaveOpen ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
          <Label htmlFor="template-name" className="text-xs font-semibold text-slate-700">
            Template name
          </Label>
          <Input
            id="template-name"
            type="text"
            placeholder="e.g. Weekly quiz night"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            className="h-8 text-sm"
          />
          {saveError ? (
            <p className="text-xs text-rose-500">{saveError}</p>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              className="h-8 px-3 text-xs"
              disabled={isSaving}
              onClick={handleSave}
            >
              {isSaving ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-8 px-3 text-xs bg-white"
              onClick={() => {
                setIsSaveOpen(false);
                setSaveName("");
                setSaveError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {/* Template browser panel */}
      {isOpen ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Saved prompts</p>
            <Button
              type="button"
              variant="ghost"
              className="h-7 w-7 p-0 text-slate-400 hover:text-slate-600"
              onClick={handleClose}
              aria-label="Close saved prompts"
            >
              ✕
            </Button>
          </div>

          <div className="divide-y divide-slate-100">
            {isPending ? (
              <p className="px-4 py-6 text-sm text-slate-500 text-center">Loading…</p>
            ) : loadError ? (
              <p className="px-4 py-6 text-sm text-rose-500 text-center">{loadError}</p>
            ) : templates.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500 text-center">
                No saved prompts yet. Fill in a prompt above and click &ldquo;Save as template&rdquo; to create one.
              </p>
            ) : (
              templates.map((template) => (
                <div key={template.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{template.name}</p>
                    <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">
                      {template.prompt.length > 80
                        ? `${template.prompt.slice(0, 80)}…`
                        : template.prompt}
                    </p>
                    {template.useCount > 0 ? (
                      <p className="text-xs text-slate-400 mt-0.5">
                        Used {template.useCount} {template.useCount === 1 ? "time" : "times"}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      type="button"
                      className="h-7 px-3 text-xs"
                      onClick={() => handleLoad(template)}
                    >
                      Load
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-rose-400 hover:text-rose-600 hover:bg-rose-50"
                      disabled={deletingId === template.id}
                      onClick={() => handleDelete(template.id)}
                      aria-label={`Delete template ${template.name}`}
                    >
                      {deletingId === template.id ? "…" : "Delete"}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
