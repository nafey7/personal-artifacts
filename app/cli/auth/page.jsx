import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { pendingAuth } from "@/lib/mongo";
import ApproveDevice from "./ApproveDevice";

export const dynamic = "force-dynamic";
export const metadata = { title: "Authorize a machine · Artifacts" };

export default async function CliAuth({ searchParams }) {
  const { code } = await searchParams;
  const userCode = typeof code === "string" ? code.trim().toUpperCase() : "";

  const user = await currentUser();
  if (!user) {
    // Comes back here — signing up mid-flow works the same as signing in.
    redirect(`/signin?next=${encodeURIComponent(`/cli/auth?code=${userCode}`)}`);
  }

  const doc = userCode
    ? await (await pendingAuth()).findOne({ userCode, status: "pending" })
    : null;
  const live = doc && new Date(doc.expiresAt) > new Date();

  if (!live) {
    return (
      <div className="authwrap">
        <div className="authcard">
          <h1>That code has expired</h1>
          <p className="authnote">
            Sign-in requests are good for ten minutes. Run{" "}
            <code>personal-artifact</code> again in your terminal to start a new
            one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="authwrap">
      <ApproveDevice userCode={userCode} device={doc.device} user={user} />
    </div>
  );
}
