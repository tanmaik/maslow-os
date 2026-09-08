import { asOrg } from "@placeholder/db";
import { computerOf } from "@placeholder/db/computers";
import { redirect } from "next/navigation";

import { Making } from "@/app/computer/making";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { progressOf } from "@/lib/computer";
import { deployment } from "@/lib/deployment";
import { sizeOf } from "@/lib/sizes";
import { principal } from "@/lib/session";

// The person's computer: made for them at sign-in, shown here as it comes
// up, and then ready.
export default async function ComputerPage() {
  const p = await principal();
  if (!p) redirect("/");
  const off = deployment.computers.kind === "none";
  const c = off ? null : await asOrg(p.orgId, (q) => computerOf(q, p.userId));
  return (
    <>
      <main className="space-y-4">
        <h1 className="text-2xl font-semibold">Computer</h1>
        {off ? (
          <Alert>
            <AlertTitle>Computers are off here</AlertTitle>
            <AlertDescription>
              This deployment has no Fly token, so nobody gets a computer.
            </AlertDescription>
          </Alert>
        ) : (
          <Making
            at={c ? progressOf(c) : "disk"}
            region={c?.region ?? null}
            size={c ? sizeOf(c) : null}
            backedUp={
              deployment.storage.kind === "s3"
                ? (c?.backedUpAt?.toISOString() ?? null)
                : "off"
            }
          />
        )}
      </main>
    </>
  );
}
