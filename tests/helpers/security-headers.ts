import { buildCustomRoute } from 'next/dist/lib/build-custom-route';

import { securityHeaders } from '@/lib/security/headers';

/**
 * The headers a path gets, matched the way Next compiles `headers()` rules
 * into the routes manifest (buildCustomRoute), so a test checks the same regex
 * production serves with.
 */
export function headersFor(pathname: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rule of securityHeaders) {
    const { regex } = buildCustomRoute('header', rule) as { regex: string };
    if (new RegExp(regex).test(pathname)) {
      for (const header of rule.headers) result[header.key] = header.value;
    }
  }
  return result;
}
