'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import type { AiCampaignPayload, CtaType } from '@/types/campaigns';
import type { MediaAssetSummary } from '@/lib/library/data';
import { AdPreview } from './AdPreview';

interface CampaignTreeProps {
  payload: AiCampaignPayload;
  onChange: (updated: AiCampaignPayload) => void;
  mediaLibrary: MediaAssetSummary[];
}

type SelectedNode =
  | { type: 'campaign' }
  | { type: 'adset'; adsetIndex: number }
  | { type: 'ad'; adsetIndex: number; adIndex: number };

function formatPhaseRange(start: string, end: string | null): string {
  const startDate = new Date(start);
  const startDay = startDate.getDate();
  const startMonth = startDate.toLocaleString('en-GB', { month: 'short' });
  if (!end) return `${startDay} ${startMonth}+`;
  const endDate = new Date(end);
  const endDay = endDate.getDate();
  const endMonth = endDate.toLocaleString('en-GB', { month: 'short' });
  if (startMonth === endMonth) return `${startDay}–${endDay} ${startMonth}`;
  return `${startDay} ${startMonth}–${endDay} ${endMonth}`;
}

export function CampaignTree({ payload, onChange, mediaLibrary }: CampaignTreeProps) {
  const [selected, setSelected] = useState<SelectedNode>({ type: 'campaign' });
  const [expandedAdsets, setExpandedAdsets] = useState<Set<number>>(
    new Set(payload.ad_sets.map((_, i) => i)),
  );
  const [pickerOpen, setPickerOpen] = useState(false);

  function toggleAdset(index: number) {
    setExpandedAdsets((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  // ----- Centre panel content -----
  function renderCentrePanel() {
    if (selected.type === 'campaign') {
      return (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1" htmlFor="campaign-name">
              Campaign name
            </label>
            <input
              id="campaign-name"
              type="text"
              value={payload.campaign_name}
              onChange={(e) => onChange({ ...payload, campaign_name: e.target.value })}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all"
            />
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">Objective</p>
            <p className="text-sm text-foreground">{payload.objective}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">Special ad category</p>
            <p className="text-sm text-foreground">{payload.special_ad_category}</p>
          </div>
        </div>
      );
    }

    if (selected.type === 'adset') {
      const adset = payload.ad_sets[selected.adsetIndex];
      if (!adset) return null;
      return (
        <div className="space-y-4">
          <div>
            <label
              className="block text-xs font-semibold text-muted-foreground mb-1"
              htmlFor="adset-name"
            >
              Ad set name
            </label>
            <input
              id="adset-name"
              type="text"
              value={adset.name}
              onChange={(e) => {
                const adSets = payload.ad_sets.map((as, i) =>
                  i === selected.adsetIndex ? { ...as, name: e.target.value } : as,
                );
                onChange({ ...payload, ad_sets: adSets });
              }}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all"
            />
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">Audience description</p>
            <p className="text-sm text-foreground">{adset.audience_description}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">Optimisation goal</p>
            <p className="text-sm text-foreground">{adset.optimisation_goal}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">Bid strategy</p>
            <p className="text-sm text-foreground">{adset.bid_strategy}</p>
          </div>
          {adset.phase_start && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Phase window</p>
              <p className="text-sm text-foreground">
                {adset.phase_start}
                {adset.phase_end ? ` → ${adset.phase_end}` : ' (open-ended)'}
              </p>
            </div>
          )}
          {adset.phase_label && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Phase theme</p>
              <p className="text-sm text-foreground">{adset.phase_label}</p>
            </div>
          )}
        </div>
      );
    }

    if (selected.type === 'ad') {
      const adset = payload.ad_sets[selected.adsetIndex];
      const ad = adset?.ads[selected.adIndex];
      if (!adset || !ad) return null;

      function updateAd(updates: Partial<typeof ad>) {
        const adSets = payload.ad_sets.map((as, ai) => {
          if (ai !== (selected as { adsetIndex: number }).adsetIndex) return as;
          const ads = as.ads.map((a, di) =>
            di === (selected as { adIndex: number }).adIndex ? { ...a, ...updates } : a,
          );
          return { ...as, ads };
        });
        onChange({ ...payload, ad_sets: adSets });
      }

      return (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1" htmlFor="ad-headline">
              Headline{' '}
              <span className={`font-normal ${ad.headline.length > 40 ? 'text-destructive' : 'text-muted-foreground'}`}>
                ({ad.headline.length}/40)
              </span>
            </label>
            <input
              id="ad-headline"
              type="text"
              maxLength={40}
              value={ad.headline}
              onChange={(e) => updateAd({ headline: e.target.value })}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1" htmlFor="ad-primary-text">
              Primary text{' '}
              <span className={`font-normal ${ad.primary_text.length > 125 ? 'text-destructive' : 'text-muted-foreground'}`}>
                ({ad.primary_text.length}/125)
              </span>
            </label>
            <textarea
              id="ad-primary-text"
              maxLength={125}
              value={ad.primary_text}
              onChange={(e) => updateAd({ primary_text: e.target.value })}
              rows={4}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1" htmlFor="ad-description">
              Description{' '}
              <span className={`font-normal ${ad.description.length > 25 ? 'text-destructive' : 'text-muted-foreground'}`}>
                ({ad.description.length}/25)
              </span>
            </label>
            <input
              id="ad-description"
              type="text"
              maxLength={25}
              value={ad.description}
              onChange={(e) => updateAd({ description: e.target.value })}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all"
            />
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">Creative brief</p>
            <p className="text-sm text-foreground bg-muted/40 rounded-md px-3 py-2">{ad.creative_brief}</p>
          </div>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
          >
            {ad.image_url ? 'Change creative' : 'Pick creative from library'}
          </button>

          {pickerOpen && (
            <div className="rounded-md border border-border bg-background p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Select an image from your library:</p>
              {mediaLibrary.length === 0 ? (
                <p className="text-xs text-muted-foreground">No images in your library yet.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                  {mediaLibrary
                    .filter((asset) => asset.mediaType === 'image')
                    .map((asset) => (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => {
                          updateAd({ image_url: asset.previewUrl, media_asset_id: asset.id });
                          setPickerOpen(false);
                        }}
                        className={`relative aspect-square rounded overflow-hidden border-2 transition-colors ${
                          ad.media_asset_id === asset.id
                            ? 'border-primary'
                            : 'border-transparent hover:border-border'
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={asset.previewUrl ?? ''}
                          alt={asset.fileName}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    return null;
  }

  // ----- Right panel (preview) -----
  function renderPreviewPanel() {
    if (selected.type !== 'ad') {
      return (
        <div className="flex h-full items-center justify-center p-6">
          <p className="text-sm text-muted-foreground text-center">Select an ad to preview</p>
        </div>
      );
    }

    const adset = payload.ad_sets[selected.adsetIndex];
    const ad = adset?.ads[selected.adIndex];
    if (!ad) return null;

    return (
      <div className="flex flex-col items-center gap-4 p-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Preview</p>
        <AdPreview
          headline={ad.headline}
          primaryText={ad.primary_text}
          cta={ad.cta as CtaType}
          imageUrl={ad.image_url}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 gap-0 rounded-xl border border-border overflow-hidden">
      {/* Left tree (200px) */}
      <div className="w-[200px] flex-shrink-0 border-r border-border bg-muted/30 overflow-y-auto">
        <div className="p-2 space-y-0.5">
          {/* Campaign node */}
          <button
            type="button"
            onClick={() => setSelected({ type: 'campaign' })}
            className={`w-full rounded-md px-2 py-1.5 text-left text-xs font-semibold transition-colors ${
              selected.type === 'campaign'
                ? 'bg-primary text-primary-foreground'
                : 'text-foreground hover:bg-accent'
            }`}
          >
            <span className="truncate block">{payload.campaign_name}</span>
          </button>

          {/* Ad set nodes */}
          {payload.ad_sets.map((adset, ai) => (
            <div key={ai}>
              <button
                type="button"
                onClick={() => {
                  setSelected({ type: 'adset', adsetIndex: ai });
                  toggleAdset(ai);
                }}
                className={`w-full rounded-md px-2 py-1.5 text-left text-xs flex items-center gap-1 transition-colors ${
                  selected.type === 'adset' && selected.adsetIndex === ai
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-accent'
                }`}
              >
                {expandedAdsets.has(ai) ? (
                  <ChevronDown className="h-3 w-3 flex-shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 flex-shrink-0" />
                )}
                <span className="truncate leading-tight">
                  <span className="block">{adset.phase_label ?? adset.name}</span>
                  {adset.phase_start && (
                    <span className="block font-normal opacity-80 text-[11px]">
                      {formatPhaseRange(adset.phase_start, adset.phase_end)}
                    </span>
                  )}
                </span>
              </button>

              {/* Ad nodes */}
              {expandedAdsets.has(ai) &&
                adset.ads.map((ad, di) => (
                  <button
                    key={di}
                    type="button"
                    onClick={() => setSelected({ type: 'ad', adsetIndex: ai, adIndex: di })}
                    className={`w-full rounded-md pl-6 pr-2 py-1.5 text-left text-xs transition-colors ${
                      selected.type === 'ad' &&
                      selected.adsetIndex === ai &&
                      selected.adIndex === di
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    }`}
                  >
                    <span className="truncate block">Variation {di + 1}</span>
                  </button>
                ))}
            </div>
          ))}
        </div>
      </div>

      {/* Centre editor */}
      <div className="flex-1 min-w-0 overflow-y-auto p-4">{renderCentrePanel()}</div>

      {/* Right preview */}
      <div className="w-[280px] flex-shrink-0 border-l border-border bg-muted/10 overflow-y-auto">
        {renderPreviewPanel()}
      </div>
    </div>
  );
}
