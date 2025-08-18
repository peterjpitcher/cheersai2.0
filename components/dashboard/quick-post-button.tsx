"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import QuickPostModal from "@/components/quick-post-modal";

export default function QuickPostButton() {
  const [modalOpen, setModalOpen] = useState(false);

  const handleSuccess = () => {
    // Optionally refresh the page or show a success message
    window.location.reload();
  };

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className="card-interactive group"
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
      />
    </>
  );
}