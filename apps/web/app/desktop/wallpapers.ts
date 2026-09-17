// What the desktop lies on. The built-ins ship with the app, so nothing a
// person does can take them away: nine photographs, free to use, each from
// an original at least 4000 pixels wide, cut to 2560 by 1600 and a few
// hundred kilobytes, and credited on the tile and in NOTICE; the picker
// draws its tiles from a small copy of each, under `small/`. "Plain" is
// the bare warm ground, and is also what the desktop falls back to when a
// picture will not load.

export type Paper = {
  // The name the choice is kept under.
  id: string;
  // What the person reads under the tile.
  name: string;
  // The file it is drawn from; null is the bare ground.
  src: string | null;
  // Who made the picture, and on what terms, read under the name.
  credit?: string;
};

export const PAPERS: Paper[] = [
  {
    id: "carina",
    name: "Carina",
    src: "/wallpapers/carina.jpg",
    credit: "NASA, ESA, CSA, STScI · public domain",
  },
  {
    id: "aurora",
    name: "Aurora",
    src: "/wallpapers/aurora.jpg",
    credit: "Aneta P. · CC BY 4.0",
  },
  {
    id: "milkyway",
    name: "Milky Way",
    src: "/wallpapers/milkyway.jpg",
    credit: "ESO / H. H. Heyer · CC BY 4.0",
  },
  {
    id: "peak",
    name: "Matterhorn",
    src: "/wallpapers/peak.jpg",
    credit: "Willi Winzig · CC BY 2.0",
  },
  {
    id: "falls",
    name: "Skógafoss",
    src: "/wallpapers/falls.jpg",
    credit: "Matthew Roth · CC BY 2.0",
  },
  {
    id: "fog",
    name: "Fog",
    src: "/wallpapers/fog.jpg",
    credit: "Annie Spratt · CC0",
  },
  {
    id: "surf",
    name: "Surf",
    src: "/wallpapers/surf.jpg",
    credit: "Christian Ferrer · CC BY 4.0",
  },
  {
    id: "volcano",
    name: "Lava",
    src: "/wallpapers/volcano.jpg",
    credit: "Rennett Stowe · CC BY 2.0",
  },
  {
    id: "skyline",
    name: "Brooklyn",
    src: "/wallpapers/skyline.jpg",
    credit: "Martin St-Amant · CC BY 3.0",
  },
  { id: "plain", name: "Plain", src: null },
];

// One wallpaper of the person's own, as the room and the picker read it.
export type Kept = { key: string; url: string; bytes: number };

// What a person has to choose from beyond the built-ins, and what they
// are wearing.
export type Papers = { choice: string | null; own: Kept[] };

// The one a desktop wears until the person picks another.
export const DEFAULT_PAPER = "carina";

// A person's own wallpaper is chosen by its object's key.
const keyOf = (choice: string | null): string | null =>
  choice?.startsWith("own:") ? choice.slice(4) : null;

// The picture a choice draws: a built-in's file, a person's own object, or
// null for the bare ground, which is what an unknown choice comes to.
export function srcOf(choice: string | null): string | null {
  const key = keyOf(choice);
  if (key) return `/uploads/${key}`;
  const id = choice ?? DEFAULT_PAPER;
  return PAPERS.find((p) => p.id === id)?.src ?? null;
}
