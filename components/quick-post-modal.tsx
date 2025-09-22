"use client";

import { useState, useEffect, useMemo, useRef, useId, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  X, Send, Calendar, Sparkles, Image as ImageIcon,
  Check, FolderOpen,
  CheckCircle, XCircle, AlertTriangle, ChevronRight, ChevronDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from 'sonner'
import ContentFeedback from "@/components/feedback/content-feedback";
import PlatformBadge from "@/components/ui/platform-badge";
import { TERMS } from "@/lib/copy";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ImageSelectionModal from "@/components/campaign/image-selection-modal";
import { preflight } from '@/lib/preflight';
import NextImage from "next/image";
import type { Database } from '@/lib/types/database';

interface QuickPostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  defaultDate?: Date | null;
  initialContent?: string;
  initialInspiration?: string;
}

type BrandProfile = Database['public']['Tables']['brand_profiles']['Row'] | null

interface SocialConnection {
  id: string;
  platform: string;
  account_name: string;
  page_name?: string | null;
  is_active: boolean;
}

type ParsedBrief = {
  summary: string
  why?: string
  activation?: string
  angles?: string
  hashtags?: string
  assets?: string
  compliance?: string
  activationList: string[]
  anglesList: string[]
  assetsList: string[]
  tags: string[]
}

const EMPTY_PARSED_BRIEF: ParsedBrief = {
  summary: '',
  activationList: [],
  anglesList: [],
  assetsList: [],
  tags: [],
}

