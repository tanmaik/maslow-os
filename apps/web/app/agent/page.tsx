import { redirect } from "next/navigation";

import { NewConversation } from "@/components/agent/new-conversation";
import { deployment } from "@/lib/deployment";
import { defaultModel, offered } from "@/lib/models";
import { principal } from "@/lib/session";

// A conversation not yet begun: the headline and the composer.
export default async function NewAgentPage() {
  const p = await principal();
  if (!p) redirect("/");
  const models = offered();
  return (
    <NewConversation
      models={models.map((m) => ({ id: m.id, label: m.label }))}
      defaultModel={defaultModel().id}
      faked={models.length === 0 && !deployment.production}
    />
  );
}
