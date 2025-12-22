"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Facebook, Instagram, Store } from "lucide-react";
import { createPlannerContent } from "@/app/(app)/planner/actions";
import { useToast } from "@/components/providers/toast-provider";
import { Button } from "@/components/ui/button";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
    SheetTrigger,
} from "@/components/ui/sheet";

export function CreatePostButton() {
    const [open, setOpen] = useState(false);
    const [isPending, startTransition] = useTransition();
    const router = useRouter();
    const toast = useToast();

    const handleCreate = (platform: "facebook" | "instagram" | "gbp", placement: "feed" | "story") => {
        startTransition(async () => {
            try {
                const result = await createPlannerContent({ platform, placement });
                toast.success("Draft created");
                setOpen(false);
                router.push(`/planner/${result.contentId}`);
            } catch (error) {
                toast.error("Failed to create draft");
                console.error(error);
            }
        });
    };

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button variant="default" className="gap-2">
                    <Plus size={16} /> Create Post
                </Button>
            </SheetTrigger>
            <SheetContent>
                <SheetHeader>
                    <SheetTitle>Create new post</SheetTitle>
                    <SheetDescription>
                        Choose where you want to publish this content.
                    </SheetDescription>
                </SheetHeader>
                <div className="grid gap-4 py-4">
                    <Button
                        variant="outline"
                        className="h-auto flex-col items-start gap-1 p-4"
                        disabled={isPending}
                        onClick={() => handleCreate("instagram", "feed")}
                    >
                        <div className="flex items-center gap-2 font-semibold">
                            <Instagram className="size-4" /> Instagram Post
                        </div>
                        <div className="text-xs text-muted-foreground font-normal">
                            Publish a photo or video to your Instagram feed.
                        </div>
                    </Button>

                    <Button
                        variant="outline"
                        className="h-auto flex-col items-start gap-1 p-4"
                        disabled={isPending}
                        onClick={() => handleCreate("instagram", "story")}
                    >
                        <div className="flex items-center gap-2 font-semibold">
                            <Instagram className="size-4" /> Instagram Story
                        </div>
                        <div className="text-xs text-muted-foreground font-normal">
                            Share a temporary photo or video to your story.
                        </div>
                    </Button>

                    <Button
                        variant="outline"
                        className="h-auto flex-col items-start gap-1 p-4"
                        disabled={isPending}
                        onClick={() => handleCreate("facebook", "feed")}
                    >
                        <div className="flex items-center gap-2 font-semibold">
                            <Facebook className="size-4" /> Facebook Post
                        </div>
                        <div className="text-xs text-muted-foreground font-normal">
                            Publish content to your Facebook page.
                        </div>
                    </Button>

                    <Button
                        variant="outline"
                        className="h-auto flex-col items-start gap-1 p-4"
                        disabled={isPending}
                        onClick={() => handleCreate("gbp", "feed")}
                    >
                        <div className="flex items-center gap-2 font-semibold">
                            <Store className="size-4" /> Google Business Update
                        </div>
                        <div className="text-xs text-muted-foreground font-normal">
                            Post an update or offer to your Google Business Profile.
                        </div>
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}
