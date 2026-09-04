# Dependencies

Every external dependency, behind the interface of ours it sits behind. Written
when the vendor is added.

| Dependency          | What it does                                                                                                                                                              | Interface                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| WorkOS              | Vouches for an email: a six-digit code through its API, behind our own sign-in.                                                                                           | `deployment.identity`                     |
| Resend              | Sends sign-in codes and invitation mail. Required in production.                                                                                                          | `deployment.mail`                         |
| Object storage (S3) | Uploaded images, in a private bucket we run. Five `STORAGE_*` values; one signer, no SDK. Required in production; a checkout uses a directory, a preview refuses uploads. | `deployment.storage`                      |
| Neon                | The managed Postgres: production's database, and a branch per pull request off an empty parent.                                                                           | `DATABASE_URL`, `scripts/preview-db.mjs`  |
| Vercel              | Hosting and the environment store. The preview workflow writes a pull request's database URLs there and asks for its one build.                                           | `scripts/preview-db.mjs`, `pnpm env:pull` |
| GitHub Actions      | Runs `pnpm check` on every push and the preview lifecycle on every pull request event, holding the Neon and Vercel credentials on an environment only `main` can use.     | `.github/workflows`                       |
| npm registry        | Everything a checkout installs, the Postgres binary included.                                                                                                             | `pnpm install`                            |
