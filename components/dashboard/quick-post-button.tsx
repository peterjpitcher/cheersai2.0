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
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ when?: string }>).detail
      const when = detail?.when ? new Date(detail.when) : new Date(Date.now() + 15 * 60 * 1000)
      setExternalDefaultDate(when);
      setModalOpen(true);
    };
    window.addEventListener('open-quick-post', handler);
    return () => window.removeEventListener('open-quick-post', handler);
  }, []);

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className="group w-full rounded-card border bg-card p-4 text-left text-card-foreground shadow-card transition-shadow hover:shadow-cardHover"
      >
        <div className="flex flex-col items-center text-center md:flex-row md:gap-3 md:text-left">
          <div className="mb-2 rounded-chip bg-accent/10 p-3 transition-colors group-hover:bg-accent/20 md:mb-0">
            <Send className="size-6 text-accent" />
          </div>
          <div>
            <p className="text-sm font-semibold md:text-base">Quick Post</p>
            <p className="hidden text-xs text-text-secondary md:block md:text-sm">Post update now</p>
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