function parseBrief(text?: string | null): ParsedBrief {
  if (!text) return EMPTY_PARSED_BRIEF
  const body = text.replace(/\r\n/g, '\n')
  const sections = {
    why: /\bWhy it matters:\s*([\s\S]*?)(?=\bActivation ideas:|\bContent angles:|\bHashtags:|\bAsset brief:|$)/i.exec(body)?.[1]?.trim(),
    activation: /\bActivation ideas:\s*([\s\S]*?)(?=\bContent angles:|\bHashtags:|\bAsset brief:|$)/i.exec(body)?.[1]?.trim(),
    angles: /\bContent angles:\s*([\s\S]*?)(?=\bHashtags:|\bAsset brief:|$)/i.exec(body)?.[1]?.trim(),
    hashtags: /\bHashtags:\s*([\s\S]*?)(?=\bAsset brief:|$)/i.exec(body)?.[1]?.trim(),
    assets: /\bAsset brief:\s*([\s\S]*?)(?=\bFor alcohol|$)/i.exec(body)?.[1]?.trim(),
    compliance: /\bFor alcohol[\s\S]*?\.?$/i.exec(body)?.[0]?.trim(),
  }
  const headerEnd = body.search(/\bWhy it matters:/i)
  const summary = headerEnd > 0 ? body.slice(0, headerEnd).trim() : body.trim()
  const toList = (section?: string) => (section ? section.split(/\n|;|•|\u2022/).map(item => item.trim()).filter(Boolean) : [])
  const tags = (sections.hashtags || '').split(/[\s,]+/).filter(tag => /^#/.test(tag))
  return {
    summary,
    why: sections.why,
    activation: sections.activation,
    angles: sections.angles,
    hashtags: sections.hashtags,
    assets: sections.assets,
    compliance: sections.compliance,
    activationList: toList(sections.activation),
    anglesList: toList(sections.angles),
    assetsList: toList(sections.assets),
    tags,
  }
}

function formatBriefForEditing(text?: string | null): string {
  const parsed = parseBrief(text)
  const lines: string[] = []
  if (parsed.summary) {
    lines.push('Summary:')
    lines.push(parsed.summary)
    lines.push('')
  }
  if (parsed.why) {
    lines.push('Why it matters:')
    lines.push(parsed.why)
    lines.push('')
  }
  if (parsed.activationList.length) {
    lines.push('Activation ideas:')
    parsed.activationList.forEach(item => lines.push(`- ${item}`))
    lines.push('')
  }
  if (parsed.anglesList.length) {
    lines.push('Content angles:')
    parsed.anglesList.forEach(item => lines.push(`- ${item}`))
    lines.push('')
  }
  if (parsed.assetsList.length) {
    lines.push('Asset ideas:')
    parsed.assetsList.forEach(item => lines.push(`- ${item}`))
    lines.push('')
  }
  if (parsed.tags.length) {
    lines.push('Hashtags: ' + parsed.tags.join(' '))
    lines.push('')
  }
  if (parsed.compliance) {
    lines.push(parsed.compliance)
  }
  return lines.join('\n')
}

export default function QuickPostModal({ isOpen, onClose, onSuccess, defaultDate, initialContent, initialInspiration }: QuickPostModalProps) {
  const [content, setContent] = useState("");
  const [contentByPlatform, setContentByPlatform] = useState<Record<string, string>>({});
  const [inspiration, setInspiration] = useState("");
  const [creativeMode, setCreativeMode] = useState<'free' | 'guided'>('free');
  const [q1, setQ1] = useState('');
  const [q2, setQ2] = useState('');
  const [q3, setQ3] = useState('');
  const [q4, setQ4] = useState('');
  const [q5, setQ5] = useState('');
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [scheduleType, setScheduleType] = useState<"now" | "later">("now");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [showMediaLibrary, setShowMediaLibrary] = useState(false);
  const [imageModalDefaultTab, setImageModalDefaultTab] = useState<'library'|'upload'|'default'>('library');
  const [brandProfile, setBrandProfile] = useState<BrandProfile>(null);
  // Inline error states per section (replace alert())
  const [genError, setGenError] = useState<string | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inspirationRef = useRef<HTMLTextAreaElement | null>(null);
  const [autoSelectedNoticeShown, setAutoSelectedNoticeShown] = useState(false);
  const [showPreflightDetailsByPlatform, setShowPreflightDetailsByPlatform] = useState<Record<string, boolean>>({});
  const baseId = useId();
  const fieldId = (suffix: string) => `${baseId}-${suffix}`;

  // Derived state
  const selectedPlatforms = useMemo(() => {
    return Array.from(new Set(
      connections
        .filter((c) => selectedConnectionIds.includes(c.id))
        .map((c) => c.platform)
    ));
  }, [connections, selectedConnectionIds]);

  const hasMissingRequiredContent = useMemo(() => {
    if (selectedPlatforms.length === 0) return true;
    return selectedPlatforms.some((p) => !((contentByPlatform[p] || content) || "").trim());
  }, [selectedPlatforms, contentByPlatform, content]);

  const fetchConnections = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: userData0 } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .maybeSingle();
    let connTenantId = userData0?.tenant_id as string | null | undefined;
    if (!connTenantId) {
      const { data: membership } = await supabase
        .from('user_tenants')
        .select('tenant_id, role, created_at')
        .eq('user_id', user.id)
        .order('role', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (membership?.tenant_id) {
        connTenantId = membership.tenant_id as string;
        await supabase.from('users').update({ tenant_id: connTenantId }).eq('id', user.id);
      }
    }
    if (!connTenantId) {
      setConnections([]);
      return;
    }

    const { data } = await supabase
      .from('social_connections')
      .select('id, platform, account_name, page_name, is_active')
      .eq('tenant_id', connTenantId)
      .eq('is_active', true)
      .returns<SocialConnection[] | null>();

    if (Array.isArray(data)) {
      setConnections(data.filter((connection) => connection.platform !== 'twitter'));
    } else {
      setConnections([]);
    }
  }, []);

  const fetchBrandProfile = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: u0 } = await supabase.from('users').select('tenant_id').eq('id', user.id).maybeSingle();
    let qTenantId = u0?.tenant_id as string | null | undefined;
    if (!qTenantId) {
      const { data: membership } = await supabase
        .from('user_tenants')
        .select('tenant_id, role, created_at')
        .eq('user_id', user.id)
        .order('role', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (membership?.tenant_id) {
        qTenantId = membership.tenant_id as string;
        await supabase.from('users').update({ tenant_id: qTenantId }).eq('id', user.id);
      }
    }
    if (!qTenantId) return;
    const { data: bp } = await supabase.from('brand_profiles').select('*').eq('tenant_id', qTenantId).maybeSingle();
    if (bp) setBrandProfile(bp);
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchConnections();
      fetchBrandProfile();
      // Default schedule: if defaultDate provided, use it; otherwise now+15 minutes
      const base = defaultDate ? new Date(defaultDate) : new Date(Date.now() + 15 * 60 * 1000);
      setScheduledDate(base.toISOString().split('T')[0]);
      setScheduledTime(base.toTimeString().slice(0,5));
      setScheduleType('later');
      if (initialContent) {
        setContent(initialContent);
      }
      if (initialInspiration) {
        setCreativeMode('free');
        setInspiration(formatBriefForEditing(initialInspiration));
      }
    }
  }, [isOpen, defaultDate, initialContent, initialInspiration, fetchConnections, fetchBrandProfile]);

  // Autosize the inspiration textarea to fit content
  useEffect(() => {
    const el = inspirationRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [inspiration, isOpen]);

  const addBookingLink = (platform: string) => {
    const url = brandProfile?.booking_url || brandProfile?.website_url;
    if (!url) return;
    setContentByPlatform(prev => ({
      ...prev,
      [platform]: (prev[platform] || '').trim().endsWith(url) ? prev[platform] : `${(prev[platform] || '')}\n${url}`
    }));
  };

  const sanitizeForPlatform = (platform: string, text: string): string => {
    if (platform === 'instagram_business') {
      // Remove raw URLs
      const withoutUrls = text.replace(/https?:\/\/\S+|www\.[^\s]+/gi, '').replace(/\n{3,}/g, '\n\n').trim();
      return withoutUrls;
    }
    return text;
  };

  // Media library modal now uses shared ImageSelectionModal which fetches/media upload internally

  const handleGenerateContent = async () => {
    let context = creativeMode === 'free'
      ? inspiration.trim()
      : [q1 && `What: ${q1}`, q2 && `Why: ${q2}`, q3 && `Action: ${q3}`, q4 && `Where: ${q4}`, q5 && `Details: ${q5}`]
          .filter(Boolean)
          .join('\n');
    // Clamp context length to avoid server-side validation issues
    if (context.length > 3500) context = context.slice(0, 3500);
    if (!context) {
      setGenError('Please provide some inspiration or answer a few questions');
      return;
    }
    
    setGenerating(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No user");

      const { data: userData1 } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('id', user.id)
        .maybeSingle();
      let genTenantId = userData1?.tenant_id as string | null | undefined;
      if (!genTenantId) {
        const { data: membership } = await supabase
          .from('user_tenants')
          .select('tenant_id, role, created_at')
          .eq('user_id', user.id)
          .order('role', { ascending: true })
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (membership?.tenant_id) {
          genTenantId = membership.tenant_id as string;
          await supabase.from('users').update({ tenant_id: genTenantId }).eq('id', user.id);
        }
      }

    // Derive platforms from selected accounts (or all connected if none selected)
    const selectedPlatforms = Array.from(new Set(
      connections.filter(c => selectedConnectionIds.includes(c.id)).map(c => c.platform)
    ));
    const genPlatforms = selectedPlatforms.length > 0
      ? selectedPlatforms
      : Array.from(new Set(connections.map(c => c.platform)));

    const response = await fetch("/api/generate/quick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: context,
        platforms: genPlatforms,
      }),
    });

      // Handle both envelope { ok, data: { contents } } and legacy { contents }
      const json = await response.json().catch(() => null);
      if (response.ok && (json?.ok !== false)) {
        const contents = json?.data?.contents ?? json?.contents ?? {} as Record<string,string>;
        setContent("");
        setContentByPlatform(contents || {});
        // If no accounts selected, auto-select connections matching generated platforms
        if (selectedConnectionIds.length === 0 && connections.length > 0) {
          const want = new Set(Object.keys(contents || {}));
          const autoIds = connections.filter(c => want.has(c.platform)).map(c => c.id);
          if (autoIds.length > 0) {
            setSelectedConnectionIds(autoIds);
            if (!autoSelectedNoticeShown) {
              const platformsList = Array.from(want).map(p => p.replace('_', ' ')).join(', ')
              toast.success(`Selected your connected accounts for: ${platformsList}`)
              setAutoSelectedNoticeShown(true)
            }
          }
        }
        setGenError(null);
      } else {
        const message = json?.error?.message || "Failed to generate content";
        setGenError(message);
        setGenerating(false);
        return;
      }
    } catch (error) {
      console.warn("Generation error:", error);
      if (error instanceof Error) setGenError(error.message);
      else setGenError("Failed to generate content. Please try again.");
    }
    setGenerating(false);
  };


  const handleSubmit = async () => {
    if (selectedConnectionIds.length === 0) {
      setAccountsError("Please select at least one social account");
      return;
    }
    // Derive platforms from selected accounts and validate content per platform
    const selectedPlatforms = Array.from(new Set(
      connections.filter(c => selectedConnectionIds.includes(c.id)).map(c => c.platform)
    ));
    const missing = selectedPlatforms.filter(p => !((contentByPlatform[p] || content) || '').trim());
    if (missing.length > 0) {
      setContentError("Please enter content for all selected platforms");
      return;
    }

    setLoading(true);
    const supabase = createClient();

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No user");

      const { data: userData0 } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('id', user.id)
        .maybeSingle();
      let qpTenantId = userData0?.tenant_id as string | null | undefined;
      if (!qpTenantId) {
        const { data: membership } = await supabase
          .from('user_tenants')
          .select('tenant_id, role, created_at')
          .eq('user_id', user.id)
          .order('role', { ascending: true })
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (membership?.tenant_id) {
          qpTenantId = membership.tenant_id as string;
          await supabase.from('users').update({ tenant_id: qpTenantId }).eq('id', user.id);
        }
      }
      if (!qpTenantId) throw new Error('No tenant');

      // Calculate scheduled time
      let scheduledFor = new Date().toISOString();
      if (scheduleType === "later") {
        scheduledFor = new Date(`${scheduledDate}T${scheduledTime}`).toISOString();
      }

      // Create one quick post per platform (use per-platform content if present)
      const posts = selectedPlatforms.map(platform => ({
        tenant_id: qpTenantId,
        content: (contentByPlatform[platform] || content).trim(),
        platform,
        scheduled_for: scheduledFor,
        status: scheduleType === "now" ? "published" : scheduleType === "later" ? "scheduled" : "draft",
        is_quick_post: true,
        media_url: mediaUrl,
        post_timing: scheduleType === "now" ? "immediate" : "scheduled",
        approval_status: 'approved',
      }));

      const { data: inserted, error } = await supabase
        .from("campaign_posts")
        .insert(posts)
        .select('id, platform')
        .returns<Array<{ id: string; platform: string | null }>>();

      if (error) throw error;

      // Publish or schedule via server for each inserted post
      if (inserted && inserted.length > 0) {
        // Map platforms to selected connection IDs
        const platformToConnections: Record<string, string[]> = {};
        for (const platform of selectedPlatforms) {
          platformToConnections[platform] = connections
            .filter(c => c.platform === platform && selectedConnectionIds.includes(c.id))
            .map(c => c.id);
        }

        const publishCalls = inserted.map(async (postRow) => {
          const platformKey = postRow.platform || '';
          if (!platformKey) {
            return { success: false, error: 'Unknown platform for quick post' };
          }
          const targetIds = platformToConnections[platformKey] || [];
          if (targetIds.length === 0) {
            return { success: false, error: `No selected accounts for ${platformKey}` };
          }
          const resp = await fetch('/api/social/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              postId: postRow.id,
              content: (contentByPlatform[platformKey] || content).trim(),
              connectionIds: targetIds,
              imageUrl: mediaUrl,
              scheduleFor: scheduleType === 'later' ? scheduledFor : undefined,
            })
          });
          const json = await resp.json().catch(() => ({}));
          if (!resp.ok) {
            const errStr = typeof json?.error === 'string' ? json.error : (json?.error?.message || 'Failed to publish');
            return { success: false, error: errStr };
          }
          const rawResults = (json?.data?.results ?? json?.results) as unknown;
          const ok = Array.isArray(rawResults) && rawResults.some((item) => {
            if (!item || typeof item !== 'object') return false;
            const candidate = item as { success?: unknown };
            return candidate.success === true;
          });
          return { success: ok };
        });
        await Promise.allSettled(publishCalls);
      }

      // Success
      if (onSuccess) onSuccess();
      onClose();

      // Reset form
      setContent("");
      setInspiration("");
      setSelectedConnectionIds([]);
      setScheduleType("now");
      setMediaUrl(null);
      setContentByPlatform({});
    } catch (error) {
      console.error("Error creating quick post:", error);
      setSubmitError("Failed to create post");
    }
    setLoading(false);
  };

  const toggleConnection = (connectionId: string) => {
    setSelectedConnectionIds(prev => {
      const next = prev.includes(connectionId)
        ? prev.filter(id => id !== connectionId)
        : [...prev, connectionId];
      if (next.length > 0) setAccountsError(null);
      return next;
    });
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="flex max-h-[92vh] w-[96vw] flex-col overflow-hidden p-0 sm:max-w-[96vw] lg:max-w-[1400px]">
        <DialogHeader className="border-b border-border bg-surface px-6 py-4">
          <DialogTitle className="font-heading text-xl">Quick Post</DialogTitle>
        </DialogHeader>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Submit-level error */}
          {submitError && (
            <div className="mb-6 rounded-medium border border-destructive/30 bg-destructive/10 p-3 text-destructive">
              {submitError}
            </div>
          )}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Left column: accounts + AI */}
            <div className="space-y-6">
              {/* Account Selection */}
              <div>
                <p className="mb-3 block text-sm font-medium">Select Accounts</p>
                <div className="space-y-2">
                  {connections.map((conn) => {
                    const selected = selectedConnectionIds.includes(conn.id);
                    const label = conn.platform === "instagram_business"
                      ? "Instagram"
                      : conn.platform === "google_my_business"
                        ? TERMS.GBP
                        : conn.platform.replace("_", " ");
                    return (
                      <label
                        key={conn.id}
                        className={`flex w-full cursor-pointer items-center gap-3 rounded-medium border-2 p-3 transition-colors ${selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
                      >
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={selected}
                          onChange={() => toggleConnection(conn.id)}
                        />
                        <div className="shrink-0">
                          <PlatformBadge platform={conn.platform} size="md" showLabel={false} />
                        </div>
                        <div className="flex-1 text-left">
                          <p className="font-medium capitalize">{label}</p>
                          <p className="text-sm text-text-secondary">{conn.page_name || conn.account_name}</p>
                        </div>
                        {selected && <Check className="size-5 text-primary" />}
                      </label>
                    );
                  })}
                </div>
                {connections.length === 0 && (
                  <p className="text-sm text-text-secondary">
                    No social accounts connected.
                    <a href="/settings/connections" className="ml-1 text-primary hover:underline">
                      Connect accounts
                    </a>
                  </p>
                )}
                {accountsError && (
                  <div className="mt-3 rounded-medium border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
                    {accountsError}
                  </div>
                )}
              </div>

              {/* AI Inspiration */}
              <div className="rounded-medium border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-start gap-3">
                  <Sparkles className="mt-0.5 size-5 text-primary" />
                  <div className="flex-1">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="inline-flex overflow-hidden rounded-medium border border-border">
                        {(["free", "guided"] as const).map((mode) => (
                          <button
                            key={mode}
                            onClick={() => setCreativeMode(mode)}
                            className={`px-3 py-1.5 text-sm ${creativeMode === mode ? "bg-primary text-white" : "bg-background"} ${mode !== "free" ? "border-l border-border" : ""}`}
                          >
                            {mode === "free" ? "Simple text" : "Answer a few questions"}
                          </button>
                        ))}
                      </div>
                      <Button
                        onClick={handleGenerateContent}
                        loading={generating}
                        disabled={creativeMode === "free" ? !inspiration.trim() : !(q1 || q2 || q3 || q4 || q5)}
                        size="sm"
                      >
                        {!generating && <Sparkles className="mr-1 size-4" />}
                        Generate Content
                      </Button>
                    </div>
                    {creativeMode === "free" ? (
                      <>
                        <div className="mb-2 flex items-center justify-between">
                          <p className="block text-sm font-medium">AI Content Inspiration</p>
                        </div>
                        <textarea
                          ref={inspirationRef}
                          value={inspiration}
                          onChange={(e) => {
                            setInspiration(e.target.value);
                            if (e.target.value.trim()) setGenError(null);
                            // autosize on input
                            const el = inspirationRef.current;
                            if (el) {
                              el.style.height = 'auto';
                              el.style.height = `${el.scrollHeight}px`;
                            }
                          }}
                          placeholder="E.g., Tonight’s quiz from 7pm, prizes, book at cheersbar.co.uk/quiz"
                          className="mb-0 w-full resize-none rounded-md border border-input px-3 py-2 text-sm leading-relaxed"
                          rows={3}
                        />
                      </>
                    ) : (
                      <div className="grid gap-2">
                        <input
                          className="rounded-md border border-input px-3 py-2 text-sm"
                          placeholder="What’s happening? (e.g., Quiz tonight 7pm)"
                          value={q1}
                          onChange={(e) => {
                            setQ1(e.target.value);
                            setGenError(null);
                          }}
                        />
                        <input
                          className="rounded-md border border-input px-3 py-2 text-sm"
                          placeholder="Why should people care? (fun, prizes, atmosphere)"
                          value={q2}
                          onChange={(e) => {
                            setQ2(e.target.value);
                            setGenError(null);
                          }}
                        />
                        <input
                          className="rounded-md border border-input px-3 py-2 text-sm"
                          placeholder="What should people do? (book, call, click)"
                          value={q3}
                          onChange={(e) => {
                            setQ3(e.target.value);
                            setGenError(null);
                          }}
                        />
                        <input
                          className="rounded-md border border-input px-3 py-2 text-sm"
                          placeholder="Link or phone (e.g., cheersbar.co.uk/quiz or 0161 123 4567)"
                          value={q4}
                          onChange={(e) => {
                            setQ4(e.target.value);
                            setGenError(null);
                          }}
                        />
                        <input
                          className="rounded-md border border-input px-3 py-2 text-sm"
                          placeholder="Any details? (e.g., teams up to 6)"
                          value={q5}
                          onChange={(e) => {
                            setQ5(e.target.value);
                            setGenError(null);
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
                {genError && (
                  <div className="mt-3 rounded-medium border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
                    {genError}
                  </div>
                )}
              </div>
            </div>

            {/* Right column: outputs (content, image, schedule) */}
            <div className="space-y-6">
              {/* Per-platform Content Inputs */}
              <div className="space-y-3">
                <p className="block text-sm font-medium">Post Content</p>
                {selectedPlatforms.length === 0 ? (
                  <p className="text-sm text-text-secondary">Select at least one account to edit content.</p>
                ) : (
                  selectedPlatforms.map((p) => (
                    <div key={p} className="rounded-medium border border-border p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium capitalize">{p.replace("_", " ")}</span>
                        <span className="text-xs text-text-secondary">{(contentByPlatform[p] || '').length}</span>
                      </div>
                      <textarea
                        aria-label={`${p} content`}
                        value={contentByPlatform[p] || ""}
                        onChange={(e) => {
                          setContentByPlatform((prev) => ({
                            ...prev,
                            [p]: sanitizeForPlatform(p, e.target.value),
                          }));
                          if ((e.target.value || "").trim()) setContentError(null);
                        }}
                        placeholder="Write or generate content for this platform"
                        className="min-h-[100px] w-full rounded-md border border-input px-3 py-2 text-sm"
                        maxLength={500}
                      />
                      <div className="mt-2 space-y-1 text-xs text-text-secondary">
                        {p === "instagram_business" && /https?:\/\/|www\./i.test(contentByPlatform[p] || "") && (
                          <div>
                            Instagram posts should avoid links; use 'link in bio'. We’ll remove URLs automatically.
                          </div>
                        )}
                        {/* Twitter-specific length handling removed */}
                        {brandProfile && p === "facebook" &&
                          (brandProfile.booking_url || brandProfile.website_url) &&
                          !((contentByPlatform[p] || "").includes(brandProfile.booking_url || "")) && (
                            <button onClick={() => addBookingLink(p)} className="underline hover:text-primary">
                              Insert booking link
                            </button>
                          )}
                      </div>
                      {/* Preflight panel */}
                      {(() => {
                        const text = (contentByPlatform[p] || '').trim()
                        if (!text) return null
                        const pf = preflight(text, p)
                        const overall = pf.overall
                        const codes = new Set((pf.findings || []).map(f => f.code))
                        const panelCls = overall === 'fail' ? 'border-destructive text-destructive' : overall === 'warn' ? 'border-amber-400 text-amber-600' : 'border-green-400 text-green-700'
                        const show = !!showPreflightDetailsByPlatform[p]
                        const items: { label: string; status: 'ok'|'warn'|'fail' }[] = []
                        items.push({ label: 'No banned phrases', status: codes.has('banned_phrase') ? 'fail' : 'ok' })
                        items.push({ label: 'No excessive capitalisation', status: codes.has('caps') ? 'warn' : 'ok' })
                        items.push({ label: 'Limited links (≤ 2)', status: codes.has('too_many_links') ? 'warn' : 'ok' })
                        items.push({ label: 'No emoji spam', status: codes.has('emoji_spam') ? 'warn' : 'ok' })
                        // Twitter character check removed
                        if (p === 'instagram_business') items.push({ label: 'Avoid links in caption', status: codes.has('instagram_links') ? 'warn' : 'ok' })
                        const iconFor = (s: 'ok'|'warn'|'fail') => s === 'ok' ? (
                          <CheckCircle className="size-4 text-green-600" />
                        ) : s === 'warn' ? (
                          <AlertTriangle className="size-4 text-amber-600" />
                        ) : (
                          <XCircle className="size-4 text-red-600" />
                        )
                        return (
                          <div className={`mt-3 rounded-md border p-2 text-xs ${panelCls}`}>
                            <div className="flex items-center justify-between">
                              <span className="font-medium">Preflight: {overall.toUpperCase()}</span>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 hover:underline"
                                onClick={() => setShowPreflightDetailsByPlatform(prev => ({ ...prev, [p]: !show }))}
                              >
                                {show ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />} Details
                              </button>
                            </div>
                            {show && (
                              <ul className="mt-2 space-y-1">
                                {items.map((it, idx) => (
                                  <li key={idx} className="flex items-center gap-2">
                                    {iconFor(it.status)}
                                    <span>{it.label}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )
                      })()}
                      {(contentByPlatform[p] || "").trim() && (
                        <ContentFeedback
                          content={contentByPlatform[p]}
                          prompt={inspiration}
                          platform={p}
                          generationType="quick_post"
                          onRegenerate={handleGenerateContent}
                          className="mt-2"
                        />
                      )}
                    </div>
                  ))
                )}
                {contentError && (
                  <div className="mt-3 rounded-medium border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
                    {contentError}
                  </div>
                )}
              </div>

              {/* Image Upload */}
              <div>
                <p className="mb-2 block text-sm font-medium">Add Image (Optional)</p>
                {mediaUrl ? (
                  <div className="relative">
                    <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-gray-100">
                      <NextImage src={mediaUrl} alt="Selected media" fill sizes="(max-width: 768px) 100vw, 400px" className="object-cover" />
                    </div>
                    <button
                      type="button"
                      onClick={() => setMediaUrl(null)}
                      className="absolute right-2 top-2 rounded-full bg-white p-1 shadow-lg"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    {/* Upload handled via ImageSelectionModal upload tab */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setImageModalDefaultTab('upload'); setShowMediaLibrary(true); }}
                    >
                      <ImageIcon className="mr-1 size-4" />
                      Upload New
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setImageModalDefaultTab('library'); setShowMediaLibrary(true); }}
                    >
                      <FolderOpen className="mr-2 size-4" />
                      Media Library
                    </Button>
                  </div>
                )}
                {/* Errors handled in ImageSelectionModal */}

                {/* Media Library Modal (standard with upload) */}
                {showMediaLibrary && (
                  <ImageSelectionModal
                    isOpen={showMediaLibrary}
                    onClose={() => setShowMediaLibrary(false)}
                    onSelect={(url) => { setMediaUrl(url); setShowMediaLibrary(false); }}
                    currentImageUrl={mediaUrl}
                    defaultTab={imageModalDefaultTab}
                  />
                )}
              </div>

              {/* Schedule Options */}
              <div>
                <p className="mb-3 block text-sm font-medium">When to Post</p>
                <div className="mb-3 flex gap-3">
                  <button
                    onClick={() => setScheduleType("now")}
                    className={`flex-1 rounded-lg border-2 p-3 transition-all ${
                      scheduleType === "now" ? "border-primary bg-primary/5" : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <Send className="mx-auto mb-1 size-5" />
                    <p className="text-sm font-medium">Post Now</p>
                  </button>
                  <button
                    onClick={() => setScheduleType("later")}
                    className={`flex-1 rounded-lg border-2 p-3 transition-all ${
                      scheduleType === "later" ? "border-primary bg-primary/5" : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <Calendar className="mx-auto mb-1 size-5" />
                    <p className="text-sm font-medium">Schedule</p>
                  </button>
                </div>

                {scheduleType === "later" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium" htmlFor={fieldId('schedule-date')}>Date</label>
                      <input
                        id={fieldId('schedule-date')}
                        type="date"
                        value={scheduledDate}
                        onChange={(e) => setScheduledDate(e.target.value)}
                        className="w-full rounded-md border border-input px-3 py-2"
                        min={new Date().toISOString().split("T")[0]}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium" htmlFor={fieldId('schedule-time')}>Time</label>
                      <input
                        id={fieldId('schedule-time')}
                        type="time"
                        value={scheduledTime}
                        onChange={(e) => setScheduledTime(e.target.value)}
                        className="w-full rounded-md border border-input px-3 py-2"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-border bg-surface px-6 py-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} loading={loading} disabled={selectedConnectionIds.length === 0 || hasMissingRequiredContent}>
            {!loading && <Send className="size-4" />}
            {scheduleType === "now" ? "Post Now" : "Schedule Post"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
