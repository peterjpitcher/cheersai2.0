'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/providers/toast-provider';
import type { AiCampaignPayload, BudgetType } from '@/types/campaigns';
import { generateCampaignAction, saveCampaignDraft } from '@/app/(app)/campaigns/actions';
import { CampaignTree } from './CampaignTree';

type FormState = 'brief' | 'generating' | 'review';

const GENERATING_MESSAGES = [
  'Identifying campaign objective…',
  'Building audience strategy…',
  'Writing ad copy…',
];

export function CampaignBriefForm() {
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
    try {
      const { campaignId } = await saveCampaignDraft(aiPayload, {
        budgetAmount,
        budgetType,
        startDate,
        endDate: endDate.trim() || null,
        problemBrief: problemBrief.trim(),
      });
      toast.success('Campaign saved as draft.');
      router.push(`/campaigns/${campaignId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save draft.';
      toast.error(message);
      setIsSubmitting(false);
    }
  }

  // ===== BRIEF STATE =====
  if (formState === 'brief') {
    return (
      <div className="max-w-2xl space-y-6">
        <div>
          <label className="block text-sm font-semibold text-foreground mb-1.5" htmlFor="problem-brief">
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

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-foreground mb-1.5" htmlFor="start-date">
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
            <label className="block text-sm font-semibold text-foreground mb-1.5" htmlFor="end-date">
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
          <CampaignTree payload={aiPayload} onChange={setAiPayload} />
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
