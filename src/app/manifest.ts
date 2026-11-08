import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bajar",
    short_name: "Bajar",
    description: "Real-time multi-chain crypto marketplace and noncustodial wallet.",
    start_url: "/",
    display: "standalone",
    background_color: "#1f1e1d",
    theme_color: "#1f1e1d",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
