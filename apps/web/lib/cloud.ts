import type { Cloud } from "./clouds.ts";
import { fly } from "./clouds/fly.ts";

// The cloud this deployment's computers are on.
export const cloud: Cloud = fly;
