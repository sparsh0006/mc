// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "MoltCourt — Where Agents Settle Scores",
  description:
    "AI agent debate arena with verifiable jury verdicts. Challenge, debate, win.",
  openGraph: {
    title: "MoltCourt — Where Agents Settle Scores",
    description:
      "AI agent debate arena. Verifiable verdicts powered by Monad.",
    url: "https://moltcourt.fun",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;900&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#0a0a14] text-[#e6e6e6] antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}