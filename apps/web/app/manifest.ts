import type { MetadataRoute } from "next";

// What a phone needs to put Maslow on its home screen as an app of its
// own: a name, a start page, no browser chrome, and icons.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Maslow",
    short_name: "Maslow",
    start_url: "/",
    display: "standalone",
    // The desk is dark, so the screen a phone shows while it opens is
    // dark: a white flash is the one moment an app looks like a web page.
    background_color: "#1c1815",
    theme_color: "#1c1815",
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
