"use client";

import { Button } from "@/components/ui/button";
import { Eye, EyeOff } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export function PlannerViewToggle() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const showImages = searchParams.get("show_images") !== "false";

    const toggleImages = useCallback(() => {
        const params = new URLSearchParams(searchParams.toString());

        if (showImages) {
            params.set("show_images", "false");
        } else {
            params.delete("show_images");
        }

        router.push(`${pathname}?${params.toString()}`, { scroll: false });
    }, [pathname, router, searchParams, showImages]);

    return (
        <Button
            variant="outline"
            size="sm"
            onClick={toggleImages}
            className="gap-2 bg-primary text-white border-transparent hover:bg-primary/90 hover:text-white hover:border-transparent"
            title={showImages ? "Hide images" : "Show images"}
        >
            {showImages ? (
                <>
                    <EyeOff size={14} />
                    <span className="hidden sm:inline">Hide images</span>
                </>
            ) : (
                <>
                    <Eye size={14} />
                    <span className="hidden sm:inline">Show images</span>
                </>
            )}
        </Button>
    );
}
