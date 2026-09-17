import type { NextConfig } from "next";

/**
 * The repository is named `personal`, so GitHub Pages serves this site from
 * https://suhailk-k.github.io/personal rather than the domain root. Without
 * `basePath` every asset and link resolves one level too high and 404s.
 *
 * `basePath` is applied in development too. Keeping the two environments
 * identical costs one path segment locally and avoids the failure mode where
 * routing works on localhost and breaks only once deployed.
 */
const BASE_PATH = "/personal";

const nextConfig: NextConfig = {
  // Pages is static hosting: no server, no API routes, no middleware.
  output: "export",
  basePath: BASE_PATH,
  // Pages cannot run the image optimizer, which needs a server.
  images: { unoptimized: true },
  // Emit `about/index.html` rather than `about.html` so Pages resolves
  // directory-style URLs without a redirect.
  trailingSlash: true,
};

export default nextConfig;
