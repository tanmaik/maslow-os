// Connections' part of the merge gate, through the pages as a browser would,
// against the pretend vendor: an app is found and connected, a sign-in is
// vouched for by whoever began it and nobody else, the connection is its
// owner's alone, disconnecting deletes it at the vendor, and so does being
// removed from the org. Returns true when every check passed.
import { orgs } from "../packages/db/src/seed.ts";

export async function smokeConnections(stack, signIn) {
  let ok = true;
  const check = (label, pass, detail) => {
    console.log(
      `${pass ? "ok  " : "FAIL"}  connections: ${label.padEnd(28)} ${detail}`,
    );
    ok &&= pass;
  };
  const settings = async (cookie, query = "") =>
    (
      await fetch(`${stack.url}/settings${query}`, { headers: { cookie } })
    ).text();
  const post = (cookie, body) =>
    fetch(`${stack.url}/settings/connections`, {
      method: "POST",
      headers: { cookie },
      body: new URLSearchParams(body),
      redirect: "manual",
    });

  // An app is connected when its accounts row is on the page; the finder
  // lists every app whether or not it is.
  const holds = (page, app) => page.includes(`data-app="${app}"`);

  const bakery = orgs[1];
  const marge = await signIn(bakery.users[0].id);
  const otto = await signIn(bakery.users[1].id);

  const searched = await (
    await fetch(`${stack.url}/settings/connections/apps?q=pige`, {
      headers: { cookie: marge },
    })
  ).json();
  check(
    "an app is found",
    searched.length === 1 && searched[0].name === "Carrier Pigeon",
    "Carrier Pigeon, not Sundial",
  );

  // Connecting sends the browser to the vendor's sign-in, which sends it
  // back to be vouched for; the outcome is the vendor's word once told who
  // is signed in here.
  const begun = await post(marge, { intent: "connect", app: "pigeon" });
  const signInUrl = begun.headers.get("location") ?? "";
  const returned = await fetch(signInUrl, {
    headers: { cookie: marge },
    redirect: "manual",
  });
  const landed = returned.headers.get("location") ?? "";
  const after = await settings(marge);
  const mine = after.match(/name="account" value="(pretend_[0-9a-f]{8})"/)?.[1];
  check(
    "an app connects",
    begun.status === 303 &&
      signInUrl.includes("/settings/connections/verify?session_uri=") &&
      landed.endsWith(`/settings?connection=connected&account=${mine}`) &&
      holds(after, "pigeon"),
    `began ${begun.status}, landed ${landed.split("?")[1] ?? landed}`,
  );

  // A second account in the same app, and a name for each; two accounts in
  // one app cannot share a name.
  const second = await post(marge, { intent: "connect", app: "pigeon" });
  const secondLanded = await fetch(second.headers.get("location"), {
    headers: { cookie: marge },
    redirect: "manual",
  });
  const other = secondLanded.headers
    .get("location")
    ?.match(/account=(pretend_[0-9a-f]{8})/)?.[1];
  const outcome = async (body) =>
    (await post(marge, body)).headers.get("location")?.split("connection=")[1];
  const named = await outcome({
    intent: "rename",
    account: mine,
    name: "work",
  });
  const clashed = await outcome({
    intent: "rename",
    account: other,
    name: "work",
  });
  const namedToo = await outcome({
    intent: "rename",
    account: other,
    name: "home",
  });
  const both = await settings(marge);
  check(
    "two accounts in one app, each named",
    other &&
      other !== mine &&
      named === "renamed" &&
      clashed === "taken" &&
      namedToo === "renamed" &&
      both.includes('value="work"') &&
      both.includes('value="home"'),
    `named ${named}, clashed ${clashed}, then ${namedToo}`,
  );
  await post(marge, { intent: "disconnect", account: other });

  // Otto begins a sign-in and Marge finishes it: the vendor is told Marge
  // did it, which is not who it was for, so it fails and nobody gets it.
  const lured = await post(otto, { intent: "connect", app: "sundial" });
  const forged = await fetch(lured.headers.get("location"), {
    headers: { cookie: marge },
    redirect: "manual",
  });
  check(
    "a sign-in begun for someone else fails",
    (forged.headers.get("location") ?? "").endsWith("connection=failed") &&
      !holds(await settings(marge), "sundial") &&
      (await settings(otto)).includes(">failed<"),
    `answered ${forged.headers.get("location")?.split("?")[1]}`,
  );

  // On a project without a verifier the browser comes back naming the
  // account; it has to be the signed-in membership's at the vendor.
  const callback = (cookie) =>
    fetch(
      `${stack.url}/settings/connections/callback?status=success&connected_account_id=${mine}`,
      { headers: { cookie }, redirect: "manual" },
    );
  check(
    "the callback takes nobody else's account",
    ((await callback(otto)).headers.get("location") ?? "").endsWith(
      "connection=gone",
    ) &&
      ((await callback(marge)).headers.get("location") ?? "").endsWith(
        `connection=connected&account=${mine}`,
      ),
    "gone for Otto, connected for Marge",
  );

  check(
    "a connection is its owner's alone",
    !holds(await settings(otto), "pigeon"),
    "Otto sees none",
  );

  const id = mine;
  const stolen = await post(otto, { intent: "disconnect", account: id });
  check(
    "nobody else disconnects it",
    stolen.status === 303 &&
      (stolen.headers.get("location") ?? "").endsWith("connection=gone") &&
      holds(await settings(marge), "pigeon"),
    `answered ${stolen.headers.get("location")?.split("?")[1]}`,
  );

  const ended = await post(marge, { intent: "disconnect", account: id });
  const again = await post(marge, { intent: "disconnect", account: id });
  check(
    "disconnecting deletes it at the vendor",
    ended.status === 303 &&
      (ended.headers.get("location") ?? "").endsWith(
        "connection=disconnected",
      ) &&
      !holds(await settings(marge), "pigeon") &&
      (again.headers.get("location") ?? "").endsWith("connection=gone"),
    `answered ${ended.headers.get("location")?.split("?")[1]}, then ${again.headers.get("location")?.split("?")[1]}`,
  );
  // Otto connects an app and is removed; brought back, he has no
  // connections, since access to his apps ended with his membership.
  const ottoBegun = await post(otto, { intent: "connect", app: "sundial" });
  await fetch(ottoBegun.headers.get("location"), {
    headers: { cookie: otto },
    redirect: "manual",
  });
  const hadSundial = holds(await settings(otto), "sundial");
  const members = (body) =>
    fetch(`${stack.url}/settings/members`, {
      method: "POST",
      headers: { cookie: marge },
      body: new URLSearchParams(body),
      redirect: "manual",
    });
  await members({ remove: bakery.users[1].id });
  await members({ restore: bakery.users[1].id });
  const ottoBack = await signIn(bakery.users[1].id);
  check(
    "removal disconnects their apps",
    hadSundial && !holds(await settings(ottoBack), "sundial"),
    hadSundial ? "Sundial gone after removal" : "Sundial never connected",
  );
  return ok;
}
