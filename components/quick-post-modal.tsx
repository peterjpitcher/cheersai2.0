"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  X, Send, Calendar, Clock, Sparkles, Image as ImageIcon,
  Facebook, Instagram, MapPin, Loader2, Check
} from "lucide-react";

interface QuickPostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface SocialConnection {
  id: string;
  platform: string;
  account_name: string;
  is_active: boolean;
}

export default function QuickPostModal({ isOpen, onClose, onSuccess }: QuickPostModalProps) {
  const [content, setContent] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [scheduleType, setScheduleType] = useState<"now" | "later">("now");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchConnections();
      // Set default date/time to 1 hour from now
      const future = new Date();
      future.setHours(future.getHours() + 1);
      setScheduledDate(future.toISOString().split('T')[0]);
      setScheduledTime(future.toTimeString().slice(0, 5));
    }
  }, [isOpen]);

  const fetchConnections = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) return;

    const { data } = await supabase
      .from("social_connections")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .eq("is_active", true);

    if (data) {
      setConnections(data);
      // Auto-select first platform
      if (data.length > 0) {
        setSelectedPlatforms([data[0].platform]);
      }
    }
  };

  const handleGenerateContent = async () => {
    setGenerating(true);
    try {
      const response = await fetch("/api/generate/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Create a quick social media post for a pub",
          tone: "friendly and engaging",
        }),
      });

      if (response.ok) {
        const { content: generatedContent } = await response.json();
        setContent(generatedContent);
      }
    } catch (error) {
      console.error("Generation error:", error);
    }
    setGenerating(false);
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const supabase = createClient();

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No user");

      const { data: userData } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .single();

      if (!userData?.tenant_id) throw new Error("No tenant");

      // Generate unique file name
      const fileExt = file.name.split(".").pop();
      const fileName = `${userData.tenant_id}/quick/${Date.now()}.${fileExt}`;

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("media")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from("media")
        .getPublicUrl(fileName);

      setMediaUrl(publicUrl);
    } catch (error) {
      console.error("Upload error:", error);
      alert("Failed to upload image");
    }
    setUploading(false);
  };

  const handleSubmit = async () => {
    if (!content || selectedPlatforms.length === 0) {
      alert("Please enter content and select at least one platform");
      return;
    }

    setLoading(true);
    const supabase = createClient();

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No user");

      const { data: userData } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .single();

      if (!userData?.tenant_id) throw new Error("No tenant");

      // Calculate scheduled time
      let scheduledFor = new Date().toISOString();
      if (scheduleType === "later") {
        scheduledFor = new Date(`${scheduledDate}T${scheduledTime}`).toISOString();
      }

      // Create quick posts for each platform
      const posts = selectedPlatforms.map(platform => ({
        tenant_id: userData.tenant_id,
        content,
        platform,
        scheduled_for: scheduledFor,
        status: scheduleType === "now" ? "scheduled" : "draft",
        is_quick_post: true,
        media_url: mediaUrl,
        post_timing: "immediate",
      }));

      const { error } = await supabase
        .from("campaign_posts")
        .insert(posts);

      if (error) throw error;

      // Success
      if (onSuccess) onSuccess();
      onClose();
      
      // Reset form
      setContent("");
      setSelectedPlatforms([]);
      setScheduleType("now");
      setMediaUrl(null);
    } catch (error) {
      console.error("Error creating quick post:", error);
      alert("Failed to create post");
    }
    setLoading(false);
  };

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(platform)
        ? prev.filter(p => p !== platform)
        : [...prev, platform]
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">Quick Post</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Platform Selection */}
          <div>
            <label className="block text-sm font-medium mb-3">Select Platforms</label>
            <div className="space-y-2">
              {connections.map(conn => (
                <button
                  key={conn.id}
                  onClick={() => togglePlatform(conn.platform)}
                  className={`w-full p-3 rounded-lg border-2 transition-all flex items-center gap-3 ${
                    selectedPlatforms.includes(conn.platform)
                      ? "border-primary bg-primary/5"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    conn.platform === "instagram" ? "bg-gradient-to-br from-purple-600 to-pink-500" :
                    conn.platform === "facebook" ? "bg-blue-600" :
                    "bg-green-600"
                  }`}>
                    {conn.platform === "instagram" ? <Instagram className="w-5 h-5 text-white" /> :
                     conn.platform === "facebook" ? <Facebook className="w-5 h-5 text-white" /> :
                     <MapPin className="w-5 h-5 text-white" />}
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-medium capitalize">{conn.platform}</p>
                    <p className="text-sm text-gray-600">{conn.account_name}</p>
                  </div>
                  {selectedPlatforms.includes(conn.platform) && (
                    <Check className="w-5 h-5 text-primary" />
                  )}
                </button>
              ))}
            </div>
            {connections.length === 0 && (
              <p className="text-sm text-gray-500">
                No social accounts connected. 
                <a href="/settings/connections" className="text-primary hover:underline ml-1">
                  Connect accounts
                </a>
              </p>
            )}
          </div>

          {/* Content Input */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium">Post Content</label>
              <button
                onClick={handleGenerateContent}
                disabled={generating}
                className="btn-ghost text-sm flex items-center gap-1"
              >
                {generating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                Generate with AI
              </button>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What's happening at your venue today?"
              className="input-field min-h-[120px]"
              maxLength={500}
            />
            <p className="text-xs text-gray-500 mt-1">{content.length}/500 characters</p>
          </div>

          {/* Image Upload */}
          <div>
            <label className="block text-sm font-medium mb-2">Add Image (Optional)</label>
            {mediaUrl ? (
              <div className="relative">
                <img src={mediaUrl} alt="Upload" className="w-full h-48 object-cover rounded-lg" />
                <button
                  onClick={() => setMediaUrl(null)}
                  className="absolute top-2 right-2 p-1 bg-white rounded-full shadow-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div>
                <input
                  type="file"
                  id="quick-image-upload"
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageUpload}
                  className="hidden"
                  disabled={uploading}
                />
                <label
                  htmlFor="quick-image-upload"
                  className="btn-secondary inline-flex items-center cursor-pointer"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <ImageIcon className="w-4 h-4 mr-2" />
                      Add Photo
                    </>
                  )}
                </label>
              </div>
            )}
          </div>

          {/* Schedule Options */}
          <div>
            <label className="block text-sm font-medium mb-3">When to Post</label>
            <div className="flex gap-3 mb-3">
              <button
                onClick={() => setScheduleType("now")}
                className={`flex-1 p-3 rounded-lg border-2 transition-all ${
                  scheduleType === "now"
                    ? "border-primary bg-primary/5"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <Send className="w-5 h-5 mx-auto mb-1" />
                <p className="text-sm font-medium">Post Now</p>
              </button>
              <button
                onClick={() => setScheduleType("later")}
                className={`flex-1 p-3 rounded-lg border-2 transition-all ${
                  scheduleType === "later"
                    ? "border-primary bg-primary/5"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <Calendar className="w-5 h-5 mx-auto mb-1" />
                <p className="text-sm font-medium">Schedule</p>
              </button>
            </div>

            {scheduleType === "later" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Date</label>
                  <input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="input-field"
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Time</label>
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="input-field"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex items-center justify-end gap-3">
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !content || selectedPlatforms.length === 0}
            className="btn-primary flex items-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                {scheduleType === "now" ? "Post Now" : "Schedule Post"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}