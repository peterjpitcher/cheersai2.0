declare module "https://esm.sh/@supabase/supabase-js@2" {
  export * from "@supabase/supabase-js";
}

declare module "https://esm.sh/luxon@3.7.2" {
  export * from "luxon";
}

// text-to-svg has no bundled types. We use only loadSync + getD on the
// instance, so the surface we declare is intentionally narrow.
declare module "text-to-svg" {
  interface GenerationOptions {
    fontSize?: number;
    anchor?: string;
    x?: number;
    y?: number;
    kerning?: boolean;
    letterSpacing?: number;
    tracking?: number;
  }

  interface Metrics {
    x: number;
    y: number;
    baseline: number;
    width: number;
    height: number;
    ascender: number;
    descender: number;
  }

  class TextToSVG {
    static loadSync(filepath: string): TextToSVG;
    getD(text: string, options?: GenerationOptions): string;
    getSVG(text: string, options?: GenerationOptions): string;
    getMetrics(text: string, options?: GenerationOptions): Metrics;
    getWidth(text: string, options?: GenerationOptions): number;
    getHeight(fontSize: number): number;
  }

  export = TextToSVG;
}
