"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CreateWizard } from "@/features/create/create-wizard";
import { useCreateModal } from "@/features/create/create-modal-context";

/**
 * Legacy create modal -- wraps the new 4-step wizard in a Dialog.
 * For the responsive container approach (bottom sheet / slide-over / modal),
 * see CreateFlowContainer and the /create page route.
 */
export function CreateModal() {
    const { isOpen, closeModal } = useCreateModal();

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
            <DialogContent className="w-[95vw] max-w-4xl max-h-[90vh] overflow-y-auto bg-background/95 backdrop-blur-xl border-white/20">
                <DialogTitle className="sr-only">Create Content</DialogTitle>
                <DialogDescription className="sr-only">Create and configure new content</DialogDescription>
                <CreateWizard onClose={closeModal} />
            </DialogContent>
        </Dialog>
    );
}
