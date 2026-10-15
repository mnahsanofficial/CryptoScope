import type { NextConfig } from "next";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
const apiOrigin = new URL(apiUrl).origin;
const socketOrigin = apiOrigin.replace(/^http/, "ws");
const isProduction = process.env.NODE_ENV === "production";

/**
 * Content-Security-Policy: the browser may only run scripts from this site and only talk to our API.
 * This limits what an injected script could do (e.g. send a stolen token to another server).
 * Next.js needs inline scripts for hydration and the dev server needs eval, hence those two allowances.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self' ${apiOrigin} ${socketOrigin}${isProduction ? "" : " ws://localhost:*"}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // Produces .next/standalone with a minimal server.js, so the Docker image needs no full node_modules.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false, // don't advertise the framework
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
