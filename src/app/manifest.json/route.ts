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
    {
      src: "/brand/cheers-icon-192.png",
      sizes: "192x192",
      type: "image/png",
    },
    {
      src: "/brand/cheers-icon-512.png",
      sizes: "512x512",
      type: "image/png",
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
