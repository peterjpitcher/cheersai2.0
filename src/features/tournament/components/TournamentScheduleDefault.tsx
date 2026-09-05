'use client';

import { useId } from 'react';

interface TournamentScheduleDefaultProps {
  value: string;
  onChange: (value: string) => void;
}

export function parsePostLeadHours(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const hours = Number(value);
  return Number.isInteger(hours) && hours >= 1 && hours <= 168 ? hours : null;
}

export function TournamentScheduleDefault({ value, onChange }: TournamentScheduleDefaultProps) {
  const id = useId();
  const hours = parsePostLeadHours(value);
  const timing = hours !== null && hours % 24 === 0
    ? `${hours / 24} ${hours === 24 ? 'day' : 'days'}`
    : `${hours} ${hours === 1 ? 'hour' : 'hours'}`;

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium" style={{ color: 'var(--c-ink)' }}>
        Default social scheduling
      </legend>
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3, 7].map(days => (
          <button
            key={days}
            type="button"
            aria-pressed={hours === days * 24}
            onClick={() => onChange(String(days * 24))}
            className="px-3 py-1.5 text-sm"
            style={{
              borderRadius: 'var(--r-md)',
              backgroundColor: hours === days * 24 ? 'var(--c-orange)' : 'var(--c-paper-2)',
              color: hours === days * 24 ? 'var(--c-card)' : 'var(--c-ink)',
            }}
          >
            {days} {days === 1 ? 'day' : 'days'} before
          </button>
        ))}
      </div>
      <label htmlFor={id} className="block text-sm" style={{ color: 'var(--c-ink)' }}>
        Hours before kick-off
      </label>
      <input
        id={id}
        type="number"
        value={value}
        onChange={event => onChange(event.target.value)}
        min={1}
        max={168}
        step={1}
        aria-invalid={hours === null}
        aria-describedby={`${id}-help`}
        className="w-24 px-3 py-2 text-sm"
        style={{ borderRadius: 'var(--r-md)', border: '1px solid var(--c-line)', color: 'var(--c-ink)' }}
      />
      <p id={`${id}-help`} className="text-xs" style={{ color: hours === null ? 'var(--c-claret)' : 'var(--c-ink-3)' }}>
        {hours === null ? 'Enter a whole number from 1 to 168 hours (up to 7 days).' : `Schedule new content ${timing} before each game kicks off.`}
      </p>
      <p className="text-xs" style={{ color: 'var(--c-ink-3)' }}>
        Applies when you generate content for this tournament. Regenerate existing content after changing settings to update its schedule and artwork before publishing.
      </p>
    </fieldset>
  );
}
