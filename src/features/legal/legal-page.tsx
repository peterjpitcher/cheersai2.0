import Link from "next/link";
import type { ReactNode } from "react";

import { PublicPage } from "@/features/marketing/public-page";
import { CONTACT, LEGAL_DOCUMENTS, LEGAL_UPDATED, LEGAL_VERSION, type LegalDocumentId } from "@/lib/legal/company";

/**
 * Shared shell for the three public legal pages (terms, privacy notice, DPA)
 * in the homepage's look (PublicPage): the site header, the title, date,
 * version and cross-links on the ink band, and the site footer, which carries
 * the company details and contacts the law requires on the site, so they are
 * written once.
 */

/** A link in the text, as the homepage writes them (--c-orange-hi is 5.2:1 on paper). */
const LINK = "font-medium text-orange-hi underline underline-offset-[3px]";

/** A link on the ink band. */
const LINK_ON_DARK = "font-medium text-white underline underline-offset-4";

interface LegalPageProps {
  current: LegalDocumentId;
  children: ReactNode;
}

export function LegalPage({ current, children }: LegalPageProps): React.JSX.Element {
  const doc = LEGAL_DOCUMENTS[current];
  const others = Object.values(LEGAL_DOCUMENTS).filter((other) => other.id !== current);

  return (
    <PublicPage
      eyebrow="Legal"
      title={doc.title}
      intro={
        <>
          <p className="text-sm">
            Last updated {LEGAL_UPDATED} &middot; <span className="whitespace-nowrap">Version {LEGAL_VERSION}</span>
          </p>
          <p className="text-sm">
            See also:{" "}
            {others.map((other, index) => (
              <span key={other.id}>
                {index > 0 ? " and " : null}
                <Link href={other.path} className={LINK_ON_DARK}>
                  {other.title}
                </Link>
              </span>
            ))}
          </p>
        </>
      }
    >
      {/* break-words: long URLs and permission names must wrap, not widen the page on a phone. */}
      <div className="max-w-[760px] space-y-6 break-words text-base leading-relaxed text-ink-2">{children}</div>
    </PublicPage>
  );
}

interface LegalSectionProps {
  id: string;
  title: string;
  children: ReactNode;
}

/** A numbered or titled section; the id gives each section a stable anchor. */
export function LegalSection({ id, title, children }: LegalSectionProps): React.JSX.Element {
  return (
    <section id={id} className="scroll-mt-6 space-y-4 pt-4">
      <h2 className="text-2xl font-semibold leading-tight text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function LegalList({ children }: { children: ReactNode }): React.JSX.Element {
  return <ul className="list-disc space-y-2 pl-6 marker:text-orange">{children}</ul>;
}

interface LegalTableProps {
  caption: string;
  head: readonly string[];
  rows: readonly (readonly ReactNode[])[];
}

/**
 * A simple bordered table that scrolls sideways on a narrow screen. The
 * scrolling box takes keyboard focus and is named by the caption, so it can be
 * scrolled without a mouse (WCAG 2.1.1).
 */
export function LegalTable({ caption, head, rows }: LegalTableProps): React.JSX.Element {
  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className="overflow-x-auto rounded-[var(--r-xl)] border border-line bg-card"
    >
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {head.map((cell) => (
              <th
                key={cell}
                scope="col"
                className="border-b border-line-2 bg-paper px-3 py-2.5 align-bottom font-semibold text-ink"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-line last:border-b-0">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2.5 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LegalLink({ href, children }: { href: string; children: ReactNode }): React.JSX.Element {
  const external = /^https?:\/\//.test(href);
  if (external) {
    return (
      <a href={href} className={LINK} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={LINK}>
      {children}
    </Link>
  );
}

export function ContactEmail(): React.JSX.Element {
  return (
    <a href={`mailto:${CONTACT.email}`} className={LINK}>
      {CONTACT.email}
    </a>
  );
}

export function ContactWhatsApp(): React.JSX.Element {
  return (
    <a href={`https://wa.me/${CONTACT.whatsappE164.replace("+", "")}`} className={LINK}>
      {CONTACT.whatsappDisplay}
    </a>
  );
}
