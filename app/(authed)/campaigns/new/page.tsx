"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/datetime";
import {
  Calendar, Clock, Image, ChevronLeft, ChevronRight,
  Sparkles, PartyPopper, Sun, Megaphone, Loader2, Check,
  Upload, X, Plus
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import Container from "@/components/layout/container";
import SubNav from "@/components/navigation/sub-nav";
import CropSquareModal from "@/components/media/crop-square-modal";
import { WatermarkPrompt } from "@/components/media/watermark-prompt";
import WatermarkAdjuster from "@/components/watermark/watermark-adjuster";

const CAMPAIGN_TYPES = [
  { 
    id: "event", 
    label: "Event", 
    icon: PartyPopper, 
    description: "Quiz nights, live music, special events",
    color: "bg-purple-500"
  },
  { 
    id: "special", 
    label: "Special Offer", 
    icon: Sparkles, 
    description: "Happy hours, food deals, promotions",
    color: "bg-green-500"
  },
  { 
    id: "seasonal", 
    label: "Seasonal", 
    icon: Sun, 
    description: "Holiday events, seasonal menus",
    color: "bg-orange-500"
  },
  { 
    id: "announcement", 
    label: "Announcement", 
    icon: Megaphone, 
    description: "New menu, opening hours, updates",
    color: "bg-blue-500"
  },
];

interface MediaAsset {
  id: string;
  file_url: string;
  file_name: string;
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
  const [wmDefaults, setWmDefaults] = useState<any>(null);
  const [hasActiveLogo, setHasActiveLogo] = useState(false);
  const [activeLogoUrl, setActiveLogoUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [pendingFileName, setPendingFileName] = useState<string>("");
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [selectedPostDates, setSelectedPostDates] = useState<string[]>([]);
  const [customDates, setCustomDates] = useState<{date: string, time: string}[]>([]);
  const [postingSchedule, setPostingSchedule] = useState<Array<{ day_of_week: number; time: string }>>([]);
  const [pageError, setPageError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    campaign_type: "",
    event_date: "",
    event_time: "",
    hero_image_id: "",
    creative_mode: 'free' as 'free' | 'guided',
    creative_brief: "",
    q_whats_happening: "",
    q_why_care: "",
    q_call_to_action: "",
    q_link_or_phone: "",
    q_special_details: "",
  });

  // Guided questions per campaign type (plain language)
  const getGuidedQuestions = () => {
    const type = formData.campaign_type || 'event';
    if (type === 'special') {
      return [
        { key: 'q_whats_happening' as const, label: "What’s the offer?", placeholder: "E.g., 2-for-1 burgers, £10 pizza & pint" },
        { key: 'q_why_care' as const, label: "When is it on?", placeholder: "E.g., Mon–Thu, 5–7pm" },
        { key: 'q_call_to_action' as const, label: "How do people get it?", placeholder: "E.g., show code SAVE10, book online" },
        { key: 'q_link_or_phone' as const, label: "Where should they go or call?", placeholder: "E.g., cheersbar.co.uk/deals or 0161 123 4567" },
        { key: 'q_special_details' as const, label: "Any rules?", placeholder: "E.g., excludes Fridays, eat in only" },
      ];
    }
    if (type === 'seasonal') {
      return [
        { key: 'q_whats_happening' as const, label: "What’s new for the season?", placeholder: "E.g., Winter menu, festive cocktails, Christmas quiz" },
        { key: 'q_why_care' as const, label: "When does it run?", placeholder: "E.g., 1 Dec – 2 Jan" },
        { key: 'q_call_to_action' as const, label: "What should people do?", placeholder: "E.g., book a table, see the menu" },
        { key: 'q_link_or_phone' as const, label: "Where should they go or call?", placeholder: "E.g., cheersbar.co.uk/christmas or 0161 123 4567" },
        { key: 'q_special_details' as const, label: "Any highlights or key dates?", placeholder: "E.g., Christmas Eve set menu, NYE party" },
      ];
    }
    if (type === 'announcement') {
      return [
        { key: 'q_whats_happening' as const, label: "What’s the news?", placeholder: "E.g., New menu, new opening hours, new event" },
        { key: 'q_why_care' as const, label: "When does it start?", placeholder: "E.g., from next Monday, from 7pm" },
        { key: 'q_call_to_action' as const, label: "What should people do next?", placeholder: "E.g., visit, book, call us" },
        { key: 'q_link_or_phone' as const, label: "Link or phone number", placeholder: "E.g., cheersbar.co.uk/menu or 0161 123 4567" },
        { key: 'q_special_details' as const, label: "Any helpful details?", placeholder: "E.g., kitchen open later, family friendly" },
      ];
    }
    // Event (default)
    return [
      { key: 'q_whats_happening' as const, label: "What’s happening and when?", placeholder: "E.g., Friday Quiz Night, starts 7pm" },
      { key: 'q_why_care' as const, label: "Why should people be interested?", placeholder: "E.g., fun night out, prizes, great atmosphere" },
      { key: 'q_call_to_action' as const, label: "What do you want people to do?", placeholder: "E.g., book a table, click to see menu, call us" },
      { key: 'q_link_or_phone' as const, label: "Where should they go or call?", placeholder: "E.g., cheersbar.co.uk/quiz or 0161 123 4567" },
      { key: 'q_special_details' as const, label: "Any special details or offers?", placeholder: "E.g., teams up to 6, 2-for-1 pizzas until 8pm" },
    ];
  };

  useEffect(() => {
    fetchMediaAssets();
  }, []);

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
        setPostingSchedule(Array.isArray(sched) ? sched as any : []);
      } catch {}
    })();
  }, []);

  const defaultTimeForDate = (isoDate: string): string => {
    try {
      const d = new Date(isoDate);
      const dow = d.getDay(); // 0=Sun..6=Sat
      const times = postingSchedule.filter(s => s.day_of_week === dow).map(s => s.time).sort();
      return times[0] || '08:00';
    } catch {
      return '08:00';
    }
  };

  useEffect(() => {
    // When we reach step 3, populate default post dates based on event date
    if (step === 3 && formData.event_date && selectedPostDates.length === 0) {
      const eventDate = new Date(formData.event_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const defaultDates: string[] = [];

      const showIfValid = (daysBefore: number) => {
        const d = new Date(eventDate);
        d.setDate(d.getDate() - daysBefore);
        return d >= today && daysBefore <= 30;
      };
      
      // Calculate how many weeks until the event
      const daysUntilEvent = Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const weeksUntilEvent = Math.floor(daysUntilEvent / 7);
      
      // Add all available weekly options by default
      if (weeksUntilEvent >= 6 && showIfValid(42)) {
        const sixWeeks = new Date(eventDate);
        sixWeeks.setDate(sixWeeks.getDate() - 42);
        defaultDates.push(`six_weeks_${sixWeeks.toISOString()}`);
      }
      
      if (weeksUntilEvent >= 5 && showIfValid(35)) {
        const fiveWeeks = new Date(eventDate);
        fiveWeeks.setDate(fiveWeeks.getDate() - 35);
        defaultDates.push(`five_weeks_${fiveWeeks.toISOString()}`);
      }
      
      if (weeksUntilEvent >= 4 && showIfValid(30)) {
        const monthBefore = new Date(eventDate);
        monthBefore.setDate(monthBefore.getDate() - 30);
        defaultDates.push(`month_before_${monthBefore.toISOString()}`);
      }
      
      if (weeksUntilEvent >= 3 && showIfValid(21)) {
        const threeWeeks = new Date(eventDate);
        threeWeeks.setDate(threeWeeks.getDate() - 21);
        defaultDates.push(`three_weeks_${threeWeeks.toISOString()}`);
      }
      
      if (weeksUntilEvent >= 2 && showIfValid(14)) {
        const twoWeeks = new Date(eventDate);
        twoWeeks.setDate(twoWeeks.getDate() - 14);
        defaultDates.push(`two_weeks_${twoWeeks.toISOString()}`);
      }
      
      if (weeksUntilEvent >= 1 && showIfValid(7)) {
        const weekBefore = new Date(eventDate);
        weekBefore.setDate(weekBefore.getDate() - 7);
        defaultDates.push(`week_before_${weekBefore.toISOString()}`);
      }
      
      // Day before
      if (showIfValid(1)) {
        const dayBefore = new Date(eventDate);
        dayBefore.setDate(dayBefore.getDate() - 1);
        defaultDates.push(`day_before_${dayBefore.toISOString()}`);
      }
      
      // Day of
      if (showIfValid(0)) {
        defaultDates.push(`day_of_${eventDate.toISOString()}`);
      }
      
      setSelectedPostDates(defaultDates);
    }
  }, [step, formData.event_date]);

  const fetchMediaAssets = async () => {
    try {
      // Use server route to avoid RLS/policy issues in prod
      const res = await fetch('/api/media/list', { cache: 'no-store' });
      if (!res.ok) {
        console.warn('Failed to load media list:', await res.text());
        setMediaAssets([]);
        return;
      }
      const payload = await res.json();
      setMediaAssets(payload.assets || []);
    } catch (e) {
      console.error('Media list error:', e);
      setMediaAssets([]);
    }
  };

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

  async function proceedUploadCampaignImage(initialFile: Blob | File, initialName: string) {
    try {
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
          const logos = json.data?.logos || json.logos || []
          const active = (logos || []).find((l: any) => l.is_active)
          setHasActiveLogo(!!active)
          setActiveLogoUrl(active?.file_url || null)
          const defaults = json.data?.settings || json.settings
          setWmDefaults(defaults)
          if (active) {
            if (defaults?.auto_apply) {
              const f = new FormData()
              f.append('image', new File([uploadFile], finalFileName, { type: 'image/jpeg' }))
              const wmRes = await fetch('/api/media/watermark', { method: 'POST', body: f })
              if (wmRes.ok) uploadFile = await wmRes.blob()
            } else {
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
      const { asset } = await res.json()
      setUploadProgress(90)
      setUploadProgress(100)
      // integrate asset into page state
      setMediaAssets([asset, ...mediaAssets])
      setFormData({ ...formData, hero_image_id: asset.id })
      setTimeout(() => { setUploadProgress(0); setUploading(false) }, 500)
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed')
      setUploading(false)
      setUploadProgress(0)
    }
  }

  const handleCropped = async (blob: Blob) => {
    setCropOpen(false)
    await proceedUploadCampaignImage(blob, pendingFileName || 'image.jpg')
  }
  const handleKeepOriginal = async () => {
    setCropOpen(false)
    if (pendingFile) await proceedUploadCampaignImage(pendingFile, pendingFile.name)
  }
  const handleWmConfirm = () => { setWmPromptOpen(false); setWmAdjustOpen(true) }
  const handleApplyWm = async (adjusted: any) => {
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
    const supabase = createClient();
    
    try {
      // Validate event date is not in the past
      const eventDate = new Date(formData.event_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
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
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No user");

      // Resolve tenant id: prefer users.tenant_id, adopt membership if needed, create users row if missing
      let tenantId: string | null = null;
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('id', user.id)
        .maybeSingle();
      if (userData?.tenant_id) tenantId = userData.tenant_id;

      if (!tenantId) {
        // Adopt membership if present
        const { data: membership } = await supabase
          .from('user_tenants')
          .select('tenant_id, role, created_at')
          .eq('user_id', user.id)
          .order('role', { ascending: true })
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (membership?.tenant_id) {
          tenantId = membership.tenant_id as string;
          // Best-effort persist to users for future calls
          await supabase.from('users').update({ tenant_id: tenantId }).eq('id', user.id);
        }
      }

      if (!tenantId) {
        // Ensure a users row exists (idempotent)
        await supabase.from('users').insert({
          id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
          first_name: user.user_metadata?.first_name || user.email?.split('@')[0] || 'User',
          last_name: user.user_metadata?.last_name || '',
        }).select().maybeSingle();
      }

      if (!tenantId) {
        console.error('Error fetching user tenant:', userError);
        throw new Error('No tenant');
      }

      // Then fetch tenant details separately
      const { data: tenantData, error: tenantError } = await supabase
        .from("tenants")
        .select("subscription_tier, subscription_status, total_campaigns_created")
        .eq("id", tenantId)
        .single();

      if (tenantError) {
        console.error("Error fetching tenant details:", tenantError);
        // Continue anyway - don't block campaign creation
      }

      // Check campaign limits for trial users
      const isTrialing = tenantData?.subscription_status === 'trialing' || tenantData?.subscription_status === null;
      
      if (isTrialing && tenantData) {
        const totalCampaigns = tenantData.total_campaigns_created || 0;
        if (totalCampaigns >= 10) {
          setPageError("You've reached the free trial limit of 10 campaigns. Please upgrade to continue creating campaigns.");
          setLoading(false);
          router.push("/settings/billing");
          return;
        }
      }
      
      // Check campaign limits for tier (normalized via config)
      const tier = tenantData?.subscription_tier || "free";
      
      // Get current month's campaign count
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      
      const { count: campaignCount } = await supabase
        .from("campaigns")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .gte("created_at", startOfMonth.toISOString());

      // Use centralized limits to avoid mismatch (handles 'professional' -> 'pro')
      // Dynamically import to avoid any bundling/client boundary issues; fallback safely
      let limit: number = 5;
      try {
        const mod = await import("@/lib/stripe/config");
        const tierLimits = mod.getTierLimits(tier);
        limit = typeof tierLimits.campaigns === 'number' ? tierLimits.campaigns : 5;
      } catch (e) {
        const normalized = (tier || '').toLowerCase();
        if (normalized === 'pro' || normalized === 'professional' || normalized === 'enterprise') {
          limit = -1; // unlimited
        } else if (normalized === 'starter') {
          limit = 10;
        } else {
          limit = 5;
        }
      }
      
      if (limit !== -1 && (campaignCount || 0) >= limit) {
        setPageError(`You've reached your monthly campaign limit of ${limit}. Please upgrade your plan to create more campaigns.`);
        setLoading(false);
        return;
      }

      // Combine date and time
      let eventDateTime = null;
      if (formData.event_date) {
        const dateTime = formData.event_time 
          ? `${formData.event_date}T${formData.event_time}:00`
          : `${formData.event_date}T00:00:00`;
        eventDateTime = new Date(dateTime).toISOString();
      }

      // Extract selected timings and custom dates
      const selectedTimings = selectedPostDates
        .filter(date => date.startsWith('six_weeks_') || 
                       date.startsWith('five_weeks_') ||
                       date.startsWith('month_before_') ||
                       date.startsWith('three_weeks_') ||
                       date.startsWith('two_weeks_') ||
                       date.startsWith('week_before_') || 
                       date.startsWith('day_before_') || 
                       date.startsWith('day_of_'))
        .map(date => date.split('_')[0] + '_' + date.split('_')[1]); // e.g., "week_before", "day_of"
      
      const customDatesArray = customDates.map(cd => {
        const dateTime = cd.time 
          ? `${cd.date}T${cd.time}:00`
          : `${cd.date}T12:00:00`;
        return new Date(dateTime).toISOString();
      });

          // Build description from creative inputs
          let description: string | null = null;
          if (formData.creative_mode === 'free') {
            description = formData.creative_brief?.trim() || null;
          } else {
            const qs = getGuidedQuestions();
            const lines: string[] = [];
            qs.forEach(q => {
              const val = (formData as any)[q.key];
              if (val) lines.push(`${q.label}: ${val}`);
            });
            description = lines.length ? lines.join('\n') : null;
          }

          // Create campaign with user selections via API endpoint (includes server-side validation)
          const campaignData: any = {
            name: formData.name,
            campaign_type: formData.campaign_type,
            event_date: eventDateTime,
            hero_image_id: formData.hero_image_id || null,
            status: "draft",
            selected_timings: selectedTimings,
            custom_dates: customDatesArray,
            description,
          };
      
      const response = await fetch("/api/campaigns/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campaignData),
      });

      const result = await response.json();

      if (!response.ok) {
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

      // Redirect to campaign generation page
      router.push(`/campaigns/${campaignId}/generate`);
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
        return formData.name !== "" && formData.event_date !== "";
      case 3:
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
      <SubNav base="/campaigns" preset="campaignsRoot" />
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <Container className="py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-heading font-bold">Create Campaign</h1>
            <Link href="/dashboard" className="text-text-secondary hover:bg-muted rounded-md px-3 py-2">
              Cancel
            </Link>
          </div>
        </Container>
      </header>

      <main>
        <Container className="py-8 max-w-4xl">
        {pageError && (
          <div className="mb-6 bg-destructive/10 border border-destructive/30 text-destructive rounded-medium p-3">
            {pageError}
          </div>
        )}
        {/* Progress */}
        <div className="mb-8">
          <div className="flex justify-between">
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className={`flex items-center ${s < 4 ? "flex-1" : ""}`}>
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                    step >= s ? "bg-primary text-white" : "bg-gray-200 text-gray-400"
                  }`}
                >
                  {step > s ? <Check className="w-5 h-5" /> : s}
                </div>
                {s < 4 && (
                  <div className={`flex-1 h-1 mx-2 ${step > s ? "bg-primary" : "bg-gray-200"}`} />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-2">
            <span className="text-sm">Type</span>
            <span className="text-sm">Details</span>
            <span className="text-sm">Dates</span>
            <span className="text-sm">Image</span>
          </div>
        </div>

        {/* Step Content */}
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-6">
          {step === 1 && (
            <>
              <h2 className="text-2xl font-heading font-bold mb-2">What type of campaign?</h2>
              <p className="text-text-secondary mb-6">Choose the type that best fits your needs. This helps our AI tailor the tone and messaging of your posts</p>

              <div className="grid md:grid-cols-2 gap-4">
                {CAMPAIGN_TYPES.map((type) => {
                  const Icon = type.icon;
                  return (
                    <button
                      key={type.id}
                      onClick={() => handleTypeSelect(type.id)}
                      className={`p-6 rounded-medium border-2 text-left transition-all ${
                        formData.campaign_type === type.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <div className={`${type.color} p-3 rounded-medium text-white`}>
                          <Icon className="w-6 h-6" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-lg mb-1">{type.label}</h3>
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
              <h2 className="text-2xl font-heading font-bold mb-2">Campaign Details</h2>
              <p className="text-text-secondary mb-6">Tell us about your {formData.campaign_type}</p>

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
                    className="border border-input rounded-md px-3 py-2 w-full"
                    placeholder={
                      formData.campaign_type === "event" ? "Friday Quiz Night" :
                      formData.campaign_type === "special" ? "Happy Hour Special" :
                      formData.campaign_type === "seasonal" ? "Christmas Menu Launch" :
                      "New Opening Hours"
                    }
                  />
                </div>

                {/* Inspiration / Guidance */}
                <div className="mt-2">
                  <div className="flex gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, creative_mode: 'free' })}
                      className={`px-3 py-1.5 rounded-soft border ${formData.creative_mode === 'free' ? 'bg-primary text-white border-primary' : 'bg-white text-text-secondary border-border'}`}
                    >
                      Simple text box
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, creative_mode: 'guided' })}
                      className={`px-3 py-1.5 rounded-soft border ${formData.creative_mode === 'guided' ? 'bg-primary text-white border-primary' : 'bg-white text-text-secondary border-border'}`}
                    >
                      Answer a few questions
                    </button>
                  </div>

                  {formData.creative_mode === 'free' ? (
                    <div>
                      <label className="label">Tell us anything that will help us write great posts</label>
                      <textarea
                        value={formData.creative_brief}
                        onChange={(e) => setFormData({ ...formData, creative_brief: e.target.value })}
                        className="min-h-[120px] border border-input rounded-md px-3 py-2 w-full"
                        placeholder={
                          formData.campaign_type === 'special' ? 'E.g., 2-for-1 burgers Mon–Thu 5–7pm. Book at cheersbar.co.uk/deals' :
                          formData.campaign_type === 'seasonal' ? 'E.g., Festive menu runs 1 Dec – 2 Jan. Book at cheersbar.co.uk/christmas' :
                          formData.campaign_type === 'announcement' ? 'E.g., New menu from Monday. Kitchen open later. See cheersbar.co.uk/menu' :
                          'E.g., Family-friendly quiz with prizes, starts at 7pm. Book at cheersbar.co.uk/quiz'
                        }
                      />
                    </div>
                  ) : (
                    <div className="grid gap-4">
                      {getGuidedQuestions().map(q => (
                        <div key={q.key}>
                          <label className="label">{q.label}</label>
                          <input
                            type="text"
                            value={(formData as any)[q.key]}
                            onChange={(e) => setFormData({ ...formData, [q.key]: e.target.value })}
                            className="border border-input rounded-md px-3 py-2 w-full"
                            placeholder={q.placeholder}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="date" className="label">
                      <Calendar className="inline w-4 h-4 mr-1" />
                      Date
                    </label>
                    <input
                      id="date"
                      type="date"
                      value={formData.event_date}
                      onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
                      className="border border-input rounded-md px-3 py-2 w-full"
                      min={minDate}
                    />
                  </div>

                  <div>
                    <label htmlFor="time" className="label">
                      <Clock className="inline w-4 h-4 mr-1" />
                      Time (optional)
                    </label>
                    <input
                      id="time"
                      type="time"
                      value={formData.event_time}
                      onChange={(e) => setFormData({ ...formData, event_time: e.target.value })}
                      className="border border-input rounded-md px-3 py-2 w-full"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-2xl font-heading font-bold mb-2">Choose Posting Schedule</h2>
              <p className="text-text-secondary mb-6">Select when to create posts for your {formData.campaign_type}</p>
              
              <div className="space-y-6">
                {/* Recommended Posts */}
                <div>
                  <h3 className="font-semibold mb-3">Recommended Posts</h3>
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
                            <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
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
                                className="w-4 h-4"
                              />
                              <div className="flex-1">
                                <p className="font-medium">6 Weeks Before</p>
                                <p className="text-sm text-gray-600">
                                  {formatDate(new Date(new Date(formData.event_date).setDate(new Date(formData.event_date).getDate() - 42)), undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                                </p>
                              </div>
                              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">Early bird</span>
                            </label>
                          )}

                          {/* Show 5 weeks before if event is at least 5 weeks out */}
                          {weeksUntilEvent >= 5 && showIfValid(35) && (
                            <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
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
                                className="w-4 h-4"
                              />
                              <div className="flex-1">
                                <p className="font-medium">5 Weeks Before</p>
                                <p className="text-sm text-gray-600">
                                  {formatDate(new Date(new Date(formData.event_date).setDate(new Date(formData.event_date).getDate() - 35)), undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                                </p>
                              </div>
                              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">Coming soon</span>
                            </label>
                          )}

                          {/* Show 1 month before (cap earliest suggestion at one month) */}
                          {weeksUntilEvent >= 4 && showIfValid(30) && (
                            <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
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
                                className="w-4 h-4"
                              />
                              <div className="flex-1">
                                <p className="font-medium">1 Month Before</p>
                                <p className="text-sm text-gray-600">
                                  {formatDate(new Date(new Date(formData.event_date).setDate(new Date(formData.event_date).getDate() - 30)), undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                                </p>
                              </div>
                              <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded">Mark your calendar</span>
                            </label>
                          )}

                          {/* 3 weeks before */}
                          {weeksUntilEvent >= 3 && showIfValid(21) && (
                            <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedPostDates.some(d => d.startsWith("three_weeks_"))}
                                onChange={(e) => {
                                  const threeWeeks = new Date(formData.event_date);
                                  threeWeeks.setDate(threeWeeks.getDate() - 21);
                                  const dateKey = `three_weeks_${threeWeeks.toISOString()}`;
                                  setSelectedPostDates(prev => 
                                    e.target.checked 
                                      ? [...prev, dateKey]
                                      : prev.filter(d => !d.startsWith("three_weeks_"))
                                  );
                                }}
                                className="w-4 h-4"
                              />
                              <div className="flex-1">
                                <p className="font-medium">3 Weeks Before</p>
                                <p className="text-sm text-gray-600">
                                  {formatDate(new Date(new Date(formData.event_date).setDate(new Date(formData.event_date).getDate() - 21)), undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                                </p>
                              </div>
                              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">Getting closer</span>
                            </label>
                          )}

                          {/* 2 weeks before */}
                          {weeksUntilEvent >= 2 && showIfValid(14) && (
                            <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
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
                                className="w-4 h-4"
                              />
                              <div className="flex-1">
                                <p className="font-medium">2 Weeks Before</p>
                                <p className="text-sm text-gray-600">
                                  {formatDate(new Date(new Date(formData.event_date).setDate(new Date(formData.event_date).getDate() - 14)), undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                                </p>
                              </div>
                              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">Book now</span>
                            </label>
                          )}

                          {/* 1 week before */}
                          {weeksUntilEvent >= 1 && showIfValid(7) && (
                            <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
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
                                className="w-4 h-4"
                              />
                              <div className="flex-1">
                                <p className="font-medium">1 Week Before</p>
                                <p className="text-sm text-gray-600">
                                  {formatDate(new Date(new Date(formData.event_date).setDate(new Date(formData.event_date).getDate() - 7)), undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                                </p>
                              </div>
                              <span className="text-xs bg-cyan-100 text-cyan-700 px-2 py-1 rounded">Next week!</span>
                            </label>
                          )}

                          {/* Day before (only if today or later) */}
                          {showIfValid(1) && (
                          <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
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
                              className="w-4 h-4"
                            />
                            <div className="flex-1">
                              <p className="font-medium">Day Before</p>
                              <p className="text-sm text-gray-600">
                                {formatDate(new Date(new Date(formData.event_date).setDate(new Date(formData.event_date).getDate() - 1)), undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                              </p>
                            </div>
                            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded">Tomorrow!</span>
                          </label>
                          )}

                          {/* Day of (only if today or later) */}
                          {showIfValid(0) && (
                          <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
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
                              className="w-4 h-4"
                            />
                            <div className="flex-1">
                              <p className="font-medium">Day Of Event</p>
                              <p className="text-sm text-gray-600">
                                {formatDate(new Date(formData.event_date), undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                              </p>
                            </div>
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">Today!</span>
                          </label>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Custom Dates */}
                <div>
                  <h3 className="font-semibold mb-3">Custom Dates (Optional)</h3>
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
                          className="border border-input rounded-md px-3 py-2 flex-1"
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
                          className="border border-input rounded-md px-3 py-2 w-32"
                        />
                        <button
                          onClick={() => setCustomDates(customDates.filter((_, i) => i !== index))}
                          className="text-red-600 hover:bg-red-50 rounded-md px-3 py-2"
                        >
                          <X className="w-4 h-4" />
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
                      className="border border-input rounded-md px-3 py-2 text-sm"
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add Custom Date
                    </button>
                  </div>
                </div>

                {/* Summary */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm font-medium text-blue-900">
                    {selectedPostDates.length + customDates.length} posts will be generated
                  </p>
                  <p className="text-xs text-blue-700 mt-1">
                    AI will create unique content for each post timing
                  </p>
                </div>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <h2 className="text-2xl font-heading font-bold mb-2">Select Hero Image</h2>
              <p className="text-text-secondary mb-6">Choose an image for your campaign (optional)</p>

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
                  className={`border border-input rounded-md h-10 px-4 text-sm inline-flex items-center cursor-pointer ${
                    uploading ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Uploading... {uploadProgress}%
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Upload New Image
                    </>
                  )}
                </label>
                <span className="text-sm text-text-secondary ml-3">
                  Max 5MB • JPG, PNG, GIF
                </span>
              </div>
              {uploadError && (
                <div className="-mt-4 mb-4 bg-destructive/10 border border-destructive/30 text-destructive rounded-medium p-2 text-sm">
                  {uploadError}
                </div>
              )}

              {/* Progress Bar */}
              {uploading && (
                <div className="mb-6">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Image Grid */}
              {mediaAssets.length === 0 ? (
                <div className="text-center py-8 border-2 border-dashed border-border rounded-medium">
                  <Image className="w-16 h-16 text-text-secondary/30 mx-auto mb-4" />
                  <p className="text-text-secondary">
                    No images in your media library yet
                  </p>
                  <p className="text-sm text-text-secondary mt-2">
                    Upload an image above to get started
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {mediaAssets.map((asset) => (
                    <button
                      key={asset.id}
                      onClick={() => handleImageSelect(asset.id)}
                      className={`relative aspect-square rounded-medium overflow-hidden border-2 transition-all ${
                        formData.hero_image_id === asset.id
                          ? "border-primary ring-4 ring-primary/20"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <img
                        src={asset.file_url}
                        alt={asset.file_name}
                        className="w-full h-full object-cover"
                      />
                      {formData.hero_image_id === asset.id && (
                        <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                          <div className="bg-primary text-white p-2 rounded-full">
                            <Check className="w-6 h-6" />
                          </div>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Remove Selection Button */}
              {formData.hero_image_id && (
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-sm text-success">
                    <Check className="inline w-4 h-4 mr-1" />
                    Image selected
                  </p>
                  <button
                    onClick={() => setFormData({ ...formData, hero_image_id: "" })}
                    className="text-text-secondary hover:bg-muted rounded-md px-3 py-2 text-sm"
                  >
                    <X className="w-4 h-4 mr-1" />
                    Remove Selection
                  </button>
                </div>
              )}
            </>
          )}

          {/* Navigation */}
          <div className="flex justify-between mt-8">
            {step > 1 && (
              <button onClick={() => setStep(step - 1)} className="text-text-secondary hover:bg-muted rounded-md px-3 py-2 flex items-center">
                <ChevronLeft className="w-4 h-4 mr-2" />
                Back
              </button>
            )}

            <div className={step === 1 ? "ml-auto" : ""}>
              {step < 4 ? (
                <button
                  onClick={() => setStep(step + 1)}
                  disabled={!canProceed()}
                  className="bg-primary text-white rounded-md h-10 px-4 text-sm flex items-center"
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-2" />
                </button>
              ) : (
                <Button onClick={handleSubmit} loading={loading}>
                  {!loading && (
                    <>
                      Create Campaign
                      <Sparkles className="w-4 h-4 ml-2" />
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
          onClose={() => { setWmPromptOpen(false); if (pendingBlob) proceedUploadCampaignImage(pendingBlob, pendingFileName || 'image.jpg') }}
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
          initialSettings={{ position: wmDefaults.position || 'bottom-right', opacity: wmDefaults.opacity || 0.8, size_percent: wmDefaults.size_percent || 15, margin_pixels: wmDefaults.margin_pixels || 20 }}
          onApply={handleApplyWm}
        />
      )}
    </div>
  );
}
