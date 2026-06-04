import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "RepoCouncil",
  description: "Multi-agent GitHub PR review dashboard"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
