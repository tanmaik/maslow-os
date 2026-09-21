import type { Cloud } from "./clouds.ts";
import { aws } from "./clouds/aws.ts";
import { fly } from "./clouds/fly.ts";
import { deployment } from "./deployment.ts";

// The cloud this deployment's computers are on. A deployment has one kind:
// the managed product rents them from Fly, and a customer who hosts Maslow
// makes them in their own AWS account.
export const cloud: Cloud = deployment.computers.kind === "aws" ? aws : fly;
