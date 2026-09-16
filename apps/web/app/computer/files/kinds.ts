// What a thing in the person's home is, by its name: the kinds Files
// lists and the Preview window shows, and the addresses a file is read
// and pictured at.

// One thing in a folder, as the door lists it.
export type Entry = {
  name: string;
  kind: "dir" | "file" | "link" | "other";
  size: number;
  modified: string;
};

// The most text the editor takes into the tab. Past this a file is opened
// rather than read here, so a huge log never freezes the window.
export const MOST_TEXT = 2 * 1024 * 1024;

const TEXT = new Set([
  "txt",
  "md",
  "json",
  "js",
  "mjs",
  "ts",
  "tsx",
  "css",
  "html",
  "sh",
  "py",
  "yml",
  "yaml",
  "toml",
  "env",
  "gitignore",
  "csv",
  "log",
  "xml",
  "sql",
]);
const IMAGE = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "avif",
  "heic",
  "tif",
  "tiff",
  "bmp",
]);
const VIDEO = new Set(["mp4", "m4v", "mov", "webm", "mkv"]);
const AUDIO = new Set(["mp3", "m4a", "wav", "ogg", "flac", "aac", "opus"]);
const DOCUMENT = new Set([
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "odp",
  "rtf",
]);

export const ending = (name: string) =>
  name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
// A link is followed: until the door says what it points at, it is looked
// at as a file is.
const opens = (e: Entry) => e.kind === "file" || e.kind === "link";
export const isText = (e: Entry) => opens(e) && TEXT.has(ending(e.name));
export const isImage = (e: Entry) => opens(e) && IMAGE.has(ending(e.name));
export const isVideo = (e: Entry) => opens(e) && VIDEO.has(ending(e.name));
export const isAudio = (e: Entry) => opens(e) && AUDIO.has(ending(e.name));
// A file of no known kind: worth a read as text, if its bytes are text.
export const isUnknown = (e: Entry) =>
  opens(e) &&
  !isText(e) &&
  !isImage(e) &&
  !isVideo(e) &&
  !isAudio(e) &&
  !isPdf(e) &&
  !isDocument(e);
// Whether what was read is text a person can edit: no NUL in it.
export const looksLikeText = (s: string) => !s.includes("\u0000");
export const isPdf = (e: Entry) => opens(e) && ending(e.name) === "pdf";
export const isDocument = (e: Entry) =>
  opens(e) && DOCUMENT.has(ending(e.name));

// Bytes in words a person reads at a glance.
export const size = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 ** 2
      ? `${(n / 1024).toFixed(0)} KB`
      : n < 1024 ** 3
        ? `${(n / 1024 ** 2).toFixed(1)} MB`
        : `${(n / 1024 ** 3).toFixed(2)} GB`;

export const readHref = (path: string) =>
  `/computer/files/read?path=${encodeURIComponent(path)}`;
export const previewHref = (path: string, modified: string) =>
  `/computer/files/preview?path=${encodeURIComponent(path)}&v=${encodeURIComponent(modified)}`;
export const pdfHref = (path: string, modified: string) =>
  `/computer/files/pdf?path=${encodeURIComponent(path)}&v=${encodeURIComponent(modified)}`;
