# Dependencies

Every external dependency, behind the interface of ours it sits behind. Written
when the vendor is added.

| Dependency          | What it does                                                                                                                                                               | Interface                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| WorkOS              | Vouches for an email: a six-digit code through its API, behind our own sign-in.                                                                                            | `deployment.identity`                         |
| Resend              | Sends sign-in codes and invitation mail. Required for sign-in in production.                                                                                               | `deployment.mail`                             |
| Object storage (S3) | Uploaded images, later exports and volume backups, in a private bucket we run. Five `STORAGE_*` values; one signer, no SDK. A checkout with none of them uses a directory. | `deployment.storage`, any S3-compatible store |
