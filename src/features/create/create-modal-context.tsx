"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import type { MediaAssetSummary } from "@/lib/library/data";

interface CreateModalContextType {
    isOpen: boolean;
    openModal: (options?: { initialTab?: string; initialDate?: Date; initialMedia?: MediaAssetSummary[] }) => void;
    closeModal: () => void;
    initialTab?: string;
    initialDate?: Date;
    initialMedia?: MediaAssetSummary[];
}

const CreateModalContext = createContext<CreateModalContextType | undefined>(undefined);

export function CreateModalProvider({ children }: { children: ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);
    const [initialTab, setInitialTab] = useState<string | undefined>(undefined);
    const [initialDate, setInitialDate] = useState<Date | undefined>(undefined);
    const [initialMedia, setInitialMedia] = useState<MediaAssetSummary[] | undefined>(undefined);

    const openModal = useCallback((options?: { initialTab?: string; initialDate?: Date; initialMedia?: MediaAssetSummary[] }) => {
        setInitialTab(options?.initialTab);
        setInitialDate(options?.initialDate);
        setInitialMedia(options?.initialMedia);
        setIsOpen(true);
    }, []);

    const closeModal = useCallback(() => {
        setIsOpen(false);
        setInitialTab(undefined);
        setInitialDate(undefined);
        setInitialMedia(undefined);
    }, []);

    return (
        <CreateModalContext.Provider value={{ isOpen, openModal, closeModal, initialTab, initialDate, initialMedia }}>
            {children}
        </CreateModalContext.Provider>
    );
}

export function useCreateModal() {
    const context = useContext(CreateModalContext);
    if (context === undefined) {
        throw new Error("useCreateModal must be used within a CreateModalProvider");
    }
    return context;
}
