// Mock for @ffmpeg/ffmpeg — used by Deno Edge Functions but not available in Node/Vitest
export function createFFmpeg() {
  return {
    load: async () => {},
    run: async () => {},
    FS: () => new Uint8Array(),
    isLoaded: () => false,
  };
}

export function fetchFile() {
  return new Uint8Array();
}
