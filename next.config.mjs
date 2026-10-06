/**
 * Orígenes que pueden mostrar la app dentro de un iframe (app "full screen" embebida en Procore).
 * Se puede ampliar con PROCORE_EMBED_ORIGINS (separados por espacios). Se evalúa en el build.
 */
const frameAncestors = ["'self'", ...(process.env.PROCORE_EMBED_ORIGINS || "https://*.procore.com https://procore.com").split(/\s+/).filter(Boolean)];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Solo Procore (y la propia app) pueden incrustarla; cualquier otro sitio queda bloqueado.
          { key: "Content-Security-Policy", value: `frame-ancestors ${frameAncestors.join(" ")}` },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
