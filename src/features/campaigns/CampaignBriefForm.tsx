'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Btn } from '@/components/ui/button';
import { useToast } from '@/components/providers/toast-provider';
import { featureFlags } from '@/env';
import type {
  AiCampaignPayload,
  AudienceMode,
  BudgetType,
  FoodBookingBrief,
  FoodServiceHours,
  FoodServiceKey,
  GeoRadiusMiles,
  PaidCampaignKind,
  PaidMediaPlan,
  ResolvedMetaInterest,
} from '@/types/campaigns';
import type { MediaAssetSummary } from '@/lib/library/data';
import {
  createFoodBookingCampaign,
  generateCampaignAction,
  saveAndPublishCampaign,
} from '@/app/(app)/campaigns/actions';
import {
  listManagementEventOptions,
  getManagementEventPrefill,
  type ManagementActionError,
} from '@/app/(app)/create/actions';
import { calculateInclusiveDurationDays } from '@/lib/campaigns/phases';
import { calculateFoodBookingPhases } from '@/lib/campaigns/food-booking-phases';
import { DEFAULT_FOOD_SERVICE_HOURS } from '@/lib/campaigns/food-schedule';
import { buildBriefFromEvent, deriveStartDate } from './event-import-utils';
import { CampaignTree } from './CampaignTree';
import { FoodBookingSchedulePreview } from './FoodBookingSchedulePreview';

type FormState = 'brief' | 'generating' | 'review';

const GENERATING_MESSAGES = [
  'Checking paid CTA link...',
  'Building Meta campaign structure...',
  'Writing ad copy variations...',
];

const GEO_RADIUS_OPTIONS: GeoRadiusMiles[] = [1, 3, 5, 10];
const AUDIENCE_MODE_OPTIONS: Array<{ value: AudienceMode; label: string }> = [
  { value: 'local_only', label: 'Local only' },
  { value: 'local_interests', label: 'Local + interests' },
];

const KIND_LABELS: Record<PaidCampaignKind, string> = {
  event: 'Event',
  evergreen: 'Evergreen',
  food_booking: 'Food Booking',
};

const FOOD_SERVICE_ORDER: FoodServiceKey[] = ['weekday_dinner', 'saturday_food', 'sunday_roast'];
const FOOD_SERVICE_LABELS: Record<FoodServiceKey, string> = {
  weekday_dinner: 'Weekday dinner',
  saturday_food: 'Saturday food',
  sunday_roast: 'Sunday roast',
};
const FOOD_WEEKS_OPTIONS: Array<1 | 2 | 4> = [1, 2, 4];
const FOOD_DAY_WEIGHTING_OPTIONS: Array<{ value: FoodBookingBrief['dayWeighting']; label: string }> = [
  { value: 'even', label: 'Even across days' },
  { value: 'boost_quiet', label: 'Boost quiet days' },
  { value: 'manual', label: 'Manual' },
];

/** Initial editable copy of the default service hours, in display order. */
function buildInitialFoodServices(): FoodServiceHours[] {
  return FOOD_SERVICE_ORDER.map((key) => ({ ...DEFAULT_FOOD_SERVICE_HOURS[key] }));
}

const FOOD_HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Validate the food brief on the client before calling the server action. Mirrors the server schema. */
function validateFoodBriefForm(args: {
  promotionName: string;
  problemBrief: string;
  bookingUrl: string;
  budgetAmount: number;
  startDate: string;
  services: FoodServiceHours[];
}): string | null {
  if (!args.promotionName.trim()) return 'Enter a campaign name.';
  if (!args.problemBrief.trim()) return 'Enter a campaign brief.';
  if (!args.bookingUrl.trim()) return 'Enter a booking URL.';
  try {
    new URL(args.bookingUrl.trim());
  } catch {
    return 'Enter a valid booking URL.';
  }
  if (args.budgetAmount <= 0) return 'Budget must be greater than 0.';
  if (!args.startDate) return 'Set a campaign start date.';

  const enabledServices = args.services.filter((service) => service.enabled);
  if (enabledServices.length === 0) return 'Enable at least one food service.';
  for (const service of enabledServices) {
    if (!FOOD_HHMM_REGEX.test(service.startLocal) || !FOOD_HHMM_REGEX.test(service.endLocal)) {
      return `Set valid service hours (HH:MM) for ${FOOD_SERVICE_LABELS[service.serviceKey]}.`;
    }
    if (service.endLocal <= service.startLocal) {
      return `${FOOD_SERVICE_LABELS[service.serviceKey]} must end after it starts.`;
    }
  }
  return null;
}

