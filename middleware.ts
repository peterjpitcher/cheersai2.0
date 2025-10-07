import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const APEX_HOST = "cheersai.uk";
const WWW_HOST = "www.cheersai.uk";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host");
  if (!host) {
    return NextResponse.next();
  }

  if (host.toLowerCase() === APEX_HOST) {
    const url = request.nextUrl.clone();
    url.host = WWW_HOST;
    return NextResponse.redirect(url, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|manifest.webmanifest|sitemap.xml).*)",
  ],
};
