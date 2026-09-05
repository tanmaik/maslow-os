import { type Identity, identity } from "@placeholder/db/auth";

import { deployment } from "./deployment.ts";

const API = "https://api.workos.com/user_management";

function credentials() {
  if (deployment.identity.kind !== "workos")
    throw new Error("WorkOS is not the identity provider.");
  return deployment.identity;
}

async function call<T>(path: string, body: Record<string, string>): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credentials().apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as {
      code?: string;
      error?: string;
      error_description?: string;
    };
    throw new WorkOSError(
      res.status,
      detail.code ?? detail.error ?? "unknown",
      detail.error_description,
    );
  }
  return res.json() as Promise<T>;
}

export class WorkOSError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, description?: string) {
    super(`WorkOS ${status} ${code}${description ? `: ${description}` : ""}`);
    this.status = status;
    this.code = code;
  }
}

// Mints a six-digit code for the address and returns it; mailing it is ours to
// do. WorkOS creates the person on their first successful code, so unknown
// addresses are welcome.
export async function createCode(email: string): Promise<string> {
  const { code } = await call<{ code: string }>("/magic_auth", { email });
  return code;
}

type User = {
  email: string;
  first_name: string | null;
  last_name: string | null;
};

// Trades the code back for who WorkOS says holds the address.
export async function redeemCode(
  email: string,
  code: string,
): Promise<Identity> {
  const { user } = await call<{ user: User }>("/authenticate", {
    client_id: credentials().clientId,
    client_secret: credentials().apiKey,
    grant_type: "urn:workos:oauth:grant-type:magic-auth:code",
    email,
    code,
  });
  return identity(user.email, user.first_name, user.last_name, null);
}
