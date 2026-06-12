import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "RepoCouncil",
  description: "Multi-agent GitHub PR review dashboard"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="appFrame">
          <aside className="sidebar" aria-label="Primary navigation">
            <div className="brandBlock">
              <span className="brandMark">RC</span>
              <div>
                <strong>RepoCouncil</strong>
                <span>Command center</span>
              </div>
            </div>
            <nav className="navList">
              <a href="/">Runs</a>
              <a href="/evals">Evaluations</a>
              <a href="/#findings">Findings</a>
              <a href="/evals#fixtures">Fixtures</a>
              <a href="/#models">Models</a>
              <a href="/#settings">Settings</a>
            </nav>
            <div className="sidebarStatus">
              <span>Local workspace</span>
              <span>Qwen provider</span>
              <span>Council mode</span>
              <strong>Ready</strong>
            </div>
          </aside>
          <div className="workspace">{children}</div>
        </div>
      </body>
    </html>
  );
}
