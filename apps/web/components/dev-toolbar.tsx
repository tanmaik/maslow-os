import { Annotations } from "@/components/annotations";
import { deployment } from "@/lib/deployment";

// The one thing a developer wants at hand off production: a way to mark the
// page for the agent. Renders nothing in production.
export function DevToolbar() {
  if (deployment.production) return null;
  return <Annotations />;
}