interface ImportEventOption {
  id: string;
  name: string;
  slug?: string;
  date?: string;
  time?: string;
  status?: string;
  bookingUrl?: string;
}

interface CampaignBriefFormProps {
  mediaLibrary: MediaAssetSummary[];
}

const inputStyle = {
  borderRadius: 'var(--r-md)',
  border: '1px solid var(--c-line)',
  backgroundColor: 'transparent',
  color: 'var(--c-ink)',
  outline: 'none',
} as const;

function handleInputFocus(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
  e.currentTarget.style.boxShadow = '0 0 0 2px var(--c-orange)';
}

function handleInputBlur(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
  e.currentTarget.style.boxShadow = 'none';
}

export function CampaignBriefForm({ mediaLibrary }: CampaignBriefFormProps) {
  const router = useRouter();
  const toast = useToast();

  const kindOptions: PaidCampaignKind[] = featureFlags.foodBooking
    ? ['event', 'evergreen', 'food_booking']
    : ['event', 'evergreen'];

  const [formState, setFormState] = useState<FormState>('brief');
  const [campaignKind, setCampaignKind] = useState<PaidCampaignKind>('event');
  const [promotionName, setPromotionName] = useState('');
  const [problemBrief, setProblemBrief] = useState('');
  const [destinationUrl, setDestinationUrl] = useState('');
  const [budgetAmount, setBudgetAmount] = useState<number>(20);
  const [budgetType, setBudgetType] = useState<BudgetType>('LIFETIME');
  const [geoRadiusMiles, setGeoRadiusMiles] = useState<GeoRadiusMiles>(3);
  const [audienceMode, setAudienceMode] = useState<AudienceMode>('local_only');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [adsStopTime, setAdsStopTime] = useState('');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [sourceSnapshot, setSourceSnapshot] = useState<Record<string, unknown> | null>(null);
  const [resolvedDestinationUrl, setResolvedDestinationUrl] = useState('');
  const [resolvedSourceSnapshot, setResolvedSourceSnapshot] = useState<Record<string, unknown> | null>(null);
  const [audienceInterestKeywords, setAudienceInterestKeywords] = useState<string[]>([]);
  const [resolvedInterests, setResolvedInterests] = useState<ResolvedMetaInterest[]>([]);
  const [interestResolutionWarning, setInterestResolutionWarning] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Food booking sub-form state.
  const [foodServices, setFoodServices] = useState<FoodServiceHours[]>(buildInitialFoodServices);
  const [bookingUrl, setBookingUrl] = useState('');
  const [foodHooksText, setFoodHooksText] = useState('');
  const [foodWeeks, setFoodWeeks] = useState<1 | 2 | 4>(2);
  const [foodDayWeighting, setFoodDayWeighting] = useState<FoodBookingBrief['dayWeighting']>('even');
  const [windowOverrides, setWindowOverrides] = useState<Record<string, boolean>>({});

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

  const foodBrief = useMemo<FoodBookingBrief>(() => ({
    services: foodServices,
    bookingUrl: bookingUrl.trim(),
    foodHooks: foodHooksText
      .split('\n')
      .map((hook) => hook.trim())
      .filter(Boolean),
    weeks: foodWeeks,
    dayWeighting: foodDayWeighting,
  }), [foodServices, bookingUrl, foodHooksText, foodWeeks, foodDayWeighting]);

  // Live preview windows derived from the brief + start date. Toggle state is layered on top
  // via windowOverrides (keyed by windowKey) so the parent owns the per-window enabled flag.
  const foodWindows = useMemo(() => {
    if (campaignKind !== 'food_booking' || !startDate) return [];
    try {
      return calculateFoodBookingPhases(foodBrief, startDate).map((window) => ({
        ...window,
        enabled: windowOverrides[window.windowKey] ?? window.enabled,
      }));
    } catch {
      return [];
    }
  }, [campaignKind, startDate, foodBrief, windowOverrides]);

  const foodValidationError = useMemo(
    () =>
      validateFoodBriefForm({
        promotionName,
        problemBrief,
        bookingUrl,
        budgetAmount,
        startDate,
        services: foodServices,
      }),
    [promotionName, problemBrief, bookingUrl, budgetAmount, startDate, foodServices],
  );

  function toggleFoodWindow(windowKey: string, next: boolean) {
    setWindowOverrides((prev) => ({ ...prev, [windowKey]: next }));
  }

  function updateFoodService(serviceKey: FoodServiceKey, patch: Partial<FoodServiceHours>) {
    setFoodServices((prev) =>
      prev.map((service) => (service.serviceKey === serviceKey ? { ...service, ...patch } : service)),
    );
    // Hours/enablement changes invalidate prior per-window toggles.
    setWindowOverrides({});
  }

  async function handleCreateFoodBooking() {
    if (foodValidationError) {
      toast.error(foodValidationError);
      return;
    }

    setIsSubmitting(true);
    const result = await createFoodBookingCampaign({
      promotionName: promotionName.trim(),
      problemBrief: problemBrief.trim(),
      brief: foodBrief,
      budgetAmount,
      budgetType,
      geoRadiusMiles,
      audienceMode,
      startDate,
      windowOverrides: Object.keys(windowOverrides).length > 0 ? windowOverrides : undefined,
    });

    if ('error' in result) {
      toast.error(result.error);
      setIsSubmitting(false);
      return;
    }

    router.push(`/campaigns/${result.campaignId}`);
  }

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
    setAudienceInterestKeywords([]);
    setResolvedInterests([]);
    setInterestResolutionWarning(null);
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
      audienceMode,
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
    setAudienceInterestKeywords(result.audienceInterestKeywords);
    setResolvedInterests(result.resolvedInterests);
    setInterestResolutionWarning(result.interestResolutionWarning);
    setFormState('review');
  }

  async function handleSaveAndPublish() {
    if (!aiPayload) return;
    if (missingCreativeCount > 0) {
      toast.error('Assign images to every ad before publishing.');
      return;
    }
    if (audienceMode === 'local_interests' && resolvedInterests.length === 0) {
      toast.error('No Meta interests were resolved. Switch Audience to Local only and regenerate.');
      return;
    }

    setIsSubmitting(true);
    const result = await saveAndPublishCampaign(aiPayload, {
      campaignKind,
      promotionName: promotionName.trim(),
      budgetAmount,
      budgetType,
      geoRadiusMiles,
      audienceMode,
      audienceInterestKeywords,
      resolvedInterests,
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
        const metaAdsDestinationUrl = fields.metaAdsDestinationUrl ?? '';
        const eventCategoryName = fields.eventCategoryName ?? null;
        const eventCategorySlug = fields.eventCategorySlug ?? null;
        const managementPrompt = fields.prompt ?? '';
        const bookingUrl = fields.bookingUrl ?? selectedOption?.bookingUrl ?? '';

        if (!metaAdsShortLink) {
          setImportError({
            code: 'FAILED',
            message: 'This event does not have a Meta Ads short link yet. Refresh marketing links in the management app, then import again.',
          });
          return;
        }

        setCampaignKind('event');
        setAudienceMode('local_only');
        setPromotionName(eventName);
        setProblemBrief([
          buildBriefFromEvent(eventName, eventDateStr || undefined, eventDescription || undefined),
          managementPrompt,
        ].filter(Boolean).join(' '));
        setDestinationUrl(metaAdsShortLink);
        setSourceId(selectedImportEventId);
        setSourceSnapshot({
          eventId: selectedImportEventId,
          eventSlug: selectedOption?.slug ?? null,
          eventName,
          eventDate: eventDateStr || null,
          eventTime: fields.startTime ?? selectedOption?.time ?? null,
          eventCategoryName,
          eventCategorySlug,
          metaAdsShortLink,
          metaAdsDestinationUrl,
          bookingUrl,
          paymentMode: fields.paymentMode ?? null,
          bookingMode: fields.bookingMode ?? null,
          price: fields.price ?? null,
          pricePerSeat: fields.pricePerSeat ?? null,
          capacity: fields.capacity ?? null,
          seatsRemaining: fields.seatsRemaining ?? null,
          isFree: fields.isFree ?? null,
          managementPrompt,
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
          <p className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>Campaign type</p>
          <div
            className={`grid gap-2 p-1 ${kindOptions.length > 2 ? 'grid-cols-3' : 'grid-cols-2'}`}
            style={{ borderRadius: 'var(--r-lg)', border: '1px solid var(--c-line)', backgroundColor: 'var(--c-paper)' }}
          >
            {kindOptions.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={campaignKind === kind}
                onClick={() => {
                  setCampaignKind(kind);
                  setAudienceMode(defaultAudienceMode(kind));
                  resetGeneratedState();
                  if (kind !== 'event') {
                    setSourceId(null);
                    setSourceSnapshot(null);
                    setAdsStopTime('');
                  }
                  if (kind === 'food_booking') {
                    setWindowOverrides({});
                  }
                }}
                className="px-3 py-2 text-sm font-semibold transition-colors"
                style={{
                  borderRadius: 'var(--r-md)',
                  backgroundColor: campaignKind === kind ? 'var(--c-orange)' : 'transparent',
                  color: campaignKind === kind ? 'white' : 'var(--c-ink-3)',
                }}
              >
                {KIND_LABELS[kind]}
              </button>
            ))}
          </div>
        </div>

        {campaignKind === 'event' && (
          <div
            className="space-y-3 p-4"
            style={{
              borderRadius: 'var(--r-xl)',
              border: '1px solid var(--c-line)',
              backgroundColor: 'var(--c-paper)',
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>Import event</p>
                <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
                  Pull timing, brief details, and the paid Meta short link from the management app.
                </p>
              </div>
              <button
                type="button"
                onClick={loadImportOptions}
                disabled={importOptionsPending || importApplyPending}
                className="rounded-full px-4 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
                style={{ border: '1px solid var(--c-line)', backgroundColor: 'var(--c-card)' }}
              >
                {importOptionsPending ? 'Loading...' : importSearchQuery.trim() ? 'Search events' : 'Load events'}
              </button>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium" style={{ color: 'var(--c-ink-2)' }} htmlFor="import-search">
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
                className="w-full px-3 py-2 text-sm transition-all"
                style={{ ...inputStyle, '--placeholder-color': 'var(--c-ink-4)' } as React.CSSProperties}
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
              />
            </div>

            {importOptionsLoaded && importOptions.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="space-y-1">
                  <label className="block text-xs font-medium" style={{ color: 'var(--c-ink-2)' }} htmlFor="import-event-select">
                    Event
                  </label>
                  <select
                    id="import-event-select"
                    value={selectedImportEventId}
                    onChange={(e) => setSelectedImportEventId(e.target.value)}
                    className="w-full px-3 py-2 text-sm transition-all"
                    style={inputStyle}
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                  >
                    {importOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {formatImportOption(option)}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>{importOptions.length} events loaded.</p>
                </div>
                <button
                  type="button"
                  onClick={applyImport}
                  disabled={!selectedImportEventId || importApplyPending || importOptionsPending}
                  className="rounded-full px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ backgroundColor: 'var(--c-orange)', color: 'white' }}
                >
                  {importApplyPending ? 'Applying...' : 'Apply import'}
                </button>
              </div>
            )}

            {importNotice && <p className="text-xs" style={{ color: 'var(--c-ink-2)' }}>{importNotice}</p>}

            {importError && (
              <div
                className="space-y-1 px-3 py-2 text-xs"
                style={{
                  borderRadius: 'var(--r-xl)',
                  border: '1px solid var(--c-claret-soft)',
                  backgroundColor: 'var(--c-claret-soft)',
                  color: 'var(--c-claret)',
                }}
              >
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
                    Use an API key with <code className="mono">read:events</code> and{' '}
                    <code className="mono">read:menu</code> permission.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--c-ink)' }} htmlFor="promotion-name">
            Campaign name
          </label>
          <input
            id="promotion-name"
            type="text"
            value={promotionName}
            onChange={(e) => setPromotionName(e.target.value)}
            placeholder={campaignKind === 'event' ? 'e.g. Quiz Night 18 May' : 'e.g. Summer private hire push'}
            className="w-full px-3 py-2 text-sm transition-all"
            style={inputStyle}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--c-ink)' }} htmlFor="problem-brief">
            Campaign brief
          </label>
          <textarea
            id="problem-brief"
            value={problemBrief}
            onChange={(e) => setProblemBrief(e.target.value)}
            placeholder="What are you promoting, why should people care, and what details must the ads mention?"
            rows={5}
            className="w-full px-3 py-2 text-sm transition-all resize-none"
            style={inputStyle}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
          />
        </div>

        {campaignKind !== 'food_booking' && (
          <div>
            <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--c-ink)' }} htmlFor="destination-url">
              Paid CTA URL
            </label>
            <input
              id="destination-url"
              type="url"
              value={destinationUrl}
              onChange={(e) => setDestinationUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2 text-sm transition-all"
              style={inputStyle}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
            />
            {campaignKind === 'evergreen' && (
              <p className="mt-1 text-xs" style={{ color: 'var(--c-ink-3)' }}>
                This will be converted into a Meta Ads short link before generation.
              </p>
            )}
          </div>
        )}

        {campaignKind === 'food_booking' && (
          <FoodBookingSubForm
            services={foodServices}
            onServiceChange={updateFoodService}
            bookingUrl={bookingUrl}
            onBookingUrlChange={setBookingUrl}
            foodHooksText={foodHooksText}
            onFoodHooksChange={setFoodHooksText}
            weeks={foodWeeks}
            onWeeksChange={setFoodWeeks}
            dayWeighting={foodDayWeighting}
            onDayWeightingChange={setFoodDayWeighting}
          />
        )}

        <div>
          <p className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--c-ink)' }}>Local radius</p>
          <div
            className="grid grid-cols-4 overflow-hidden"
            style={{ borderRadius: 'var(--r-md)', border: '1px solid var(--c-line)' }}
          >
            {GEO_RADIUS_OPTIONS.map((radius, index) => (
              <button
                key={radius}
                type="button"
                aria-pressed={geoRadiusMiles === radius}
                onClick={() => setGeoRadiusMiles(radius)}
                className="py-2 text-sm font-medium transition-colors"
                style={{
                  borderLeft: index > 0 ? '1px solid var(--c-line)' : undefined,
                  backgroundColor: geoRadiusMiles === radius ? 'var(--c-orange)' : 'var(--c-card)',
                  color: geoRadiusMiles === radius ? 'white' : 'var(--c-ink)',
                }}
              >
                {radius} mi
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--c-ink)' }}>Audience</p>
          <div
            className="grid grid-cols-2 overflow-hidden"
            style={{ borderRadius: 'var(--r-md)', border: '1px solid var(--c-line)' }}
          >
            {AUDIENCE_MODE_OPTIONS.map((option, index) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={audienceMode === option.value}
                onClick={() => {
                  setAudienceMode(option.value);
                  resetGeneratedState();
                }}
                className="py-2 text-sm font-medium transition-colors"
                style={{
                  borderLeft: index > 0 ? '1px solid var(--c-line)' : undefined,
                  backgroundColor: audienceMode === option.value ? 'var(--c-orange)' : 'var(--c-card)',
                  color: audienceMode === option.value ? 'white' : 'var(--c-ink)',
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--c-ink)' }} htmlFor="budget-amount">
              Budget
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm" style={{ color: 'var(--c-ink-3)' }}>£</span>
              <input
                id="budget-amount"
                type="number"
                min={1}
                step={1}
                value={budgetAmount}
                onChange={(e) => setBudgetAmount(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm transition-all"
                style={inputStyle}
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
              />
            </div>
          </div>

          <div>
            <p className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--c-ink)' }}>Budget type</p>
            <div className="flex overflow-hidden" style={{ borderRadius: 'var(--r-md)', border: '1px solid var(--c-line)' }}>
              <button
                type="button"
                onClick={() => setBudgetType('DAILY')}
                className="flex-1 py-2 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: budgetType === 'DAILY' ? 'var(--c-orange)' : 'var(--c-card)',
                  color: budgetType === 'DAILY' ? 'white' : 'var(--c-ink)',
                }}
              >
                Daily
              </button>
              <button
                type="button"
                onClick={() => setBudgetType('LIFETIME')}
                className="flex-1 py-2 text-sm font-medium transition-colors"
                style={{
                  borderLeft: '1px solid var(--c-line)',
                  backgroundColor: budgetType === 'LIFETIME' ? 'var(--c-orange)' : 'var(--c-card)',
                  color: budgetType === 'LIFETIME' ? 'white' : 'var(--c-ink)',
                }}
              >
                Total
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--c-ink)' }} htmlFor="start-date">
              Start date
            </label>
            <input
              id="start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 text-sm transition-all"
              style={inputStyle}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
            />
          </div>

          {campaignKind === 'food_booking' ? (
            <div className="flex items-end">
              <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
                The end date is set automatically from the last scheduled ad window.
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--c-ink)' }} htmlFor="end-date">
                {campaignKind === 'event' ? 'Event date' : 'End date'}
              </label>
              <input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 text-sm transition-all"
                style={inputStyle}
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
              />
              {campaignKind === 'evergreen' && (
                <p className="mt-1 text-xs" style={{ color: durationDays && durationDays > 30 ? 'var(--c-claret)' : 'var(--c-ink-3)' }}>
                  {durationDays ? `${durationDays} day${durationDays === 1 ? '' : 's'} selected. Maximum 30.` : 'Maximum 30 days.'}
                </p>
              )}
            </div>
          )}
        </div>

        {campaignKind === 'event' && (
          <div className="max-w-xs">
            <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--c-ink)' }} htmlFor="ads-stop-time">
              Stop ads at
            </label>
            <input
              id="ads-stop-time"
              type="time"
              value={adsStopTime}
              onChange={(e) => setAdsStopTime(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm transition-all"
              style={inputStyle}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
            />
          </div>
        )}

        {campaignKind === 'food_booking' && (
          <div className="space-y-2">
            <p className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>Schedule preview</p>
            <FoodBookingSchedulePreview
              windows={foodWindows}
              services={foodServices}
              onToggle={toggleFoodWindow}
              budgetAmount={budgetAmount}
              budgetType={budgetType}
            />
          </div>
        )}

        <div className="pt-2">
          {campaignKind === 'food_booking' ? (
            <Btn
              onClick={handleCreateFoodBooking}
              disabled={isSubmitting || Boolean(foodValidationError)}
            >
              {isSubmitting ? 'Creating campaign...' : 'Create Campaign'}
            </Btn>
          ) : (
            <Btn onClick={handleGenerate} disabled={Boolean(validateBriefForm())}>
              Generate Campaign
            </Btn>
          )}
        </div>
      </div>
    );
  }

  if (formState === 'generating') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div
          className="h-8 w-8 rounded-full animate-spin"
          style={{ border: '2px solid var(--c-orange)', borderTopColor: 'transparent' }}
        />
        <p className="text-sm" style={{ color: 'var(--c-ink-3)' }}>{generatingMessage}</p>
      </div>
    );
  }

  if (formState === 'review' && aiPayload) {
    return (
      <div className="space-y-6">
        <div
          className="px-4 py-3"
          style={{
            borderRadius: 'var(--r-xl)',
            border: '1px solid var(--c-line)',
            backgroundColor: 'var(--c-paper)',
          }}
        >
          <p className="eyebrow mb-1">Campaign checks</p>
          <div className="space-y-1 text-sm" style={{ color: 'var(--c-ink)' }}>
            <p>{campaignKind === 'event' ? 'Event campaign' : 'Evergreen campaign'} · {startDate} to {endDate}</p>
            <p>Geo: {geoRadiusMiles} mi from venue location</p>
            <p>
              Audience: {audienceMode === 'local_interests' ? 'Local + interests' : 'Local only'}
            </p>
            {audienceMode === 'local_interests' && resolvedInterests.length > 0 && (
              <p>Interests: {resolvedInterests.map((interest) => interest.name).join(', ')}</p>
            )}
            {audienceMode === 'local_interests' && audienceInterestKeywords.length > 0 && resolvedInterests.length === 0 && (
              <p style={{ color: 'var(--c-orange-hi)' }}>Keywords checked: {audienceInterestKeywords.join(', ')}</p>
            )}
            {interestResolutionWarning && (
              <p style={{ color: 'var(--c-orange-hi)' }}>{interestResolutionWarning}</p>
            )}
            {campaignKind === 'event' && aiPayload.media_plan && (
              <div className="pt-2">
                <p>{formatMediaPlanSummary(aiPayload.media_plan)}</p>
                <p style={{ color: 'var(--c-ink-3)' }}>{aiPayload.media_plan.rationale}</p>
                {aiPayload.media_plan.budgetRecommendation && (
                  <p style={{ color: 'var(--c-orange-hi)' }}>
                    {formatBudgetRecommendation(aiPayload.media_plan)}
                  </p>
                )}
              </div>
            )}
            <p className="break-all">Paid CTA: {resolvedDestinationUrl || destinationUrl}</p>
            <p style={{ color: missingCreativeCount > 0 ? 'var(--c-orange-hi)' : 'var(--c-status-posted-fg)' }}>
              {missingCreativeCount > 0
                ? `${missingCreativeCount} ad${missingCreativeCount === 1 ? '' : 's'} still need images`
                : 'All ads have images'}
            </p>
          </div>
        </div>

        <div
          className="px-4 py-3"
          style={{
            borderLeft: '3px solid var(--c-ink)',
            backgroundColor: 'var(--c-paper)',
            borderRadius: 'var(--r-sm)',
          }}
        >
          <p className="eyebrow mb-1">AI rationale</p>
          <p className="text-sm" style={{ color: 'var(--c-ink)' }}>{aiPayload.rationale}</p>
        </div>

        <div className="h-[500px] overflow-hidden">
          <CampaignTree payload={aiPayload} onChange={setAiPayload} mediaLibrary={mediaLibrary} />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Btn
            variant="outline"
            type="button"
            onClick={() => setFormState('brief')}
            disabled={isSubmitting}
          >
            Back
          </Btn>
          <Btn
            onClick={handleSaveAndPublish}
            disabled={isSubmitting || missingCreativeCount > 0 || (audienceMode === 'local_interests' && resolvedInterests.length === 0)}
          >
            {isSubmitting ? 'Publishing to Meta...' : 'Save & Publish'}
          </Btn>
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

function defaultAudienceMode(kind: PaidCampaignKind): AudienceMode {
  // Event + food booking are local-first; only evergreen layers interests by default.
  return kind === 'evergreen' ? 'local_interests' : 'local_only';
}

interface FoodBookingSubFormProps {
  services: FoodServiceHours[];
  onServiceChange: (serviceKey: FoodServiceKey, patch: Partial<FoodServiceHours>) => void;
  bookingUrl: string;
  onBookingUrlChange: (value: string) => void;
  foodHooksText: string;
  onFoodHooksChange: (value: string) => void;
  weeks: 1 | 2 | 4;
  onWeeksChange: (value: 1 | 2 | 4) => void;
  dayWeighting: FoodBookingBrief['dayWeighting'];
  onDayWeightingChange: (value: FoodBookingBrief['dayWeighting']) => void;
}

function FoodBookingSubForm({
  services,
  onServiceChange,
  bookingUrl,
  onBookingUrlChange,
  foodHooksText,
  onFoodHooksChange,
  weeks,
  onWeeksChange,
  dayWeighting,
  onDayWeightingChange,
}: FoodBookingSubFormProps) {
  return (
    <div
      className="space-y-4 p-4"
      style={{ borderRadius: 'var(--r-xl)', border: '1px solid var(--c-line)', backgroundColor: 'var(--c-paper)' }}
    >
      <div className="space-y-1">
        <p className="text-sm font-semibold" style={{ color: 'var(--c-ink)' }}>Food services</p>
        <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
          Turn services on or off and adjust hours. Defaults match a typical pub schedule.
        </p>
      </div>

      <div className="space-y-3">
        {services.map((service) => {
          const label = FOOD_SERVICE_LABELS[service.serviceKey];
          return (
            <div
              key={service.serviceKey}
              className="grid gap-3 sm:grid-cols-[auto_1fr_1fr] sm:items-end"
              style={{
                borderRadius: 'var(--r-md)',
                border: '1px solid var(--c-line)',
                padding: '0.75rem',
                backgroundColor: 'var(--c-card)',
              }}
            >
              <label className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--c-ink)' }}>
                <input
                  type="checkbox"
                  checked={service.enabled}
                  onChange={(e) => onServiceChange(service.serviceKey, { enabled: e.target.checked })}
                  aria-label={`Enable ${label}`}
                  className="h-4 w-4"
                  style={{ accentColor: 'var(--c-orange)' }}
                />
                {label}
              </label>

              <div>
                <label
                  className="block text-xs font-medium mb-1"
                  style={{ color: 'var(--c-ink-2)' }}
                  htmlFor={`service-start-${service.serviceKey}`}
                >
                  {label} start
                </label>
                <input
                  id={`service-start-${service.serviceKey}`}
                  type="time"
                  value={service.startLocal}
                  disabled={!service.enabled}
                  onChange={(e) => onServiceChange(service.serviceKey, { startLocal: e.target.value })}
                  className="w-full px-3 py-2 text-sm transition-all disabled:opacity-50"
                  style={inputStyle}
                  onFocus={handleInputFocus}
                  onBlur={handleInputBlur}
                />
              </div>

              <div>
                <label
                  className="block text-xs font-medium mb-1"
                  style={{ color: 'var(--c-ink-2)' }}
                  htmlFor={`service-end-${service.serviceKey}`}
                >
                  {label} last orders
                </label>
                <input
                  id={`service-end-${service.serviceKey}`}
                  type="time"
                  value={service.endLocal}
                  disabled={!service.enabled}
                  onChange={(e) => onServiceChange(service.serviceKey, { endLocal: e.target.value })}
                  className="w-full px-3 py-2 text-sm transition-all disabled:opacity-50"
                  style={inputStyle}
                  onFocus={handleInputFocus}
                  onBlur={handleInputBlur}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div>
        <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--c-ink)' }} htmlFor="food-booking-url">
          Booking URL
        </label>
        <input
          id="food-booking-url"
          type="url"
          value={bookingUrl}
          onChange={(e) => onBookingUrlChange(e.target.value)}
          placeholder="https://book.example.com"
          className="w-full px-3 py-2 text-sm transition-all"
          style={inputStyle}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
        />
      </div>

      <div>
        <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--c-ink)' }} htmlFor="food-hooks">
          Food hooks
        </label>
        <textarea
          id="food-hooks"
          value={foodHooksText}
          onChange={(e) => onFoodHooksChange(e.target.value)}
          placeholder={'One hook per line, e.g.\nHand-carved roast\nGravy made fresh daily'}
          rows={3}
          className="w-full px-3 py-2 text-sm transition-all resize-none"
          style={inputStyle}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
        />
        <p className="mt-1 text-xs" style={{ color: 'var(--c-ink-3)' }}>One hook per line. The AI weaves these into the ad copy.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--c-ink)' }} htmlFor="food-weeks">
            Weeks to run
          </label>
          <select
            id="food-weeks"
            value={String(weeks)}
            onChange={(e) => onWeeksChange(Number(e.target.value) as 1 | 2 | 4)}
            className="w-full px-3 py-2 text-sm transition-all"
            style={inputStyle}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
          >
            {FOOD_WEEKS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option} week{option === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--c-ink)' }} htmlFor="food-day-weighting">
            Day weighting
          </label>
          <select
            id="food-day-weighting"
            value={dayWeighting}
            onChange={(e) => onDayWeightingChange(e.target.value as FoodBookingBrief['dayWeighting'])}
            className="w-full px-3 py-2 text-sm transition-all"
            style={inputStyle}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
          >
            {FOOD_DAY_WEIGHTING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function formatMediaPlanSummary(mediaPlan: PaidMediaPlan): string {
  const strategicCount = mediaPlan.strategicPhases.length;
  const executionCount = mediaPlan.executionPhases.length;
  return `Media plan: ${strategicCount} booking moment${strategicCount === 1 ? '' : 's'}; Meta execution: ${executionCount} ad set${executionCount === 1 ? '' : 's'} (${formatExecutionMode(mediaPlan.executionMode)}).`;
}

function formatBudgetRecommendation(mediaPlan: PaidMediaPlan): string {
  const recommendation = mediaPlan.budgetRecommendation;
  if (!recommendation) return '';

  const budgetLabel = recommendation.budgetType === 'DAILY' ? 'daily' : 'total';
  const increaseLabel = recommendation.additionalBudgetAmount > 0
    ? `, an increase of ${formatCurrency(recommendation.additionalBudgetAmount)}`
    : '';

  return `Budget alert: increase the ${budgetLabel} budget to ${formatCurrency(recommendation.recommendedBudgetAmount)}${increaseLabel} before publishing to unlock ${formatExecutionMode(recommendation.targetExecutionMode)}.`;
}

function formatExecutionMode(mode: PaidMediaPlan['executionMode']): string {
  if (mode === 'three_phase') return '3-phase delivery';
  if (mode === 'two_phase') return '2-phase delivery';
  return 'single booking push';
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value);
}
