'use client';

import { useState } from 'react';
import type { UseFormReturn, FieldValues } from 'react-hook-form';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

interface PromotionFieldsProps {
  form: UseFormReturn<FieldValues>;
}

/**
 * Type-specific fields for promotion content.
 * Captures offer summary (max 500 chars with counter), coupon code, start/end dates.
 */
export function PromotionFields({ form }: PromotionFieldsProps): React.JSX.Element {
  const { register, watch, formState: { errors } } = form;
  const offerSummary = (watch('offerSummary') as string) ?? '';
  const [charCount, setCharCount] = useState(offerSummary.length);

  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-medium text-foreground">Promotion Details</legend>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="offerSummary">
            Offer summary <span className="text-destructive">*</span>
          </Label>
          <span
            className={`text-xs ${charCount > 500 ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {charCount}/500
          </span>
        </div>
        <textarea
          id="offerSummary"
          rows={3}
          className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-150 hover:border-ring/40 resize-none"
          placeholder="e.g. 2-for-1 cocktails every Thursday until midnight"
          aria-invalid={!!errors.offerSummary}
          {...register('offerSummary', {
            onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
              setCharCount(e.target.value.length);
            },
          })}
        />
        {errors.offerSummary && (
          <p className="text-sm text-destructive">{String(errors.offerSummary.message)}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="couponCode">Coupon code (optional)</Label>
        <Input
          id="couponCode"
          placeholder="e.g. THURSDAY241"
          {...register('couponCode')}
          aria-invalid={!!errors.couponCode}
        />
        {errors.couponCode && (
          <p className="text-sm text-destructive">{String(errors.couponCode.message)}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="startDate">Start date (optional)</Label>
          <Input
            id="startDate"
            type="date"
            {...register('startDate')}
            aria-invalid={!!errors.startDate}
          />
          {errors.startDate && (
            <p className="text-sm text-destructive">{String(errors.startDate.message)}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="endDate">
            End date <span className="text-destructive">*</span>
          </Label>
          <Input
            id="endDate"
            type="date"
            {...register('endDate')}
            aria-invalid={!!errors.endDate}
          />
          {errors.endDate && (
            <p className="text-sm text-destructive">{String(errors.endDate.message)}</p>
          )}
        </div>
      </div>
    </fieldset>
  );
}
