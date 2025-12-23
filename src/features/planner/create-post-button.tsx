"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCreateModal } from "@/features/create/create-modal-context";

export function CreatePostButton() {
    const { openModal } = useCreateModal();

    return (
        <Button
            variant="default"
            className="gap-2 shadow-sm hover:shadow-md transition-all"
            onClick={() => openModal({ initialTab: "instant" })}
        >
            <Plus size={16} />
            Create Post
        </Button>
    );
}
