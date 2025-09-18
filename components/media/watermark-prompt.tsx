"use client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function WatermarkPrompt({ open, onClose, onConfirm, logoPresent }: { open: boolean; onClose: () => void; onConfirm: () => void; logoPresent: boolean }) {
  if (!open) return null
  if (!logoPresent) return null
  return (
    <Dialog open={open} onOpenChange={(o)=>{ if(!o) onClose() }}>
      <DialogContent aria-describedby={undefined} className="flex max-w-md flex-col overflow-hidden p-0">
        <DialogHeader className="px-6 py-4">
          <DialogTitle>Add your logo watermark?</DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto px-6 pb-6">
          <p className="mb-4 text-sm text-text-secondary">We can place your logo on the image using your saved defaults. You can adjust the position on the next step.</p>
          <div className="flex justify-end gap-2">
            <button className="rounded-md px-3 py-2 text-sm text-text-secondary hover:bg-muted" onClick={onClose}>No thanks</button>
            <button className="rounded-md bg-primary px-3 py-2 text-sm text-white" onClick={onConfirm}>Add Watermark</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
