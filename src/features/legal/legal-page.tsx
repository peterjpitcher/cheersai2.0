import Link from "next/link";
import type { ReactNode } from "react";

import {
  COMPANY,
  CONTACT,
  LEGAL_DOCUMENTS,
  LEGAL_UPDATED,
  LEGAL_VERSION,
  type LegalDocumentId,
} from "@/lib/legal/company";

/**
 * Shared shell for the three public legal pages (terms, privacy notice, DPA):
 * the same header, cross-links and company details footer on each, so the
 * details the law requires on the site are written once.
 */

const linkStyle = { color: "var(--c-orange)" } as const;
const headingStyle = { color: "var(--c-ink)" } as const;
const mutedStyle = { color: "var(--c-ink-3)" } as const;

interface LegalPageProps {
  current: LegalDocumentId;
  children: ReactNode;
}

export function LegalPage({ current, children }: LegalPageProps) {
  const doc = LEGAL_DOCUMENTS[current];
  const others = Object.values(LEGAL_DOCUMENTS).filter((other) => other.id !== current);

  return (
    <main className="mx-auto max-w-[720px] px-4 py-16" style={{ color: "var(--c-ink)" }}>
      <header className="space-y-4 text-center">
        <p className="eyebrow" style={mutedStyle}>
          Cheers by Orange Jelly
        </p>
        <h1 className="text-3xl font-semibold" style={headingStyle}>
          {doc.title}
        </h1>
        <p className="text-sm" style={mutedStyle}>
          Last updated {LEGAL_UPDATED} &middot; Version {LEGAL_VERSION}
        </p>
        <p className="text-sm" style={mutedStyle}>
          See also:{" "}
          {others.map((other, index) => (
            <span key={other.id}>
              {index > 0 ? " and " : null}
              <Link href={other.path} className="hover:underline" style={linkStyle}>
                {other.title}
              </Link>
            </span>
          ))}
        </p>
      </header>

      {/* break-words: long URLs and permission names must wrap, not widen the page on a phone. */}
      <div className="mt-12 space-y-6 break-words text-base" style={{ lineHeight: "1.55" }}>
        {children}
      </div>

      <LegalFooter />
    </main>
  );
}

/** Company details and contacts, shown at the foot of every legal page. */
export function LegalFooter() {
  return (
    <footer className="mt-16 border-t pt-6 text-sm" style={{ ...mutedStyle, borderColor: "var(--c-line)" }}>
      <address className="not-italic space-y-2 leading-relaxed">
        <p>
          {COMPANY.tradingName} is a trading name of {COMPANY.legalName}, a company registered in{" "}
          {COMPANY.registeredIn}, company number {COMPANY.companyNumber}. Registered office:{" "}
          {COMPANY.registeredOffice}. Trading address: {COMPANY.tradingAddress}. VAT number {COMPANY.vatNumber}.
        </p>
        <p>
          Email <ContactEmail /> or message us on WhatsApp at <ContactWhatsApp />.
        </p>
      </address>
      <nav aria-label="Legal documents" className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
        {Object.values(LEGAL_DOCUMENTS).map((doc) => (
          <Link key={doc.id} href={doc.path} className="hover:underline" style={linkStyle}>
            {doc.title}
          </Link>
        ))}
      </nav>
    </footer>
  );
}

interface LegalSectionProps {
  id: string;
  title: string;
  children: ReactNode;
}

/** A numbered or titled section; the id gives each section a stable anchor. */
export function LegalSection({ id, title, children }: LegalSectionProps) {
  return (
    <section id={id} className="space-y-4">
      <h2 className="text-xl font-semibold" style={headingStyle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-6">{children}</ul>;
}

interface LegalTableProps {
  caption: string;
  head: readonly string[];
  rows: readonly (readonly ReactNode[])[];
}

/** A simple bordered table that scrolls sideways on a narrow screen. */
export function LegalTable({ caption, head, rows }: LegalTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {head.map((cell) => (
              <th
                key={cell}
                scope="col"
                className="border-b px-2 py-2 align-bottom font-semibold"
                style={{ ...headingStyle, borderColor: "var(--c-line-2)" }}
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className="border-b px-2 py-2 align-top"
                  style={{ borderColor: "var(--c-line)" }}
                >
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

export function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  const external = /^https?:\/\//.test(href);
  if (external) {
    return (
      <a href={href} className="hover:underline" style={linkStyle} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className="hover:underline" style={linkStyle}>
      {children}
    </Link>
  );
}

export function ContactEmail() {
  return (
    <a href={`mailto:${CONTACT.email}`} className="hover:underline" style={linkStyle}>
      {CONTACT.email}
    </a>
  );
}

export function ContactWhatsApp() {
  return (
    <a href={`https://wa.me/${CONTACT.whatsappE164.replace("+", "")}`} className="hover:underline" style={linkStyle}>
      {CONTACT.whatsappDisplay}
    </a>
  );
}
