import type { ReactNode } from "react";

export const metadata = { title: "placeholder" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: "3rem auto",
          maxWidth: 40 + "rem",
        }}
      >
        {children}
      </body>
    </html>
  );
}
