/**
 * Watermark utility functions for consistent size calculations and positioning
 */

export interface WatermarkSettings {
  position: string;
  opacity: number;
  size_percent: number;
  margin_pixels: number;
  enabled?: boolean;
  auto_apply?: boolean;
  active_logo_id?: string;
}

export interface WatermarkPosition {
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
  transform?: string;
}

// Standard preview container size for consistent calculations
export const PREVIEW_CONTAINER_SIZE = 400;

/**
 * Calculate watermark size in pixels based on percentage of container size
 * @param sizePercent - Size percentage (5-50)
 * @param containerSize - Container size in pixels (defaults to standard preview size)
 * @returns Size in pixels
 */
export function calculateWatermarkSize(sizePercent: number, containerSize: number = PREVIEW_CONTAINER_SIZE): number {
  return (containerSize * sizePercent) / 100;
}

/**
 * Get CSS positioning properties for watermark based on position setting
 * @param position - Position string (e.g., 'bottom-right', 'top-left', 'center')
 * @param marginPixels - Margin from edges in pixels (not used in percentage mode)
 * @param usePercentage - Use percentage-based positioning for responsive layout
 * @returns CSS positioning object
 */
export function getWatermarkPosition(position: string, marginPixels: number, usePercentage: boolean = false): WatermarkPosition {
  const positioning: WatermarkPosition = {};
  const margin = usePercentage ? '5%' : `${marginPixels}px`;

  switch (position) {
    case 'top-left':
      positioning.top = margin;
      positioning.left = margin;
      break;
    case 'top-right':
      positioning.top = margin;
      positioning.right = margin;
      break;
    case 'bottom-left':
      positioning.bottom = margin;
      positioning.left = margin;
      break;
    case 'bottom-right':
      positioning.bottom = margin;
      positioning.right = margin;
      break;
    case 'center':
      positioning.top = '50%';
      positioning.left = '50%';
      positioning.transform = 'translate(-50%, -50%)';
      break;
    default:
      // Default to bottom-right
      positioning.bottom = margin;
      positioning.right = margin;
      break;
  }

  return positioning;
}

/**
 * Get default watermark settings
 * @returns Default watermark settings object
 */
export function getDefaultWatermarkSettings(): WatermarkSettings {
  return {
    enabled: false,
    position: 'bottom-right',
    opacity: 0.8,
    size_percent: 15,
    margin_pixels: 20,
    auto_apply: false,
  };
}

/**
 * Validate watermark settings
 * @param settings - Settings to validate
 * @returns Validated settings with defaults for missing values
 */
export function validateWatermarkSettings(settings: Partial<WatermarkSettings>): WatermarkSettings {
  const defaults = getDefaultWatermarkSettings();
  
  return {
    enabled: settings.enabled ?? defaults.enabled,
    position: settings.position ?? defaults.position,
    opacity: Math.max(0.1, Math.min(1, settings.opacity ?? defaults.opacity)),
    size_percent: Math.max(5, Math.min(50, settings.size_percent ?? defaults.size_percent)),
    margin_pixels: Math.max(5, Math.min(50, settings.margin_pixels ?? defaults.margin_pixels)),
    auto_apply: settings.auto_apply ?? defaults.auto_apply,
    active_logo_id: settings.active_logo_id,
  };
}

/**
 * Generate inline styles for watermark positioning and sizing
 * @param settings - Watermark settings
 * @param containerSize - Container size for size calculations (optional)
 * @param usePercentage - Use percentage-based sizing for responsive layout
 * @returns CSS style object
 */
export function generateWatermarkStyles(
  settings: WatermarkSettings, 
  containerSize: number = PREVIEW_CONTAINER_SIZE,
  usePercentage: boolean = true
): React.CSSProperties {
  const positioning = getWatermarkPosition(settings.position, settings.margin_pixels, usePercentage);
  
  // Use percentage-based sizing for responsive behavior
  const sizeValue = usePercentage 
    ? `${settings.size_percent}%` 
    : `${calculateWatermarkSize(settings.size_percent, containerSize)}px`;

  return {
    position: 'absolute',
    width: sizeValue,
    height: 'auto',
    maxWidth: sizeValue,
    opacity: settings.opacity,
    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))',
    objectFit: 'contain',
    pointerEvents: 'none' as const,
    ...positioning,
  } as React.CSSProperties;
}