// What the desktop lies on. The built-ins ship with the app, so nothing a
// person does can take them away; each is a few kilobytes of gradient and
// grain, drawn crisp at any size. "Plain" is the bare warm ground, and is
// also what the desktop falls back to when a picture will not load.

export type Paper = {
  // The name the choice is kept under.
  id: string;
  // What the person reads under the tile.
  name: string;
  // The file it is drawn from; null is the bare ground.
  src: string | null;
};

export const PAPERS: Paper[] = [
  { id: "dusk", name: "Dusk", src: "/wallpapers/dusk.svg" },
  { id: "dawn", name: "Dawn", src: "/wallpapers/dawn.svg" },
  { id: "ember", name: "Ember", src: "/wallpapers/ember.svg" },
  { id: "amber", name: "Amber", src: "/wallpapers/amber.svg" },
  { id: "clay", name: "Clay", src: "/wallpapers/clay.svg" },
  { id: "rose", name: "Rose", src: "/wallpapers/rose.svg" },
  { id: "moss", name: "Moss", src: "/wallpapers/moss.svg" },
  { id: "sand", name: "Sand", src: "/wallpapers/sand.svg" },
  { id: "plain", name: "Plain", src: null },
];

// One wallpaper of the person's own, as the room and the picker read it.
export type Kept = { key: string; url: string; bytes: number };

// What a person has to choose from beyond the built-ins, and what they
// are wearing.
export type Papers = { choice: string | null; own: Kept[] };

// The one a desktop wears until the person picks another.
export const DEFAULT_PAPER = "dusk";

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
