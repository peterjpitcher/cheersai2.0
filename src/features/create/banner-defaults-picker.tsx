import {
  sanitiseCustomMessage,
  type BannerDefaults,
} from "@/lib/scheduling/banner-config";
import {
  FIXED_BANNER_BG,
  FIXED_BANNER_TEXT,
} from "@/lib/banner/config";

interface BannerDefaultsPickerProps {
  value: BannerDefaults;
  onChange: (value: BannerDefaults) => void;
  autoLabelPreview?: string;
}

export function BannerDefaultsPicker({
  value,
  onChange: _onChange,
  autoLabelPreview = "TODAY",
}: BannerDefaultsPickerProps): React.ReactElement {
  const textDraft = value.customMessage ?? "";
  const previewText = sanitiseCustomMessage(textDraft) ?? autoLabelPreview;
  void _onChange;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Every post uses the right-side gold banner. After generation, customise the overlay text on each post or leave its automatic label.
      </p>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Preview</span>
        <div
          className="flex h-6 max-w-full items-center rounded px-3 text-[10px] font-bold uppercase tracking-wider"
          style={{
            backgroundColor: FIXED_BANNER_BG,
            color: FIXED_BANNER_TEXT,
          }}
        >
          <span className="max-w-[14rem] truncate">{previewText}</span>
        </div>
      </div>
    </div>
  );
}
