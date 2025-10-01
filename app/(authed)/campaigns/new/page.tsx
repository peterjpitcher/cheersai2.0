"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import NextImage from "next/image";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/datetime";
import {
  Calendar,
  Clock,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  PartyPopper,
  Loader2,
  Check,
  Upload,
  X,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import Container from "@/components/layout/container";
import CropSquareModal from "@/components/media/crop-square-modal";
import { WatermarkPrompt } from "@/components/media/watermark-prompt";
import WatermarkAdjuster from "@/components/watermark/watermark-adjuster";
import { validateWatermarkSettings, type WatermarkSettings } from "@/lib/utils/watermark";

const CAMPAIGN_TYPES = [
  {
    id: "event_build_up",
    label: "Event Build-Up",
    icon: PartyPopper,
    description: "Strategic posts building up to an event",
    color: "bg-purple-500",
  },
  {
    id: "offer_countdown",
    label: "Offer Countdown",
    icon: Sparkles,
    description: "Announce and count down to an offer ending",
    color: "bg-green-500",
  },
  {
    id: "recurring_weekly",
    label: "Weekly Reminder",
    icon: Calendar,
    description: "Weekly reminder for a regular activity",
    color: "bg-teal-500",
  },
];

interface MediaAsset {
  id: string;
  file_url: string;
  file_name: string;
  created_at?: string;
  tags?: string[] | null;
}

type GuidedQuestionKey =
  | "q_whats_happening"
  | "q_why_care"
  | "q_call_to_action"
  | "q_link_or_phone"
  | "q_special_details";

interface GuidedQuestion {
  key: GuidedQuestionKey;
  label: string;
  placeholder: string;
}

interface CampaignFormData {
  name: string;
  campaign_type: string;
  event_date: string;
  event_time: string;
  hero_image_id: string;
  creative_mode: "free" | "guided";
  creative_brief: string;
  q_whats_happening: string;
  q_why_care: string;
  q_call_to_action: string;
  q_link_or_phone: string;
  q_special_details: string;
  primary_cta: string;
}

interface PostingScheduleEntry {
  day_of_week: number;
  time: string;
}

interface WatermarkLogo {
  is_active?: boolean;
  file_url?: string | null;
}

interface CampaignPayload {
  name: string;
  campaign_type: string;
  event_date: string | null;
  hero_image_id: string | null;
  status: "draft";
  selected_timings: string[];
  custom_dates: string[];
  description: string | null;
  call_to_action: string | null;
}

export default function NewCampaignPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [cropOpen, setCropOpen] = useState(false);
  const [wmPromptOpen, setWmPromptOpen] = useState(false);
  const [wmAdjustOpen, setWmAdjustOpen] = useState(false);
  const [wmDefaults, setWmDefaults] = useState<WatermarkSettings | null>(null);
  const [hasActiveLogo, setHasActiveLogo] = useState(false);
  const [activeLogoUrl, setActiveLogoUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [pendingFileName, setPendingFileName] = useState<string>("");
  const [wmDeclined, setWmDeclined] = useState(false);
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [selectedPostDates, setSelectedPostDates] = useState<string[]>([]);
  const [customDates, setCustomDates] = useState<Array<{ date: string; time: string }>>([]);
  const [postingSchedule, setPostingSchedule] = useState<PostingScheduleEntry[]>([]);
  const [pageError, setPageError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Recurring inputs
  const [recurrenceStart, setRecurrenceStart] = useState<string>('');
  const [recurrenceEnd, setRecurrenceEnd] = useState<string>('');
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]); // 0=Sun..6=Sat
  const [recurrenceTime, setRecurrenceTime] = useState<string>('07:00');
  const [formData, setFormData] = useState<CampaignFormData>({
    name: "",
    campaign_type: "",
    event_date: "",
    event_time: "",
    hero_image_id: "",
    creative_mode: "free",
    creative_brief: "",
    q_whats_happening: "",
    q_why_care: "",
    q_call_to_action: "",
    q_link_or_phone: "",
    q_special_details: "",
    primary_cta: "",
  });

  const selectedCampaignType = CAMPAIGN_TYPES.find((type) => type.id === formData.campaign_type) || null;
  const friendlyCampaignLabel = selectedCampaignType?.label ?? 'Campaign';
  const friendlyCampaignDescription = friendlyCampaignLabel
    ? friendlyCampaignLabel.charAt(0).toLowerCase() + friendlyCampaignLabel.slice(1)
    : 'campaign';

  // Guided questions per campaign type (plain language)
  const getGuidedQuestions = (): GuidedQuestion[] => {
    const type = formData.campaign_type || 'event_build_up';
    if (type === 'offer_countdown') {
      return [
        { key: 'q_whats_happening' as const, label: "What’s the offer?", placeholder: "E.g., 2-for-1 burgers, £10 pizza & pint" },
        { key: 'q_why_care' as const, label: "When is it on?", placeholder: "E.g., Mon–Thu, 5–7pm" },
        { key: 'q_call_to_action' as const, label: "How do people get it?", placeholder: "E.g., show code SAVE10, book online" },
        { key: 'q_link_or_phone' as const, label: "Where should they go or call?", placeholder: "E.g., cheersbar.co.uk/deals or 0161 123 4567" },
        { key: 'q_special_details' as const, label: "Any rules?", placeholder: "E.g., excludes Fridays, eat in only" },
      ];
    }
    if (type === 'recurring_weekly') {
      return [
        { key: 'q_whats_happening' as const, label: "What’s the weekly reminder for?", placeholder: "E.g., Sunday lunch, quiz night, weekly offer" },
        { key: 'q_why_care' as const, label: "What’s appealing about it?", placeholder: "E.g., roast specials, prizes, time-limited deal" },
        { key: 'q_call_to_action' as const, label: "What should people do?", placeholder: "E.g., book a table, see the menu" },
        { key: 'q_link_or_phone' as const, label: "Where should they go or call?", placeholder: "E.g., cheersbar.co.uk/sunday or 0161 123 4567" },
        { key: 'q_special_details' as const, label: "Helpful details", placeholder: "E.g., kitchen open later, family friendly" },
      ];
    }
    // Event build-up (default)
    return [
      { key: 'q_whats_happening' as const, label: "What’s happening and when?", placeholder: "E.g., Friday Quiz Night, starts 7pm" },
      { key: 'q_why_care' as const, label: "Why should people be interested?", placeholder: "E.g., fun night out, prizes, great atmosphere" },
      { key: 'q_call_to_action' as const, label: "What do you want people to do?", placeholder: "E.g., book a table, click to see menu, call us" },
      { key: 'q_link_or_phone' as const, label: "Where should they go or call?", placeholder: "E.g., cheersbar.co.uk/quiz or 0161 123 4567" },
      { key: 'q_special_details' as const, label: "Any special details or offers?", placeholder: "E.g., teams up to 6, 2-for-1 pizzas until 8pm" },
    ];
  };

  // Load user's posting schedule (tenant-scoped) for default times
  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: u } = await supabase.from('users').select('tenant_id').eq('id', user.id).maybeSingle();
        const tenantId = u?.tenant_id as string | null | undefined;
        if (!tenantId) return;
        const { data: sched } = await supabase
          .from('posting_schedules')
          .select('day_of_week, time')
          .eq('tenant_id', tenantId)
          .order('day_of_week')
          .order('time');
        const schedule = Array.isArray(sched)
          ? sched.filter((entry): entry is PostingScheduleEntry =>
              typeof entry?.day_of_week === 'number' && typeof entry?.time === 'string'
            )
          : [];
        setPostingSchedule(schedule);
      } catch {}
    })();
  }, []);

  const defaultTimeForDate = (isoDate: string): string => {
    try {
      const d = new Date(isoDate);
      const dow = d.getDay(); // 0=Sun..6=Sat
      const times = postingSchedule.filter(s => s.day_of_week === dow).map(s => s.time).sort();
      return times[0] || '07:00';
    } catch {
      return '07:00';
    }
  };

  // Default all eligible recommended dates as selected on schedule step
  useEffect(() => {
    if (step !== 3) return;
    if (formData.campaign_type === 'recurring_weekly') return;
    if (!formData.event_date) return;
    if (selectedPostDates.length > 0) return; // don't override user choices

    try {
      const eventDate = new Date(formData.event_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const showIfValid = (daysBefore: number) => {
        const d = new Date(eventDate);
        d.setDate(d.getDate() - daysBefore);
        return d >= today && daysBefore <= 30; // capped at 1 month before
      };

      const daysUntilEvent = Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const weeksUntilEvent = Math.floor(daysUntilEvent / 7);

      const selections: string[] = [];

      // 6 weeks (normally hidden by 30-day cap, but respect UI condition anyway)
      if (weeksUntilEvent >= 6 && showIfValid(42)) {
        const d = new Date(eventDate); d.setDate(d.getDate() - 42);
        selections.push(`six_weeks_${d.toISOString()}`);
      }

      // 5 weeks (also typically capped out)
      if (weeksUntilEvent >= 5 && showIfValid(35)) {
        const d = new Date(eventDate); d.setDate(d.getDate() - 35);
        selections.push(`five_weeks_${d.toISOString()}`);
      }

      // 1 month before
      if (weeksUntilEvent >= 4 && showIfValid(30)) {
        const d = new Date(eventDate); d.setDate(d.getDate() - 30);
        selections.push(`month_before_${d.toISOString()}`);
      }

      // 2 weeks
      if (weeksUntilEvent >= 2 && showIfValid(14)) {
        const d = new Date(eventDate); d.setDate(d.getDate() - 14);
        selections.push(`two_weeks_${d.toISOString()}`);
      }

      // 1 week
      if (weeksUntilEvent >= 1 && showIfValid(7)) {
        const d = new Date(eventDate); d.setDate(d.getDate() - 7);
        selections.push(`week_before_${d.toISOString()}`);
      }

      // Day before
      if (showIfValid(1)) {
        const d = new Date(eventDate); d.setDate(d.getDate() - 1);
        selections.push(`day_before_${d.toISOString()}`);
      }

      // Day of
      if (showIfValid(0)) {
        const d = new Date(eventDate);
        selections.push(`day_of_${d.toISOString()}`);
      }

      if (selections.length > 0) setSelectedPostDates(selections);
    } catch {}
  }, [step, formData.campaign_type, formData.event_date, selectedPostDates.length]);

  const normaliseMediaAsset = useCallback((input: unknown): MediaAsset | null => {
    if (!input) return null;
    if (Array.isArray(input)) {
      for (const item of input) {
        const normalised = normaliseMediaAsset(item);
        if (normalised) return normalised;
      }
      return null;
    }
    if (typeof input !== 'object') return null;
    const asset = input as Record<string, unknown>;
    const idSource = asset.id ?? asset.asset_id ?? asset.media_id;
    const id = typeof idSource === 'string' ? idSource : typeof idSource === 'number' ? String(idSource) : '';
    const fileUrlSource = asset.file_url ?? asset.url ?? asset.public_url ?? asset.publicUrl;
    const fileUrl = typeof fileUrlSource === 'string' ? fileUrlSource : '';
    if (!id || !fileUrl) return null;
    const fileNameSource = asset.file_name ?? asset.name ?? asset.filename;
    const file_name = typeof fileNameSource === 'string' && fileNameSource.trim().length > 0 ? fileNameSource : 'Campaign asset';
    const created_at = typeof asset.created_at === 'string' ? asset.created_at : undefined;
    const tagsValue = Array.isArray(asset.tags)
      ? asset.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
      : null;

    return {
      id,
      file_url: fileUrl,
      file_name,
      created_at,
      tags: tagsValue && tagsValue.length ? tagsValue : null,
    } satisfies MediaAsset;
  }, []);

  const fetchMediaAssets = useCallback(async () => {
    try {
      // Use server route to avoid RLS/policy issues in prod
      const res = await fetch('/api/media/list', { cache: 'no-store' });
      if (!res.ok) {
        console.warn('Failed to load media list:', await res.text());
        setMediaAssets([]);
        return [] as MediaAsset[];
      }
      const payload = await res.json();
      const rawAssets: unknown[] = Array.isArray(payload?.data?.assets)
        ? payload.data.assets
        : Array.isArray(payload?.assets)
          ? payload.assets
          : [];
      const normalised = rawAssets
        .map((item) => normaliseMediaAsset(item))
        .filter((asset): asset is MediaAsset => Boolean(asset));
      setMediaAssets(normalised);
      return normalised;
    } catch (e) {
      console.error('Media list error:', e);
      setMediaAssets([]);
      return [] as MediaAsset[];
    }
  }, [normaliseMediaAsset]);

  useEffect(() => {
    void fetchMediaAssets();
  }, [fetchMediaAssets]);

  const handleTypeSelect = (type: string) => {
    setFormData({ ...formData, campaign_type: type });
  };

  const handleImageSelect = (imageId: string) => {
    setFormData({ ...formData, hero_image_id: imageId });
  };

  // Helper function to compress image
  const compressImage = async (file: File, maxWidth = 1920, maxHeight = 1920, quality = 0.85): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        
        // Calculate new dimensions
        if (width > height) {
          if (width > maxWidth) {
            height = height * (maxWidth / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = width * (maxHeight / height);
            height = maxHeight;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        
        // Draw and compress
        ctx?.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Canvas toBlob failed'));
            }
          },
          'image/jpeg',
          quality
        );
      };
      
      img.onerror = () => reject(new Error('Image load failed'));
      
      // Handle both File and Blob inputs
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('FileReader failed'));
      reader.readAsDataURL(file);
    });
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/") && !file.type.includes("heic") && !file.type.includes("heif")) {
      setUploadError("Please upload an image file");
      return;
    }
    setUploadProgress(0);
    try {
      setUploadProgress(10);
      // Hold and prompt crop if not square
      setPendingFile(file)
      setPendingFileName(file.name)
      const probe = new window.Image()
      const url = URL.createObjectURL(file)
      await new Promise<void>((resolve)=>{ probe.onload=()=>resolve(); probe.src=url })
      URL.revokeObjectURL(url)
      if (probe.width !== probe.height) {
        setCropOpen(true)
        return
      }
      await proceedUploadCampaignImage(file, file.name)
    } catch (e) {
      console.error('Upload error details:', e)
      setUploadError(e instanceof Error ? e.message : 'Failed to upload image')
      setUploadProgress(0)
    } finally {
      // Clear the input
      event.target.value = "";
    }
  };

  async function proceedUploadCampaignImage(initialFile: Blob | File, initialName: string, opts?: { skipWatermark?: boolean }) {
    try {
      setUploadError(null)
      setUploading(true)
      setUploadProgress(20)
      let uploadFile: Blob | File = initialFile
      let finalFileName = initialName
      // Compress if >2MB
      if ((uploadFile as File).size && ((uploadFile as File).size > 2 * 1024 * 1024)) {
        try {
          const compressed = await compressImage(uploadFile as File)
          uploadFile = compressed
          finalFileName = initialName.replace(/\.(heic|heif|HEIC|HEIF)$/i, '.jpg')
          if (!finalFileName.endsWith('.jpg')) finalFileName = finalFileName.replace(/\.[^.]+$/, '.jpg')
        } catch {}
      }
      setUploadProgress(30)
      // Watermark flow
      try {
        const w = await fetch('/api/media/watermark')
        if (w.ok) {
          const json = await w.json()
          const logos: WatermarkLogo[] = json.data?.logos || json.logos || []
          const active = logos.find((logo) => logo?.is_active)
          setHasActiveLogo(!!active)
          setActiveLogoUrl(active?.file_url || null)
          const defaultsRaw: Partial<WatermarkSettings> | undefined = json.data?.settings || json.settings
          const validatedDefaults = defaultsRaw ? validateWatermarkSettings(defaultsRaw) : null
          setWmDefaults(validatedDefaults)
          if (active) {
            if (validatedDefaults?.auto_apply) {
              const f = new FormData()
              f.append('image', new File([uploadFile], finalFileName, { type: 'image/jpeg' }))
              const wmRes = await fetch('/api/media/watermark', { method: 'POST', body: f })
              if (wmRes.ok) uploadFile = await wmRes.blob()
            } else if (!(opts?.skipWatermark || wmDeclined)) {
              setPendingBlob(new Blob([uploadFile], { type: 'image/jpeg' }))
              setPendingFileName(finalFileName)
              setWmPromptOpen(true)
              setUploading(false)
              return
            }
          }
        }
      } catch {}
      // Upload to server
      const form = new FormData()
      form.append('image', new File([uploadFile], finalFileName, { type: 'image/jpeg' }))
      const res = await fetch('/api/media/upload', { method: 'POST', body: form })
      if (!res.ok) throw new Error(await res.text())
      const payload = await res.json()
      const rawAsset = payload?.data?.asset ?? payload?.asset
      const fallbackId = (rawAsset && typeof rawAsset === 'object' && !Array.isArray(rawAsset))
        ? (typeof (rawAsset as Record<string, unknown>).id === 'string'
            ? (rawAsset as Record<string, unknown>).id as string
            : typeof (rawAsset as Record<string, unknown>).id === 'number'
              ? String((rawAsset as Record<string, unknown>).id)
              : undefined)
        : undefined;
      setUploadProgress(90)
      setUploadProgress(100)
      // integrate asset into page state
      let normalisedAsset = normaliseMediaAsset(rawAsset)
      if (!normalisedAsset) {
        const refreshed = await fetchMediaAssets()
        normalisedAsset = fallbackId
          ? refreshed.find((asset: MediaAsset) => asset.id === fallbackId) ?? null
          : refreshed[0] ?? null
      } else {
        setMediaAssets((prev) => {
          const withoutDuplicate = prev.filter((asset: MediaAsset) => asset.id !== normalisedAsset!.id)
          return [normalisedAsset!, ...withoutDuplicate]
        })
      }
      if (!normalisedAsset) {
        throw new Error('Upload succeeded but returned an invalid asset payload')
      }
      setFormData((prev) => ({ ...prev, hero_image_id: normalisedAsset!.id }))
      void fetchMediaAssets()
      setTimeout(() => { setUploadProgress(0); setUploading(false) }, 500)
      setPendingFile(null)
      setPendingBlob(null)
      setPendingFileName('')
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed')
      setUploading(false)
      setUploadProgress(0)
    }
  }

  const handleCropped = async (blob: Blob) => {
    setCropOpen(false)
    setWmDeclined(false)
    await proceedUploadCampaignImage(blob, pendingFileName || 'image.jpg')
  }
  const handleKeepOriginal = async () => {
    setCropOpen(false)
    setWmDeclined(false)
    if (pendingFile) await proceedUploadCampaignImage(pendingFile, pendingFile.name)
  }
  const handleWmConfirm = () => { setWmPromptOpen(false); setWmAdjustOpen(true) }
  const handleApplyWm = async (adjusted: WatermarkSettings) => {
    if (!pendingBlob) return
    try {
      const form = new FormData()
      form.append('image', new File([pendingBlob], pendingFileName || 'image.jpg', { type: 'image/jpeg' }))
      if (adjusted?.position) form.append('position', adjusted.position)
      if (adjusted?.opacity) form.append('opacity', String(adjusted.opacity))
      if (adjusted?.size_percent) form.append('size_percent', String(adjusted.size_percent))
      if (adjusted?.margin_pixels) form.append('margin_pixels', String(adjusted.margin_pixels))
      const res = await fetch('/api/media/watermark', { method: 'POST', body: form })
      const blob = res.ok ? await res.blob() : pendingBlob
      await proceedUploadCampaignImage(blob, pendingFileName || 'image.jpg')
    } catch {
      await proceedUploadCampaignImage(pendingBlob, pendingFileName || 'image.jpg')
    } finally {
      setWmAdjustOpen(false)
      setPendingBlob(null)
    }
  }

  const handleSubmit = async () => {
    setLoading(true);
    setPageError(null);
    try {
      // Validate event dates / ranges are not in the past
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (formData.campaign_type !== 'recurring_weekly') {
        const eventDate = new Date(formData.event_date);
        eventDate.setHours(0, 0, 0, 0);

        if (eventDate < today) {
          setPageError("Campaign event date cannot be in the past. Please select today or a future date.");
          setLoading(false);
          return;
        }

        // Validate custom dates are not in the past
        for (const customDate of customDates) {
          const customDateTime = new Date(customDate.date);
          customDateTime.setHours(0, 0, 0, 0);
          if (customDateTime < today) {
            setPageError("Custom post dates cannot be in the past. Please select today or future dates only.");
            setLoading(false);
            return;
          }
        }
      } else {
        const start = new Date(recurrenceStart);
        const end = new Date(recurrenceEnd);
        start.setHours(0, 0, 0, 0);
        end.setHours(0, 0, 0, 0);
        if (start < today) {
          setPageError('Recurring campaigns must start today or later.');
          setLoading(false);
          return;
        }
        if (end < start) {
          setPageError('Recurring campaigns must end on or after the start date.');
          setLoading(false);
          return;
        }
      }
      
      // No client-side auth/tenant resolution here — server route resolves tenant and validates auth

      // Plan checks and tenant resolution happen server-side in /api/campaigns/create

      // Combine date and time (tolerate HH:MM or HH:MM:SS)
      const normalizeIsoLocal = (d: string, t?: string | null) => {
        const time = (t || '').trim()
        let hh = '00', mm = '00', ss = '00'
        if (time) {
          const m = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
          if (m) { hh = m[1].padStart(2,'0'); mm = m[2]; ss = (m[3] || '00'); }
        }
        const local = `${d}T${hh}:${mm}:${ss}`
        const dt = new Date(local)
        if (isNaN(dt.getTime())) throw new RangeError('invalid date')
        return dt.toISOString()
      }

      // Combine date and time
      let eventDateTime: string | null = null;
      if (formData.event_date && formData.campaign_type !== 'recurring_weekly') {
        eventDateTime = normalizeIsoLocal(formData.event_date, formData.event_time || '00:00')
      }

      // Extract selected timings and custom dates
      const allowedTimingIds = new Set(['month_before','two_weeks','two_days_before','week_before','day_before','day_of']);
      const selectedTimingIds: string[] = [];
      let customDatesArray: string[] = customDates.map((cd) =>
        normalizeIsoLocal(cd.date, cd.time || '07:00')
      );
      if (formData.campaign_type !== 'recurring_weekly') {
        for (const key of selectedPostDates) {
          // key format: `<token>_<ISO>`
          const idx = key.lastIndexOf('_');
          if (idx === -1) continue;
          const token = key.slice(0, idx);
          const iso = key.slice(idx + 1);
          if (token === 'day_of_end') {
            // Map to standard day_of against end-date (we already anchor end-date via event_date for offer)
            selectedTimingIds.push('day_of');
            continue;
          }
          if (token === 'offer_start' || token === 'two_days_before') {
            // Not supported as timing IDs — treat as custom post dates
            try { customDatesArray.push(new Date(iso).toISOString()); } catch {}
            continue;
          }
          if (allowedTimingIds.has(token)) {
            selectedTimingIds.push(token);
          }
        }
      }
      if (formData.campaign_type === 'recurring_weekly') {
        // Expand recurrence between start/end for selected weekdays at recurrenceTime
        const start = new Date(recurrenceStart)
        const end = new Date(recurrenceEnd)
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || !recurrenceDays.length) {
          throw new Error('Please select start date, end date, and at least one weekday for recurring campaigns')
        }
        const dates: string[] = []
        const cursor = new Date(start)
        cursor.setHours(0,0,0,0)
        end.setHours(0,0,0,0)
        while (cursor <= end) {
          if (recurrenceDays.includes(cursor.getDay())) {
            const ymd = cursor.toISOString().split('T')[0]
            dates.push(normalizeIsoLocal(ymd, recurrenceTime || '12:00'))
          }
          cursor.setDate(cursor.getDate()+1)
        }
        customDatesArray = dates
      }

          // Build description from creative inputs
          let description: string | null = null;
          if (formData.creative_mode === 'free') {
            description = formData.creative_brief?.trim() || null;
          } else {
            const qs = getGuidedQuestions();
            const lines: string[] = [];
            qs.forEach((q) => {
              const val = formData[q.key];
              if (val) lines.push(`${q.label}: ${val}`);
            });
            description = lines.length ? lines.join('\n') : null;
          }

          // Create campaign with user selections via API endpoint (includes server-side validation)
          const normalizedCta = formData.primary_cta.trim();

          const campaignData: CampaignPayload = {
            name: formData.name,
            campaign_type: formData.campaign_type === 'event_build_up' ? 'event' : formData.campaign_type === 'offer_countdown' ? 'special' : formData.campaign_type === 'recurring_weekly' ? 'seasonal' : formData.campaign_type,
            event_date: eventDateTime,
            hero_image_id: formData.hero_image_id || null,
            status: "draft",
            selected_timings: selectedTimingIds,
            custom_dates: customDatesArray,
            description,
            call_to_action: normalizedCta ? normalizedCta : null,
          };
      
      const response = await fetch("/api/campaigns/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campaignData),
      });

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          setPageError('Your session has expired. Please sign in again.');
          setLoading(false);
          router.push('/auth/login');
          return;
        }
        // Surface first field-level validation error when available
        let detailMsg = '';
        const details = result?.error?.details;
        if (details) {
          if (Array.isArray(details._errors) && details._errors[0]) {
            detailMsg = details._errors[0];
          } else {
            for (const key of Object.keys(details)) {
              const errs = details[key]?._errors;
              if (errs && errs.length) { detailMsg = `${key}: ${errs[0]}`; break; }
            }
          }
        }
        const base = (result && result.error && (result.error.message || result.error.code)) || "Failed to create campaign";
        const msg = detailMsg ? `${base} — ${detailMsg}` : base;
        throw new Error(msg);
      }

      // Our API uses standard ok() wrapper: { ok, data, requestId }
      const campaignId = result?.data?.campaign?.id ?? result?.campaign?.id;
      if (!campaignId) {
        throw new Error('Failed to create campaign — invalid response');
      }

      // Redirect to campaign generation page and auto-start generation
      router.push(`/campaigns/${campaignId}/generate?autostart=1`);
    } catch (error) {
      console.error("Error creating campaign:", error);
      const msg = error instanceof Error ? error.message : 'Failed to create campaign';
      setPageError(msg);
      setLoading(false);
    }
  };

  const canProceed = () => {
    switch (step) {
      case 1:
        return formData.campaign_type !== "";
      case 2:
        if (formData.campaign_type === 'recurring_weekly') {
          return formData.name !== '' && recurrenceStart !== '' && recurrenceEnd !== '' && recurrenceDays.length > 0;
        }
        return formData.name !== "" && formData.event_date !== "";
      case 3:
        if (formData.campaign_type === 'recurring_weekly') return true; // recurrence expands to dates on submit
        return selectedPostDates.length > 0 || customDates.length > 0; // At least one post date
      case 4:
        return true; // Image is optional
      default:
        return false;
    }
  };

  // Get today's date as minimum for event date
  const today = new Date();
  const minDate = today.toISOString().split("T")[0];

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <main>
        <Container className="max-w-4xl pb-page-pb pt-page-pt">
        {pageError && (
          <div className="mb-6 rounded-chip border border-destructive/30 bg-destructive/10 p-3 text-destructive">
            {pageError}
          </div>
        )}
        {/* Progress */}
        <div className="mb-8">
          <div className="flex justify-between">
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className={`flex items-center ${s < 4 ? "flex-1" : ""}`}>
                <div
                  className={`flex size-10 items-center justify-center rounded-full font-bold ${
                    step >= s ? "bg-primary text-white" : "bg-gray-200 text-gray-400"
                  }`}
                >
                  {step > s ? <Check className="size-5" /> : s}
                </div>
                {s < 4 && (
                  <div className={`mx-2 h-1 flex-1 ${step > s ? "bg-primary" : "bg-gray-200"}`} />
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between">
            <span className="text-sm">Type</span>
            <span className="text-sm">Details</span>
            <span className="text-sm">Dates</span>
            <span className="text-sm">Image</span>
          </div>
        </div>

        {/* Step Content */}
        <div className="rounded-card border bg-card p-6 text-card-foreground shadow-card">
          {step === 1 && (
            <>
              <h2 className="mb-2 font-heading text-2xl font-bold">What type of campaign?</h2>
              <p className="mb-6 text-text-secondary">Choose the type that best fits your needs. This helps our AI tailor the tone and messaging of your posts</p>

              <div className="grid gap-4 md:grid-cols-2">
                {CAMPAIGN_TYPES.map((type) => {
                  const Icon = type.icon;
                  return (
                    <button
                      key={type.id}
                      onClick={() => handleTypeSelect(type.id)}
                      className={`rounded-chip border-2 p-6 text-left transition-all ${
                        formData.campaign_type === type.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <div className={`${type.color} rounded-chip p-3 text-white`}>
                          <Icon className="size-6" />
                        </div>
                        <div className="flex-1">
                          <h3 className="mb-1 text-lg font-semibold">{type.label}</h3>
                          <p className="text-sm text-text-secondary">{type.description}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="mb-2 font-heading text-2xl font-bold">Campaign Details</h2>
              <p className="mb-6 text-text-secondary">Tell us about your {friendlyCampaignDescription}</p>

              <div className="space-y-4">
                <div>
                  <label htmlFor="name" className="label">
                    Campaign Name
                  </label>
                  <input
                    id="name"
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full rounded-md border border-input px-3 py-2"
                    placeholder={"Give your campaign a clear name"}
                  />
                </div>

                {/* Inspiration / Guidance */}
                <div className="mt-2">
                  <div className="mb-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, creative_mode: 'free' })}
                      className={`rounded-card border px-3 py-1.5 ${formData.creative_mode === 'free' ? 'border-primary bg-primary text-white' : 'border-border bg-white text-text-secondary'}`}
                    >
                      Simple text box
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, creative_mode: 'guided' })}
                      className={`rounded-card border px-3 py-1.5 ${formData.creative_mode === 'guided' ? 'border-primary bg-primary text-white' : 'border-border bg-white text-text-secondary'}`}
                    >
                      Answer a few questions
                    </button>
                  </div>

                  {formData.creative_mode === 'free' ? (
                    <div>
                      <label htmlFor="creative-brief" className="label">Tell us anything that will help us write great posts</label>
                      <textarea
                        id="creative-brief"
                        value={formData.creative_brief}
                        onChange={(e) => setFormData({ ...formData, creative_brief: e.target.value })}
                        className="min-h-[120px] w-full rounded-md border border-input px-3 py-2"
                      placeholder={'E.g., key details, timings, booking link'}
                      />
                    </div>
                  ) : (
                    <div className="grid gap-4">
                      {getGuidedQuestions().map(q => (
                        <div key={q.key}>
                          <label htmlFor={`guided-${q.key}`} className="label">{q.label}</label>
                          <input
                            id={`guided-${q.key}`}
                            type="text"
                            value={formData[q.key]}
                            onChange={(e) =>
                              setFormData((prev) => {
                                const value = e.target.value
                                const next = { ...prev, [q.key]: value }
                                if (q.key === 'q_call_to_action') {
                                  if (!prev.primary_cta || prev.primary_cta === prev.q_call_to_action) {
                                    next.primary_cta = value
                                  }
                                }
                                return next
                              })
                            }
                            className="w-full rounded-md border border-input px-3 py-2"
                            placeholder={q.placeholder}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-4">
                  <label htmlFor="primary-cta" className="label">Call to action</label>
                  <input
                    id="primary-cta"
                    type="text"
                    value={formData.primary_cta}
                    onChange={(e) => setFormData({ ...formData, primary_cta: e.target.value })}
                    className="w-full rounded-md border border-input px-3 py-2"
                    placeholder={'E.g., Book via the app, Call us on 0161 123 4567'}
                  />
                  <p className="mt-1 text-sm text-muted-foreground">
                    We’ll use this exact line to close every generated post for this campaign.
                  </p>
                </div>

                {formData.campaign_type !== 'recurring_weekly' ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label htmlFor="date" className="label">
                        <Calendar className="mr-1 inline size-4" />
                        Date
                      </label>
                      <input
                        id="date"
                        type="date"
                        value={formData.event_date}
                        onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
                        className="w-full rounded-md border border-input px-3 py-2"
                        min={minDate}
                      />
                    </div>

                    <div>
                      <label htmlFor="time" className="label">
                        <Clock className="mr-1 inline size-4" />
                        Time (optional)
                      </label>
                      <input
                        id="time"
                        type="time"
                        value={formData.event_time}
                        onChange={(e) => setFormData({ ...formData, event_time: e.target.value })}
                        className="w-full rounded-md border border-input px-3 py-2"
                        step={60}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <label htmlFor="recurrence-start" className="label">Start Date</label>
                        <input
                          id="recurrence-start"
                          type="date"
                          value={recurrenceStart}
                          onChange={(e) => setRecurrenceStart(e.target.value)}
                          className="w-full rounded-md border border-input px-3 py-2"
                          min={minDate}
                        />
                      </div>
                      <div>
                        <label htmlFor="recurrence-end" className="label">End Date</label>
                        <input
                          id="recurrence-end"
                          type="date"
                          value={recurrenceEnd}
                          onChange={(e) => setRecurrenceEnd(e.target.value)}
                          className="w-full rounded-md border border-input px-3 py-2"
                          min={recurrenceStart || minDate}
                        />
                      </div>
                      <div>
                        <label htmlFor="recurrence-time" className="label">Posting Time</label>
                        <input
                          id="recurrence-time"
                          type="time"
                          value={recurrenceTime}
                          onChange={(e) => setRecurrenceTime(e.target.value)}
                          className="w-full rounded-md border border-input px-3 py-2"
                          step={60}
                        />
                      </div>
                    </div>
                    <div>
                      <span className="label">Days of Week</span>
                      <div className="grid grid-cols-7 gap-1">
                        {[0,1,2,3,4,5,6].map(d => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setRecurrenceDays(prev => prev.includes(d) ? prev.filter(x=>x!==d) : [...prev, d])}
                            className={`h-10 rounded-md border text-sm ${recurrenceDays.includes(d) ? 'border-primary bg-primary text-white' : 'border-input bg-white text-text-secondary'}`}
                            title={["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d]}
                          >
                            {["S","M","T","W","T","F","S"][d]}
                          </button>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-text-secondary">We’ll generate posts on selected weekdays between the start and end dates.</p>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {step === 3 && formData.campaign_type !== 'recurring_weekly' && (
            <>
              <h2 className="mb-2 font-heading text-2xl font-bold">Choose Posting Schedule</h2>
              <p className="mb-6 text-text-secondary">Select when to create posts for your {friendlyCampaignDescription}</p>
              
              <div className="space-y-6">
                {/* Recommended Posts */}
                <div>
                  <h3 className="mb-3 font-semibold">Recommended Posts</h3>
                  <div className="space-y-3">
                    {formData.event_date && (() => {
                      const eventDate = new Date(formData.event_date);
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);

                      // Only recommend dates from today onward and no earlier than 1 month before event
                      const showIfValid = (daysBefore: number) => {
                        const d = new Date(eventDate);
                        d.setDate(d.getDate() - daysBefore);
                        return d >= today && daysBefore <= 30;
                      };

                      // Calculate how many weeks until the event
                      const daysUntilEvent = Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                      const weeksUntilEvent = Math.floor(daysUntilEvent / 7);
                      
                      return (
                        <>
                          {/* Show 6 weeks before if event is at least 6 weeks out */}
                          {weeksUntilEvent >= 6 && showIfValid(42) && (
                            <label className="flex cursor-pointer items-center gap-3 rounded-card border p-3 hover:bg-gray-50">
                              <input
                                type="checkbox"
                                checked={selectedPostDates.some(d => d.startsWith("six_weeks_"))}
                                onChange={(e) => {
                                  const sixWeeks = new Date(formData.event_date);
                                  sixWeeks.setDate(sixWeeks.getDate() - 42);
                                  const dateKey = `six_weeks_${sixWeeks.toISOString()}`;
                                  setSelectedPostDates(prev => 
                                    e.target.checked 
                                      ? [...prev, dateKey]
                                      : prev.filter(d => !d.startsWith("six_weeks_"))
                                  );
                                }}
                                className="size-4"
                              />
                              <div className="flex-1">
                                <p className="font-medium">6 Weeks Before</p>
                                <p className="text-sm text-gray-600">
                                  {formatDate(new Date(new Date(formData.event_date).setDate(new Date(formData.event_date).getDate() - 42)), undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                                </p>
                              </div>
                              <span className="rounded bg-purple-100 px-2 py-1 text-xs text-purple-700">Early bird</span>
                            </label>
                          )}

                          {/* Show 5 weeks before if event is at least 5 weeks out */}
                          {weeksUntilEvent >= 5 && showIfValid(35) && (
                            <label className="flex cursor-pointer items-center gap-3 rounded-card border p-3 hover:bg-gray-50">
                              <input
                                type="checkbox"
                                checked={selectedPostDates.some(d => d.startsWith("five_weeks_"))}
                                onChange={(e) => {
                                  const fiveWeeks = new Date(formData.event_date);
                                  fiveWeeks.setDate(fiveWeeks.getDate() - 35);
                                  const dateKey = `five_weeks_${fiveWeeks.toISOString()}`;
                                  setSelectedPostDates(prev => 
                                    e.target.checked 
                                      ? [...prev, dateKey]
                                      : prev.filter(d => !d.startsWith("five_weeks_"))
                                  );
                                }}
                                className="size-4"
                              />
                              <div className="flex-1">
                                <p className="font-medium">5 Weeks Before</p>
                                <p className="text-sm text-gray-600">
                                  {formatDate(new Date(new Date(formData.event_date).setDate(new Date(formData.event_date).getDate() - 35)), undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                                </p>
                              </div>
                              <span className="rounded bg-purple-100 px-2 py-1 text-xs text-purple-700">Coming soon</span>
                            </label>
                          )}

                          {/* Show 1 month before (cap earliest suggestion at one month) */}
                          {weeksUntilEvent >= 4 && showIfValid(30) && (
                            <label className="flex cursor-pointer items-center gap-3 rounded-card border p-3 hover:bg-gray-50">
                              <input
                                type="checkbox"
                                checked={selectedPostDates.some(d => d.startsWith("month_before_"))}
                                onChange={(e) => {
                                  const monthBefore = new Date(formData.event_date);
                                  monthBefore.setDate(monthBefore.getDate() - 30);
                                  const dateKey = `month_before_${monthBefore.toISOString()}`;
                                  setSelectedPostDates(prev => 
                                    e.target.checked 
                                      ? [...prev, dateKey]
                                      : prev.filter(d => !d.startsWith("month_before_"))
                                  );
                                }}
                                className="size-4"
                              />
                              <div className="flex-1">
                                <p className="font-medium">1 Month Before</p>
                                <p className="text-sm text-gray-600">
                                  {formatDate(new Date(new Date(formData.event_date).setDate(new Date(formData.event_date).getDate() - 30)), undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                                </p>
                              </div>
                              <span className="rounded bg-indigo-100 px-2 py-1 text-xs text-indigo-700">Mark your calendar</span>
                            </label>
                          )}

                          {/* 3 Weeks Before removed for simplicity */}

                          {/* 2 weeks before */}
                          {weeksUntilEvent >= 2 && showIfValid(14) && (
                            <label className="flex cursor-pointer items-center gap-3 rounded-card border p-3 hover:bg-gray-50">
                              <input
                                type="checkbox"
                                checked={selectedPostDates.some(d => d.startsWith("two_weeks_"))}
                                onChange={(e) => {
                                  const twoWeeks = new Date(formData.event_date);
                                  twoWeeks.setDate(twoWeeks.getDate() - 14);
                                  const dateKey = `two_weeks_${twoWeeks.toISOString()}`;
                                  setSelectedPostDates(prev => 
                                    e.target.checked 
                                      ? [...prev, dateKey]
                                      : prev.filter(d => !d.startsWith("two_weeks_"))
                                  );
                                }}
                                className="size-4"
                              />
                              <div className="flex-1">
                                <p className="font-medium">2 Weeks Before</p>
                                <p className="text-sm text-gray-600">
                                  {formatDate(new Date(new Date(formData.event_date).setDate(new Date(formData.event_date).getDate() - 14)), undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                                </p>
                              </div>
                              <span className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-700">Book now</span>
                            </label>
                          )}

                          {/* 1 week before */}
                          {weeksUntilEvent >= 1 && showIfValid(7) && (
                            <label className="flex cursor-pointer items-center gap-3 rounded-card border p-3 hover:bg-gray-50">
                              <input
                                type="checkbox"
                                checked={selectedPostDates.some(d => d.startsWith("week_before"))}
                                onChange={(e) => {
                                  const weekBefore = new Date(formData.event_date);
                                  weekBefore.setDate(weekBefore.getDate() - 7);
                                  const dateKey = `week_before_${weekBefore.toISOString()}`;
                                  setSelectedPostDates(prev => 
                                    e.target.checked 
                                      ? [...prev, dateKey]
                                      : prev.filter(d => !d.startsWith("week_before"))
                                  );
                                }}
                                className="size-4"
                              />
                              <div className="flex-1">
                                <p className="font-medium">1 Week Before</p>
                                <p className="text-sm text-gray-600">
                                  {formatDate(new Date(new Date(formData.event_date).setDate(new Date(formData.event_date).getDate() - 7)), undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                                </p>
                              </div>
                              <span className="rounded bg-cyan-100 px-2 py-1 text-xs text-cyan-700">Next week!</span>
                            </label>
                          )}

                          {/* Day before (only if today or later) */}
                          {showIfValid(1) && (
                          <label className="flex cursor-pointer items-center gap-3 rounded-card border p-3 hover:bg-gray-50">
                            <input
                              type="checkbox"
                              checked={selectedPostDates.some(d => d.startsWith("day_before"))}
                              onChange={(e) => {
                                const dayBefore = new Date(formData.event_date);
                                dayBefore.setDate(dayBefore.getDate() - 1);
                                const dateKey = `day_before_${dayBefore.toISOString()}`;
                                setSelectedPostDates(prev => 
                                  e.target.checked 
                                    ? [...prev, dateKey]
                                    : prev.filter(d => !d.startsWith("day_before"))
                                );
                              }}
                              className="size-4"
                            />
                            <div className="flex-1">
                              <p className="font-medium">Day Before</p>
                              <p className="text-sm text-gray-600">
                                {formatDate(new Date(new Date(formData.event_date).setDate(new Date(formData.event_date).getDate() - 1)), undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                              </p>
                            </div>
                            <span className="rounded bg-yellow-100 px-2 py-1 text-xs text-yellow-700">Tomorrow!</span>
                          </label>
                          )}

                          {/* Day of (only if today or later) */}
                          {showIfValid(0) && (
                          <label className="flex cursor-pointer items-center gap-3 rounded-card border p-3 hover:bg-gray-50">
                            <input
                              type="checkbox"
                              checked={selectedPostDates.some(d => d.startsWith("day_of"))}
                              onChange={(e) => {
                                const dateKey = `day_of_${new Date(formData.event_date).toISOString()}`;
                                setSelectedPostDates(prev => 
                                  e.target.checked 
                                    ? [...prev, dateKey]
                                    : prev.filter(d => !d.startsWith("day_of"))
                                );
                              }}
                              className="size-4"
                            />
                            <div className="flex-1">
                              <p className="font-medium">Day Of Event</p>
                              <p className="text-sm text-gray-600">
                                {formatDate(new Date(formData.event_date), undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                              </p>
                            </div>
                            <span className="rounded bg-green-100 px-2 py-1 text-xs text-green-700">Today!</span>
                          </label>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Custom Dates */}
                <div>
                  <h3 className="mb-3 font-semibold">Custom Dates (Optional)</h3>
                  <div className="space-y-3">
                    {customDates.map((custom, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <input
                          type="date"
                          value={custom.date}
                          onChange={(e) => {
                            const newCustomDates = [...customDates];
                            newCustomDates[index].date = e.target.value;
                            newCustomDates[index].time = defaultTimeForDate(e.target.value);
                            setCustomDates(newCustomDates);
                          }}
                          className="flex-1 rounded-md border border-input px-3 py-2"
                          min={minDate}
                        />
                        <input
                          type="time"
                          value={custom.time}
                          onChange={(e) => {
                            const newCustomDates = [...customDates];
                            newCustomDates[index].time = e.target.value;
                            setCustomDates(newCustomDates);
                          }}
                          className="w-32 rounded-md border border-input px-3 py-2"
                          step={60}
                        />
                        <button
                          onClick={() => setCustomDates(customDates.filter((_, i) => i !== index))}
                          className="rounded-md px-3 py-2 text-red-600 hover:bg-red-50"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        const today = new Date();
                        const defaultDate = formData.event_date || today.toISOString().split("T")[0];
                        const time = defaultTimeForDate(defaultDate);
                        setCustomDates([...customDates, { date: defaultDate, time }]);
                      }}
                      className="rounded-md border border-input px-3 py-2 text-sm"
                    >
                      <Plus className="mr-1 size-4" />
                      Add Custom Date
                    </button>
                  </div>
                </div>

                {/* Summary */}
                <div className="rounded-card border border-blue-200 bg-blue-50 p-4">
                  <p className="text-sm font-medium text-blue-900">
                    {selectedPostDates.length + customDates.length} posts will be generated
                  </p>
                  <p className="mt-1 text-xs text-blue-700">
                    AI will create unique content for each post timing
                  </p>
                </div>
              </div>
            </>
          )}

          {step === 3 && formData.campaign_type === 'recurring_weekly' && (
            <>
              <h2 className="mb-2 font-heading text-2xl font-bold">Posting Schedule</h2>
              <p className="mb-6 text-text-secondary">We will generate posts between {recurrenceStart || '…'} and {recurrenceEnd || '…'} on {recurrenceDays.length ? recurrenceDays.map(d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ') : '…'} at {recurrenceTime}.</p>
              <div className="text-sm text-text-secondary">
                Continue to the next step to pick an image. You can review and edit the generated posts on the next screen.
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <h2 className="mb-2 font-heading text-2xl font-bold">Select Hero Image</h2>
              <p className="mb-6 text-text-secondary">Choose an image for your campaign (optional)</p>

              {/* Upload Button */}
              <div className="mb-6">
                <input
                  type="file"
                  id="image-upload"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => { setUploadError(null); handleImageUpload(e); }}
                  className="hidden"
                  disabled={uploading}
                />
                <label
                  htmlFor="image-upload"
                  className={`inline-flex h-10 cursor-pointer items-center rounded-md border border-input px-4 text-sm ${
                    uploading ? "cursor-not-allowed opacity-50" : ""
                  }`}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Uploading... {uploadProgress}%
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 size-4" />
                      Upload New Image
                    </>
                  )}
                </label>
                <span className="ml-3 text-sm text-text-secondary">
                  Max 5MB • JPG, PNG, GIF
                </span>
              </div>
              {uploadError && (
                <div className="-mt-4 mb-4 rounded-chip border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
                  {uploadError}
                </div>
              )}

              {/* Progress Bar */}
              {uploading && (
                <div className="mb-6">
                  <div className="h-2 w-full rounded-full bg-gray-200">
                    <div
                      className="h-2 rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Image Grid - recently uploaded + tag sections */}
              {mediaAssets.length === 0 ? (
                <div className="rounded-chip border-2 border-dashed border-border py-8 text-center">
                  <ImageIcon className="mx-auto mb-4 size-16 text-text-secondary/30" />
                  <p className="text-text-secondary">
                    No images in your media library yet
                  </p>
                  <p className="mt-2 text-sm text-text-secondary">
                    Upload an image above to get started
                  </p>
                </div>
              ) : (
                <>
                  {/* Recently uploaded (top 3 only) */}
                  {(() => {
                    const list = [...mediaAssets]
                      .sort((a,b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
                      .slice(0, 3);
                    if (list.length === 0) return null;
                    return (
                      <section className="mb-6">
                        <h3 className="mb-2 text-sm font-semibold text-text-secondary">Recently uploaded</h3>
                        <div className="grid grid-cols-3 gap-4">
                          {list.map(asset => (
                            <button
                              key={`recent-${asset.id}`}
                              onClick={() => handleImageSelect(asset.id)}
                              className={`relative aspect-square overflow-hidden rounded-chip border-2 transition-all ${formData.hero_image_id===asset.id? 'border-primary ring-4 ring-primary/20':'border-border hover:border-primary/50'}`}
                            >
                              <NextImage
                                fill
                                src={asset.file_url}
                                alt={asset.file_name || "Campaign asset"}
                                className="object-cover"
                                sizes="(max-width: 640px) 100vw, 33vw"
                              />
                              {formData.hero_image_id===asset.id && (<div className="absolute inset-0 bg-primary/20" />)}
                            </button>
                          ))}
                        </div>
                      </section>
                    )
                  })()}

                  {/* Categories (tags) below */}
                  {(() => {
                    const map = new Map<string, MediaAsset[]>();
                    for (const asset of mediaAssets) {
                      if (!asset) continue;
                      const cleanedTags = Array.isArray(asset.tags)
                        ? asset.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
                        : [];
                      const tags = cleanedTags.length ? cleanedTags : ['Uncategorised'];
                      for (const tag of tags) {
                        const key = tag?.trim() ? tag.trim() : 'Uncategorised';
                        const arr = map.get(key) || [];
                        arr.push(asset);
                        map.set(key, arr);
                      }
                    }
                    const names = Array.from(map.keys()).filter(n => n !== 'Uncategorised').sort((a,b)=>a.localeCompare(b));
                    const sections = [...names, 'Uncategorised'];
                    return (
                      <div className="space-y-6">
                        {sections.map((name) => {
                          const list = map.get(name) || [];
                          if (list.length === 0) return null;
                          return (
                            <TagSection
                              key={`tag-${name}`}
                              title={name}
                              assets={list}
                              selectedId={formData.hero_image_id}
                              onSelect={handleImageSelect}
                            />
                          );
                        })}
                      </div>
                    );
                  })()}
                </>
              )}

              {/* Remove Selection Button */}
              {formData.hero_image_id && (
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-sm text-success">
                    <Check className="mr-1 inline size-4" />
                    Image selected
                  </p>
                  <button
                    onClick={() => setFormData({ ...formData, hero_image_id: "" })}
                    className="rounded-md px-3 py-2 text-sm text-text-secondary hover:bg-muted"
                  >
                    <X className="mr-1 size-4" />
                    Remove Selection
                  </button>
                </div>
              )}
            </>
          )}

          {/* Navigation */}
          <div className="mt-8 flex justify-between">
            <div className="flex items-center gap-2">
              {step > 1 && (
                <button onClick={() => setStep(step - 1)} className="flex items-center rounded-md px-3 py-2 text-text-secondary hover:bg-muted">
                  <ChevronLeft className="mr-2 size-4" />
                  Back
                </button>
              )}
              <Link href="/dashboard" className="rounded-md px-3 py-2 text-sm text-text-secondary hover:bg-muted">
                Cancel
              </Link>
            </div>

            <div className="flex items-center gap-2">
              {step < 4 ? (
                <button
                  onClick={() => setStep(step + 1)}
                  disabled={!canProceed()}
                  className="flex h-10 items-center rounded-md bg-primary px-4 text-sm text-white"
                >
                  Next
                  <ChevronRight className="ml-2 size-4" />
                </button>
              ) : (
                <Button onClick={handleSubmit} loading={loading}>
                  {!loading && (
                    <>
                      Create Campaign
                      <Sparkles className="ml-2 size-4" />
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
        </Container>
      </main>
      {/* Crop/Watermark modals */}
      {pendingFile && (
        <CropSquareModal
          open={cropOpen}
          onClose={() => setCropOpen(false)}
          file={pendingFile}
          onCropped={handleCropped}
          onKeepOriginal={handleKeepOriginal}
        />
      )}
      {hasActiveLogo && (
          <WatermarkPrompt
          open={wmPromptOpen}
          onClose={() => { setWmPromptOpen(false); setWmDeclined(true); if (pendingBlob) void proceedUploadCampaignImage(pendingBlob, pendingFileName || 'image.jpg', { skipWatermark: true }) }}
          onConfirm={handleWmConfirm}
          logoPresent={hasActiveLogo}
        />
      )}
      {wmAdjustOpen && wmDefaults && pendingBlob && (
        <WatermarkAdjuster
          isOpen={wmAdjustOpen}
          onClose={() => setWmAdjustOpen(false)}
          imageUrl={URL.createObjectURL(pendingBlob)}
          logoUrl={activeLogoUrl || ''}
          initialSettings={{ ...wmDefaults }}
          onApply={handleApplyWm}
        />
      )}
    </div>
  );
}

function TagSection({ title, assets, selectedId, onSelect }: {
  title: string;
  assets: MediaAsset[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  if (!assets || assets.length === 0) return null;
  return (
    <section>
      <button className="mb-2 flex w-full items-center justify-between text-left" onClick={() => setOpen(o=>!o)}>
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-text-secondary">{assets.length} image{assets.length!==1?'s':''} {open?'▾':'▸'}</span>
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3">
          {assets.map(asset => (
            <button
              key={asset.id}
              onClick={() => onSelect(asset.id)}
              className={`relative aspect-square overflow-hidden rounded-chip border-2 transition-all ${selectedId===asset.id? 'border-primary ring-4 ring-primary/20':'border-border hover:border-primary/50'}`}
            >
              <NextImage
                fill
                src={asset.file_url}
                alt={asset.file_name || "Campaign asset"}
                className="object-cover"
                sizes="(max-width: 640px) 100vw, 33vw"
              />
              {selectedId===asset.id && (<div className="absolute inset-0 bg-primary/20" />)}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
