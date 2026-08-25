'use client';

import { useState, useTransition } from 'react';
import type { UseFormReturn, FieldValues } from 'react-hook-form';

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
  const { register, formState: { errors }, setValue } = form;
  const [importOpen, setImportOpen] = useState(false);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [search, setSearch] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
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
        const briefParts = [fields.description, fields.prompt].filter(Boolean);
        if (briefParts.length > 0) {
          setValue('prompt', briefParts.join('\n\n'), { shouldValidate: true });
        }
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

      {/* Import from management app */}
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
            placeholder="The Anchor, Stanwell Moor Village"
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
