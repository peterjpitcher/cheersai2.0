# Wave 2 / Server renderer — Handoff

## Outputs
- src/lib/banner/render-server.ts
- src/lib/banner/render-server.test.ts
- tests/fixtures/banner/square-1080.jpg
- tests/fixtures/banner/portrait-1080-1350.jpg
- tests/fixtures/banner/story-1080-1920.jpg
- Commit: 8f67a9df829cfb3a02988e8f489cb6a9c9e96621 feat(banner): add renderBannerServer

## Exported signature
`renderBannerServer(source: Buffer, config: ResolvedConfig, label: string): Promise<Buffer>`

## Format
TypeScript Sharp-based renderer + Vitest integration tests + JPEG fixtures.

## Assumptions
- Sharp is already a dependency (^0.34.5 confirmed in package.json) — used directly with no wrapper.
- The plan's fixture-generation script used a top-level `await`, which `tsx` rejects under CJS output. Wrapped the calls in an `async main()` for the one-off run; the script was deleted before commit, so this deviation is not committed and has no downstream impact.
- `ResolvedConfig` imported as a type from `@/lib/banner/config` (matches Wave 1 export).
- Fixtures are committed solid-colour blue 3-channel JPEGs at quality 85 (per plan); ~5–13 KB each, well under the size threshold for committed test data.
- Byte-stability holds because: SVG is built deterministically from inputs, no timestamps or random IDs are emitted, and `mozjpeg: false` + `quality: 92` are pinned in the JPEG encoder options.

## Issues
- None. Tests pass (4/4), typecheck clean, lint clean.

## Downstream notes
- Wave 3 worker-and-cleanup agent: import `renderBannerServer` from `@/lib/banner/render-server` in the publish worker.
- The function throws `BANNER_RENDER_FAILED: source has no dimensions` on undecodable input; the worker should catch and mark the job failed.
- The function does not consult `config.enabled` — the caller decides whether to render. If `enabled === false`, do not call `renderBannerServer` at all.
- The function does not consult `config.textOverride` — the caller resolves the final label string and passes it as the `label` arg.
- `mozjpeg: false` and `quality: 92` are pinned for byte-stability; do not change without updating the byte-stable test.
- `failOn: 'error'` is set on the input pipeline, so a corrupted source JPEG will reject rather than silently produce garbage.
- The strip sizing rule is dimension-driven (height > width × 1.5 → 6% short side, else 8%), so callers don't need to pass platform hints — feed the buffer in any aspect ratio and the function adapts.
