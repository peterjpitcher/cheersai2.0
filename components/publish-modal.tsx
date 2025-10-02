"use client";

import { useState, useEffect, useId } from "react";
import { toast } from 'sonner';
import { createClient } from "@/lib/supabase/client";
import { formatUkPhoneDisplay } from "@/lib/utils/format";
import { Loader2, Facebook, Instagram, MapPin, Send, AlertCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TERMS } from "@/lib/copy";
import PublishResultsList from "@/components/publishing/PublishResultsList";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import NextImage from "next/image";
import type { Database } from '@/lib/types/database'

interface SocialConnection {
  id: string;
  platform: string;
  account_name: string;
  page_name?: string;
  is_active: boolean;
  token_expires_at?: string | null;
  verify_status?: 'pass' | 'fail' | 'warning' | null;
  verified_at?: string | null;
}

interface PublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  post: {
    id: string;
    content: string;
    scheduled_for: string | null;
    approval_status?: string | null;
    platforms?: string[] | null;
    platform?: string | null;
    campaign_id?: string | null;
  };
  campaignName: string;
  imageUrl?: string;
  campaignId: string;
}

type PublishResult = {
  connectionId: string
  success: boolean
  error?: string
  scheduled?: boolean
  postId?: string
  errorCode?: string
}

type GMBPostType = 'STANDARD' | 'EVENT' | 'OFFER'

type GMBCallToActionType = '' | 'BOOK' | 'ORDER' | 'SHOP' | 'LEARN_MORE' | 'SIGN_UP' | 'GET_OFFER' | 'CALL'

type GMBOptions = {
  callToAction?: {
    actionType: Exclude<GMBCallToActionType, ''>
    url?: string
    phone?: string
  }
  event?: {
    title: string
    schedule: {
      startDate: string
      startTime?: string
      endDate?: string
      endTime?: string
    }
  }
  offer?: {
    couponCode?: string
    redeemOnlineUrl?: string
    termsConditions?: string
  }
}

type BrandProfileRow = Pick<
  Database['public']['Tables']['brand_profiles']['Row'],
  'booking_url' | 'website_url' | 'phone' | 'phone_e164' | 'whatsapp' | 'whatsapp_e164'
>

function isPublishResult(value: unknown): value is PublishResult {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.connectionId === 'string' && typeof record.success === 'boolean'
}

const PLATFORM_ICONS = {
  facebook: Facebook,
  instagram: Instagram,
  instagram_business: Instagram,
  google_my_business: MapPin,
} as const;

const PLATFORM_COLORS = {
  facebook: "text-blue-600",
  instagram: "text-pink-600",
  instagram_business: "text-pink-600",
  google_my_business: "text-green-600",
} as const;

