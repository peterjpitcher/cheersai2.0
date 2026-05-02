'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/providers/toast-provider';
import type { AiCampaignPayload, BudgetType, GeoRadiusMiles, PaidCampaignKind } from '@/types/campaigns';
import type { MediaAssetSummary } from '@/lib/library/data';
import { generateCampaignAction, saveAndPublishCampaign } from '@/app/(app)/campaigns/actions';
import {
  listManagementEventOptions,
  getManagementEventPrefill,
  type ManagementActionError,
} from '@/app/(app)/create/actions';
import { calculateInclusiveDurationDays } from '@/lib/campaigns/phases';
import { buildBriefFromEvent, deriveStartDate } from './event-import-utils';
import { CampaignTree } from './CampaignTree';

type FormState = 'brief' | 'generating' | 'review';

const GENERATING_MESSAGES = [
  'Checking paid CTA link...',
  'Building Meta campaign structure...',
  'Writing ad copy variations...',
];

const GEO_RADIUS_OPTIONS: GeoRadiusMiles[] = [1, 3, 5, 10];

interface ImportEventOption {
  id: string;
  name: string;
  slug?: string;
  date?: string;
  time?: string;
  status?: string;
}

interface CampaignBriefFormProps {
  mediaLibrary: MediaAssetSummary[];
}

