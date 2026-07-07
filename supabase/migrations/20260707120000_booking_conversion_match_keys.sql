-- Advanced-matching signals for Meta Conversions API forwarding.
-- Only SHA-256 digests are ever stored (never raw email/phone); values are
-- consent-gated at the ingest endpoint, matching fbp/fbc/client_user_agent.
alter table booking_conversion_events
  add column if not exists email_sha256 text,
  add column if not exists phone_sha256 text,
  add column if not exists client_ip_address text;

comment on column booking_conversion_events.email_sha256 is
  'SHA-256 hex digest of the normalised booking email (consent-gated; raw value never stored).';
comment on column booking_conversion_events.phone_sha256 is
  'SHA-256 hex digest of the E.164 booking phone (consent-gated; raw value never stored).';
comment on column booking_conversion_events.client_ip_address is
  'Booker client IP as seen by the-anchor.pub (consent-gated), forwarded to Meta CAPI for matching.';

-- Partial index for the CAPI retry cron; predicate mirrors the cron's exact filter.
create index if not exists idx_booking_conversion_events_capi_retry
  on booking_conversion_events (occurred_at)
  where meta_consent_granted and (
    capi_status is null
    or capi_status = 'failed'
    or (capi_status = 'skipped' and capi_error = 'not_configured')
  );
