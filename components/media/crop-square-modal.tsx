"use client";
import { useEffect, useMemo, useRef, useState } from 'react'
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
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null)
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [scale, setScale] = useState<number>(1)
  const [minScale, setMinScale] = useState<number>(1)
  const [maxScale, setMaxScale] = useState<number>(4)
  const draggingRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null)
  const pinchRef = useRef<{
    startDist: number;
    startScale: number;
    ox: number; oy: number;
    ix: number; iy: number; // image coords under focal
  } | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const containerSize = 400

  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    const img = new Image()
    img.onload = () => {
      const w = img.width, h = img.height
      setImgDims({ w, h })
      if (w !== h) setWarning('This image is not square. You can reposition before cropping.')
      // Fit smaller dimension to container
      const sc = containerSize / Math.min(w, h)
      setMinScale(sc)
      setScale(sc)
      setMaxScale(sc * 10)
      // Center image within viewport initially
      const sw = w * sc, sh = h * sc
      const ox = (containerSize - sw) / 2
      const oy = (containerSize - sh) / 2
      setOffset({ x: ox, y: oy })
    }
    img.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  const clampOffset = (ox: number, oy: number, sw: number, sh: number) => {
    // Ensure image always covers the container (no gaps)
    const minX = Math.min(0, containerSize - sw)
    const minY = Math.min(0, containerSize - sh)
    const maxX = 0
    const maxY = 0
    return { x: Math.max(minX, Math.min(maxX, ox)), y: Math.max(minY, Math.min(maxY, oy)) }
  }

  const onPointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if ('touches' in e && e.touches.length === 2 && imgDims && containerRef.current) {
      const [t1, t2] = [e.touches[0], e.touches[1]]
      const dx = t1.clientX - t2.clientX
      const dy = t1.clientY - t2.clientY
      const dist = Math.hypot(dx, dy)
      const rect = containerRef.current.getBoundingClientRect()
      const midX = (t1.clientX + t2.clientX) / 2 - rect.left
      const midY = (t1.clientY + t2.clientY) / 2 - rect.top
      const ix = (midX - offset.x) / scale
      const iy = (midY - offset.y) / scale
      pinchRef.current = { startDist: dist, startScale: scale, ox: offset.x, oy: offset.y, ix, iy }
      draggingRef.current = null
      return
    }
    const pt = 'touches' in e ? e.touches[0] : (e as React.MouseEvent)
    draggingRef.current = { startX: pt.clientX, startY: pt.clientY, ox: offset.x, oy: offset.y }
  }
  const onPointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (pinchRef.current && 'touches' in e && e.touches.length === 2 && imgDims && containerRef.current) {
      const [t1, t2] = [e.touches[0], e.touches[1]]
      const dx = t1.clientX - t2.clientX
      const dy = t1.clientY - t2.clientY
      const dist = Math.hypot(dx, dy)
      let newScale = pinchRef.current.startScale * (dist / pinchRef.current.startDist)
      newScale = Math.max(minScale, Math.min(maxScale, newScale))
      const mid = containerRef.current.getBoundingClientRect()
      // Keep focal point stable in viewport
      const o1x = ( (t1.clientX + t2.clientX)/2 - mid.left ) - pinchRef.current.ix * newScale
      const o1y = ( (t1.clientY + t2.clientY)/2 - mid.top ) - pinchRef.current.iy * newScale
      const sw = imgDims.w * newScale, sh = imgDims.h * newScale
      const next = clampOffset(o1x, o1y, sw, sh)
      setScale(newScale)
      setOffset(next)
      return
    }
    if (!draggingRef.current || !imgDims) return
    const pt = 'touches' in e ? e.touches[0] : (e as React.MouseEvent)
    const dx = pt.clientX - draggingRef.current.startX
    const dy = pt.clientY - draggingRef.current.startY
    const sw = imgDims.w * scale, sh = imgDims.h * scale
    const next = clampOffset(draggingRef.current.ox + dx, draggingRef.current.oy + dy, sw, sh)
    setOffset(next)
  }
  const onPointerUp = () => { draggingRef.current = null; pinchRef.current = null }

  const handleCrop = async () => {
    const img = await readImage(file)
    const sc = scale
    const sx = Math.max(0, Math.min(img.width, Math.round(-offset.x / sc)))
    const sy = Math.max(0, Math.min(img.height, Math.round(-offset.y / sc)))
    const cropSize = Math.min(img.width - sx, img.height - sy, Math.round(containerSize / sc))
    const canvas = document.createElement('canvas')
    const out = Math.min(2048, cropSize) // cap output dimension for performance
    canvas.width = out
    canvas.height = out
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, sx, sy, cropSize, cropSize, 0, 0, out, out)
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
              <div
                className="relative rounded-md border overflow-hidden select-none touch-none bg-black/5"
                style={{ width: containerSize, height: containerSize, margin: '0 auto' }}
                ref={containerRef}
                onMouseDown={onPointerDown as any}
                onMouseMove={onPointerMove as any}
                onMouseUp={onPointerUp}
                onMouseLeave={onPointerUp}
                onTouchStart={onPointerDown as any}
                onTouchMove={onPointerMove as any}
                onTouchEnd={onPointerUp}
              >
                {/* draggable image */}
                <img
                  src={previewUrl}
                  alt="Preview"
                  draggable={false}
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                    transformOrigin: 'top left',
                    // Important: prevent Tailwind preflight from clamping
                    // images to the container width. We render at the image's
                    // natural pixel size and use CSS transforms for zooming.
                    maxWidth: 'none',
                    maxHeight: 'none',
                    width: imgDims ? `${imgDims.w}px` : 'auto',
                    height: imgDims ? `${imgDims.h}px` : 'auto',
                    userSelect: 'none',
                    cursor: 'grab',
                    willChange: 'transform',
                  }}
                />
                {/* grid overlay */}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
                    {Array.from({ length: 9 }).map((_, i) => (
                      <div key={i} className="border border-white/30" />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* Zoom control (desktop and as fallback) */}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-text-secondary">Zoom</span>
            <input
              type="range"
              min={minScale}
              max={maxScale}
              step={0.01}
              value={scale}
              onChange={(e) => {
                if (!imgDims || !containerRef.current) { setScale(parseFloat(e.target.value)); return }
                const newScale = Math.max(minScale, Math.min(maxScale, parseFloat(e.target.value)))
                // Keep center stable when zooming via slider
                const rect = containerRef.current.getBoundingClientRect()
                const vx = containerSize / 2
                const vy = containerSize / 2
                const ix = (vx - offset.x) / scale
                const iy = (vy - offset.y) / scale
                const o1x = vx - ix * newScale
                const o1y = vy - iy * newScale
                const sw = imgDims.w * newScale, sh = imgDims.h * newScale
                const next = clampOffset(o1x, o1y, sw, sh)
                setScale(newScale)
                setOffset(next)
              }}
              className="w-full"
            />
          </div>
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
