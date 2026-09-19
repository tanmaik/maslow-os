// What any cloud is to the product: what it refuses, what a machine, a
// disk and a copy of one are, and the calls the product makes of it.

// What the cloud refused, as a kind of its own, so a caller can tell the
// vendor's answer from a fault of ours and go on without it.
export class CloudRefused extends Error {
  // The cloud that refused, by name, as the person is told it.
  readonly cloud: string;
  readonly status: number;
  // The vendor's own body, for the server's log alone: a rejected machine
  // config comes back with parts of itself in it, and a config carries
  // secrets.
  readonly said: string;
  // The call that was refused, which carries nothing.
  readonly call: string;
  constructor(cloud: string, status: number, said: string, call: string) {
    super(`${cloud} ${call} answered ${status}: ${said}`);
    this.name = "CloudRefused";
    this.cloud = cloud;
    this.status = status;
    this.said = said;
    this.call = call;
  }
}

// Refused a machine because the disk it was to boot from is gone.
export class DiskGone extends CloudRefused {}

// A machine as the cloud has it, in our words: running, stopped, on its
// way from one to the other, or gone (going or went); where; the image it
// runs by its label; its size; what it was told when it was made; its
// tags; and the disks it boots from.
export type Machine = {
  id: string;
  name: string;
  state: "running" | "stopped" | "changing" | "gone";
  region: string;
  image: string | null;
  // Each part of its size as the cloud reports it, absent where it does
  // not say.
  size: { cpuKind?: string; cpus?: number; memoryMb?: number };
  env: Record<string, string>;
  tags: Record<string, string>;
  disks: string[];
};

// A disk as the cloud has it: ready to boot from, still being filled or
// made, or gone (going or went); where; how big; and its name.
type Volume = {
  id: string;
  name: string;
  region: string;
  state: "ready" | "filling" | "gone";
  sizeGb: number;
};

// A copy of a disk at a moment, ready once it is whole.
type Snapshot = { id: string; ready: boolean };

// What a machine is made of: its image by its label, its door's secret,
// the brain's address and the session it reaches it with, who the person
// is on it, its size, its disk, and its tags.
export type Shape = {
  image: string;
  volumeId: string;
  cpuKind: "shared" | "performance";
  cpus: number;
  memoryMb: number;
  secret: string;
  brain: { url: string; token: string } | null;
  // The account's name and the machine's, so a prompt reads wile@acme.
  who: { person: string; org: string };
  // Where the agent inside sends its model calls and what it carries
  // there; none where this deployment mints no keys.
  model: { url: string; token: string } | null;
  metadata: Record<string, string>;
};

// What the relay's machine is made of: its image by its label, the secret
// it shares with the app, and its tags. No disk: it holds nothing that
// outlives a document being open.
export type RelayShape = {
  image: string;
  secret: string;
  metadata: Record<string, string>;
};

// A place a cloud makes computers in: its name in words and where it is
// on the earth.
export type Place = { name: string; at: readonly [number, number] };

// How a machine's door is reached from this server: the address, and the
// headers that name the machine where the address alone does not.
type Door = { url: string; headers: Record<string, string> };

// A place that runs computers: everything the product asks of one,
// whichever cloud answers. Machines and disks are made, kept and let go;
// a disk is copied and filled back from a copy; and a machine's door is
// reached where the cloud says it is.
export type Cloud = {
  // The regions this cloud makes disks in, by the cloud's own code, the
  // first the one taken when nothing nearer is known.
  regions: Readonly<Record<string, Place>>;
  // The region nearest this server, where the cloud can tell: off Vercel
  // the server and the person are the same laptop. Null when it cannot.
  edge(): Promise<string | null>;
  createVolume(
    name: string,
    region: string,
    sizeGb: number,
  ): Promise<{ id: string }>;
  // A machine on its disk, started, running until it is stopped, its door
  // reachable at its own name under the deployment's domain. Refused with
  // DiskGone when the disk is not there to boot from.
  createMachine(m: Shape & { name: string; region: string }): Promise<Machine>;
  // The same machine remade to a shape, a newer image most often, on the
  // same disk.
  reshape(id: string, m: Shape): Promise<void>;
  // The relay's machine, where the cloud keeps it, and the same remade to
  // a newer image.
  createRelay(m: RelayShape & { name: string }): Promise<Machine>;
  reshapeRelay(id: string, m: RelayShape): Promise<void>;
  machines(): Promise<Machine[]>;
  // Null once the cloud no longer has it.
  machine(id: string): Promise<Machine | null>;
  volumes(): Promise<Volume[]>;
  // Null once the cloud no longer has it.
  volume(id: string): Promise<Volume | null>;
  // How many days the disk's snapshots are kept, from the next one on.
  keepSnapshots(id: string, days: number): Promise<void>;
  // A copy of the disk this moment, made in the background: the copy's
  // id, which its listing then says the status of.
  snapshot(volumeId: string): Promise<Snapshot>;
  snapshots(volumeId: string): Promise<Snapshot[]>;
  // A disk filled from a snapshot, in a region, no smaller than the disk
  // the snapshot was of; the disk is ready once it is whole.
  restoreVolume(
    name: string,
    region: string,
    sizeGb: number,
    snapshotId: string,
  ): Promise<{ id: string }>;
  // Grows a disk to a size while its machine runs, and says whether the
  // machine must be restarted before it sees the room.
  extendVolume(id: string, sizeGb: number): Promise<{ needsRestart: boolean }>;
  // Asked of a machine already up, start is the state wanted.
  start(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  // Whether the machine has come to a stop, waited for up to the seconds
  // given.
  stopped(id: string, seconds: number): Promise<boolean>;
  // A reboot: every running process ends, and only the disk remains.
  restart(id: string): Promise<void>;
  // The lease and anything else a machine is tagged with, without a
  // restart.
  tag(id: string, key: string, value: string): Promise<void>;
  // Gone for good; one already gone is fine.
  destroyMachine(id: string): Promise<void>;
  destroyVolume(id: string): Promise<void>;
  // Where the machine's door is reached from this server.
  door(machineId: string): Door;
};
