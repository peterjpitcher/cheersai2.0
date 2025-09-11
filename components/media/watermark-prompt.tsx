"use client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function WatermarkPrompt({ open, onClose, onConfirm, logoPresent }: { open: boolean; onClose: () => void; onConfirm: () => void; logoPresent: boolean }) {
  if (!open) return null
  if (!logoPresent) return null
  return (
    <Dialog open={open} onOpenChange={(o)=>{ if(!o) onClose() }}>
      <DialogContent aria-describedby={undefined} className="max-w-md p-0">
        <DialogHeader className="px-6 py-4">
          <DialogTitle>Add your logo watermark?</DialogTitle>
        </DialogHeader>
        <div className="px-6 pb-6">
          <p className="text-sm text-text-secondary mb-4">We can place your logo on the image using your saved defaults. You can adjust the position on the next step.</p>
          <div className="flex justify-end gap-2">
            <button className="text-sm text-text-secondary hover:bg-muted rounded-md px-3 py-2" onClick={onClose}>No thanks</button>
            <button className="text-sm bg-primary text-white rounded-md px-3 py-2" onClick={onConfirm}>Add Watermark</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
