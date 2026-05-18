import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CreatePostButton() {
    return (
        <Button
            variant="default"
            className="gap-2 shadow-sm hover:shadow-md transition-all"
            asChild
        >
            <Link href="/create?tab=instant">
                <Plus size={16} />
                Create Post
            </Link>
        </Button>
    );
}
