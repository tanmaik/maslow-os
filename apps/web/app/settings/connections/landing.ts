// Where a tab that left the desk to sign in to an app lands: the desk,
// with the Settings window open on what came of it.
export const landing = (home: string, outcome: string, account?: string) =>
  `${home}/?maslow=settings&connection=${outcome}${account ? `&account=${encodeURIComponent(account)}` : ""}`;
