import { serializeJsonLd, type JsonLdObject } from '@/lib/marketing/structured-data';

interface JsonLdProps {
  data: JsonLdObject;
}

/**
 * A schema.org JSON-LD block. The data is our own (company.ts, PLANS, page
 * content), serialised with "<", ">" and "&" escaped, which is the pattern
 * Next's JSON-LD guide gives: the only way to put JSON inside a script tag
 * without React escaping it into invalid JSON.
 */
export function JsonLd({ data }: JsonLdProps): React.JSX.Element {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
