"use client";

import { useState, useEffect } from "react";
import { toast } from 'sonner';
import { createClient } from "@/lib/supabase/client";
import { formatUkPhoneDisplay } from "@/lib/utils/format";
import {
  X, Loader2, Facebook, Instagram, MapPin, Twitter as TwitterIcon,
  Calendar, Clock, Send, AlertCircle, Check
} from "lucide-react";
import PublishResultsList from "@/components/publishing/PublishResultsList";

interface SocialConnection {
  id: string;
  platform: string;
  account_name: string;
  page_name?: string;
  is_active: boolean;
}

interface PublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  post: {
    id: string;
    content: string;
    scheduled_for: string;
    approval_status?: string;
  };
  campaignName: string;
  imageUrl?: string;
}

const PLATFORM_ICONS = {
  facebook: Facebook,
  instagram: Instagram,
  google_my_business: MapPin,
  twitter: TwitterIcon,
} as const;

const PLATFORM_COLORS = {
  facebook: "text-blue-600",
  instagram: "text-pink-600",
  google_my_business: "text-green-600",
  twitter: "text-gray-900",
} as const;

export default function PublishModal({
  isOpen,
  onClose,
  post,
  campaignName,
  imageUrl,
}: PublishModalProps) {
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [selectedConnections, setSelectedConnections] = useState<string[]>([]);
  const [publishTime, setPublishTime] = useState<"now" | "scheduled">("now");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [results, setResults] = useState<null | Array<{ connectionId: string; success: boolean; error?: string; scheduled?: boolean; postId?: string }>>(null);
  const [publishedConnections, setPublishedConnections] = useState<string[]>([]);
  // GMB options state
  const [gmbPostType, setGmbPostType] = useState<'STANDARD' | 'EVENT' | 'OFFER'>('STANDARD');
  const [gmbCtaType, setGmbCtaType] = useState<
    'BOOK' | 'ORDER' | 'SHOP' | 'LEARN_MORE' | 'SIGN_UP' | 'GET_OFFER' | 'CALL' | ''
  >('');
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

  useEffect(() => {
    if (isOpen) {
      fetchConnections();
      // Set default scheduled date/time to post's scheduled time
      const postDate = new Date(post.scheduled_for);
      setScheduledDate(postDate.toISOString().split("T")[0]);
      setScheduledTime(postDate.toTimeString().slice(0, 5));
    }
  }, [isOpen, post.scheduled_for]);

  const fetchConnections = async () => {
    setLoading(true);
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Get user's tenant
    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) return;

    // Get active social connections
    const { data } = await supabase
      .from("social_connections")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .eq("is_active", true);

    if (data) {
      setConnections(data);
    }

    // Check publishing history for this post
    const { data: history } = await supabase
      .from("publishing_history")
      .select("social_connection_id")
      .eq("campaign_post_id", post.id)
      .eq("status", "published");

    if (history) {
      setPublishedConnections(history.map(h => h.social_connection_id));
    }

    // Suggest CTAs from brand profile
    const { data: brandProfile } = await supabase
      .from('brand_profiles')
      .select('*')
      .eq('tenant_id', userData.tenant_id)
      .single();

    if (brandProfile) {
      if (!gmbCtaUrl) {
        setGmbCtaUrl(brandProfile.booking_url || brandProfile.website_url || '');
      }
      if (!gmbCtaPhone && brandProfile.phone_e164) {
        setGmbCtaPhone(formatUkPhoneDisplay(brandProfile.phone_e164));
      }
    }

    setLoading(false);
  };

  const toggleConnection = (connectionId: string) => {
    setSelectedConnections(prev =>
      prev.includes(connectionId)
        ? prev.filter(id => id !== connectionId)
        : [...prev, connectionId]
    );
  };

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

      const gmbOptions = hasGmbSelected ? (() => {
        const opts: any = {};
        if (gmbCtaType) {
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
        return opts;
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
        }),
      });

      const data = await response.json();

      if (response.ok) {
        const successCount = data.results.filter((r: any) => r.success).length;
        const failCount = data.results.filter((r: any) => !r.success).length;
        setResults(data.results);
        if (failCount > 0) {
          toast.error(`${successCount} succeeded, ${failCount} failed`);
        } else {
          toast.success(`${publishTime === 'scheduled' ? 'Scheduled' : 'Published'} to ${successCount} account(s)`);
        }
      } else {
        toast.error(data.error || "Failed to publish");
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-large max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-heading font-bold">Publish Post</h2>
              <p className="text-sm text-text-secondary mt-1">{campaignName}</p>
            </div>
            <button
              onClick={onClose}
              className="text-text-secondary hover:text-text-primary"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Post Preview */}
          <div className="mb-6">
            <h3 className="font-semibold mb-2">Post Content</h3>
            
            {/* Approval Status Warning */}
            {post.approval_status !== 'approved' && (
              <div className="bg-warning/10 border border-warning/20 rounded-medium p-4 mb-4">
                <div className="flex gap-3">
                  <AlertCircle className="w-5 h-5 text-warning flex-shrink-0" />
                  <div>
                    <p className="font-medium text-sm">Approval Required</p>
                    <p className="text-sm text-text-secondary mt-1">
                      This post must be approved before it can be published. 
                      {post.approval_status === 'rejected' ? ' It has been rejected and needs review.' : ' It is currently pending approval.'}
                    </p>
                  </div>
                </div>
              </div>
            )}
            
            <div className="bg-background rounded-medium p-4">
              <p className="text-sm whitespace-pre-wrap">{post.content}</p>
              {imageUrl && (
                <div className="mt-3">
                  <img
                    src={imageUrl}
                    alt="Post image"
                    className="w-32 h-32 object-cover rounded-soft"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Publishing Time */}
          <div className="mb-6">
            <h3 className="font-semibold mb-3">When to Publish</h3>
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="publishTime"
                  value="now"
                  checked={publishTime === "now"}
                  onChange={() => setPublishTime("now")}
                  className="w-4 h-4 text-primary"
                />
                <span>Publish immediately</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="publishTime"
                  value="scheduled"
                  checked={publishTime === "scheduled"}
                  onChange={() => setPublishTime("scheduled")}
                  className="w-4 h-4 text-primary"
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
                    className="px-3 py-2 border border-border rounded-soft"
                  />
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="px-3 py-2 border border-border rounded-soft"
                  />
                </div>
              )}
            </div>
        </div>

          {/* Social Accounts */}
          <div>
            <h3 className="font-semibold mb-3">Select Social Accounts</h3>
            
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : connections.length === 0 ? (
              <div className="bg-warning/10 border border-warning/20 rounded-medium p-4">
                <div className="flex gap-3">
                  <AlertCircle className="w-5 h-5 text-warning flex-shrink-0" />
                  <div>
                    <p className="font-medium text-sm">No Connected Accounts</p>
                    <p className="text-sm text-text-secondary mt-1">
                      Connect your social media accounts in Settings to start publishing.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {connections.map((connection) => {
                  const Icon = PLATFORM_ICONS[connection.platform as keyof typeof PLATFORM_ICONS];
                  const isPublished = publishedConnections.includes(connection.id);
                  const isSelected = selectedConnections.includes(connection.id);

                  return (
                    <label
                      key={connection.id}
                      className={`flex items-center gap-3 p-3 border rounded-medium cursor-pointer transition-colors ${
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      } ${isPublished ? "opacity-60" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleConnection(connection.id)}
                        className="w-4 h-4 text-primary"
                      />
                      <Icon className={`w-5 h-5 ${PLATFORM_COLORS[connection.platform as keyof typeof PLATFORM_COLORS]}`} />
                      <div className="flex-1">
                        <p className="font-medium text-sm">
                          {connection.page_name || connection.account_name}
                        </p>
                        <p className="text-xs text-text-secondary capitalize">
                          {connection.platform.replace("_", " ")}
                        </p>
                      </div>
                      {isPublished && (
                        <div className="flex items-center gap-1 text-success text-xs">
                          <Check className="w-3 h-3" />
                          Published
                        </div>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          {/* GMB Options */}
          {selectedConnections.some(id => connections.find(c => c.id === id)?.platform === 'google_my_business') && (
            <div className="mt-4 p-4 border border-border rounded-medium">
              <h3 className="font-semibold mb-3">Google Business Profile Options</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Post Type</label>
                  <select
                    value={gmbPostType}
                    onChange={(e) => setGmbPostType(e.target.value as any)}
                    className="w-full px-3 py-2 border border-border rounded-soft"
                  >
                    <option value="STANDARD">Standard</option>
                    <option value="EVENT">Event</option>
                    <option value="OFFER">Offer</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">CTA</label>
                  <div className="flex gap-2">
                    <select
                      value={gmbCtaType}
                      onChange={(e) => setGmbCtaType(e.target.value as any)}
                      className="px-3 py-2 border border-border rounded-soft"
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
                      type="url"
                      placeholder="CTA URL (optional)"
                      value={gmbCtaUrl}
                      onChange={(e) => setGmbCtaUrl(e.target.value)}
                      className="flex-1 px-3 py-2 border border-border rounded-soft"
                    />
                    <input
                      type="tel"
                      placeholder="CTA Phone (optional)"
                      value={gmbCtaPhone}
                      onChange={(e) => setGmbCtaPhone(e.target.value)}
                      className="w-40 px-3 py-2 border border-border rounded-soft"
                    />
                  </div>
                </div>
              </div>

              {gmbPostType === 'EVENT' && (
                <div className="mt-3 grid md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Event Title</label>
                    <input
                      type="text"
                      value={gmbEventTitle}
                      onChange={(e) => setGmbEventTitle(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-soft"
                      placeholder="Event title"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-sm font-medium mb-1">Start Date</label>
                      <input
                        type="date"
                        value={gmbEventStartDate}
                        onChange={(e) => setGmbEventStartDate(e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-soft"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Start Time</label>
                      <input
                        type="time"
                        value={gmbEventStartTime}
                        onChange={(e) => setGmbEventStartTime(e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-soft"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">End Date</label>
                      <input
                        type="date"
                        value={gmbEventEndDate}
                        onChange={(e) => setGmbEventEndDate(e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-soft"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">End Time</label>
                      <input
                        type="time"
                        value={gmbEventEndTime}
                        onChange={(e) => setGmbEventEndTime(e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-soft"
                      />
                    </div>
                  </div>
                </div>
              )}

              {gmbPostType === 'OFFER' && (
                <div className="mt-3 grid md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Coupon Code</label>
                    <input
                      type="text"
                      value={gmbOfferCoupon}
                      onChange={(e) => setGmbOfferCoupon(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-soft"
                      placeholder="SAVE10"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Redeem URL</label>
                    <input
                      type="url"
                      value={gmbOfferUrl}
                      onChange={(e) => setGmbOfferUrl(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-soft"
                      placeholder="https://example.com/offer"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Terms</label>
                    <input
                      type="text"
                      value={gmbOfferTerms}
                      onChange={(e) => setGmbOfferTerms(e.target.value)}
                      className="w-full px-3 py-2 border border-border rounded-soft"
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
              <h3 className="font-semibold mb-3">Results</h3>
              <PublishResultsList results={results} connections={connections} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border">
          <div className="flex gap-3 justify-end">
            {results && results.some(r => !r.success) && (
              <button
                onClick={() => {
                  const failed = results.filter(r => !r.success).map(r => r.connectionId);
                  if (failed.length === 0) return;
                  // Clear previous results and retry just the failed ones
                  setResults(null);
                  void handlePublish(failed);
                }}
                className="border border-input rounded-md h-10 px-4 text-sm"
                disabled={publishing}
              >
                Retry failed
              </button>
            )}
            <button
              onClick={onClose}
              className="border border-input rounded-md h-10 px-4 text-sm"
              disabled={publishing}
            >
              {results ? 'Close' : 'Cancel'}
            </button>
            <button
              onClick={handlePublish}
              className="bg-primary text-white rounded-md h-10 px-4 text-sm flex items-center"
              disabled={publishing || selectedConnections.length === 0 || post.approval_status !== 'approved'}
            >
              {publishing ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              {publishTime === "scheduled" ? "Schedule" : "Publish Now"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
