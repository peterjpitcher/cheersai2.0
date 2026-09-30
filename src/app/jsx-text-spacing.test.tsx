import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadBindings, transform } from "next/dist/build/swc/index.js";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * `next build` compiles JSX with SWC, which drops the leading space of a JSX
 * text run when that run contains an HTML entity and carries on to another
 * line. So `{COMPANY.legalName} (&ldquo;we&rdquo;, ...` followed by a line
 * break went live as "Orange Jelly Limited(“we”". Vitest compiles JSX with a
 * different compiler that keeps the space, so an ordinary render test passes
 * either way: these tests compile the pages with Next's own SWC first.
 *
 * Node environment on purpose: the jsdom environment refuses to import the
 * compiled page from the temporary folder.
 */

const SRC = path.resolve(__dirname, "..");
const workDir = mkdtempSync(path.join(realpathSync(tmpdir()), "cheers-swc-"));
/** The compiled page lives outside the project, so its JSX runtime import must name React by path. */
const REACT_DIR = path.dirname(createRequire(import.meta.url).resolve("react/package.json"));

/** Compiles a page the way `next build` does, then imports the result. */
async function buildPage(relativePath: string): Promise<ComponentType> {
  const source = readFileSync(path.join(SRC, relativePath), "utf8");
  const { code } = (await transform(source, {
    filename: relativePath,
    jsc: {
      parser: { syntax: "typescript", tsx: true },
      target: "es2022",
      transform: { react: { runtime: "automatic", importSource: REACT_DIR } },
    },
    module: { type: "es6" },
  })) as { code: string };
  const file = path.join(workDir, `${relativePath.replace(/[^a-z0-9]+/gi, "-")}.js`);
  writeFileSync(file, code);
  const mod = (await import(/* @vite-ignore */ file)) as { default: ComponentType };
  return mod.default;
}

/** The page's visible text: tags removed and React's escapes undone. */
function textOf(Page: ComponentType): string {
  return renderToStaticMarkup(<Page />)
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

beforeAll(async () => {
  await loadBindings();
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("the legal pages as `next build` compiles them", () => {
  it("the terms keep the space after the company name and after the DPA link", async () => {
    const text = textOf(await buildPage("app/terms/page.tsx"));
    expect(text).toContain("These terms are the agreement between Orange Jelly Limited (“we”, “us”) and the business");
    expect(text).toContain("Our Data Processing Agreement covers the personal data we handle for you");
  });

  it("the data processing agreement keeps the space after the company name and after bold lead-ins", async () => {
    const text = textOf(await buildPage("app/data-processing/page.tsx"));
    expect(text).toContain("This agreement is between Orange Jelly Limited (“we”, the processor) and the business");
    expect(text).toContain("Other help. We help you with security");
    expect(text).toContain("Not sub-processors. Stripe takes payments");
  });
});

/** Any HTML entity: named (&rsquo;), decimal (&#39;) or hex (&#x27;). */
const ENTITY = /&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

describe("JSX text in src/", () => {
  it("never has the shape whose leading space the build drops (use {\" \"} before the text instead)", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node): void => {
        if (node.kind === ts.SyntaxKind.JsxText) {
          const raw = source.slice(node.pos, node.end);
          const firstLine = raw.split("\n")[0];
          if (raw.includes("\n") && ENTITY.test(raw) && /^[ \t]+\S/.test(firstLine)) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(node.pos);
            offenders.push(`${path.relative(SRC, file)}:${line + 1}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }
    expect(offenders).toEqual([]);
  });
});
