"use client";

import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import QuickPostModal from "@/components/quick-post-modal";

export default function QuickPostButton() {
  const [modalOpen, setModalOpen] = useState(false);
  const [externalDefaultDate, setExternalDefaultDate] = useState<Date | null>(null);

  const handleSuccess = () => {
    // Optionally refresh the page or show a success message
    window.location.reload();
  };

  // Listen for sub-nav "Quick Post" trigger
  useEffect(() => {
    const handler = (e: any) => {
      const when: Date | undefined = e?.detail?.when ? new Date(e.detail.when) : new Date(Date.now() + 15 * 60 * 1000);
      setExternalDefaultDate(when);
      setModalOpen(true);
    };
    window.addEventListener('open-quick-post', handler as any);
    return () => window.removeEventListener('open-quick-post', handler as any);
  }, []);

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className="rounded-lg border bg-card text-card-foreground shadow-sm hover:shadow-md transition-shadow p-4 w-full text-left group"
      >
        <div className="flex flex-col md:flex-row items-center md:gap-3 text-center md:text-left">
          <div className="bg-accent/10 p-3 rounded-medium group-hover:bg-accent/20 transition-colors mb-2 md:mb-0">
            <Send className="w-6 h-6 text-accent" />
          </div>
          <div>
            <p className="font-semibold text-sm md:text-base">Quick Post</p>
            <p className="text-xs md:text-sm text-text-secondary hidden md:block">Post update now</p>
          </div>
        </div>
      </button>

      <QuickPostModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={handleSuccess}
        defaultDate={externalDefaultDate}
      />
    </>
  );
}