export default function PublishModal({
  isOpen,
  onClose,
  post,
  campaignName,
  imageUrl,
  campaignId,
}: PublishModalProps) {
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [selectedConnections, setSelectedConnections] = useState<string[]>([]);
  const [publishTime, setPublishTime] = useState<"now" | "scheduled">("now");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [results, setResults] = useState<PublishResult[] | null>(null);
  const [showResultsSummary, setShowResultsSummary] = useState(true);
  const [publishedConnections, setPublishedConnections] = useState<string[]>([]);
  // Derived guardrail: Instagram requires an image
  const igSelectedNoImage = (() => {
    if (!imageUrl) {
      return selectedConnections.some(id => {
        const c = connections.find(x => x.id === id);
        const p = (c?.platform || '').toLowerCase();
        return p === 'instagram' || p === 'instagram_business';
      });
    }
    return false;
  })();
  // GMB options state
  const [gmbPostType, setGmbPostType] = useState<GMBPostType>('STANDARD');
  const [gmbCtaType, setGmbCtaType] = useState<GMBCallToActionType>('');
  const [gmbCtaUrl, setGmbCtaUrl] = useState('');
  const [gmbCtaPhone, setGmbCtaPhone] = useState('');
  const [gmbEventTitle, setGmbEventTitle] = useState('');
  const [gmbEventStartDate, setGmbEventStartDate] = useState('');
  const [gmbEventStartTime, setGmbEventStartTime] = useState('');
  const [gmbEventEndDate, setGmbEventEndDate] = useState('');
  const [gmbEventEndTime, setGmbEventEndTime] = useState('');
  const [gmbOfferCoupon, setGmbOfferCoupon] = useState('');
  const [gmbOfferUrl, setGmbOfferUrl] = useState('');
  const [gmbOfferTerms, setGmbOfferTerms] = useState('');
  const [blockingIssues, setBlockingIssues] = useState<Array<{ id: string; reason: string }>>([]);
  const baseId = useId();
  const fieldId = (suffix: string) => `${baseId}-${suffix}`;

  const postPlatformsKey = (post.platforms ?? []).join(',')

  useEffect(() => {
    if (!isOpen) return

    let isCancelled = false

    const loadConnections = async () => {
      setLoading(true)
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          if (!isCancelled) {
            setConnections([])
            setSelectedConnections([])
            setPublishedConnections([])
          }
          return
        }

        const { data: userData } = await supabase
          .from('users')
          .select('tenant_id')
          .eq('id', user.id)
          .maybeSingle()
        const tenantId = userData?.tenant_id
        if (!tenantId) {
          if (!isCancelled) {
            setConnections([])
            setSelectedConnections([])
          }
          return
        }

        const { data: connectionRows } = await supabase
          .from('social_connections')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('is_active', true)

        if (!isCancelled) {
          const safeConnections = connectionRows ?? []
          setConnections(safeConnections)
          const preferredPlatform = (post.platforms && post.platforms.length > 0 ? post.platforms[0] : post.platform) || 'facebook'
          const normalized = preferredPlatform === 'instagram' ? 'instagram_business' : preferredPlatform
          const ids = safeConnections
            .filter(c => (c.platform === 'instagram' ? 'instagram_business' : c.platform) === normalized)
            .map(c => c.id)
          setSelectedConnections(ids)
        }

        const { data: history } = await supabase
          .from('publishing_history')
          .select('social_connection_id')
          .eq('campaign_post_id', post.id)
          .eq('status', 'published')

        if (!isCancelled) {
          setPublishedConnections(history ? history.map(h => h.social_connection_id) : [])
        }

        const { data: brandProfile } = await supabase
          .from('brand_profiles')
          .select('booking_url,website_url,phone,phone_e164,whatsapp,whatsapp_e164')
          .eq('tenant_id', tenantId)
          .maybeSingle()
          .returns<BrandProfileRow | null>()

        if (!isCancelled && brandProfile) {
          const defaultUrl = brandProfile.booking_url || brandProfile.website_url || ''
          const phoneRaw = brandProfile.phone ?? brandProfile.phone_e164 ?? brandProfile.whatsapp ?? brandProfile.whatsapp_e164
          setGmbCtaUrl(prev => prev || defaultUrl)
          if (phoneRaw) {
            setGmbCtaPhone(prev => prev || formatUkPhoneDisplay(phoneRaw))
          }
        }
      } catch (error) {
        if (!isCancelled) {
          console.warn('fetchConnections error', error)
          setConnections([])
        }
      } finally {
        if (!isCancelled) {
          setLoading(false)
        }
      }
    }

    const postDate = (() => {
      if (!post.scheduled_for) return new Date();
      const parsed = new Date(post.scheduled_for);
      return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    })();

    setScheduledDate(postDate.toISOString().split('T')[0])
    setScheduledTime(postDate.toTimeString().slice(0, 5))
    loadConnections()

    return () => {
      isCancelled = true
    }
  }, [isOpen, post.id, post.platform, post.platforms, postPlatformsKey, post.scheduled_for])

  const prettyPlatform = (p: string) => p === 'instagram_business' ? 'Instagram' : (p === 'google_my_business' ? TERMS.GBP : p.charAt(0).toUpperCase() + p.slice(1));
  const [trackLinks, setTrackLinks] = useState(true)

  useEffect(() => {
    const selected = connections.filter(c => selectedConnections.includes(c.id));
    const issues: Array<{ id: string; reason: string }> = [];
    const now = new Date();
    for (const c of selected) {
      const expired = !!(c.token_expires_at && new Date(c.token_expires_at) <= now);
      if (expired) {
        issues.push({ id: c.id, reason: `${prettyPlatform(c.platform)} token expired` });
        continue;
      }
      if (c.verify_status === 'fail') {
        issues.push({ id: c.id, reason: `${prettyPlatform(c.platform)} verification failed` });
      }
    }
    setBlockingIssues(issues);
  }, [connections, selectedConnections]);

  const handlePublish = async (overrideIds?: string[]) => {
    const targetIds = overrideIds && overrideIds.length ? overrideIds : selectedConnections;
    if (targetIds.length === 0) {
      toast.error("Select at least one social account");
      return;
    }

    // Check if post is approved
    if (post.approval_status !== 'approved') {
      toast.error("This post must be approved before publishing");
      return;
    }

    setPublishing(true);

    try {
      let scheduleFor = undefined;
      
      if (publishTime === "scheduled") {
        scheduleFor = new Date(`${scheduledDate}T${scheduledTime}`).toISOString();
      }

      // Build GMB options if any GMB connection is selected
      const hasGmbSelected = targetIds.some(id => {
        const c = connections.find(x => x.id === id);
        return c?.platform === 'google_my_business';
      });

      const gmbOptions: GMBOptions | undefined = hasGmbSelected ? (() => {
        const opts: GMBOptions = {};
        if (gmbCtaType !== '') {
          opts.callToAction = {
            actionType: gmbCtaType,
            url: gmbCtaUrl || undefined,
            phone: gmbCtaPhone || undefined,
          };
        }
        if (gmbPostType === 'EVENT') {
          opts.event = {
            title: gmbEventTitle || 'Event',
            schedule: {
              startDate: gmbEventStartDate,
              startTime: gmbEventStartTime || undefined,
              endDate: gmbEventEndDate || undefined,
              endTime: gmbEventEndTime || undefined,
            },
          };
        } else if (gmbPostType === 'OFFER') {
          opts.offer = {
            couponCode: gmbOfferCoupon || undefined,
            redeemOnlineUrl: gmbOfferUrl || undefined,
            termsConditions: gmbOfferTerms || undefined,
          };
        }
        return Object.keys(opts).length > 0 ? opts : undefined;
      })() : undefined;

      const response = await fetch("/api/social/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: post.id,
          content: post.content,
          connectionIds: targetIds,
          imageUrl,
          scheduleFor,
          gmbOptions,
          trackLinks,
        }),
      });

      const json = await response.json();

      if (response.ok) {
        const rawResults = (json?.data?.results ?? json?.results) as unknown
        const nextResults = Array.isArray(rawResults)
          ? rawResults.filter(isPublishResult)
          : []
        const successCount = nextResults.filter(result => result.success).length
        const failCount = nextResults.length - successCount
        setResults(nextResults);
        setShowResultsSummary(true);
        if (failCount > 0) {
          toast.error(`${successCount} succeeded, ${failCount} failed`);
        } else {
          toast.success(`${publishTime === 'scheduled' ? 'Scheduled' : 'Published'} to ${successCount} account(s)`);
        }

        if (nextResults.some(result => result.success)) {
          try {
            await fetch(`/api/campaigns/${campaignId}/status`, {
              method: 'POST',
              cache: 'no-store',
            });
          } catch (statusError) {
            console.warn('Failed to refresh campaign status', statusError);
          }
        }
      } else {
        const uiMsg = typeof json?.error === 'string' 
          ? json.error 
          : (json?.error?.message || 'Failed to publish');
        toast.error(uiMsg);
      }
    } catch (error) {
      console.error("Publishing error:", error);
      toast.error("Failed to publish. Please try again.");
    } finally {
      setPublishing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[90svh] flex-col overflow-hidden p-0 sm:max-h-[85vh] sm:max-w-2xl">
        <DialogHeader className="sticky top-0 z-10 border-b border-border bg-surface p-6">
          <DialogTitle className="font-heading text-xl">Publish Post</DialogTitle>
          <p className="mt-1 text-sm text-text-secondary">{campaignName}</p>
        </DialogHeader>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Post Preview */}
          <div className="mb-6">
            <h3 className="mb-2 font-semibold">Post Content</h3>
            
            {/* Approval Status Warning */}
            {post.approval_status !== 'approved' && (
              <div className="mb-4 rounded-medium border border-warning/20 bg-warning/10 p-4">
                <div className="flex gap-3">
                  <AlertCircle className="size-5 shrink-0 text-warning" />
                  <div>
                    <p className="text-sm font-medium">Approval Required</p>
                    <p className="mt-1 text-sm text-text-secondary">
                      This post must be approved before it can be published. 
                      {post.approval_status === 'rejected' ? ' It has been rejected and needs review.' : ' It is currently pending approval.'}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {/* Instagram media requirement */}
            {igSelectedNoImage && (
              <div className="mb-4 rounded-medium border border-warning/20 bg-warning/10 p-4">
                <div className="flex gap-3">
                  <AlertCircle className="size-5 shrink-0 text-warning" />
                  <div>
                    <p className="text-sm font-medium">Instagram requires an image.</p>
                    <p className="mt-1 text-sm text-text-secondary">Add an image to this post to publish on Instagram.</p>
                  </div>
                </div>
              </div>
            )}
            
            <div className="rounded-medium bg-background p-4">
              <p className="whitespace-pre-wrap text-sm">{post.content}</p>
              {imageUrl && (
                <div className="relative mt-3 size-32 overflow-hidden rounded-soft">
                  <NextImage src={imageUrl} alt="Post preview" fill sizes="128px" className="object-cover" />
                </div>
              )}
            </div>
          </div>

          {/* Publishing Time */}
          <div className="mb-6">
            <h3 className="mb-3 font-semibold">When to Publish</h3>
            <div className="space-y-3">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name="publishTime"
                  value="now"
                  checked={publishTime === "now"}
                  onChange={() => setPublishTime("now")}
                  className="size-4 text-primary"
                />
                <span>Publish immediately</span>
              </label>
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name="publishTime"
                  value="scheduled"
                  checked={publishTime === "scheduled"}
                  onChange={() => setPublishTime("scheduled")}
                  className="size-4 text-primary"
                />
                <span>Schedule for later</span>
              </label>
              {publishTime === "scheduled" && (
                <div className="ml-7 flex gap-2">
                  <input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    min={new Date().toISOString().split("T")[0]}
                    className="rounded-soft border border-border px-3 py-2"
                  />
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="rounded-soft border border-border px-3 py-2"
                  />
                </div>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <input id="trackLinks" type="checkbox" className="accent-primary" checked={trackLinks} onChange={e => setTrackLinks(e.target.checked)} />
              <label htmlFor="trackLinks" className="text-sm">Track link clicks (use short links + UTM)</label>
            </div>
          </div>

          {/* Channel (fixed by post's platform) */}
          <div>
            <h3 className="mb-3 font-semibold">Channel</h3>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-6 animate-spin text-primary" />
              </div>
            ) : (
              <div className="space-y-2">
                {(() => {
                  const postPlatform = (post.platforms && post.platforms.length > 0 ? post.platforms[0] : post.platform) || 'facebook';
                  const normalized = postPlatform === 'instagram' ? 'instagram_business' : postPlatform;
                  const matching = connections.filter(c => (c.platform === 'instagram' ? 'instagram_business' : c.platform) === normalized);
                  if (matching.length === 0) {
                    return (
                      <div className="rounded-medium border border-warning/20 bg-warning/10 p-4">
                        <div className="flex gap-3">
                          <AlertCircle className="size-5 shrink-0 text-warning" />
                          <div>
                            <p className="text-sm font-medium">No connected {prettyPlatform(normalized)} account</p>
                            <p className="mt-1 text-sm text-text-secondary">Connect an account in Settings → Connections.</p>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return matching.map((connection) => {
                    const Icon = PLATFORM_ICONS[connection.platform as keyof typeof PLATFORM_ICONS] || PLATFORM_ICONS['facebook'];
                    const isPublished = publishedConnections.includes(connection.id);
                    return (
                      <div key={connection.id} className={`flex items-center gap-3 rounded-medium border p-3 ${isPublished ? 'opacity-60' : ''}`}>
                        <Icon className={`size-5 ${PLATFORM_COLORS[connection.platform as keyof typeof PLATFORM_COLORS] || ''}`} />
                        <div className="flex-1">
                          <p className="text-sm font-medium">{connection.page_name || connection.account_name}</p>
                          <p className="text-xs capitalize text-text-secondary">{prettyPlatform(connection.platform)}</p>
                        </div>
                        {isPublished && (
                          <div className="flex items-center gap-1 text-xs text-success">
                            <Check className="size-3" />
                            Published
                          </div>
                        )}
                      </div>
                    );
                  })
                })()}
              </div>
            )}
          </div>
          {/* GMB Options */}
          {selectedConnections.some(id => connections.find(c => c.id === id)?.platform === 'google_my_business') && (
            <div className="mt-4 rounded-medium border border-border p-4">
              <h3 className="mb-3 font-semibold">Google Business Profile Options</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label
                    htmlFor={fieldId('gmb-post-type')}
                    className="mb-1 block text-sm font-medium"
                  >
                    Post Type
                  </label>
                  <select
                    id={fieldId('gmb-post-type')}
                    value={gmbPostType}
                    onChange={(e) => setGmbPostType(e.target.value as GMBPostType)}
                    className="w-full rounded-soft border border-border px-3 py-2"
                  >
                    <option value="STANDARD">Standard</option>
                    <option value="EVENT">Event</option>
                    <option value="OFFER">Offer</option>
                  </select>
                </div>
                <div>
                  <p className="mb-1 block text-sm font-medium">CTA</p>
                  <div className="flex gap-2">
                    <select
                      aria-label="CTA type"
                      value={gmbCtaType}
                      onChange={(e) => setGmbCtaType(e.target.value as GMBCallToActionType)}
                      className="rounded-soft border border-border px-3 py-2"
                    >
                      <option value="">None</option>
                      <option value="LEARN_MORE">Learn More</option>
                      <option value="SHOP">Shop</option>
                      <option value="ORDER">Order</option>
                      <option value="BOOK">Book</option>
                      <option value="SIGN_UP">Sign Up</option>
                      <option value="GET_OFFER">Get Offer</option>
                      <option value="CALL">Call</option>
                    </select>
                    <input
                      aria-label="CTA URL"
                      type="url"
                      placeholder="CTA URL (optional)"
                      value={gmbCtaUrl}
                      onChange={(e) => setGmbCtaUrl(e.target.value)}
                      className="flex-1 rounded-soft border border-border px-3 py-2"
                    />
                    <input
                      aria-label="CTA phone"
                      type="tel"
                      placeholder="CTA Phone (optional)"
                      value={gmbCtaPhone}
                      onChange={(e) => setGmbCtaPhone(e.target.value)}
                      className="w-40 rounded-soft border border-border px-3 py-2"
                    />
                  </div>
                </div>
              </div>

              {gmbPostType === 'EVENT' && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <label
                      htmlFor={fieldId('gmb-event-title')}
                      className="mb-1 block text-sm font-medium"
                    >
                      Event Title
                    </label>
                    <input
                      id={fieldId('gmb-event-title')}
                      type="text"
                      value={gmbEventTitle}
                      onChange={(e) => setGmbEventTitle(e.target.value)}
                      className="w-full rounded-soft border border-border px-3 py-2"
                      placeholder="Event title"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label
                        htmlFor={fieldId('gmb-event-start-date')}
                        className="mb-1 block text-sm font-medium"
                      >
                        Start Date
                      </label>
                      <input
                        id={fieldId('gmb-event-start-date')}
                        type="date"
                        value={gmbEventStartDate}
                        onChange={(e) => setGmbEventStartDate(e.target.value)}
                        className="w-full rounded-soft border border-border px-3 py-2"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={fieldId('gmb-event-start-time')}
                        className="mb-1 block text-sm font-medium"
                      >
                        Start Time
                      </label>
                      <input
                        id={fieldId('gmb-event-start-time')}
                        type="time"
                        value={gmbEventStartTime}
                        onChange={(e) => setGmbEventStartTime(e.target.value)}
                        className="w-full rounded-soft border border-border px-3 py-2"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={fieldId('gmb-event-end-date')}
                        className="mb-1 block text-sm font-medium"
                      >
                        End Date
                      </label>
                      <input
                        id={fieldId('gmb-event-end-date')}
                        type="date"
                        value={gmbEventEndDate}
                        onChange={(e) => setGmbEventEndDate(e.target.value)}
                        className="w-full rounded-soft border border-border px-3 py-2"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={fieldId('gmb-event-end-time')}
                        className="mb-1 block text-sm font-medium"
                      >
                        End Time
                      </label>
                      <input
                        id={fieldId('gmb-event-end-time')}
                        type="time"
                        value={gmbEventEndTime}
                        onChange={(e) => setGmbEventEndTime(e.target.value)}
                        className="w-full rounded-soft border border-border px-3 py-2"
                      />
                    </div>
                  </div>
                </div>
              )}

              {gmbPostType === 'OFFER' && (
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <div>
                    <label
                      htmlFor={fieldId('gmb-offer-coupon')}
                      className="mb-1 block text-sm font-medium"
                    >
                      Coupon Code
                    </label>
                    <input
                      id={fieldId('gmb-offer-coupon')}
                      type="text"
                      value={gmbOfferCoupon}
                      onChange={(e) => setGmbOfferCoupon(e.target.value)}
                      className="w-full rounded-soft border border-border px-3 py-2"
                      placeholder="SAVE10"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={fieldId('gmb-offer-url')}
                      className="mb-1 block text-sm font-medium"
                    >
                      Redeem URL
                    </label>
                    <input
                      id={fieldId('gmb-offer-url')}
                      type="url"
                      value={gmbOfferUrl}
                      onChange={(e) => setGmbOfferUrl(e.target.value)}
                      className="w-full rounded-soft border border-border px-3 py-2"
                      placeholder="https://example.com/offer"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={fieldId('gmb-offer-terms')}
                      className="mb-1 block text-sm font-medium"
                    >
                      Terms
                    </label>
                    <input
                      id={fieldId('gmb-offer-terms')}
                      type="text"
                      value={gmbOfferTerms}
                      onChange={(e) => setGmbOfferTerms(e.target.value)}
                      className="w-full rounded-soft border border-border px-3 py-2"
                      placeholder="Conditions apply"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Results */}
          {results && (
            <div className="mt-8">
              <h3 className="mb-3 font-semibold">Results</h3>
              {/* Inline summary (dismissible) */}
              {showResultsSummary && (() => {
                const succ = results.filter(r => r.success).length;
                const fail = results.filter(r => !r.success).length;
                if (fail === 0) return null;
                return (
                  <div className="mb-3 flex items-start justify-between rounded-medium border border-destructive/30 bg-destructive/10 p-3 text-destructive">
                    <div className="text-sm">
                      Some platforms failed to publish. {succ} succeeded, {fail} failed.
                    </div>
                    <button
                      className="ml-3 text-sm text-destructive/80 hover:text-destructive"
                      onClick={() => setShowResultsSummary(false)}
                      aria-label="Dismiss summary"
                    >
                      ✕
                    </button>
                  </div>
                );
              })()}
              <PublishResultsList results={results} connections={connections} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 z-10 border-t border-border bg-surface p-6">
          <div className="flex items-center justify-end gap-3">
            {blockingIssues.length > 0 && (
              <div className="mr-auto flex items-start gap-2 text-left text-sm text-warning">
                <AlertCircle className="mt-0.5 size-4" />
                <div>
                  <div>Some selected connections need attention before publishing:</div>
                  <ul className="ml-5 list-disc">
                    {blockingIssues.map(i => (
                      <li key={i.id}>{i.reason} — <a href="/settings/connections" className="underline hover:text-primary">Verify</a></li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {/* Verification happens in settings; no bulk verify control here */}
            {results && results.some(r => !r.success) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const failed = results.filter(r => !r.success).map(r => r.connectionId);
                  if (failed.length === 0) return;
                  setResults(null);
                  void handlePublish(failed);
                }}
                disabled={publishing}
              >
                Retry failed
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onClose} disabled={publishing}>
              {results ? 'Close' : 'Cancel'}
            </Button>
            <Button
              onClick={() => { void handlePublish(); }}
              loading={publishing}
              disabled={
                selectedConnections.length === 0 ||
                post.approval_status !== 'approved' ||
                blockingIssues.length > 0 ||
                igSelectedNoImage
              }
            >
              {!publishing && <Send className="mr-2 size-4" />}
              {publishTime === "scheduled" ? "Schedule" : "Publish Now"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
