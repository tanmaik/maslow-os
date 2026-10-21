// What the server does once as it starts. A trial reaps its day-old orgs
// now and every hour after, since it runs as one process with no cron.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { deployment } = await import("./lib/deployment");
  if (!deployment.trial) return;
  const { reap } = await import("./lib/trial");
  void reap();
  setInterval(() => void reap(), 60 * 60 * 1000).unref();
}
