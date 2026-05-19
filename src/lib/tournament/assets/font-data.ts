// Barrel re-export — each font lives in its own file to stay under webpack's
// per-module size threshold (WasmHash crashes on ~300 KB+ modules on Vercel).

export { OSWALD_500_SHA256, OSWALD_500_SIZE_BYTES, OSWALD_500_TTF_BASE64 } from './font-oswald-500';
export { OSWALD_600_SHA256, OSWALD_600_SIZE_BYTES, OSWALD_600_TTF_BASE64 } from './font-oswald-600';
export { OSWALD_700_SHA256, OSWALD_700_SIZE_BYTES, OSWALD_700_TTF_BASE64 } from './font-oswald-700';
export { INTER_500_SHA256, INTER_500_SIZE_BYTES, INTER_500_TTF_BASE64 } from './font-inter-500';
export { INTER_600_SHA256, INTER_600_SIZE_BYTES, INTER_600_TTF_BASE64 } from './font-inter-600';
