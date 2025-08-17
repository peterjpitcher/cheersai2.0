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
        <div className="flex items-center gap-3">
          <div className="bg-accent/10 p-3 rounded-medium group-hover:bg-accent/20 transition-colors">
            <Send className="w-6 h-6 text-accent" />
          </div>
          <div className="text-left">
            <p className="font-semibold">Quick Post</p>
            <p className="text-sm text-text-secondary">Post update now</p>
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