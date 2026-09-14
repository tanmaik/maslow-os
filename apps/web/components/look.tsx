// Which look the page wears, kept on the device: light, dark, or absent
// for the device's own.
export const LOOK = "look";
export type Look = "system" | "light" | "dark";
const KEY = LOOK;
export const ACCENT = "accent";

// The colours the product may spend on what a person should look at, by
// their hue and how much of it; the orange unless the person picks another.
export const ACCENTS = {
  orange: { hue: 42, chroma: 0.163 },
  red: { hue: 22, chroma: 0.17 },
  pink: { hue: 350, chroma: 0.16 },
  purple: { hue: 305, chroma: 0.15 },
  blue: { hue: 255, chroma: 0.15 },
  teal: { hue: 200, chroma: 0.11 },
  green: { hue: 150, chroma: 0.13 },
  graphite: { hue: 60, chroma: 0.012 },
} as const;
export type Accent = keyof typeof ACCENTS;

// Set on the root before the first paint, so nobody sees the other look
// flash past, and set again whenever the choice changes anywhere: a pick
// made in Settings reaches the desk and every window on it at once, and
// the device's own change of look is followed. Its own script, not React,
// which runs too late for the first paint.
export const beforePaint = `(function(){function a(){try{var k=localStorage.getItem("${KEY}");var d=k==="dark"||(k!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);var c=localStorage.getItem("${ACCENT}");if(c)document.documentElement.dataset.accent=c;else delete document.documentElement.dataset.accent}catch(e){}}a();addEventListener("storage",a);try{matchMedia("(prefers-color-scheme: dark)").addEventListener("change",a)}catch(e){}})()`;
