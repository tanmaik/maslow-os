# Dependencies

Every external dependency, with its self-hosted answer. Written when the vendor
is added.

| Dependency          | Managed                                                                                                                                                                    | Self-hosted                                                                            | Absent on self-hosted                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| WorkOS              | Vouches for an email: a six-digit code through its API, behind our own sign-in.                                                                                            | Any OpenID Connect provider, the org's own, through a redirect. Same admission.        | Enterprise SSO routing and directory sync: the org's provider already is. |
| Resend              | Sends sign-in codes and invitation mail. Required for managed sign-in.                                                                                                     | Nothing yet: their provider signs people in. Invitations work by word of mouth.        | Invitation mail, until SMTP is wired.                                     |
| Object storage (S3) | Uploaded images, later exports and volume backups, in a private bucket we run. Five `STORAGE_*` values; one signer, no SDK. A checkout with none of them uses a directory. | Any S3-compatible store — MinIO on their box, their cloud's S3 — the same five values. | Nothing.                                                                  |
