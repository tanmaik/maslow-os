import type { MetadataRoute } from "next";

// What a phone needs to put Maslow on its home screen as an app of its
// own: a name, a start page, no browser chrome, and icons.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Maslow",
    short_name: "Maslow",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
