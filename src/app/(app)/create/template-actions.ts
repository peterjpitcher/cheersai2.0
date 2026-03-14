"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/server";

export interface ContentTemplate {
  id: string;
  name: string;
  prompt: string;
  platforms: string[];
  toneAdjust: string;
  ctaUrl: string | null;
  notes: string | null;
  useCount: number;
  createdAt: string;
}

type ContentTemplateRow = {
  id: string;
  name: string;
  prompt: string;
  platforms: string[];
  tone_adjust: string;
  cta_url: string | null;
  notes: string | null;
  use_count: number;
  created_at: string;
};

function fromRow(row: ContentTemplateRow): ContentTemplate {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    platforms: row.platforms,
    toneAdjust: row.tone_adjust,
    ctaUrl: row.cta_url,
    notes: row.notes,
    useCount: row.use_count,
    createdAt: row.created_at,
  };
}

export interface SaveTemplateInput {
  name: string;
  prompt: string;
  platforms: string[];
  toneAdjust: string;
  ctaUrl?: string;
  notes?: string;
}

const saveTemplateSchema = z.object({
  name: z.string().min(1, "Template name is required").max(100, "Name must be 100 characters or fewer"),
  prompt: z.string().min(1, "Prompt is required").max(2000, "Prompt must be 2000 characters or fewer"),
  platforms: z.array(z.string()).min(1, "Select at least one platform"),
  toneAdjust: z.string().min(1),
  ctaUrl: z.string().url("Enter a valid URL").optional().or(z.literal("").transform(() => undefined)),
  notes: z.string().max(500).optional(),
});

export async function listTemplates(): Promise<ContentTemplate[]> {
  const { supabase, accountId } = await requireAuthContext();

  const { data, error } = await supabase
    .from("content_templates")
    .select("id, name, prompt, platforms, tone_adjust, cta_url, notes, use_count, created_at")
    .eq("account_id", accountId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load templates: ${error.message}`);
  }

  return (data as ContentTemplateRow[]).map(fromRow);
}

export async function saveTemplate(
  input: SaveTemplateInput,
): Promise<{ success?: boolean; error?: string; id?: string }> {
  const { supabase, accountId } = await requireAuthContext();

  const parsed = saveTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { name, prompt, platforms, toneAdjust, ctaUrl, notes } = parsed.data;

  const { data, error } = await supabase
    .from("content_templates")
    .insert({
      account_id: accountId,
      name,
      prompt,
      platforms,
      tone_adjust: toneAdjust,
      cta_url: ctaUrl ?? null,
      notes: notes ?? null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    return { error: `Failed to save template: ${error.message}` };
  }

  revalidatePath("/create");
  return { success: true, id: data.id };
}

export async function deleteTemplate(
  id: string,
): Promise<{ success?: boolean; error?: string }> {
  if (!id || typeof id !== "string") {
    return { error: "Invalid template ID" };
  }

  const { supabase, accountId } = await requireAuthContext();

  const { error } = await supabase
    .from("content_templates")
    .delete()
    .eq("id", id)
    .eq("account_id", accountId);

  if (error) {
    return { error: `Failed to delete template: ${error.message}` };
  }

  revalidatePath("/create");
  return { success: true };
}

export async function incrementTemplateUseCount(id: string): Promise<void> {
  if (!id || typeof id !== "string") return;

  const { supabase, accountId } = await requireAuthContext();

  // Fetch current count then increment — non-critical counter so race condition is acceptable
  const { data } = await supabase
    .from("content_templates")
    .select("use_count")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle<{ use_count: number }>();

  if (!data) return;

  await supabase
    .from("content_templates")
    .update({ use_count: data.use_count + 1, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("account_id", accountId);
  // Silently ignore errors — this is a non-critical usage counter
}
