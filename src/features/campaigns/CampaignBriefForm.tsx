'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/providers/toast-provider';
import type { AiCampaignPayload, BudgetType } from '@/types/campaigns';
import type { MediaAssetSummary } from '@/lib/library/data';
import { generateCampaignAction, saveCampaignDraft } from '@/app/(app)/campaigns/actions';
import {
  listManagementEventOptions,
  getManagementEventPrefill,
  type ManagementActionError,
} from '@/app/(app)/create/actions';
import { buildBriefFromEvent, deriveStartDate } from './event-import-utils';
import { CampaignTree } from './CampaignTree';

type FormState = 'brief' | 'generating' | 'review';

const GENERATING_MESSAGES = [
  'Identifying campaign objective…',
  'Building audience strategy…',
  'Writing ad copy…',
];

// ── Management import types ──────────────────────────────────────────────────

interface ImportEventOption {
  id: string;
  name: string;
  slug?: string;
  date?: string;
  time?: string;
  status?: string;
}

// ── Component ────────────────────────────────────────────────────────────────

interface CampaignBriefFormProps {
  mediaLibrary: MediaAssetSummary[];
}

export function CampaignBriefForm({ mediaLibrary }: CampaignBriefFormProps) {
  const router = useRouter();
  const toast = useToast();

  // ----- Form state -----
  const [formState, setFormState] = useState<FormState>('brief');
  const [problemBrief, setProblemBrief] = useState('');
  const [budgetAmount, setBudgetAmount] = useState<number>(20);
  const [budgetType, setBudgetType] = useState<BudgetType>('DAILY');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ----- Generating state -----
  const [generatingMessage, setGeneratingMessage] = useState(GENERATING_MESSAGES[0]);
  const messageIndexRef = useRef(0);

  // ----- Review state -----
  const [aiPayload, setAiPayload] = useState<AiCampaignPayload | null>(null);

  // ----- Import panel state -----
  const [importSearchQuery, setImportSearchQuery] = useState('');
  const [importOptions, setImportOptions] = useState<ImportEventOption[]>([]);
  const [importOptionsLoaded, setImportOptionsLoaded] = useState(false);
  const [importOptionsPending, setImportOptionsPending] = useState(false);
  const [selectedImportEventId, setSelectedImportEventId] = useState('');
  const [importApplyPending, setImportApplyPending] = useState(false);
  const [importError, setImportError] = useState<ManagementActionError | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  // Cycle generating messages
  useEffect(() => {
    if (formState !== 'generating') return;
    const interval = setInterval(() => {
      messageIndexRef.current =
        (messageIndexRef.current + 1) % GENERATING_MESSAGES.length;
      setGeneratingMessage(GENERATING_MESSAGES[messageIndexRef.current]);
    }, 2000);
    return () => clearInterval(interval);
  }, [formState]);

  async function handleGenerate() {
    if (!problemBrief.trim() || !startDate) {
      toast.error('Please fill in the brief and start date.');
      return;
    }
    if (budgetAmount <= 0) {
      toast.error('Budget must be greater than 0.');
      return;
    }

    setFormState('generating');
    messageIndexRef.current = 0;
    setGeneratingMessage(GENERATING_MESSAGES[0]);

    const result = await generateCampaignAction({
      problemBrief: problemBrief.trim(),
      budgetAmount,
      budgetType,
      startDate,
      endDate: endDate.trim() || null,
    });

    if ('error' in result) {
      toast.error(result.error);
      setFormState('brief');
      return;
    }

    setAiPayload(result.payload);
    setFormState('review');
  }

  async function handleSaveDraft() {
    if (!aiPayload) return;
    setIsSubmitting(true);
    const result = await saveCampaignDraft(aiPayload, {
      budgetAmount,
      budgetType,
      startDate,
      endDate: endDate.trim() || null,
      problemBrief: problemBrief.trim(),
    });
    if ('error' in result) {
      toast.error(result.error);
      setIsSubmitting(false);
      return;
    }
    toast.success('Campaign saved as draft.');
    router.push(`/campaigns/${result.campaignId}`);
  }

  // ── Import panel handlers ────────────────────────────────────────────────

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

        const { name, description, startDate: eventDate } = response.data.fields;
        const eventName = name ?? '';
        const eventDateStr = eventDate ?? '';
        const eventDescription = description ?? '';

        const briefText = buildBriefFromEvent(
          eventName,
          eventDateStr || undefined,
          eventDescription || undefined,
        );

        if (problemBrief.trim()) {
          const confirmed =
            typeof window === 'undefined'
              ? true
              : window.confirm('This will overwrite your existing brief. Continue?');
          if (!confirmed) {
            setImportNotice('Import cancelled. Existing brief was kept.');
            return;
          }
        }

        setProblemBrief(briefText);
        if (eventDateStr) {
          setStartDate(deriveStartDate(eventDateStr));
          setEndDate(eventDateStr);
        }
        setImportNotice(`Imported details from ${response.data.sourceLabel}.`);
      } catch {
        setImportError({ code: 'FAILED', message: 'Import failed unexpectedly.' });
      } finally {
        setImportApplyPending(false);
      }
    })();
  };

  // ===== BRIEF STATE =====
  if (formState === 'brief') {
    return (
      <div className="max-w-2xl space-y-6">

        {/* ── Import panel ─────────────────────────────────────────────── */}
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">Import from management app</p>
              <p className="text-xs text-slate-500">
                Pull event details to pre-fill the brief and campaign dates.
              </p>
            </div>
            <button
              type="button"
              onClick={loadImportOptions}
              disabled={importOptionsPending || importApplyPending}
              className="rounded-full border border-input bg-background px-4 py-1.5 text-xs font-semibold transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importOptionsPending
                ? 'Loading…'
                : importSearchQuery.trim()
                  ? 'Search events'
                  : 'Load events'}
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
                <label
                  className="block text-xs font-medium text-slate-700"
                  htmlFor="import-event-select"
                >
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
                {importApplyPending ? 'Applying…' : 'Apply import'}
              </button>
            </div>
          )}

          {importNotice && (
            <p className="text-xs text-slate-600">{importNotice}</p>
          )}

          {importError && (
            <div className="space-y-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              <p>{importError.message}</p>
              {isImportFixable(importError.code) && (
                <p>
                  Update connection details in{' '}
                  <Link
                    href="/settings#management-app-connection"
                    className="font-semibold underline"
                  >
                    Settings
                  </Link>
                  .
                </p>
              )}
              {importError.code === 'FORBIDDEN' && (
                <p>
                  Use an API key with <code className="font-mono">read:events</code> permission.
                </p>
              )}
            </div>
          )}

          {importOptionsLoaded &&
            !importOptionsPending &&
            !importError &&
            importOptions.length === 0 && (
              <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                {importSearchQuery.trim()
                  ? 'No events matched your search.'
                  : 'No events were returned from the management app.'}
              </p>
            )}
        </div>

        {/* ── Brief field ──────────────────────────────────────────────── */}
        <div>
          <label
            className="block text-sm font-semibold text-foreground mb-1.5"
            htmlFor="problem-brief"
          >
            What problem are you solving?
          </label>
          <textarea
            id="problem-brief"
            value={problemBrief}
            onChange={(e) => setProblemBrief(e.target.value)}
            placeholder="e.g. We have a quiet Tuesday night and want to attract more footfall with a new cocktail menu launch…"
            rows={5}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              className="block text-sm font-semibold text-foreground mb-1.5"
              htmlFor="budget-amount"
            >
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

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              className="block text-sm font-semibold text-foreground mb-1.5"
              htmlFor="start-date"
            >
              Start date <span className="text-destructive">*</span>
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
            <label
              className="block text-sm font-semibold text-foreground mb-1.5"
              htmlFor="end-date"
            >
              End date <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input
              id="end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all"
            />
          </div>
        </div>

        <div className="pt-2">
          <Button onClick={handleGenerate} disabled={!problemBrief.trim() || !startDate}>
            Generate Campaign
          </Button>
        </div>
      </div>
    );
  }

  // ===== GENERATING STATE =====
  if (formState === 'generating') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <p className="text-sm text-muted-foreground">{generatingMessage}</p>
      </div>
    );
  }

  // ===== REVIEW STATE =====
  if (formState === 'review' && aiPayload) {
    return (
      <div className="space-y-6">
        {/* AI rationale */}
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            AI rationale
          </p>
          <p className="text-sm text-foreground">{aiPayload.rationale}</p>
        </div>

        {/* Campaign tree */}
        <div className="h-[500px] overflow-hidden">
          <CampaignTree payload={aiPayload} onChange={setAiPayload} mediaLibrary={mediaLibrary} />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <Button
            variant="outline"
            type="button"
            onClick={() => setFormState('brief')}
            disabled={isSubmitting}
          >
            Back
          </Button>
          <Button onClick={handleSaveDraft} disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save Draft'}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

// ── Helpers (module-level) ───────────────────────────────────────────────────

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
