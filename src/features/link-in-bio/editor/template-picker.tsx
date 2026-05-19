'use client';

/**
 * Template picker for link-in-bio editor (D-08).
 * Shows 4 template options in a 2x2 grid with CSS-only previews.
 */

import { cn } from '@/lib/utils';
import { TEMPLATES } from '@/lib/link-in-bio/templates';
import type { LinkInBioTemplate } from '@/lib/link-in-bio/types';

interface TemplatePickerProps {
  selected: LinkInBioTemplate;
  onSelect: (template: LinkInBioTemplate) => void;
}

const TEMPLATE_ORDER: LinkInBioTemplate[] = ['classic', 'grid', 'magazine', 'minimal'];

/** Simple CSS-only representation of each template layout */
function TemplatePreview({ templateId }: { templateId: LinkInBioTemplate }) {
  if (templateId === 'classic') {
    return (
      <div className="flex flex-col gap-1">
        <div className="h-4 w-full rounded-sm bg-current opacity-20" />
        <div className="mx-auto h-2 w-6 rounded-full bg-current opacity-30" />
        <div className="flex flex-col gap-0.5">
          <div className="h-2 w-full rounded-sm bg-current opacity-15" />
          <div className="h-2 w-full rounded-sm bg-current opacity-15" />
          <div className="h-2 w-full rounded-sm bg-current opacity-15" />
        </div>
      </div>
    );
  }

  if (templateId === 'grid') {
    return (
      <div className="flex flex-col gap-1">
        <div className="mx-auto h-4 w-4 rounded-sm bg-current opacity-20" />
        <div className="grid grid-cols-2 gap-0.5">
          <div className="h-3 rounded-sm bg-current opacity-15" />
          <div className="h-3 rounded-sm bg-current opacity-15" />
          <div className="h-3 rounded-sm bg-current opacity-15" />
          <div className="h-3 rounded-sm bg-current opacity-15" />
        </div>
      </div>
    );
  }

  if (templateId === 'magazine') {
    return (
      <div className="flex flex-col gap-1">
        <div className="h-4 w-full rounded-sm bg-current opacity-20" />
        <div className="grid grid-cols-2 gap-0.5">
          <div className="h-3 rounded-sm bg-current opacity-15" />
          <div className="h-3 rounded-sm bg-current opacity-15" />
        </div>
        <div className="grid grid-cols-2 gap-0.5">
          <div className="h-3 rounded-sm bg-current opacity-15" />
          <div className="h-3 rounded-sm bg-current opacity-15" />
        </div>
      </div>
    );
  }

  // minimal
  return (
    <div className="flex flex-col gap-1 pt-2">
      <div className="h-1.5 w-full rounded-sm bg-current opacity-15" />
      <div className="h-1.5 w-full rounded-sm bg-current opacity-15" />
      <div className="h-1.5 w-full rounded-sm bg-current opacity-15" />
      <div className="h-1.5 w-full rounded-sm bg-current opacity-15" />
    </div>
  );
}

export function TemplatePicker({ selected, onSelect }: TemplatePickerProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {TEMPLATE_ORDER.map((templateId) => {
        const config = TEMPLATES[templateId];
        const isSelected = selected === templateId;

        return (
          <button
            key={templateId}
            type="button"
            onClick={() => onSelect(templateId)}
            className={cn(
              'flex flex-col gap-2 rounded-lg border-2 p-3 text-left transition-all',
              isSelected
                ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                : 'border-border hover:border-primary/40',
            )}
          >
            <div className="w-full px-1">
              <TemplatePreview templateId={templateId} />
            </div>
            <div>
              <p className="text-sm font-medium">{config.name}</p>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {config.description}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
