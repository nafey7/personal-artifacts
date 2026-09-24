import { currentUser } from "@/lib/auth";
import DashboardLayout from "./(dash)/layout";
import AllArtifacts from "./(dash)/AllArtifacts";
import Landing from "./_home/Landing";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Artifacts — one private home for everything your AI tools make",
  description:
    "Publish the reports, dashboards and pages that Claude Code, Codex, Gemini CLI and Cursor produce to one private site of your own. Free, open source, one command to install.",
  alternates: { canonical: "https://artifacts.pallason.com/" },
  openGraph: {
    title: "Artifacts — one private home for everything your AI tools make",
    description:
      "Every coding agent you use can publish to the same private site, encrypted so the site cannot read it. Share a link when you choose, with an expiry or a passphrase.",
    url: "https://artifacts.pallason.com/",
    siteName: "Artifacts",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

// `/` is two pages: the dashboard for whoever is signed in, and the public
// home page for everyone else. Composing the dashboard here, instead of a
// redirect, keeps it at the root address the sidebar and sign-in already use.
export default async function Home() {
  const user = await currentUser();
  if (!user) return <Landing />;
  return (
    <DashboardLayout>
      <AllArtifacts user={user} />
    </DashboardLayout>
  );
}
