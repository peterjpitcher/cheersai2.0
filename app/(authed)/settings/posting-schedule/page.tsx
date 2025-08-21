"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 
  Clock, Plus, Trash2, Save, Loader2, 
  Calendar, AlertCircle, Lightbulb, Zap
} from "lucide-react";
import Link from "next/link";
import {
  getRecommendedSchedule,
  convertRecommendationsToSlots,
  HOSPITALITY_QUICK_PRESETS,
  BUSINESS_TYPES
} from "@/lib/scheduling/uk-hospitality-defaults";

interface ScheduleSlot {
  id: string;
  day_of_week: number; // 0 = Sunday, 6 = Saturday
  time: string; // HH:MM format
  platform: string;
  active: boolean;
}

const DAYS_OF_WEEK = [
  "Sunday", "Monday", "Tuesday", "Wednesday", 
  "Thursday", "Friday", "Saturday"
];

const PLATFORMS = [
  { value: "all", label: "All Platforms" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "twitter", label: "Twitter/X" },
  { value: "linkedin", label: "LinkedIn" },
];

const DEFAULT_TIMES = HOSPITALITY_QUICK_PRESETS;

export default function PostingSchedulePage() {
  const router = useRouter();
  const [schedule, setSchedule] = useState<ScheduleSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tenantId, setTenantId] = useState<string>("");
  const [showRecommendations, setShowRecommendations] = useState(false);

  useEffect(() => {
    fetchSchedule();
  }, []);

  const fetchSchedule = async () => {
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
    setTenantId(userData.tenant_id);

    try {
      // Fetch existing schedule
      const { data: scheduleData, error } = await supabase
        .from("posting_schedules")
        .select("*")
        .eq("tenant_id", userData.tenant_id)
        .order("day_of_week", { ascending: true })
        .order("time", { ascending: true });

      if (error) {
        console.error("Error fetching posting schedule:", error);
        // If table doesn't exist (404 error), initialize with defaults
        if (error.code === "42P01" || error.message.includes("relation") || error.message.includes("does not exist")) {
          console.log("Posting schedules table not found, initializing with defaults");
          initializeDefaultSchedule();
        } else {
          // For other errors, show an alert
          alert("Failed to load posting schedule. Please try refreshing the page.");
        }
      } else if (scheduleData && scheduleData.length > 0) {
        setSchedule(scheduleData);
      } else {
        // Initialize with recommended defaults
        initializeDefaultSchedule();
      }
    } catch (error) {
      console.error("Error in fetchSchedule:", error);
      // Fallback to default schedule if there's any error
      initializeDefaultSchedule();
    }

    setLoading(false);
  };

  const initializeDefaultSchedule = () => {
    // Use smart recommendations for UK hospitality
    const recommendations = getRecommendedSchedule();
    const smartSchedule = convertRecommendationsToSlots(recommendations, "all");
    
    // Limit to high-priority recommendations to avoid overwhelming users
    const limitedSchedule = smartSchedule.slice(0, 8);
    
    setSchedule(limitedSchedule);
  };

  const applySmartRecommendations = () => {
    const recommendations = getRecommendedSchedule();
    const smartSchedule = convertRecommendationsToSlots(recommendations, "all");
    
    // Replace current schedule with smart recommendations
    setSchedule(smartSchedule);
    setShowRecommendations(false);
  };

  const addTimeSlot = (dayOfWeek: number) => {
    const newSlot: ScheduleSlot = {
      id: crypto.randomUUID(),
      day_of_week: dayOfWeek,
      time: "12:00",
      platform: "all",
      active: true,
    };

    setSchedule([...schedule, newSlot].sort((a, b) => {
      if (a.day_of_week !== b.day_of_week) {
        return a.day_of_week - b.day_of_week;
      }
      return a.time.localeCompare(b.time);
    }));
  };

  const updateSlot = (id: string, field: keyof ScheduleSlot, value: any) => {
    setSchedule(schedule.map(slot => 
      slot.id === id ? { ...slot, [field]: value } : slot
    ));
  };

  const removeSlot = (id: string) => {
    setSchedule(schedule.filter(slot => slot.id !== id));
  };

  const saveSchedule = async () => {
    if (!tenantId) return;

    setSaving(true);
    const supabase = createClient();

    try {
      // Delete existing schedule
      const { error: deleteError } = await supabase
        .from("posting_schedules")
        .delete()
        .eq("tenant_id", tenantId);

      // Log delete error but don't fail if table doesn't exist yet
      if (deleteError && !deleteError.message.includes("relation") && !deleteError.message.includes("does not exist")) {
        console.error("Error deleting existing schedule:", deleteError);
      }

      // Insert new schedule
      if (schedule.length > 0) {
        const scheduleToSave = schedule.map(slot => ({
          tenant_id: tenantId,
          day_of_week: slot.day_of_week,
          time: slot.time,
          platform: slot.platform,
          active: slot.active,
        }));

        const { error } = await supabase
          .from("posting_schedules")
          .insert(scheduleToSave);

        if (error) {
          console.error("Insert error:", error);
          if (error.message.includes("relation") || error.message.includes("does not exist")) {
            alert("The posting schedules feature is not yet available. Please contact support or run the latest database migrations.");
          } else {
            alert(`Failed to save schedule: ${error.message}`);
          }
          setSaving(false);
          return;
        }
      }

      alert("Posting schedule saved successfully!");
    } catch (error) {
      console.error("Error saving schedule:", error);
      alert("Failed to save schedule. Please try again.");
    }

    setSaving(false);
  };

  const getSlotsByDay = (dayOfWeek: number) => {
    return schedule.filter(slot => slot.day_of_week === dayOfWeek);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-surface">
        <div className="container mx-auto px-4 py-4">
          <div>
            <h1 className="text-2xl font-heading font-bold">Posting Schedule</h1>
            <p className="text-sm text-text-secondary">
              Set your recommended posting times
            </p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Info Box */}
        <div className="card bg-primary/5 border-primary/20 mb-6">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-1">Optimize Your Posting Times</p>
              <p className="text-sm text-text-secondary">
                These recommended times will be used when generating campaign schedules. 
                Posts will be automatically distributed across these time slots for maximum engagement.
              </p>
            </div>
          </div>
        </div>

        {/* Smart Recommendations */}
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-primary" />
              <h3 className="font-semibold">UK Hospitality Smart Recommendations</h3>
            </div>
            <button
              onClick={() => setShowRecommendations(!showRecommendations)}
              className="text-primary hover:text-primary/80 text-sm"
            >
              {showRecommendations ? 'Hide' : 'View'} Recommendations
            </button>
          </div>
          
          <div className="bg-primary/5 border border-primary/20 rounded-medium p-3 mb-4">
            <p className="text-sm text-text-secondary mb-2">
              Our smart scheduling uses UK hospitality industry data to recommend optimal posting times
              for maximum engagement during breakfast, lunch, after-work, dinner, and evening social periods.
            </p>
            <button
              onClick={applySmartRecommendations}
              className="btn-primary text-sm flex items-center gap-2"
            >
              <Zap className="w-4 h-4" />
              Apply Smart Recommendations
            </button>
          </div>

          {showRecommendations && (
            <div className="mb-4">
              <h4 className="font-medium mb-3">Recommended Times by Business Peak Periods:</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div className="bg-surface p-3 rounded-medium">
                  <strong>Breakfast Rush:</strong> 8:00-9:00 AM<br />
                  <span className="text-text-secondary">Coffee shops, cafes</span>
                </div>
                <div className="bg-surface p-3 rounded-medium">
                  <strong>Lunch Peak:</strong> 12:00-1:30 PM<br />
                  <span className="text-text-secondary">Restaurants, pubs, cafes</span>
                </div>
                <div className="bg-surface p-3 rounded-medium">
                  <strong>After Work:</strong> 5:00-7:00 PM<br />
                  <span className="text-text-secondary">Pubs, bars</span>
                </div>
                <div className="bg-surface p-3 rounded-medium">
                  <strong>Evening Dining:</strong> 7:00-9:00 PM<br />
                  <span className="text-text-secondary">Restaurants, entertainment</span>
                </div>
              </div>
            </div>
          )}

          <h4 className="font-semibold mb-3">Quick Add Hospitality Times</h4>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_TIMES.map(preset => (
              <button
                key={preset.time}
                onClick={() => {
                  const dayOfWeek = new Date().getDay();
                  const newSlot: ScheduleSlot = {
                    id: crypto.randomUUID(),
                    day_of_week: dayOfWeek,
                    time: preset.time,
                    platform: "all",
                    active: true,
                  };
                  setSchedule([...schedule, newSlot].sort((a, b) => {
                    if (a.day_of_week !== b.day_of_week) {
                      return a.day_of_week - b.day_of_week;
                    }
                    return a.time.localeCompare(b.time);
                  }));
                }}
                className="btn-secondary text-sm"
              >
                <Plus className="w-4 h-4 mr-1" />
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Schedule by Day */}
        <div className="space-y-4">
          {DAYS_OF_WEEK.map((day, dayIndex) => {
            const daySlots = getSlotsByDay(dayIndex);
            
            return (
              <div key={day} className="card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    {day}
                  </h3>
                  <button
                    onClick={() => addTimeSlot(dayIndex)}
                    className="text-primary hover:text-primary/80 text-sm flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" />
                    Add Time
                  </button>
                </div>

                {daySlots.length === 0 ? (
                  <p className="text-sm text-text-secondary py-4 text-center border-2 border-dashed border-border rounded-medium">
                    No posting times set for {day}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {daySlots.map(slot => (
                      <div key={slot.id} className="flex items-center gap-3 p-3 bg-surface rounded-medium">
                        <Clock className="w-4 h-4 text-text-secondary" />
                        
                        <input
                          type="time"
                          value={slot.time}
                          onChange={(e) => updateSlot(slot.id, "time", e.target.value)}
                          className="input-field w-32"
                        />

                        <select
                          value={slot.platform}
                          onChange={(e) => updateSlot(slot.id, "platform", e.target.value)}
                          className="input-field flex-1"
                        >
                          {PLATFORMS.map(platform => (
                            <option key={platform.value} value={platform.value}>
                              {platform.label}
                            </option>
                          ))}
                        </select>

                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={slot.active}
                            onChange={(e) => updateSlot(slot.id, "active", e.target.checked)}
                            className="w-4 h-4"
                          />
                          <span className="text-sm">Active</span>
                        </label>

                        <button
                          onClick={() => removeSlot(slot.id)}
                          className="text-error hover:text-error/80"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Save Button */}
        <div className="mt-8 flex justify-end gap-3">
          <Link href="/settings" className="btn-secondary">
            Cancel
          </Link>
          <button
            onClick={saveSchedule}
            disabled={saving}
            className="btn-primary flex items-center gap-2"
          >
            {saving ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Save className="w-5 h-5" />
                Save Schedule
              </>
            )}
          </button>
        </div>
      </main>
    </div>
  );
}