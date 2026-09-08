// Where our things live at the vendors that are not secret: the Vercel
// project and team, the Neon project and the branch previews fork from,
// and the dev bucket. Named once here; the workflows carry only tokens.
export const ids = {
  VERCEL_TEAM_ID: "team_7NQXOFvUYkNy7L2ztTSnohQ8",
  VERCEL_TEAM_SLUG: "maslowtech",
  VERCEL_PROJECT_ID: "prj_rAZ2iUe98KkFuLsvFc7uwqTh8ko0",
  NEON_PROJECT_ID: "quiet-wave-64485699",
  NEON_PARENT_BRANCH: "preview-parent",
  STORAGE_ENDPOINT: "https://fly.storage.tigris.dev",
  STORAGE_REGION: "auto",
  STORAGE_BUCKET: "placeholder-uploads-dev",
  // The Fly app every computer outside production lives in.
  FLY_COMPUTERS_DEV_APP: "maslow-computers-dev",
};
