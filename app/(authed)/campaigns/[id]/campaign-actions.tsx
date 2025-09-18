"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, Check, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/datetime";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface CampaignPost {
  id: string;
  post_timing: string;
  content: string;
  scheduled_for: string;
}

interface CampaignActionsProps {
  campaignId: string;
  campaignName: string;
  posts: CampaignPost[];
}

export default function CampaignActions({ campaignId, campaignName, posts }: CampaignActionsProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const copyAllPosts = async () => {
    const content = posts.map(post => post.content).join("\n\n---\n\n");
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadAllPosts = () => {
    const content = posts.map((post, idx) => {
      const date = formatDate(post.scheduled_for);
      return `Post ${idx + 1} - ${date}\n${'-'.repeat(40)}\n${post.content}`;
    }).join('\n\n');

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${campaignName.replace(/\s+/g, "-")}-posts.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const deleteCampaign = async () => {
    setDeleting(true);
    setDeleteError(null);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to delete campaign");
      }

      // Close dialog and redirect to campaigns list
      setDeleteDialogOpen(false);
      router.push("/campaigns");
    } catch (error) {
      console.error("Delete error:", error);
      setDeleteError(error instanceof Error ? error.message : "Failed to delete campaign");
      setDeleting(false);
    }
  };

  const handleDeleteClick = () => {
    setDeleteError(null);
    setDeleteDialogOpen(true);
  };

  return (
    <div className="flex gap-2">
  <Button variant="outline" onClick={copyAllPosts} size="sm">
        {copied ? (
          <Check className="mr-2 size-4 text-success" />
        ) : (
          <Copy className="mr-2 size-4" />
        )}
        {copied ? "Copied!" : "Copy All"}
      </Button>
  <Button variant="outline" onClick={downloadAllPosts} size="sm">
        <Download className="mr-2 size-4" />
        Download
      </Button>
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogTrigger asChild>
          <Button onClick={handleDeleteClick} variant="destructive" size="sm">
            <Trash2 className="mr-2 size-4" />
            Delete
          </Button>
        </DialogTrigger>
        <DialogContent className="flex flex-col overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              Delete Campaign
            </DialogTitle>
            <DialogDescription className="text-left">
              Are you sure you want to delete the campaign <strong>"{campaignName}"</strong>?
              <br />
              <br />
              This action will permanently delete:
              <ul className="mt-2 list-inside list-disc space-y-1">
                <li>The campaign</li>
                <li>All {posts.length} associated posts</li>
                <li>All scheduling information</li>
              </ul>
              <br />
              <strong>This action cannot be undone.</strong>
            </DialogDescription>
          </DialogHeader>
          
          {deleteError && (
            <div className="mx-6 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <strong>Error:</strong> {deleteError}
            </div>
          )}
          
          <DialogFooter className="gap-2 px-6 py-4">
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={deleting} size="sm">
              Cancel
            </Button>
            <Button onClick={deleteCampaign} loading={deleting} variant="destructive" size="sm">
              {!deleting && <Trash2 className="mr-2 size-4" />}
              Delete Campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
