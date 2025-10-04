"use client";

import { useRef, useState } from "react";

import { finaliseMediaUpload, requestMediaUpload } from "@/app/(app)/library/actions";

interface UploadingAsset {
  id: string;
  name: string;
  status: "uploading" | "processing" | "complete" | "error";
  error?: string;
}

export function UploadPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<UploadingAsset[]>([]);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;

    const fileArray = Array.from(files);

    for (const file of fileArray) {
      const tempId = `${file.name}-${Date.now()}`;
      setUploading((prev) => [
        { id: tempId, name: file.name, status: "uploading" },
        ...prev,
      ]);

      try {
        const { assetId, uploadUrl, storagePath } = await requestMediaUpload({
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
        });

        updateStatus(tempId, "processing");

        const response = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": file.type,
          },
          body: file,
        });

        if (!response.ok) {
          throw new Error(`Upload failed with status ${response.status}`);
        }

        await finaliseMediaUpload({
          assetId,
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
          storagePath,
        });

        updateStatus(tempId, "complete");
      } catch (error) {
        console.error("[library] upload failed", error);
        updateStatus(tempId, "error", error instanceof Error ? error.message : "Upload failed");
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const updateStatus = (tempId: string, status: UploadingAsset["status"], error?: string) => {
    setUploading((prev) =>
      prev.map((item) =>
        item.id === tempId
          ? {
              ...item,
              status,
              error,
            }
          : item,
      ),
    );
  };

  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => void handleFiles(event.target.files)}
      />
      <p className="text-sm text-slate-600">
        Drag and drop images or videos, or
        <button
          type="button"
          className="ml-1 font-semibold text-slate-900 underline"
          onClick={() => fileInputRef.current?.click()}
        >
          browse files
        </button>
        .
      </p>
      <p className="mt-2 text-xs text-slate-500">
        Files are uploaded to Supabase Storage and processed server-side with FFmpeg to generate platform-ready derivatives.
      </p>
      {uploading.length > 0 && (
        <div className="mt-6 space-y-2 text-left">
          {uploading.map((item) => (
            <div
              key={item.id}
              className="flex flex-col rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 sm:flex-row sm:items-center sm:justify-between"
            >
              <span>{item.name}</span>
              <span className="text-xs font-medium uppercase text-slate-500">
                {item.status === "uploading" && "Requesting slot"}
                {item.status === "processing" && "Uploading"}
                {item.status === "complete" && "Ready"}
                {item.status === "error" && "Failed"}
              </span>
              {item.error ? (
                <span className="text-xs text-rose-500">{item.error}</span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
