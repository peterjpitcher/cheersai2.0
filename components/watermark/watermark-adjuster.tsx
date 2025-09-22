"use client";

import { useState, useEffect, useId } from "react";
import { Droplets, RotateCw } from "lucide-react";
import { generateWatermarkStyles, type WatermarkPlacement, type WatermarkSettings } from "@/lib/utils/watermark";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface WatermarkAdjusterProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  logoUrl: string;
  initialSettings: WatermarkSettings;
  onApply: (settings: WatermarkSettings) => void;
}

const POSITIONS: Array<{ value: WatermarkPlacement; label: string; icon: string }> = [
  { value: 'top-left', label: 'Top Left', icon: '↖' },
  { value: 'top-right', label: 'Top Right', icon: '↗' },
  { value: 'bottom-left', label: 'Bottom Left', icon: '↙' },
  { value: 'bottom-right', label: 'Bottom Right', icon: '↘' },
  { value: 'center', label: 'Centre', icon: '⊙' },
];

export default function WatermarkAdjuster({
  isOpen,
  onClose,
  imageUrl,
  logoUrl,
  initialSettings,
  onApply,
}: WatermarkAdjusterProps) {
  const [settings, setSettings] = useState<WatermarkSettings>(initialSettings);
  const baseId = useId();
  const sliderId = (suffix: string) => `${baseId}-${suffix}`;

  useEffect(() => {
    setSettings(initialSettings);
  }, [initialSettings]);

  const handleApply = () => {
    onApply(settings);
    onClose();
  };

  const handlePositionClick = (position: WatermarkPlacement) => {
    setSettings((prev) => ({ ...prev, position }));
  };

  const handleImageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    
    // Determine position based on click coordinates
    let position: WatermarkPlacement = 'center';
    if (x < 33 && y < 33) position = 'top-left';
    else if (x > 66 && y < 33) position = 'top-right';
    else if (x < 33 && y > 66) position = 'bottom-left';
    else if (x > 66 && y > 66) position = 'bottom-right';
    
    setSettings((prev) => ({ ...prev, position }));
  };

  const handleKeyboardPositionSelect = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSettings((prev) => ({ ...prev, position: 'center' }));
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-w-4xl flex-col overflow-hidden p-0">
        <DialogHeader className="flex items-center justify-between border-b border-border p-4">
          <DialogTitle className="flex items-center gap-2">
            <Droplets className="size-5 text-primary" />
            Adjust Watermark
          </DialogTitle>
        </DialogHeader>

        {/* Content */}
        <div className="overflow-y-auto p-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Preview */}
            <div>
              <p className="mb-2 text-sm font-medium">Preview</p>
              <div 
                role="button"
                tabIndex={0}
                className="relative cursor-crosshair overflow-hidden rounded-medium bg-gray-100"
                onClick={handleImageClick}
                onKeyDown={handleKeyboardPositionSelect}
                aria-label="Preview image area. Click or press space to adjust watermark position."
                style={{ maxWidth: '500px' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt="Preview"
                  className="h-auto w-full"
                />
                {logoUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={logoUrl}
                    alt="Watermark"
                    className="object-contain"
                    style={generateWatermarkStyles(settings, undefined, true)}
                  />
                )}
                
                {/* Grid overlay */}
                <div className="pointer-events-none absolute inset-0">
                  <div className="grid h-full grid-cols-3 grid-rows-3">
                    {[...Array(9)].map((_, i) => (
                      <div key={i} className="border border-white/20" />
                    ))}
                  </div>
                </div>
              </div>
              <p className="mt-2 text-xs text-text-secondary">
                Click on the image to position the watermark
              </p>
            </div>

            {/* Controls */}
            <div className="space-y-4">
              {/* Position Buttons */}
              <div>
                <p className="mb-2 block text-sm font-medium">Position</p>
                <div className="grid grid-cols-3 gap-2">
                  {POSITIONS.map((pos) => (
                    <button
                      key={pos.value}
                      onClick={() => handlePositionClick(pos.value)}
                      className={`rounded-medium border-2 p-3 text-sm transition-all ${
                        settings.position === pos.value
                          ? 'border-primary bg-primary/10 font-medium text-primary'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <span className="mr-1 text-lg">{pos.icon}</span>
                      {pos.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Size Slider */}
              <div>
                <label className="mb-2 block text-sm font-medium" htmlFor={sliderId('size')}>
                  Size: {settings.size_percent}%
                </label>
                <input
                  id={sliderId('size')}
                  type="range"
                  min="5"
                  max="50"
                  value={settings.size_percent}
                  onChange={(e) => setSettings({ 
                    ...settings, 
                    size_percent: parseInt(e.target.value) 
                  })}
                  className="w-full"
                />
              </div>

              {/* Opacity Slider */}
              <div>
                <label className="mb-2 block text-sm font-medium" htmlFor={sliderId('opacity')}>
                  Opacity: {Math.round(settings.opacity * 100)}%
                </label>
                <input
                  id={sliderId('opacity')}
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.1"
                  value={settings.opacity}
                  onChange={(e) => setSettings({ 
                    ...settings, 
                    opacity: parseFloat(e.target.value) 
                  })}
                  className="w-full"
                />
              </div>

              {/* Margin Slider */}
              <div>
                <label className="mb-2 block text-sm font-medium" htmlFor={sliderId('margin')}>
                  Margin: {settings.margin_pixels}px
                </label>
                <input
                  id={sliderId('margin')}
                  type="range"
                  min="5"
                  max="50"
                  value={settings.margin_pixels}
                  onChange={(e) => setSettings({ 
                    ...settings, 
                    margin_pixels: parseInt(e.target.value) 
                  })}
                  className="w-full"
                />
              </div>

              {/* Quick Actions */}
              <div className="border-t border-border pt-4">
                <p className="mb-2 text-sm font-medium">Quick Actions</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSettings(initialSettings)}
                    className="flex items-center rounded-md px-3 py-1 text-sm text-text-secondary hover:bg-muted"
                  >
                    <RotateCw className="mr-1 size-4" />
                    Reset
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border bg-gray-50 p-4">
          <button onClick={onClose} className="h-10 rounded-md px-4 text-sm text-text-secondary hover:bg-muted">
            Cancel
          </button>
          <button onClick={handleApply} className="h-10 rounded-md bg-primary px-4 text-sm text-white">
            Apply Watermark
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
