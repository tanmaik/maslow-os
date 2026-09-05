# Analytics is PostHog, one project, tagged by deployment

2026-09-04

Product analytics go to PostHog, the vendor behind `deployment.analytics`.
The browser reports every page seen, as the person signed in, in the org
they are acting in, through a path on our own origin so a browser that
blocks PostHog's hosts still reports.

**One key, through the deployment object.** `POSTHOG_KEY` is the project
token, read once into the deployment object and handed to the browser by
the layout as a prop. Nothing reads a `NEXT_PUBLIC_` variable, and nothing
outside `components/analytics.tsx` imports PostHog.

**One project for all three deployments.** PostHog's free plan allows one,
so local, preview and production share it, and every event carries which
one it came from as `deployment`. A second project for anything outside
production is a card on file away, and would change only where the key
points.

**Ids, never names; shapes, never words.** PostHog is told a person's id
and role, and their org's id, and nothing else about them. A replay masks
every input and every piece of text, so it shows how a page was used and
not what was in it. Loosening that is one selector in
`components/analytics.tsx`, and a decision.

**The whole of PostHog, from our own bundle.** Replay, error tracking,
dead clicks, heatmaps, web vitals and surveys ship inside the app's
JavaScript rather than as scripts fetched from PostHog's hosts, which
content blockers drop by filename. The bundle is larger; nothing is left
to chance.

**Only production counts.** The project's internal-and-test-users filter
keeps events whose `deployment` is `production`, on by default for every
insight, so a laptop or a preview never moves a number. Errors are
captured in production alone: an issue is work for someone, and a
laptop's would sit in the queue beside production's.

**Missing outside production, faked; missing in production, refused.** As
every vendor: the pill says analytics is faked, and production does not
start without the key.
