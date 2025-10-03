"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import NextImage from "next/image";
import { createClient } from "@/lib/supabase/client";
import { formatDate, formatTime, getUserTimeZone } from "@/lib/datetime";
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
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import Container from "@/components/layout/container";
import CropSquareModal from "@/components/media/crop-square-modal";
import { WatermarkPrompt } from "@/components/media/watermark-prompt";
import WatermarkAdjuster from "@/components/watermark/watermark-adjuster";
import SchedulePlanner, { type PlannerSlot } from "@/components/campaign/schedule-planner";
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

const ALLOWED_TIMING_TOKENS = new Set([
  'six_weeks',
  'five_weeks',
  'month_before',
  'two_weeks',
  'two_days_before',
  'week_before',
  'day_before',
  'day_of',
]);

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
  offer_start_date: string;
  offer_start_time: string;
  offer_end_date: string;
  offer_end_time: string;
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
  startDate: string | null;
  endDate: string | null;
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
  const [slots, setSlots] = useState<PlannerSlot[]>([]);
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
    offer_start_date: "",
    offer_start_time: "",
    offer_end_date: "",
    offer_end_time: "",
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

  const userTimeZone = getUserTimeZone();

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

  const defaultTimeForDate = useCallback((isoDate: string): string => {
    try {
      const d = new Date(isoDate);
      const dow = d.getDay(); // 0=Sun..6=Sat
      const times = postingSchedule.filter(s => s.day_of_week === dow).map(s => s.time).sort();
      return times[0] || '07:00';
    } catch {
      return '07:00';
    }
  }, [postingSchedule]);

  const normalizeIsoLocal = useCallback((d: string, t?: string | null) => {
    if (!d) throw new RangeError('missing date');
    const time = (t || '').trim();
    let hh = '00', mm = '00', ss = '00';
    if (time) {
      const match = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if (!match) throw new RangeError('invalid time');
      hh = match[1].padStart(2, '0');
      mm = match[2];
      ss = match[3] || '00';
    }
    const local = `${d}T${hh}:${mm}:${ss}`;
    const dt = new Date(local);
    if (Number.isNaN(dt.getTime())) throw new RangeError('invalid date');
    return dt.toISOString();
  }, []);

  const createSlotId = useCallback(() => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return Math.random().toString(36).slice(2);
  }, []);

  const slotDateKey = useCallback((iso: string) => {
    try {
      return new Date(iso).toISOString().split('T')[0];
    } catch {
      return '';
    }
  }, []);

  const adjustIsoForSameDay = useCallback((iso: string) => {
    try {
      const now = new Date();
      const dt = new Date(iso);
      const same = dt.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
      if (same && dt.getTime() <= now.getTime()) {
        const bump = new Date(now);
        bump.setMinutes(0, 0, 0);
        bump.setHours(bump.getHours() + 1);
        return bump.toISOString();
      }
    } catch {}
    return iso;
  }, []);

  const sortSlots = useCallback((list: PlannerSlot[]) => {
    return [...list].sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime());
  }, []);

  const recommendedSlots = useMemo(() => {
    if (formData.campaign_type === 'recurring_weekly') return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const items: PlannerSlot[] = [];

    const pushSlot = (iso: string, label: string, token?: string) => {
      items.push({ id: createSlotId(), iso, label, source: 'recommended', token });
    };

    if (formData.campaign_type === 'offer_countdown') {
      if (!formData.offer_start_date || !formData.offer_end_date) return [];
      try {
        const startIso = normalizeIsoLocal(
          formData.offer_start_date,
          formData.offer_start_time || defaultTimeForDate(formData.offer_start_date)
        );
        const endIso = normalizeIsoLocal(
          formData.offer_end_date,
          formData.offer_end_time || defaultTimeForDate(formData.offer_end_date)
        );

        const startDate = new Date(startIso);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(endIso);
        endDate.setHours(0, 0, 0, 0);

        if (startDate >= today) {
          pushSlot(startIso, 'Offer goes live', 'offer_start');
        }

        const addReminder = (offset: number, label: string, token: string) => {
          const reminder = new Date(endDate);
          reminder.setDate(reminder.getDate() - offset);
          reminder.setHours(0, 0, 0, 0);
          if (reminder < today || reminder < startDate) return;
          const dateKey = reminder.toISOString().split('T')[0];
          const iso = normalizeIsoLocal(dateKey, formData.offer_end_time || defaultTimeForDate(dateKey));
          pushSlot(iso, label, token);
        };

        addReminder(2, 'Two days before offer ends', 'two_days_before');
        addReminder(1, 'Day before offer ends', 'day_before');

        if (endDate >= today) {
          pushSlot(endIso, 'Final day of the offer', 'day_of');
        }

        return items;
      } catch {
        return [];
      }
    }

    if (!formData.event_date) return [];
    try {
      const eventDate = new Date(formData.event_date);
      eventDate.setHours(0, 0, 0, 0);

      const addEventReminder = (delta: number, label: string, token: string) => {
        const target = new Date(eventDate);
        target.setDate(target.getDate() - delta);
        target.setHours(0, 0, 0, 0);
        if (target < today || delta > 30) return;
        const dateKey = target.toISOString().split('T')[0];
        const baseTime = token === 'day_of' && formData.event_time
          ? formData.event_time
          : defaultTimeForDate(dateKey);
        const iso = normalizeIsoLocal(dateKey, baseTime);
        pushSlot(iso, label, token);
      };

      addEventReminder(42, '6 Weeks Before', 'six_weeks');
      addEventReminder(35, '5 Weeks Before', 'five_weeks');
      addEventReminder(30, '1 Month Before', 'month_before');
      addEventReminder(14, '2 Weeks Before', 'two_weeks');
      addEventReminder(7, '1 Week Before', 'week_before');
      addEventReminder(1, 'Day Before', 'day_before');
      addEventReminder(0, 'Day of Event', 'day_of');

      return items;
    } catch {
      return [];
    }
  }, [
    formData.campaign_type,
    formData.offer_start_date,
    formData.offer_start_time,
    formData.offer_end_date,
    formData.offer_end_time,
    formData.event_date,
    formData.event_time,
    defaultTimeForDate,
    normalizeIsoLocal,
    createSlotId,
  ]);

  useEffect(() => {
    if (step !== 3) return;
    if (formData.campaign_type === 'recurring_weekly') return;
    if (slots.length > 0) return;
    if (recommendedSlots.length > 0) {
      setSlots(recommendedSlots.map((slot) => ({ ...slot })));
    }
  }, [step, formData.campaign_type, slots.length, recommendedSlots]);

  const handleCreateSlot = useCallback((dateKey: string) => {
    setSlots((prev) => {
      if (prev.some((slot) => slotDateKey(slot.iso) === dateKey)) {
        return prev;
      }
      try {
        let iso = normalizeIsoLocal(dateKey, defaultTimeForDate(dateKey));
        iso = adjustIsoForSameDay(iso);
        const next = [...prev, { id: createSlotId(), iso, label: 'Custom post', source: 'custom' as const }];
        return sortSlots(next);
      } catch {
        return prev;
      }
    });
  }, [slotDateKey, normalizeIsoLocal, defaultTimeForDate, adjustIsoForSameDay, createSlotId, sortSlots]);

  const handleMoveSlot = useCallback((slotId: string, dateKey: string) => {
    setSlots((prev) => {
      const index = prev.findIndex((slot) => slot.id === slotId);
      if (index === -1) return prev;
      if (prev.some((slot, idx) => idx !== index && slotDateKey(slot.iso) === dateKey)) {
        return prev;
      }
      const current = prev[index];
      if (slotDateKey(current.iso) === dateKey) {
        return prev;
      }
      const currentDate = new Date(current.iso);
      const hh = String(currentDate.getHours()).padStart(2, '0');
      const mm = String(currentDate.getMinutes()).padStart(2, '0');
      try {
        let iso = normalizeIsoLocal(dateKey, `${hh}:${mm}`);
        iso = adjustIsoForSameDay(iso);
        const next = [...prev];
        next[index] = {
          ...current,
          iso,
          source: 'custom',
          token: undefined,
        };
        return sortSlots(next);
      } catch {
        return prev;
      }
    });
  }, [slotDateKey, normalizeIsoLocal, adjustIsoForSameDay, sortSlots]);

  const handleEditSlotTime = useCallback((slotId: string, time: string) => {
    if (!time || !/^\d{1,2}:\d{2}$/.test(time)) {
      return;
    }
    setSlots((prev) => {
      const index = prev.findIndex((slot) => slot.id === slotId);
      if (index === -1) return prev;
      const current = prev[index];
      const dateKey = slotDateKey(current.iso);
      try {
        let iso = normalizeIsoLocal(dateKey, time);
        iso = adjustIsoForSameDay(iso);
        const next = [...prev];
        next[index] = {
          ...current,
          iso,
          source: current.source === 'recommended' ? 'custom' : current.source,
          token: current.source === 'recommended' ? undefined : current.token,
        };
        return sortSlots(next);
      } catch {
        return prev;
      }
    });
  }, [slotDateKey, normalizeIsoLocal, adjustIsoForSameDay, sortSlots]);

  const handleDeleteSlot = useCallback((slotId: string) => {
    setSlots((prev) => prev.filter((slot) => slot.id !== slotId));
  }, []);

  const handleResetSlots = useCallback(() => {
    if (recommendedSlots.length === 0) {
      setSlots([]);
      return;
    }
    setSlots(recommendedSlots.map((slot) => ({ ...slot })));
  }, [recommendedSlots]);

  const sortedSlots = useMemo(() => sortSlots(slots), [slots, sortSlots]);
  const plannedSlotCount = sortedSlots.length;

  const scheduleMaxDate = useMemo(() => (
    formData.campaign_type === 'offer_countdown'
      ? formData.offer_end_date || null
      : null
  ), [formData.campaign_type, formData.offer_end_date]);

  const plannerDisabledReason = useMemo(() => {
    if (formData.campaign_type === 'offer_countdown' && (!formData.offer_start_date || !formData.offer_end_date)) {
      return 'Set the offer start and end dates to add posts.';
    }
    return null;
  }, [formData.campaign_type, formData.offer_start_date, formData.offer_end_date]);


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
    setSlots([]);
    setFormData((prev) => ({
      ...prev,
      campaign_type: type,
      event_date: type === 'event_build_up' ? prev.event_date : '',
      event_time: type === 'event_build_up' ? prev.event_time : '',
      offer_start_date: type === 'offer_countdown' ? prev.offer_start_date : '',
      offer_start_time: type === 'offer_countdown' ? prev.offer_start_time : '',
      offer_end_date: type === 'offer_countdown' ? prev.offer_end_date : '',
      offer_end_time: type === 'offer_countdown' ? prev.offer_end_time : '',
    }));
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

      if (formData.campaign_type === 'recurring_weekly') {
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

      let offerWindowStart: Date | null = null;
      let offerWindowEnd: Date | null = null;

      if (formData.campaign_type === 'offer_countdown') {
        if (!formData.offer_start_date || !formData.offer_end_date) {
          setPageError('Please provide both the offer start and end dates.');
          setLoading(false);
          return;
        }

        const offerStart = new Date(formData.offer_start_date);
        const offerEnd = new Date(formData.offer_end_date);
        offerStart.setHours(0, 0, 0, 0);
        offerEnd.setHours(0, 0, 0, 0);

        if (offerStart < today) {
          setPageError('Offer countdowns must start today or later.');
          setLoading(false);
          return;
        }

        if (offerEnd < offerStart) {
          setPageError('Offer end date must be on or after the start date.');
          setLoading(false);
          return;
        }

        offerWindowStart = offerStart;
        offerWindowEnd = offerEnd;

      } else {
        if (!formData.event_date) {
          setPageError('Please choose an event date to continue.');
          setLoading(false);
          return;
        }

        const eventDate = new Date(formData.event_date);
        eventDate.setHours(0, 0, 0, 0);

        if (eventDate < today) {
          setPageError('Campaign event date cannot be in the past. Please select today or a future date.');
          setLoading(false);
          return;
        }

      }
      
      // No client-side auth/tenant resolution here — server route resolves tenant and validates auth

      // Plan checks and tenant resolution happen server-side in /api/campaigns/create

      let eventDateTime: string | null = null;
      let startDateTime: string | null = null;
      let endDateTime: string | null = null;
      if (formData.campaign_type === 'offer_countdown') {
        try {
          startDateTime = formData.offer_start_date
            ? normalizeIsoLocal(
                formData.offer_start_date,
                formData.offer_start_time || defaultTimeForDate(formData.offer_start_date)
              )
            : null;
        } catch {
          throw new Error('Invalid offer start date or time.');
        }

        try {
          endDateTime = formData.offer_end_date
            ? normalizeIsoLocal(
                formData.offer_end_date,
                formData.offer_end_time || defaultTimeForDate(formData.offer_end_date)
              )
            : null;
          eventDateTime = endDateTime;
        } catch {
          throw new Error('Invalid offer end date or time.');
        }
      } else if (formData.campaign_type !== 'recurring_weekly') {
        try {
          eventDateTime = formData.event_date
            ? normalizeIsoLocal(formData.event_date, formData.event_time || '00:00')
            : null;
        } catch {
          throw new Error('Invalid event date or time.');
        }
      }

      // Extract selected timings and custom dates
      const selectedTimingIds: string[] = [];
      let customDatesArray: string[] = [];

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
      } else {
        const seenTokens = new Set<string>()
        for (const slot of sortedSlots) {
          const slotDate = new Date(slot.iso)
          slotDate.setHours(0, 0, 0, 0)
          if (slotDate < today) {
            setPageError('Custom post dates cannot be in the past. Please select today or future dates only.');
            setLoading(false);
            return;
          }
          if (formData.campaign_type === 'offer_countdown') {
            const startWindow = offerWindowStart
            const endWindow = offerWindowEnd
            if (startWindow && endWindow && (slotDate < startWindow || slotDate > endWindow)) {
              setPageError('Custom post dates for offers must fall within the offer window.');
              setLoading(false);
              return;
            }
          }
          if (slot.source === 'recommended' && slot.token && ALLOWED_TIMING_TOKENS.has(slot.token)) {
            if (!seenTokens.has(slot.token)) {
              seenTokens.add(slot.token)
              selectedTimingIds.push(slot.token)
            }
          } else {
            try {
              customDatesArray.push(new Date(slot.iso).toISOString())
            } catch {}
          }
        }
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
            startDate: startDateTime,
            endDate: endDateTime,
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
        if (formData.campaign_type === 'offer_countdown') {
          return (
            formData.name !== '' &&
            formData.offer_start_date !== '' &&
            formData.offer_end_date !== ''
          );
        }
        return formData.name !== "" && formData.event_date !== "";
      case 3:
        if (formData.campaign_type === 'recurring_weekly') return true; // recurrence expands to dates on submit
        return slots.length > 0; // At least one planned post
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
                  formData.campaign_type === 'offer_countdown' ? (
                    <div className="space-y-6">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <label htmlFor="offer-start-date" className="label">
                            <Calendar className="mr-1 inline size-4" />
                            Offer start date
                          </label>
                          <input
                            id="offer-start-date"
                            type="date"
                            value={formData.offer_start_date}
                            onChange={(e) => {
                              const nextDate = e.target.value;
                              setFormData((prev) => ({
                                ...prev,
                                offer_start_date: nextDate,
                                offer_start_time: nextDate ? prev.offer_start_time || defaultTimeForDate(nextDate) : '',
                              }));
                            }}
                            className="w-full rounded-md border border-input px-3 py-2"
                            min={minDate}
                          />
                        </div>
                        <div>
                          <label htmlFor="offer-start-time" className="label">
                            <Clock className="mr-1 inline size-4" />
                            Start time (optional)
                          </label>
                          <input
                            id="offer-start-time"
                            type="time"
                            value={formData.offer_start_time}
                            onChange={(e) => setFormData((prev) => ({ ...prev, offer_start_time: e.target.value }))}
                            className="w-full rounded-md border border-input px-3 py-2"
                            step={60}
                          />
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <label htmlFor="offer-end-date" className="label">
                            <Calendar className="mr-1 inline size-4" />
                            Offer end date
                          </label>
                          <input
                            id="offer-end-date"
                            type="date"
                            value={formData.offer_end_date}
                            onChange={(e) => {
                              const nextDate = e.target.value;
                              setFormData((prev) => ({
                                ...prev,
                                offer_end_date: nextDate,
                                offer_end_time: nextDate ? prev.offer_end_time || defaultTimeForDate(nextDate) : '',
                              }));
                            }}
                            className="w-full rounded-md border border-input px-3 py-2"
                            min={formData.offer_start_date || minDate}
                          />
                          <p className="mt-1 text-xs text-text-secondary">We’ll count down to this date so guests know when the offer finishes.</p>
                        </div>
                        <div>
                          <label htmlFor="offer-end-time" className="label">
                            <Clock className="mr-1 inline size-4" />
                            End time (optional)
                          </label>
                          <input
                            id="offer-end-time"
                            type="time"
                            value={formData.offer_end_time}
                            onChange={(e) => setFormData((prev) => ({ ...prev, offer_end_time: e.target.value }))}
                            className="w-full rounded-md border border-input px-3 py-2"
                            step={60}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
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
                  )
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
              <h2 className="mb-2 font-heading text-2xl font-bold">Plan Your Posts</h2>
              <p className="mb-6 text-text-secondary">Drag and drop to reschedule, or click any day to add a new post before your {friendlyCampaignDescription} goes live.</p>

              {recommendedSlots.length === 0 && (
                <div className="mb-4 rounded-card border border-dashed border-border bg-muted/20 p-4 text-sm text-text-secondary">
                  {formData.campaign_type === 'offer_countdown'
                    ? 'Set a future offer window to see recommended reminders, or click any date to add your own.'
                    : 'Your selected event date is in the past. Adjust it to see recommended reminders, or add custom posts manually.'}
                </div>
              )}

              <SchedulePlanner
                slots={sortedSlots}
                onCreate={handleCreateSlot}
                onMove={handleMoveSlot}
                onDelete={handleDeleteSlot}
                onEditTime={handleEditSlotTime}
                onReset={handleResetSlots}
                recommendedDefaults={recommendedSlots}
                minDate={minDate}
                maxDate={scheduleMaxDate}
                disableAddReason={plannerDisabledReason}
              />

              <div className="mt-6 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Planned posts</h3>
                  <span className="text-sm text-text-secondary">{plannedSlotCount} total</span>
                </div>
                {plannedSlotCount === 0 ? (
                  <p className="text-sm text-text-secondary">Add at least one scheduled post to continue.</p>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {sortedSlots.map((slot) => {
                      const slotDate = new Date(slot.iso);
                      return (
                        <div key={slot.id} className="rounded-card border border-border bg-white p-3">
                          <div className="font-medium">
                            {formatDate(slotDate, undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                          </div>
                          <div className="text-sm text-text-secondary">
                            {formatTime(slot.iso, userTimeZone)}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {slot.source === 'recommended' && slot.token
                              ? `Recommended – ${slot.label}`
                              : slot.label}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
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
