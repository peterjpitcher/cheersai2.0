'use client';

import { useState, useTransition } from 'react';
import type { UseFormReturn, FieldValues } from 'react-hook-form';

import { useAuth } from '@/components/providers/auth-provider';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  listManagementEventOptions,
  getManagementEventPrefill,
} from '@/app/(app)/create/actions';
import {
  describeArtworkState,
  isArtworkProblem,
  type ArtworkUiState,
} from '@/features/create/artwork-status';
import type { EventFactSheet } from '@/lib/management-app/event-facts';
import { importedBriefText, toneAfterImport } from '@/features/create/forms/event-import';

interface EventFieldsProps {
  form: UseFormReturn<FieldValues>;
  /**
   * Asks the wizard to import this event's artwork. Deliberately fire and
   * forget: the wizard owns the request so it survives this step unmounting,
   * and reports back through `artworkState`.
   */
  onImportArtwork?: (event: { eventId: string; eventSlug?: string }) => void;
  artworkState?: ArtworkUiState | null;
  canReplaceWithArtwork?: boolean;
  onUseArtwork?: () => void;
}

/** The facts the AI will use, shown so the owner can spot anything wrong in the events system. */
function EventFactsSummary({ facts }: { facts: EventFactSheet }): React.JSX.Element {
  const rows: Array<[string, string]> = [
    ['Kind of event', facts.category ?? ''],
    ['Times', facts.times ?? ''],
    ['Price', facts.price ?? ''],
    ['Booking', facts.booking ?? ''],
    ['Host', facts.host ?? ''],
    ['Highlights', (facts.highlights ?? []).join('; ')],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  return (
    <div className="rounded-md border bg-muted/40 p-3 text-xs">
      <p className="font-medium text-foreground">Facts the AI will use (from your events system)</p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted-foreground">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-medium">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {facts.faqs?.length ? (
        <div className="mt-1">
          <p className="font-medium text-muted-foreground">Questions and answers from the event page</p>
          <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
            {facts.faqs.map((faq) => (
              <li key={faq.question}>
                <span className="font-medium">{faq.question}</span> {faq.answer}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-1 text-muted-foreground">Something wrong? Correct it in the events system, then import again.</p>
    </div>
  );
}

interface EventOption {
  id: string;
  name: string;
  slug?: string;
  date?: string;
  time?: string;
  status?: string;
}

export function EventFields({
  form,
  onImportArtwork,
  artworkState = null,
  canReplaceWithArtwork = false,
  onUseArtwork,
}: EventFieldsProps): React.JSX.Element {
  const { register, formState: { errors, touchedFields }, setValue, getValues } = form;
  const canImport = useAuth()?.features.managementImport === true;
  const [importOpen, setImportOpen] = useState(false);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [search, setSearch] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [importedFacts, setImportedFacts] = useState<EventFactSheet | null>(
    () => (getValues('facts') as EventFactSheet | undefined) ?? null,
  );
  const [isPending, startTransition] = useTransition();

  function handleOpenImport(): void {
    setImportOpen(true);
    setImportError(null);
    startTransition(async () => {
      const result = await listManagementEventOptions();
      if (result.ok) {
        setEvents(result.data);
      } else {
        setImportError(result.error.message);
      }
    });
  }

  function handleSearch(query: string): void {
    setSearch(query);
    startTransition(async () => {
      const result = await listManagementEventOptions({ query: query || undefined });
      if (result.ok) {
        setEvents(result.data);
      }
    });
  }

  function handleSelectEvent(event: EventOption): void {
    startTransition(async () => {
      const result = await getManagementEventPrefill({
        eventId: event.id,
        eventSlug: event.slug,
      });
      if (result.ok) {
        const { fields, sourceLabel } = result.data;
        if (fields.name) {
          setValue('title', fields.name, { shouldValidate: true });
          setValue('eventName', fields.name, { shouldValidate: true });
        }
        if (fields.startDate) setValue('eventDate', fields.startDate, { shouldValidate: true });
        if (fields.startTime) setValue('eventTime', fields.startTime, { shouldValidate: true });
        if (fields.ctaLinks && Object.keys(fields.ctaLinks).length > 0) {
          setValue('ctaLinks', fields.ctaLinks, { shouldValidate: true });
        }
        const facts = fields.facts && Object.keys(fields.facts).length ? fields.facts : undefined;
        setValue('facts', facts, { shouldValidate: true });
        setImportedFacts(facts ?? null);
        setValue('prompt', importedBriefText(fields, Boolean(facts)), { shouldValidate: true });
        // A tone the owner picked (touched the control) stays; otherwise this event's suggestion.
        const tone = toneAfterImport({ ownerChoseTone: Boolean(touchedFields.tone), suggestedTone: fields.suggestedTone });
        if (tone) setValue('tone', tone, { shouldValidate: true });
        setSelectedLabel(sourceLabel);
        setImportOpen(false);

        // Started only after the fields land, and never awaited. Artwork
        // involves several megabytes of download and re-render, so tying it to
        // the prefill would make the form feel slow, and a slow or missing
        // artwork host must never stop the details importing.
        onImportArtwork?.({ eventId: event.id, eventSlug: event.slug });
      } else {
        setImportError(result.error.message);
      }
    });
  }

  const filteredEvents = search
    ? events.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
    : events;

  const artworkStatusText = describeArtworkState(artworkState);

  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-medium text-foreground">Event Details</legend>

      {/* Import from management app (per-brand switch, off by default) */}
      {canImport && (
      <div className="space-y-2">
        {!importOpen ? (
          <button
            type="button"
            onClick={handleOpenImport}
            className="text-sm font-medium text-primary hover:text-primary/80 underline-offset-4 hover:underline"
          >
            Import from events
          </button>
        ) : (
          <div className="rounded-lg border bg-muted/50 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Select an event</span>
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
            <Label htmlFor="managementEventSearch" className="sr-only">
              Search events
            </Label>
            <Input
              id="managementEventSearch"
              placeholder="Search events..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              autoFocus
            />
            {importError && (
              <p className="text-sm text-destructive">{importError}</p>
            )}
            {isPending && events.length === 0 && (
              <p className="text-sm text-muted-foreground">Loading events...</p>
            )}
            {!isPending && events.length === 0 && !importError && (
              <p className="text-sm text-muted-foreground">No events found</p>
            )}
            {filteredEvents.length > 0 && (
              <ul className="max-h-48 overflow-y-auto space-y-1">
                {filteredEvents.map((event) => (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectEvent(event)}
                      disabled={isPending}
                      className="w-full text-left rounded-md px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
                    >
                      <span className="font-medium">{event.name}</span>
                      {event.date && (
                        <span className="ml-2 text-muted-foreground">
                          {event.date}
                          {event.time ? ` ${event.time}` : ''}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {selectedLabel && !importOpen && (
          <p className="text-xs text-muted-foreground">
            Imported: {selectedLabel}
          </p>
        )}
        {importedFacts && !importOpen && <EventFactsSummary facts={importedFacts} />}

        {/*
          Artwork arrives seconds after the fields, often once this panel has
          closed, so the update has to be announced rather than merely drawn.
          Problems are marked with words as well as colour.
        */}
        <div aria-live="polite" role="status" className="space-y-2">
          {artworkStatusText && (
            <p
              className={
                isArtworkProblem(artworkState)
                  ? 'text-xs font-medium text-destructive'
                  : 'text-xs text-muted-foreground'
              }
            >
              {isArtworkProblem(artworkState) ? 'Artwork problem: ' : ''}
              {artworkStatusText}
            </p>
          )}

          {canReplaceWithArtwork && onUseArtwork && (
            <button
              type="button"
              onClick={onUseArtwork}
              className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
            >
              Replace current media with event artwork
            </button>
          )}
        </div>
      </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="eventName">
          Event name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="eventName"
          placeholder="e.g. Friday Live Music"
          {...register('eventName')}
          aria-invalid={!!errors.eventName}
        />
        {errors.eventName && (
          <p className="text-sm text-destructive">{String(errors.eventName.message)}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="eventDate">
            Event date <span className="text-destructive">*</span>
          </Label>
          <Input
            id="eventDate"
            type="date"
            {...register('eventDate')}
            aria-invalid={!!errors.eventDate}
          />
          {errors.eventDate && (
            <p className="text-sm text-destructive">{String(errors.eventDate.message)}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="eventTime">
            Event time <span className="text-destructive">*</span>
          </Label>
          <Input
            id="eventTime"
            type="time"
            {...register('eventTime')}
            aria-invalid={!!errors.eventTime}
          />
          {errors.eventTime && (
            <p className="text-sm text-destructive">{String(errors.eventTime.message)}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="eventEndDate">End date (optional)</Label>
          <Input
            id="eventEndDate"
            type="date"
            {...register('eventEndDate')}
            aria-invalid={!!errors.eventEndDate}
          />
          {errors.eventEndDate && (
            <p className="text-sm text-destructive">{String(errors.eventEndDate.message)}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="venue">Venue (optional)</Label>
          <Input
            id="venue"
            placeholder="Venue name, town"
            {...register('venue')}
            aria-invalid={!!errors.venue}
          />
          {errors.venue && (
            <p className="text-sm text-destructive">{String(errors.venue.message)}</p>
          )}
        </div>
      </div>
    </fieldset>
  );
}
