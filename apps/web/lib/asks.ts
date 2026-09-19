import {
  acceptRequest,
  declineRequest,
  Invalid,
  type Subject,
  type Target,
} from "@maslow/brain";
import type { Query } from "@maslow/db";
import type { Principal } from "@maslow/db/auth";
import { computerOf, givePort } from "@maslow/db/computers";
import { answerRequestNotification } from "@maslow/db/notifications";
import type {
  SharedFile,
  Subject as FileSubject,
} from "@maslow/db/shared-files";

import { tellPublic } from "./computer.ts";
import { giveSharedFile, unmarked } from "./shares.ts";

// Answering an ask to share, wherever the person answers it: the brain's
// pages or the panel behind the clock. Accepting makes every share the ask
// names, in the person's name, and hands over any port, file or folder it
// names on their own computer; either answer marks the notification that
// carried it, so one ask never waits in two places. Answers with the
// notification that carried the ask, what accepting shared and with whom,
// and the files it handed over, for telling whoever they reached.
export async function answerShareAsk(
  q: Query,
  p: Principal,
  request: string,
  said: "accept" | "decline",
): Promise<{
  notification: string | null;
  shared: Target[];
  subjects: Subject[];
  files: { file: SharedFile; to: FileSubject }[];
}> {
  // The notification is marked first: answering takes the request away, and a
  // notification pointing at a request that is gone no longer knows which one it
  // carried. A refusal below rolls the whole answer back.
  const notification = await answerRequestNotification(
    q,
    request,
    said === "accept" ? "Accept" : "Decline",
  );
  const files: { file: SharedFile; to: FileSubject }[] = [];
  // The marks an ask makes on the disk outlive a transaction that rolls
  // back, so those made for nothing are undone before the refusal is
  // passed on.
  const marked: { file: SharedFile; had: boolean }[] = [];
  if (said === "accept") {
    try {
      const made = await acceptRequest(
        q,
        request,
        async (port, to) => {
          const c = await computerOf(q, p.userId);
          if (!c) throw new Invalid("you have no computer to give a port of");
          await givePort(q, c.id, port, to);
          // A port made public opens at the door, which has to hear of it.
          if (to.who === "public") await tellPublic(q, c);
        },
        async (path, to, level) => {
          const at = pathOnHome(path);
          if (at === null) throw new Invalid(`${path} is not in your home`);
          if (to.who === "public")
            throw new Invalid("only a port can be made public");
          const gave = await giveSharedFile(q, p, at, to, level);
          marked.push(gave);
          files.push({ file: gave.file, to });
        },
      );
      return { notification, ...made, files };
    } catch (err) {
      await unmarked(p, marked);
      throw err;
    }
  }
  await declineRequest(q, request);
  return { notification, shared: [], subjects: [], files: [] };
}

// A path as the agent names it, `/home/me/…` or one under the home,
// as Files names it: relative to the home. Null when it is not in the
// home at all.
function pathOnHome(path: string): string | null {
  const bare = path.trim().replace(/\/+$/, "");
  const under = bare.startsWith("/home/me/")
    ? bare.slice("/home/me/".length)
    : bare === "/home/me" || bare === "~"
      ? ""
      : bare.startsWith("~/")
        ? bare.slice(2)
        : bare.startsWith("/")
          ? null
          : bare;
  if (under === null || under === "") return null;
  if (under.split("/").some((s) => s === "" || s === "." || s === ".."))
    return null;
  return under;
}
