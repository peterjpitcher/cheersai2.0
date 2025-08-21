"use client";

import { useState, useEffect } from "react";
import { X, Move, Droplets, RotateCw } from "lucide-react";

interface WatermarkAdjusterProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  logoUrl: string;
  initialSettings: {
    position: string;
    opacity: number;
    size_percent: number;
    margin_pixels: number;
  };
  onApply: (settings: any) => void;
}

const POSITIONS = [
  { value: 'top-left', label: 'Top Left', icon: '↖' },
  { value: 'top-right', label: 'Top Right', icon: '↗' },
  { value: 'bottom-left', label: 'Bottom Left', icon: '↙' },
  { value: 'bottom-right', label: 'Bottom Right', icon: '↘' },
  { value: 'center', label: 'Center', icon: '⊙' },
];

export default function WatermarkAdjuster({
  isOpen,
  onClose,
  imageUrl,
  logoUrl,
  initialSettings,
  onApply,
}: WatermarkAdjusterProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [isDragging, setIsDragging] = useState(false);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    setSettings(initialSettings);
  }, [initialSettings]);

  const handleApply = () => {
    onApply(settings);
    onClose();
  };

  const handlePositionClick = (position: string) => {
    setSettings({ ...settings, position });
  };

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    // Determine position based on click coordinates
    let position = 'center';
    if (x < 33 && y < 33) position = 'top-left';
    else if (x > 66 && y < 33) position = 'top-right';
    else if (x < 33 && y > 66) position = 'bottom-left';
    else if (x > 66 && y > 66) position = 'bottom-right';
    
    setSettings({ ...settings, position });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-large shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Droplets className="w-5 h-5 text-primary" />
            <h3 className="font-semibold">Adjust Watermark</h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-soft transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Preview */}
            <div>
              <p className="text-sm font-medium mb-2">Preview</p>
              <div 
                className="relative bg-gray-100 rounded-medium overflow-hidden cursor-crosshair"
                onClick={handleImageClick}
              >
                <img
                  src={imageUrl}
                  alt="Preview"
                  className="w-full h-auto"
                />
                {logoUrl && (
                  <div
                    className="absolute transition-all duration-200"
                    style={{
                      top: settings.position.includes('top') 
                        ? `${settings.margin_pixels}px` 
                        : settings.position === 'center' 
                          ? '50%' 
                          : 'auto',
                      bottom: settings.position.includes('bottom') 
                        ? `${settings.margin_pixels}px` 
                        : 'auto',
                      left: settings.position.includes('left') 
                        ? `${settings.margin_pixels}px` 
                        : settings.position === 'center' 
                          ? '50%' 
                          : 'auto',
                      right: settings.position.includes('right') 
                        ? `${settings.margin_pixels}px` 
                        : 'auto',
                      transform: settings.position === 'center' 
                        ? 'translate(-50%, -50%)' 
                        : 'none',
                    }}
                  >
                    <img
                      src={logoUrl}
                      alt="Watermark"
                      className="object-contain"
                      style={{
                        width: `${(300 * settings.size_percent) / 100}px`,
                        height: 'auto',
                        opacity: settings.opacity,
                        filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))',
                      }}
                    />
                  </div>
                )}
                
                {/* Grid overlay */}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="grid grid-cols-3 grid-rows-3 h-full">
                    {[...Array(9)].map((_, i) => (
                      <div key={i} className="border border-white/20" />
                    ))}
                  </div>
                </div>
              </div>
              <p className="text-xs text-text-secondary mt-2">
                Click on the image to position the watermark
              </p>
            </div>

            {/* Controls */}
            <div className="space-y-4">
              {/* Position Buttons */}
              <div>
                <label className="text-sm font-medium mb-2 block">Position</label>
                <div className="grid grid-cols-3 gap-2">
                  {POSITIONS.map((pos) => (
                    <button
                      key={pos.value}
                      onClick={() => handlePositionClick(pos.value)}
                      className={`p-3 rounded-medium border-2 transition-all text-sm ${
                        settings.position === pos.value
                          ? 'border-primary bg-primary/10 text-primary font-medium'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <span className="text-lg mr-1">{pos.icon}</span>
                      {pos.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Size Slider */}
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Size: {settings.size_percent}%
                </label>
                <input
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
                <label className="text-sm font-medium mb-2 block">
                  Opacity: {Math.round(settings.opacity * 100)}%
                </label>
                <input
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
                <label className="text-sm font-medium mb-2 block">
                  Margin: {settings.margin_pixels}px
                </label>
                <input
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
              <div className="pt-4 border-t border-border">
                <p className="text-sm font-medium mb-2">Quick Actions</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSettings(initialSettings)}
                    className="btn-ghost text-sm flex items-center"
                  >
                    <RotateCw className="w-4 h-4 mr-1" />
                    Reset
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 border-t border-border bg-gray-50">
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button onClick={handleApply} className="btn-primary">
            Apply Watermark
          </button>
        </div>
      </div>
    </div>
  );
}