"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CreateWizard } from "@/features/create/create-wizard";
import { useCreateModal } from "@/features/create/create-modal-context";
import { getCreateModalData } from "@/features/create/create-modal-actions";

export function CreateModal() {
    const { isOpen, closeModal, initialTab, initialDate, initialMedia } = useCreateModal();

    const { data, isLoading } = useQuery({
        queryKey: ["create-modal-data"],
        queryFn: () => getCreateModalData(),
        enabled: isOpen,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
            <DialogContent className="w-[95vw] max-w-7xl max-h-[90vh] overflow-y-auto bg-background/95 backdrop-blur-xl border-white/20">
                {isLoading || !data ? (
                    <div className="flex flex-col items-center justify-center p-12 space-y-4">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Loading studio...</p>
                    </div>
                ) : (
                    <CreateWizard
                        mediaAssets={data.mediaAssets}
                        plannerItems={data.plannerItems}
                        ownerTimezone={data.ownerTimezone}
                        initialTab={initialTab}
                        initialDate={initialDate}
                        initialMedia={initialMedia}
                        onSuccess={closeModal}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}
