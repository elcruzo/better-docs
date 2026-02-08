import { NextRequest, NextResponse } from "next/server";

/**
 * Subdomain routing middleware.
 *
 * Requests arriving at <slug>.better-docs.xyz are internally rewritten
 * to /docs/<slug> so the public docs page handles them.
 *
 * The ROOT_DOMAIN env var controls the apex domain (default: better-docs.xyz).
 * In local dev, subdomains aren't used — visit /docs/<slug> directly.
 */

const ROOT_DOMAIN = process.env.ROOT_DOMAIN || "better-docs.xyz";

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") || "";
  const hostname = host.split(":")[0]; // strip port

  // Only intercept if the hostname is a subdomain of ROOT_DOMAIN
  if (hostname.endsWith(`.${ROOT_DOMAIN}`) && hostname !== ROOT_DOMAIN && hostname !== `www.${ROOT_DOMAIN}`) {
    const slug = hostname.replace(`.${ROOT_DOMAIN}`, "");

    // Don't rewrite API routes or _next assets
    const { pathname } = req.nextUrl;
    if (pathname.startsWith("/api/") || pathname.startsWith("/_next/") || pathname.startsWith("/favicon")) {
      return NextResponse.next();
    }

    // Rewrite to /docs/[slug] + preserve the rest of the path
    const url = req.nextUrl.clone();
    url.pathname = `/docs/${slug}${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except static assets and API internals
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
