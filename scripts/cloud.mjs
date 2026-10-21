// The cloud a script sweeps, in the scripts' own words, so the reap reads
// whichever cloud this environment names: AWS where it names an account,
// Fly otherwise. A machine is its id, its name, whether it runs, the tags
// the app gave it, the disks it holds and when it was made; a disk is its
// id, its name, when it was made and whether a machine holds it.
import * as aws from "./aws.mjs";
import * as fly from "./fly.mjs";

// Fly's own answers, in those words.
const overFly = {
  name: "Fly",
  machines: async (env) =>
    (await fly.machines(env)).map((m) => ({
      id: m.id,
      name: m.name,
      running: m.state === "started",
      tags: m.config?.metadata ?? {},
      disks: (m.config?.mounts ?? []).map((x) => x.volume).filter(Boolean),
      madeAt: new Date(m.created_at),
      raw: m,
    })),
  volumes: async (env) =>
    (await fly.volumes(env)).map((v) => ({
      id: v.id,
      name: v.name,
      madeAt: new Date(v.created_at),
      held: Boolean(v.attached_machine_id),
    })),
  renewLeases: fly.renewLeases,
  stop: (id) => fly.stop(id),
  destroy: (m) => fly.destroy(m.raw),
  destroyVolume: (id) => fly.destroyVolume(id),
  untouchable: () => false,
  leftovers: async () => [],
};

const overAws = {
  name: "AWS",
  machines: aws.machines,
  volumes: aws.volumes,
  renewLeases: aws.renewLeases,
  stop: aws.stop,
  destroy: aws.destroy,
  destroyVolume: aws.destroyVolume,
  untouchable: aws.untouchable,
  leftovers: aws.leftovers,
};

// When a machine was last wanted: its lease, or, for one made by hand
// with none, its birth.
export const wantedAt = (m) => new Date(m.tags.lease ?? m.madeAt);

export const cloudOf = (env = process.env) => (aws.on(env) ? overAws : overFly);
