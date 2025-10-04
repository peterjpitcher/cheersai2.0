import { OWNER_ACCOUNT_ID } from "@/lib/constants";
import { ensureOwnerAccount } from "@/lib/supabase/owner";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { isSchemaMissingError } from "@/lib/supabase/errors";

export interface MediaAssetSummary {
  id: string;
  fileName: string;
  mediaType: "image" | "video";
  tags: string[];
  uploadedAt: string;
  sizeBytes?: number;
  storagePath: string;
  processedStatus: 'pending' | 'processing' | 'ready' | 'failed' | 'skipped';
  processedAt?: string;
  derivedVariants: Record<string, string>;
}

type MediaAssetRow = {
  id: string;
  file_name: string;
  media_type: "image" | "video";
  tags: string[] | null;
  uploaded_at: string;
  size_bytes: number | null;
  storage_path: string;
  processed_status: 'pending' | 'processing' | 'ready' | 'failed' | 'skipped' | null;
  processed_at: string | null;
  derived_variants: Record<string, string> | null;
};

export async function listMediaAssets(): Promise<MediaAssetSummary[]> {
  await ensureOwnerAccount();
  const supabase = createServiceSupabaseClient();

  try {
    const { data, error } = await supabase
      .from("media_assets")
      .select("id, file_name, media_type, tags, uploaded_at, size_bytes, storage_path, processed_status, processed_at, derived_variants")
      .eq("account_id", OWNER_ACCOUNT_ID)
      .order("uploaded_at", { ascending: false })
      .limit(20)
      .returns<MediaAssetRow[]>();

    if (error) {
      if (isSchemaMissingError(error)) {
        return [];
      }
      throw error;
    }

    if (!data?.length) {
      return [];
    }

    return data.map((row) => ({
      id: row.id,
      fileName: row.file_name,
      mediaType: row.media_type,
      tags: row.tags ?? [],
      uploadedAt: row.uploaded_at,
      sizeBytes: row.size_bytes ?? undefined,
      storagePath: row.storage_path,
      processedStatus: (row.processed_status ?? 'pending') as MediaAssetSummary['processedStatus'],
      processedAt: row.processed_at ?? undefined,
      derivedVariants: row.derived_variants ?? {},
    }));
  } catch (error) {
    if (isSchemaMissingError(error)) {
      return [];
    }
    throw error;
  }
}
