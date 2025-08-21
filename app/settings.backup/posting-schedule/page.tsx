"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 
  Clock, Plus, Trash2, Save, Loader2, 
  ChevronLeft, Calendar, AlertCircle
} from "lucide-react";
import Link from "next/link";

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

const DEFAULT_TIMES = [
  { time: "09:00", label: "Morning (9:00 AM)" },
  { time: "12:00", label: "Lunch (12:00 PM)" },
  { time: "17:00", label: "Happy Hour (5:00 PM)" },
  { time: "20:00", label: "Evening (8:00 PM)" },
];

export default function PostingSchedulePage() {
  const router = useRouter();
  const [schedule, setSchedule] = useState<ScheduleSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tenantId, setTenantId] = useState<string>("");

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

    // Fetch existing schedule
    const { data: scheduleData } = await supabase
      .from("posting_schedules")
      .select("*")
      .eq("tenant_id", userData.tenant_id)
      .order("day_of_week", { ascending: true })
      .order("time", { ascending: true });

    if (scheduleData && scheduleData.length > 0) {
      setSchedule(scheduleData);
    } else {
      // Initialize with recommended defaults
      initializeDefaultSchedule();
    }

    setLoading(false);
  };

  const initializeDefaultSchedule = () => {
    const defaultSchedule: ScheduleSlot[] = [];
    
    // Add default posting times for key days
    // Thursday - Quiz night promotion
    defaultSchedule.push({
      id: crypto.randomUUID(),
      day_of_week: 4,
      time: "17:00",
      platform: "all",
      active: true,
    });

    // Friday - Weekend kickoff
    defaultSchedule.push({
      id: crypto.randomUUID(),
      day_of_week: 5,
      time: "12:00",
      platform: "all",
      active: true,
    });
    defaultSchedule.push({
      id: crypto.randomUUID(),
      day_of_week: 5,
      time: "17:00",
      platform: "all",
      active: true,
    });

    // Saturday - Weekend events
    defaultSchedule.push({
      id: crypto.randomUUID(),
      day_of_week: 6,
      time: "11:00",
      platform: "all",
      active: true,
    });
    defaultSchedule.push({
      id: crypto.randomUUID(),
      day_of_week: 6,
      time: "19:00",
      platform: "all",
      active: true,
    });

    // Sunday - Sunday roast
    defaultSchedule.push({
      id: crypto.randomUUID(),
      day_of_week: 0,
      time: "10:00",
      platform: "all",
      active: true,
    });

    setSchedule(defaultSchedule);
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
      await supabase
        .from("posting_schedules")
        .delete()
        .eq("tenant_id", tenantId);

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

        if (error) throw error;
      }

      alert("Posting schedule saved successfully!");
    } catch (error) {
      console.error("Error saving schedule:", error);
      alert("Failed to save schedule");
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
          <div className="flex items-center gap-4">
            <Link href="/settings" className="text-text-secondary hover:text-primary">
              <ChevronLeft className="w-6 h-6" />
            </Link>
            <div>
              <h1 className="text-2xl font-heading font-bold">Posting Schedule</h1>
              <p className="text-sm text-text-secondary">
                Set your recommended posting times
              </p>
            </div>
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

        {/* Quick Add Presets */}
        <div className="card mb-6">
          <h3 className="font-semibold mb-3">Quick Add Popular Times</h3>
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