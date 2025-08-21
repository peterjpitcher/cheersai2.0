"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface PublishAllButtonProps {
  campaignId: string;
  draftCount: number;
  onSuccess?: () => void;
}

export function PublishAllButton({ campaignId, draftCount, onSuccess }: PublishAllButtonProps) {
  const [publishing, setPublishing] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handlePublishAll = async () => {
    setPublishing(true);
    
    try {
      // Update all draft posts to scheduled
      const { error } = await supabase
        .from("campaign_posts")
        .update({ 
          status: "scheduled",
          updated_at: new Date().toISOString()
        })
        .eq("campaign_id", campaignId)
        .eq("status", "draft");

      if (error) throw error;

      toast.success(`${draftCount} posts scheduled successfully`);
      
      // Call the parent's success callback to update state
      if (onSuccess) {
        onSuccess();
      } else {
        // Fallback to router refresh if no callback provided
        router.refresh();
      }
    } catch (error) {
      console.error("Error scheduling posts:", error);
      toast.error("Failed to schedule posts");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Button 
      onClick={handlePublishAll}
      disabled={publishing || draftCount === 0}
      size="lg"
    >
      {publishing ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Scheduling...
        </>
      ) : (
        <>
          <Clock className="h-4 w-4 mr-2" />
          Schedule All Drafts ({draftCount})
        </>
      )}
    </Button>
  );
}