export function CampaignBriefForm({ mediaLibrary }: CampaignBriefFormProps) {
  const router = useRouter();
  const toast = useToast();

  const [formState, setFormState] = useState<FormState>('brief');
  const [campaignKind, setCampaignKind] = useState<PaidCampaignKind>('event');
  const [promotionName, setPromotionName] = useState('');
  const [problemBrief, setProblemBrief] = useState('');
  const [destinationUrl, setDestinationUrl] = useState('');
  const [budgetAmount, setBudgetAmount] = useState<number>(20);
  const [budgetType, setBudgetType] = useState<BudgetType>('LIFETIME');
  const [geoRadiusMiles, setGeoRadiusMiles] = useState<GeoRadiusMiles>(3);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [adsStopTime, setAdsStopTime] = useState('');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [sourceSnapshot, setSourceSnapshot] = useState<Record<string, unknown> | null>(null);
  const [resolvedDestinationUrl, setResolvedDestinationUrl] = useState('');
  const [resolvedSourceSnapshot, setResolvedSourceSnapshot] = useState<Record<string, unknown> | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [generatingMessage, setGeneratingMessage] = useState(GENERATING_MESSAGES[0]);
  const messageIndexRef = useRef(0);

  const [aiPayload, setAiPayload] = useState<AiCampaignPayload | null>(null);

  const [importSearchQuery, setImportSearchQuery] = useState('');
  const [importOptions, setImportOptions] = useState<ImportEventOption[]>([]);
  const [importOptionsLoaded, setImportOptionsLoaded] = useState(false);
  const [importOptionsPending, setImportOptionsPending] = useState(false);
  const [selectedImportEventId, setSelectedImportEventId] = useState('');
  const [importApplyPending, setImportApplyPending] = useState(false);
  const [importError, setImportError] = useState<ManagementActionError | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  const durationDays = useMemo(() => {
    if (!startDate || !endDate) return null;
    try {
      return calculateInclusiveDurationDays(startDate, endDate);
    } catch {
      return null;
    }
  }, [startDate, endDate]);

  const missingCreativeCount = useMemo(() => {
    if (!aiPayload) return 0;
    return aiPayload.ad_sets.reduce((count, adSet) => {
      return count + adSet.ads.filter((ad) => !ad.media_asset_id && !adSet.adset_media_asset_id).length;
    }, 0);
  }, [aiPayload]);

  useEffect(() => {
    if (formState !== 'generating') return;
    const interval = setInterval(() => {
      messageIndexRef.current = (messageIndexRef.current + 1) % GENERATING_MESSAGES.length;
      setGeneratingMessage(GENERATING_MESSAGES[messageIndexRef.current]);
    }, 2000);
    return () => clearInterval(interval);
  }, [formState]);

  function resetGeneratedState() {
    setAiPayload(null);
    setResolvedDestinationUrl('');
    setResolvedSourceSnapshot(null);
  }

  async function handleGenerate() {
    const validationError = validateBriefForm();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    resetGeneratedState();
    setFormState('generating');
    messageIndexRef.current = 0;
    setGeneratingMessage(GENERATING_MESSAGES[0]);

    const result = await generateCampaignAction({
      campaignKind,
      promotionName: promotionName.trim(),
      problemBrief: problemBrief.trim(),
      destinationUrl: destinationUrl.trim(),
      geoRadiusMiles,
      budgetAmount,
      budgetType,
      startDate,
      endDate,
      adsStopTime: campaignKind === 'event' ? adsStopTime : undefined,
      sourceType: campaignKind === 'event' ? 'management_event' : 'custom_promotion',
      sourceId,
      sourceSnapshot,
    });

    if ('error' in result) {
      toast.error(result.error);
      setFormState('brief');
      return;
    }

    setAiPayload(result.payload);
    setResolvedDestinationUrl(result.destinationUrl);
    setResolvedSourceSnapshot(result.sourceSnapshot);
    setFormState('review');
  }

  async function handleSaveAndPublish() {
    if (!aiPayload) return;
    if (missingCreativeCount > 0) {
      toast.error('Assign images to every ad before publishing.');
      return;
    }

    setIsSubmitting(true);
    const result = await saveAndPublishCampaign(aiPayload, {
      campaignKind,
      promotionName: promotionName.trim(),
      budgetAmount,
      budgetType,
      geoRadiusMiles,
      startDate,
      endDate,
      adsStopTime: campaignKind === 'event' ? adsStopTime : undefined,
      problemBrief: problemBrief.trim(),
      destinationUrl: resolvedDestinationUrl || destinationUrl.trim(),
      sourceType: campaignKind === 'event' ? 'management_event' : 'custom_promotion',
      sourceId,
      sourceSnapshot: resolvedSourceSnapshot ?? sourceSnapshot ?? {},
    });

    if ('error' in result) {
      toast.error(result.error);
      setIsSubmitting(false);
      return;
    }

    router.push(`/campaigns/${result.campaignId}`);
  }

  const loadImportOptions = () => {
    setImportError(null);
    setImportNotice(null);
    setImportOptionsPending(true);

    void (async () => {
      try {
        const response = await listManagementEventOptions({
          query: importSearchQuery.trim() || undefined,
          limit: 50,
        });
        setImportOptionsLoaded(true);
        if (!response.ok) {
          setImportOptions([]);
          setSelectedImportEventId('');
          setImportError(response.error);
          return;
        }
        setImportOptions(response.data);
        setSelectedImportEventId((current) => {
          if (current && response.data.some((o) => o.id === current)) return current;
          return response.data[0]?.id ?? '';
        });
      } catch {
        setImportError({ code: 'FAILED', message: 'Failed to load events.' });
        setImportOptions([]);
        setSelectedImportEventId('');
      } finally {
        setImportOptionsPending(false);
      }
    })();
  };

  const applyImport = () => {
    if (!selectedImportEventId) return;
    setImportError(null);
    setImportNotice(null);
    setImportApplyPending(true);

    void (async () => {
      try {
        const selectedOption = importOptions.find((o) => o.id === selectedImportEventId);
        const response = await getManagementEventPrefill({
          eventId: selectedImportEventId,
          eventSlug: selectedOption?.slug,
        });

        if (!response.ok) {
          setImportError(response.error);
          return;
        }

        const fields = response.data.fields;
        const eventName = fields.name ?? selectedOption?.name ?? '';
        const eventDateStr = fields.startDate ?? selectedOption?.date ?? '';
        const eventDescription = fields.description ?? '';
        const metaAdsShortLink = fields.metaAdsShortLink ?? '';

        if (!metaAdsShortLink) {
          setImportError({
            code: 'FAILED',
            message: 'This event does not have a Meta Ads short link yet. Refresh marketing links in the management app, then import again.',
          });
          return;
        }

        setCampaignKind('event');
        setPromotionName(eventName);
        setProblemBrief(buildBriefFromEvent(eventName, eventDateStr || undefined, eventDescription || undefined));
        setDestinationUrl(metaAdsShortLink);
        setSourceId(selectedImportEventId);
        setSourceSnapshot({
          eventId: selectedImportEventId,
          eventSlug: selectedOption?.slug ?? null,
          eventName,
          eventDate: eventDateStr || null,
          eventTime: fields.startTime ?? selectedOption?.time ?? null,
          metaAdsShortLink,
        });

        if (eventDateStr) {
          setStartDate(deriveStartDate(eventDateStr));
          setEndDate(eventDateStr);
        }
        if (fields.startTime) {
          setAdsStopTime(fields.startTime);
        }
        setImportNotice(`Imported details from ${response.data.sourceLabel}.`);
      } catch {
        setImportError({ code: 'FAILED', message: 'Import failed unexpectedly.' });
      } finally {
        setImportApplyPending(false);
      }
    })();
  };

  function validateBriefForm(): string | null {
    if (!promotionName.trim()) return 'Enter a campaign name.';
    if (!problemBrief.trim()) return 'Enter a campaign brief.';
    if (!destinationUrl.trim()) return 'Enter a paid CTA URL.';
    if (!startDate || !endDate) return 'Set campaign start and end dates.';
    if (budgetAmount <= 0) return 'Budget must be greater than 0.';

    try {
      new URL(destinationUrl.trim());
    } catch {
      return 'Enter a valid paid CTA URL.';
    }

    if (campaignKind === 'event' && !adsStopTime) {
      return 'Set the event ad stop time.';
    }

    if (campaignKind === 'evergreen') {
      try {
        const days = calculateInclusiveDurationDays(startDate, endDate);
        if (days > 30) return 'Evergreen campaigns can run for a maximum of 30 days.';
      } catch {
        return 'Campaign end date must be on or after the start date.';
      }
    }

    return null;
  }

  if (formState === 'brief') {
    return (
      <div className="max-w-3xl space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground">Campaign type</p>
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/20 p-1">
            {(['event', 'evergreen'] as PaidCampaignKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  setCampaignKind(kind);
                  resetGeneratedState();
                  if (kind === 'evergreen') {
                    setSourceId(null);
                    setSourceSnapshot(null);
                    setAdsStopTime('');
                  }
                }}
                className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                  campaignKind === kind
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-background hover:text-foreground'
                }`}
              >
                {kind === 'event' ? 'Event' : 'Evergreen'}
              </button>
            ))}
          </div>
        </div>

        {campaignKind === 'event' && (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900">Import event</p>
                <p className="text-xs text-slate-500">
                  Pull timing, brief details, and the paid Meta short link from the management app.
                </p>
              </div>
              <button
                type="button"
                onClick={loadImportOptions}
                disabled={importOptionsPending || importApplyPending}
                className="rounded-full border border-input bg-background px-4 py-1.5 text-xs font-semibold transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importOptionsPending ? 'Loading...' : importSearchQuery.trim() ? 'Search events' : 'Load events'}
              </button>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-700" htmlFor="import-search">
                Search events
              </label>
              <input
                id="import-search"
                type="text"
                value={importSearchQuery}
                onChange={(e) => setImportSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    loadImportOptions();
                  }
                }}
                placeholder="Search by name or date"
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all"
              />
            </div>

            {importOptionsLoaded && importOptions.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700" htmlFor="import-event-select">
                    Event
                  </label>
                  <select
                    id="import-event-select"
                    value={selectedImportEventId}
                    onChange={(e) => setSelectedImportEventId(e.target.value)}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all"
                  >
                    {importOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {formatImportOption(option)}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500">{importOptions.length} events loaded.</p>
                </div>
                <button
                  type="button"
                  onClick={applyImport}
                  disabled={!selectedImportEventId || importApplyPending || importOptionsPending}
                  className="rounded-full border border-brand-navy bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {importApplyPending ? 'Applying...' : 'Apply import'}
                </button>
              </div>
            )}

            {importNotice && <p className="text-xs text-slate-600">{importNotice}</p>}

            {importError && (
              <div className="space-y-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                <p>{importError.message}</p>
                {isImportFixable(importError.code) && (
                  <p>
                    Update connection details in{' '}
                    <Link href="/settings#management-app-connection" className="font-semibold underline">
                      Settings
                    </Link>
                    .
                  </p>
                )}
                {importError.code === 'FORBIDDEN' && (
                  <p>
                    Use an API key with <code className="font-mono">read:events</code> and{' '}
                    <code className="font-mono">read:menu</code> permission.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-semibold text-foreground mb-1.5" htmlFor="promotion-name">
            Campaign name
          </label>
          <input
            id="promotion-name"
            type="text"
            value={promotionName}
            onChange={(e) => setPromotionName(e.target.value)}
            placeholder={campaignKind === 'event' ? 'e.g. Quiz Night 18 May' : 'e.g. Summer private hire push'}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-foreground mb-1.5" htmlFor="problem-brief">
            Campaign brief
          </label>
          <textarea
            id="problem-brief"
            value={problemBrief}
            onChange={(e) => setProblemBrief(e.target.value)}
            placeholder="What are you promoting, why should people care, and what details must the ads mention?"
            rows={5}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-foreground mb-1.5" htmlFor="destination-url">
            Paid CTA URL
          </label>
          <input
            id="destination-url"
            type="url"
            value={destinationUrl}
            onChange={(e) => setDestinationUrl(e.target.value)}
            placeholder="https://..."
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all"
          />
          {campaignKind === 'evergreen' && (
            <p className="mt-1 text-xs text-muted-foreground">
              This will be converted into a Meta Ads short link before generation.
            </p>
          )}
        </div>

        <div>
          <p className="block text-sm font-semibold text-foreground mb-1.5">Local radius</p>
          <div className="grid grid-cols-4 rounded-md border border-input overflow-hidden">
            {GEO_RADIUS_OPTIONS.map((radius, index) => (
              <button
                key={radius}
                type="button"
                aria-pressed={geoRadiusMiles === radius}
                onClick={() => setGeoRadiusMiles(radius)}
                className={`py-2 text-sm font-medium transition-colors ${
                  index > 0 ? 'border-l border-input' : ''
                } ${
                  geoRadiusMiles === radius
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-foreground hover:bg-accent'
                }`}
              >
                {radius} mi
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold text-foreground mb-1.5" htmlFor="budget-amount">
              Budget
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">£</span>
              <input
                id="budget-amount"
                type="number"
                min={1}
                step={1}
                value={budgetAmount}
                onChange={(e) => setBudgetAmount(Number(e.target.value))}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all"
              />
            </div>
          </div>

          <div>
            <p className="block text-sm font-semibold text-foreground mb-1.5">Budget type</p>
            <div className="flex rounded-md border border-input overflow-hidden">
              <button
                type="button"
                onClick={() => setBudgetType('DAILY')}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  budgetType === 'DAILY'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-foreground hover:bg-accent'
                }`}
              >
                Daily
              </button>
              <button
                type="button"
                onClick={() => setBudgetType('LIFETIME')}
                className={`flex-1 py-2 text-sm font-medium transition-colors border-l border-input ${
                  budgetType === 'LIFETIME'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-foreground hover:bg-accent'
                }`}
              >
                Total
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold text-foreground mb-1.5" htmlFor="start-date">
              Start date
            </label>
            <input
              id="start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-foreground mb-1.5" htmlFor="end-date">
              {campaignKind === 'event' ? 'Event date' : 'End date'}
            </label>
            <input
              id="end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all"
            />
            {campaignKind === 'evergreen' && (
              <p className={`mt-1 text-xs ${durationDays && durationDays > 30 ? 'text-rose-600' : 'text-muted-foreground'}`}>
                {durationDays ? `${durationDays} day${durationDays === 1 ? '' : 's'} selected. Maximum 30.` : 'Maximum 30 days.'}
              </p>
            )}
          </div>
        </div>

        {campaignKind === 'event' && (
          <div className="max-w-xs">
            <label className="block text-sm font-semibold text-foreground mb-1.5" htmlFor="ads-stop-time">
              Stop ads at
            </label>
            <input
              id="ads-stop-time"
              type="time"
              value={adsStopTime}
              onChange={(e) => setAdsStopTime(e.target.value)}
              required
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all"
            />
          </div>
        )}

        <div className="pt-2">
          <Button onClick={handleGenerate} disabled={Boolean(validateBriefForm())}>
            Generate Campaign
          </Button>
        </div>
      </div>
    );
  }

  if (formState === 'generating') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <p className="text-sm text-muted-foreground">{generatingMessage}</p>
      </div>
    );
  }

  if (formState === 'review' && aiPayload) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Campaign checks
          </p>
          <div className="space-y-1 text-sm text-foreground">
            <p>{campaignKind === 'event' ? 'Event campaign' : 'Evergreen campaign'} · {startDate} to {endDate}</p>
            <p>Geo: {geoRadiusMiles} mi from venue location</p>
            <p className="break-all">Paid CTA: {resolvedDestinationUrl || destinationUrl}</p>
            <p className={missingCreativeCount > 0 ? 'text-amber-700' : 'text-emerald-700'}>
              {missingCreativeCount > 0
                ? `${missingCreativeCount} ad${missingCreativeCount === 1 ? '' : 's'} still need images`
                : 'All ads have images'}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            AI rationale
          </p>
          <p className="text-sm text-foreground">{aiPayload.rationale}</p>
        </div>

        <div className="h-[500px] overflow-hidden">
          <CampaignTree payload={aiPayload} onChange={setAiPayload} mediaLibrary={mediaLibrary} />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button
            variant="outline"
            type="button"
            onClick={() => setFormState('brief')}
            disabled={isSubmitting}
          >
            Back
          </Button>
          <Button onClick={handleSaveAndPublish} disabled={isSubmitting || missingCreativeCount > 0}>
            {isSubmitting ? 'Publishing to Meta...' : 'Save & Publish'}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

function formatImportOption(option: ImportEventOption): string {
  const date = option.date ?? 'No date';
  const timePart = option.time ? ` ${option.time}` : '';
  const statusPart = option.status ? ` · ${option.status}` : '';
  return `${option.name} (${date}${timePart})${statusPart}`;
}

function isImportFixable(code: ManagementActionError['code']): boolean {
  return (
    code === 'NOT_CONFIGURED' ||
    code === 'DISABLED' ||
    code === 'UNAUTHORIZED' ||
    code === 'NETWORK'
  );
}
