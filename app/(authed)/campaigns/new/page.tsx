"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Calendar, Clock, Image, ChevronLeft, ChevronRight,
  Sparkles, PartyPopper, Sun, Megaphone, Loader2, Check,
  Upload, X, Plus
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
  const [selectedPostDates, setSelectedPostDates] = useState<string[]>([]);
  const [customDates, setCustomDates] = useState<{date: string, time: string}[]>([]);
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

  useEffect(() => {
    // When we reach step 3, populate default post dates based on event date
    if (step === 3 && formData.event_date && selectedPostDates.length === 0) {
      const eventDate = new Date(formData.event_date);
      const defaultDates = [];
      
      // Week before
      const weekBefore = new Date(eventDate);
      weekBefore.setDate(weekBefore.getDate() - 7);
      defaultDates.push(`week_before_${weekBefore.toISOString()}`);
      
      // Day before
      const dayBefore = new Date(eventDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      defaultDates.push(`day_before_${dayBefore.toISOString()}`);
      
      // Day of
      defaultDates.push(`day_of_${eventDate.toISOString()}`);
      
      // Hour before (if time is set)
      if (formData.event_time) {
        const hourBefore = new Date(`${formData.event_date}T${formData.event_time}`);
        hourBefore.setHours(hourBefore.getHours() - 1);
        defaultDates.push(`hour_before_${hourBefore.toISOString()}`);
      }
      
      setSelectedPostDates(defaultDates);
    }
  }, [step, formData.event_date, formData.event_time]);

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
      alert("Please upload an image file");
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

      setUploadProgress(10);

      // Compress image if needed
      let uploadFile: Blob | File = file;
      let finalFileName = file.name;
      
      // Check if compression is needed (over 2MB or HEIC format)
      if (file.size > 2 * 1024 * 1024 || file.type.includes("heic") || file.type.includes("heif")) {
        try {
          console.log("Compressing image from", Math.round(file.size / 1024), "KB");
          const compressed = await compressImage(file);
          console.log("Compressed to", Math.round(compressed.size / 1024), "KB");
          uploadFile = compressed;
          // Change extension to .jpg for compressed images
          finalFileName = file.name.replace(/\.(heic|heif|HEIC|HEIF)$/i, '.jpg');
          if (!finalFileName.endsWith('.jpg')) {
            finalFileName = finalFileName.replace(/\.[^.]+$/, '.jpg');
          }
        } catch (compressionError) {
          console.error("Compression failed, uploading original:", compressionError);
          // Continue with original file if compression fails
        }
      }

      setUploadProgress(30);

      // Generate unique file name
      const fileExt = finalFileName.split(".").pop() || 'jpg';
      const fileName = `${userData.tenant_id}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("media")
        .upload(fileName, uploadFile, {
          cacheControl: "3600",
          upsert: false,
          contentType: uploadFile.type || 'image/jpeg',
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
          file_name: finalFileName,
          file_url: publicUrl,
          file_type: uploadFile.type || 'image/jpeg',
          file_size: uploadFile.size,
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
      console.error("Upload error details:", error);
      if (error instanceof Error) {
        alert(`Failed to upload image: ${error.message}`);
      } else {
        alert("Failed to upload image. Please try again.");
      }
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
      // Validate event date is not in the past
      const eventDate = new Date(formData.event_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      eventDate.setHours(0, 0, 0, 0);
      
      if (eventDate < today) {
        alert("Campaign event date cannot be in the past. Please select today or a future date.");
        setLoading(false);
        return;
      }
      
      // Validate custom dates are not in the past
      for (const customDate of customDates) {
        const customDateTime = new Date(customDate.date);
        customDateTime.setHours(0, 0, 0, 0);
        if (customDateTime < today) {
          alert("Custom post dates cannot be in the past. Please select today or future dates only.");
          setLoading(false);
          return;
        }
      }
      
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

      // Extract selected timings and custom dates
      const selectedTimings = selectedPostDates
        .filter(date => date.startsWith('week_before_') || 
                       date.startsWith('day_before_') || 
                       date.startsWith('day_of_') || 
                       date.startsWith('hour_before_'))
        .map(date => date.split('_')[0] + '_' + date.split('_')[1]); // e.g., "week_before", "day_of"
      
      const customDatesArray = customDates.map(cd => {
        const dateTime = cd.time 
          ? `${cd.date}T${cd.time}:00`
          : `${cd.date}T12:00:00`;
        return new Date(dateTime).toISOString();
      });

      // Create campaign with user selections via API endpoint (includes server-side validation)
      const campaignData: any = {
        name: formData.name,
        campaign_type: formData.campaign_type,
        event_date: eventDateTime,
        hero_image_id: formData.hero_image_id || null,
        status: "draft",
        selected_timings: selectedTimings,
        custom_dates: customDatesArray,
      };
      
      const response = await fetch("/api/campaigns/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campaignData),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to create campaign");
      }

      const campaign = result.campaign;

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
              <h2 className="text-2xl font-heading font-bold mb-2">Choose Posting Schedule</h2>
              <p className="text-text-secondary mb-6">Select when to create posts for your {formData.campaign_type}</p>
              
              <div className="space-y-6">
                {/* Recommended Posts */}
                <div>
                  <h3 className="font-semibold mb-3">Recommended Posts</h3>
                  <div className="space-y-3">
                    {formData.event_date && (
                      <>
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
                              {new Date(new Date(formData.event_date).setDate(new Date(formData.event_date).getDate() - 7)).toLocaleDateString("en-GB", { weekday: 'long', day: 'numeric', month: 'long' })}
                            </p>
                          </div>
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">Save the date</span>
                        </label>

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
                              {new Date(new Date(formData.event_date).setDate(new Date(formData.event_date).getDate() - 1)).toLocaleDateString("en-GB", { weekday: 'long', day: 'numeric', month: 'long' })}
                            </p>
                          </div>
                          <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded">Reminder</span>
                        </label>

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
                              {new Date(formData.event_date).toLocaleDateString("en-GB", { weekday: 'long', day: 'numeric', month: 'long' })}
                            </p>
                          </div>
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">Today!</span>
                        </label>

                        {formData.event_time && (
                          <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedPostDates.some(d => d.startsWith("hour_before"))}
                              onChange={(e) => {
                                const hourBefore = new Date(`${formData.event_date}T${formData.event_time}`);
                                hourBefore.setHours(hourBefore.getHours() - 1);
                                const dateKey = `hour_before_${hourBefore.toISOString()}`;
                                setSelectedPostDates(prev => 
                                  e.target.checked 
                                    ? [...prev, dateKey]
                                    : prev.filter(d => !d.startsWith("hour_before"))
                                );
                              }}
                              className="w-4 h-4"
                            />
                            <div className="flex-1">
                              <p className="font-medium">1 Hour Before</p>
                              <p className="text-sm text-gray-600">
                                {(() => {
                                  const time = new Date(`${formData.event_date}T${formData.event_time}`);
                                  time.setHours(time.getHours() - 1);
                                  return time.toLocaleTimeString("en-GB", { hour: '2-digit', minute: '2-digit' });
                                })()}
                              </p>
                            </div>
                            <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">Last call</span>
                          </label>
                        )}
                      </>
                    )}
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
                            setCustomDates(newCustomDates);
                          }}
                          className="input-field flex-1"
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
                          className="input-field w-32"
                        />
                        <button
                          onClick={() => setCustomDates(customDates.filter((_, i) => i !== index))}
                          className="btn-ghost text-red-600"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        const today = new Date();
                        const defaultDate = formData.event_date || today.toISOString().split("T")[0];
                        setCustomDates([...customDates, { date: defaultDate, time: "12:00" }]);
                      }}
                      className="btn-secondary text-sm"
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
              {step < 4 ? (
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