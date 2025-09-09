"use client";
import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface CropSquareModalProps {
  open: boolean
  onClose: () => void
  file: File
  onCropped: (blob: Blob) => void
  onKeepOriginal: () => void
}

export default function CropSquareModal({ open, onClose, file, onCropped, onKeepOriginal }: CropSquareModalProps) {
  const [previewUrl, setPreviewUrl] = useState<string>("")
  const [warning, setWarning] = useState<string>("")

  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    const img = new Image()
    img.onload = () => {
      if (img.width !== img.height) setWarning('This image is not square. It may be cropped on some platforms.')
    }
    img.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  const handleCrop = async () => {
    const img = await readImage(file)
    const size = Math.min(img.width, img.height)
    const sx = Math.floor((img.width - size) / 2)
    const sy = Math.floor((img.height - size) / 2)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, sx, sy, size, size, 0, 0, size, size)
    canvas.toBlob((blob) => {
      if (blob) onCropped(blob)
      onClose()
    }, 'image/jpeg', 0.92)
  }

  return (
    <Dialog open={open} onOpenChange={(o)=>{ if(!o) onClose() }}>
      <DialogContent className="max-w-md p-0">
        <DialogHeader className="px-6 py-4">
          <DialogTitle>Crop to Square?</DialogTitle>
        </DialogHeader>
        <div className="px-6 pb-6">
          {previewUrl && (
            <div className="mb-4">
              <img src={previewUrl} alt="Preview" className="max-w-full max-h-64 rounded-md border" />
            </div>
          )}
          {warning && (
            <div className="text-sm text-warning mb-3">{warning}</div>
          )}
          <div className="flex gap-2 justify-end">
            <button className="text-sm text-text-secondary hover:bg-muted rounded-md px-3 py-2" onClick={()=>{ onKeepOriginal(); onClose() }}>Keep Original</button>
            <button className="text-sm bg-primary text-white rounded-md px-3 py-2" onClick={handleCrop}>Crop to Square</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function readImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = reader.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

