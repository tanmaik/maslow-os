import path from "node:path";
import { fileURLToPath } from "node:url";

// The checkout these scripts belong to.
export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
