import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // next/image refuses to render any external src whose host isn't listed
  // here. PublicMenuItem.imageUrl now points at the project's own Supabase
  // Storage public object URL (packages/shared/src/storage/menuImages.ts's
  // menuImagePublicUrl) instead of the pre-WBS-3.8 raw storage path, so both
  // the deployed project host (*.supabase.co) and the local dev stack
  // (127.0.0.1:54321, see packages/shared/src/config.ts's
  // assertLocalSupabaseInDev) need an entry. Scoped to the menu-images
  // bucket's own path prefix — this app never renders any other bucket.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/menu-images/**",
      },
      {
        protocol: "http",
        hostname: "127.0.0.1",
        port: "54321",
        pathname: "/storage/v1/object/public/menu-images/**",
      },
    ],
    // Next.js 16 added a default SSRF guard that blocks image optimization
    // for any host resolving to a private/local IP, even one already listed
    // in remotePatterns above. The only remotePatterns entry this could ever
    // match is the hardcoded 127.0.0.1:54321 local-dev entry (production
    // only ever serves from *.supabase.co, a public host) -- so this doesn't
    // widen the allow-list, it just stops that one already-whitelisted local
    // entry from being blocked a second time. Without this, local dev's
    // menu photos 400 at /_next/image with "url parameter is not allowed"
    // even though remotePatterns matches.
    dangerouslyAllowLocalIP: true,
  },
};

export default nextConfig;
