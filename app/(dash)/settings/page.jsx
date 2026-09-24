import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { currentUser } from "@/lib/auth";
import { tokens as tokenCol, users, toObjectId } from "@/lib/mongo";
import { loadUsage, stamp } from "@/lib/data";
import { MAX_BYTES, MAX_PER_USER } from "@/lib/limits";
import PageHead from "../PageHead";
import TokenManager from "./TokenManager";
import Usage from "./Usage";
import Recovery from "./Recovery";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · Artifacts" };

export default async function Settings() {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const [docs, usage, account] = await Promise.all([
    (await tokenCol()).find({ userId: user.id }).sort({ createdAt: -1 }).toArray(),
    loadUsage(user.id),
    (await users()).findOne({ _id: toObjectId(user.id) }, { projection: { keysCreatedAt: 1 } }),
  ]);

  // The config snippet should name the site the user is actually looking at.
  const head = await headers();
  const host = head.get("host") || "";
  const proto = head.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");

  return (
    <>
      <PageHead title="Settings" count={usage.count} />
      <Usage
        count={usage.count}
        bytes={usage.bytes}
        maxCount={MAX_PER_USER}
        maxBytes={MAX_BYTES}
        trashed={usage.trashed}
      />
      <h2 className="settingshead">Encryption</h2>
      <Recovery
        user={user}
        since={account?.keysCreatedAt ? stamp(account.keysCreatedAt) : null}
      />
      <h2 className="settingshead">API tokens</h2>
      <p className="settingslede">
        A token lets the <code>publish</code> CLI put artifacts into your account
        from any machine. Give each machine its own, so losing one means revoking
        one.
      </p>
      <TokenManager
        site={`${proto}://${host}`}
        tokens={docs.map((t) => ({
          id: t._id.toString(),
          label: t.label,
          prefix: t.prefix,
          createdAt: new Date(t.createdAt).toISOString(),
          lastUsedAt: t.lastUsedAt ? new Date(t.lastUsedAt).toISOString() : null,
        }))}
      />
    </>
  );
}
