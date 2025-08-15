"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Calendar, Clock, Image, ChevronLeft, ChevronRight,
  Sparkles, PartyPopper, Sun, Megaphone, Loader2, Check,
  Upload, X
} from "lucide-react";
import Link from "next/link";

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
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [formData, setFormData] = useState({
    name: "",
    campaign_type: "",
    event_date: "",
    event_time: "",
    hero_image_id: "",
  });

  useEffect(() => {
    fetchMediaAssets();
  }, []);

  const fetchMediaAssets = async () => {
    const supabase = createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/auth/login");
      return;
    }

    const { data: userData } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userData?.tenant_id) return;

    const { data } = await supabase
      .from("media_assets")
      .select("id, file_url, file_name")
      .eq("tenant_id", userData.tenant_id)
      .order("created_at", { ascending: false });

    if (data) {
      setMediaAssets(data);
    }
  };

  const handleTypeSelect = (type: string) => {
    setFormData({ ...formData, campaign_type: type });
  };

  const handleImageSelect = (imageId: string) => {
    setFormData({ ...formData, hero_image_id: imageId });
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      alert("Please upload an image file");
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert("Image must be less than 5MB");
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    const supabase = createClient();

    try {
      // Get user and tenant
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
      const fileName = `${userData.tenant_id}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

      // Upload to Supabase Storage
      setUploadProgress(30);
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("media")
        .upload(fileName, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      setUploadProgress(60);

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from("media")
        .getPublicUrl(fileName);

      // Save to media_assets table
      const { data: asset, error: dbError } = await supabase
        .from("media_assets")
        .insert({
          tenant_id: userData.tenant_id,
          file_name: file.name,
          file_url: publicUrl,
          file_type: file.type,
          file_size: file.size,
          storage_path: fileName,
        })
        .select()
        .single();

      if (dbError) throw dbError;

      setUploadProgress(100);

      // Add to media assets list and select it
      setMediaAssets([asset, ...mediaAssets]);
      setFormData({ ...formData, hero_image_id: asset.id });

      // Reset upload state
      setTimeout(() => {
        setUploadProgress(0);
        setUploading(false);
      }, 500);

    } catch (error) {
      console.error("Upload error:", error);
      alert("Failed to upload image");
      setUploading(false);
      setUploadProgress(0);
    }

    // Clear the input
    event.target.value = "";
  };

  const handleSubmit = async () => {
    setLoading(true);
    const supabase = createClient();
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No user");

      const { data: userData } = await supabase
        .from("users")
        .select(`
          tenant_id,
          tenant:tenants (
            subscription_tier
          )
        `)
        .eq("id", user.id)
        .single();

      if (!userData?.tenant_id) throw new Error("No tenant");

      // Check campaign limits for tier
      const tier = userData.tenant?.subscription_tier || "free";
      
      // Get current month's campaign count
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      
      const { count: campaignCount } = await supabase
        .from("campaigns")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", userData.tenant_id)
        .gte("created_at", startOfMonth.toISOString());

      // Check limits based on tier
      const limits: Record<string, number> = {
        free: 5,
        starter: 10,
        pro: -1, // unlimited
        enterprise: -1 // unlimited
      };

      const limit = limits[tier] || 5;
      
      if (limit !== -1 && (campaignCount || 0) >= limit) {
        alert(`You've reached your monthly campaign limit of ${limit}. Please upgrade your plan to create more campaigns.`);
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

      // Create campaign
      const { data: campaign, error } = await supabase
        .from("campaigns")
        .insert({
          tenant_id: userData.tenant_id,
          name: formData.name,
          campaign_type: formData.campaign_type,
          event_date: eventDateTime,
          hero_image_id: formData.hero_image_id || null,
          status: "draft",
        })
        .select()
        .single();

      if (error) throw error;

      // Redirect to campaign generation page
      router.push(`/campaigns/${campaign.id}/generate`);
    } catch (error) {
      console.error("Error creating campaign:", error);
      alert("Failed to create campaign");
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
        return true; // Image is optional
      default:
        return false;
    }
  };

  // Get tomorrow's date as minimum for event date
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split("T")[0];

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-heading font-bold">Create Campaign</h1>
            <Link href="/dashboard" className="btn-ghost">
              Cancel
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex justify-between">
            {[1, 2, 3].map((s) => (
              <div key={s} className={`flex items-center ${s < 3 ? "flex-1" : ""}`}>
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                    step >= s ? "bg-primary text-white" : "bg-gray-200 text-gray-400"
                  }`}
                >
                  {step > s ? <Check className="w-5 h-5" /> : s}
                </div>
                {s < 3 && (
                  <div className={`flex-1 h-1 mx-2 ${step > s ? "bg-primary" : "bg-gray-200"}`} />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-2">
            <span className="text-sm">Campaign Type</span>
            <span className="text-sm">Details</span>
            <span className="text-sm">Hero Image</span>
          </div>
        </div>

        {/* Step Content */}
        <div className="card">
          {step === 1 && (
            <>
              <h2 className="text-2xl font-heading font-bold mb-2">What type of campaign?</h2>
              <p className="text-text-secondary mb-6">Choose the type that best fits your needs</p>

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
                    className="input-field"
                    placeholder={
                      formData.campaign_type === "event" ? "Friday Quiz Night" :
                      formData.campaign_type === "special" ? "Happy Hour Special" :
                      formData.campaign_type === "seasonal" ? "Christmas Menu Launch" :
                      "New Opening Hours"
                    }
                  />
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
                      className="input-field"
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
                      className="input-field"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-2xl font-heading font-bold mb-2">Select Hero Image</h2>
              <p className="text-text-secondary mb-6">Choose an image for your campaign (optional)</p>

              {/* Upload Button */}
              <div className="mb-6">
                <input
                  type="file"
                  id="image-upload"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                  disabled={uploading}
                />
                <label
                  htmlFor="image-upload"
                  className={`btn-secondary inline-flex items-center cursor-pointer ${
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
                    className="btn-ghost text-sm"
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
              <button onClick={() => setStep(step - 1)} className="btn-ghost flex items-center">
                <ChevronLeft className="w-4 h-4 mr-2" />
                Back
              </button>
            )}

            <div className={step === 1 ? "ml-auto" : ""}>
              {step < 3 ? (
                <button
                  onClick={() => setStep(step + 1)}
                  disabled={!canProceed()}
                  className="btn-primary flex items-center"
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-2" />
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="btn-primary flex items-center"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      Create Campaign
                      <Sparkles className="w-4 h-4 ml-2" />
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}