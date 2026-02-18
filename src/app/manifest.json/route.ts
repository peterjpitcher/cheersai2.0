import { NextResponse } from "next/server";

const MANIFEST = {
  name: "CheersAI Command Centre",
  short_name: "CheersAI",
  start_url: "/login",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#0f172a",
  icons: [
    {
      src: "/favicon.ico",
      sizes: "48x48",
      type: "image/x-icon",
    },
  ],
} as const;

export function GET() {
  return NextResponse.json(MANIFEST, {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}
