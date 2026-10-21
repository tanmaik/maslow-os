import type { App } from "@/lib/composio";
import type { Connection } from "@/lib/connections";

import { Avatar } from "@/components/base/avatar/avatar";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { initials } from "@/lib/initials";

import { AccountName } from "./account-name";
import { AppSearch } from "./app-search";
import { Row, Rows } from "./row";
import { Said } from "./said";
import { Section } from "./section";
import type { Told } from "./told";

// The apps the signed-in person has connected, as the vendor has them right
// now, each account under its app with the name the person gave it, and a
// way to connect more. Null for either list means the vendor did not
// answer.
export function Connections({
  enabled,
  connections,
  mostUsed,
  focus,
  said,
}: {
  enabled: boolean;
  connections: Connection[] | null;
  mostUsed: App[] | null;
  focus: string | null;
  said: Told;
}) {
  const apps = new Map<string, Connection[]>();
  for (const c of connections ?? [])
    apps.set(c.app, [...(apps.get(c.app) ?? []), c]);

  return (
    <Section id="apps" title="Connected apps">
      {!enabled ? (
        <p className="text-body-regular text-text-secondary">
          Connections are not set up on this deployment.
        </p>
      ) : (
        <>
          <Said {...said} />
          {connections === null ? (
            <p className="text-body-regular text-text-secondary">
              Composio didn&apos;t answer, so your connections can&apos;t be
              shown right now. Reload to try again.
            </p>
          ) : (
            apps.size > 0 && (
              <div className="flex flex-col gap-3">
                {[...apps.entries()].map(([slug, accounts]) => (
                  <div
                    key={slug}
                    data-app={slug}
                    className="flex flex-col gap-2"
                  >
                    <div className="flex items-center gap-2 px-3">
                      {accounts[0]!.logo ? (
                        <img
                          src={accounts[0]!.logo}
                          alt=""
                          className="size-5 shrink-0 object-contain"
                        />
                      ) : (
                        <Avatar
                          size="sm"
                          initials={initials(accounts[0]!.appName)}
                        />
                      )}
                      <p className="text-body-medium text-text-secondary">
                        {accounts[0]!.appName}
                      </p>
                    </div>
                    <Rows>
                      {accounts.map((c) => (
                        <Row
                          key={c.id}
                          label={
                            <AccountName
                              account={c.id}
                              name={c.name}
                              focus={c.id === focus}
                            />
                          }
                        >
                          {c.status !== "ACTIVE" && (
                            <Chip variant="caption" color="yellow">
                              {c.status.toLowerCase()}
                            </Chip>
                          )}
                          <form action="/settings/connections" method="post">
                            <input
                              type="hidden"
                              name="intent"
                              value="disconnect"
                            />
                            <input type="hidden" name="account" value={c.id} />
                            <Button
                              variant="secondary"
                              size="small"
                              type="submit"
                            >
                              Disconnect
                            </Button>
                          </form>
                        </Row>
                      ))}
                      <Row label={`Another ${accounts[0]!.appName} account`}>
                        <form
                          action="/settings/connections"
                          method="post"
                          target="_top"
                        >
                          <input type="hidden" name="intent" value="connect" />
                          <input type="hidden" name="app" value={slug} />
                          <Button
                            variant="secondary"
                            size="small"
                            type="submit"
                          >
                            Connect
                          </Button>
                        </form>
                      </Row>
                    </Rows>
                  </div>
                ))}
              </div>
            )
          )}
          <AppSearch mostUsed={mostUsed} />
        </>
      )}
    </Section>
  );
}
