// Simple sensitive data scrubber to prevent secrets/PII in logs and error payloads
// Redacts common tokens/headers, cookies, and emails while preserving structure

const SENSITIVE_KEYS = [
  'authorization',
  'access_token',
  'refresh_token',
  'id_token',
  'api_key',
  'openai_api_key',
  'stripe_secret_key',
  'stripe_webhook_secret',
  'cookie',
  'cookies',
  'set-cookie',
  'supabase_service_role_key',
  'next_public_supabase_anon_key',
  'google_my_business_client_secret',
  'twitter_client_secret',
];

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const TOKEN_REGEX = /(?:bearer\s+)?[A-Za-z0-9_\-\.]{20,}\b/g;

function redactString(input: string): string {
  let out = input.replace(EMAIL_REGEX, '[redacted:email]');
  out = out.replace(TOKEN_REGEX, '[redacted:token]');
  return out;
}

export function scrubSensitive<T = unknown>(value: T): T {
  if (value == null) return value;

  if (typeof value === 'string') {
    return redactString(value) as unknown as T;
  }

  if (Array.isArray(value)) {
    return value.map(v => scrubSensitive(v)) as unknown as T;
  }

  if (value instanceof Error) {
    const safe: any = {
      name: value.name,
      message: redactString(value.message || ''),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
    // Copy enumerable props, redacting as needed
    for (const k of Object.keys(value as any)) {
      safe[k] = scrubSensitive((value as any)[k]);
    }
    return safe as T;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.includes(k.toLowerCase())) {
        safe[k] = '[redacted]';
      } else if (typeof v === 'string') {
        safe[k] = redactString(v);
      } else {
        safe[k] = scrubSensitive(v);
      }
    }
    return safe as T;
  }

  return value;
}

export function safeLog(label: string, payload: any) {
  try {
    // eslint-disable-next-line no-console
    console.error(label, scrubSensitive(payload));
  } catch {
    // fallback to plain label
    // eslint-disable-next-line no-console
    console.error(label);
  }
}

