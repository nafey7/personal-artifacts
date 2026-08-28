import { pendingAuth, tokens } from "@/lib/mongo";
import { requireUser } from "@/lib/guard";
import { mintToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";

const MAX_TOKENS = 10;

// The browser half: a signed-in person approves (or refuses) the waiting
// machine. Approving is what mints the token — it is never created earlier, so
// an abandoned sign-in leaves nothing behind.
export async function POST(request) {
  const { user, response } = await requireUser();
  if (response) return response;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const userCode = typeof body.userCode === "string" ? body.userCode.trim().toUpperCase() : "";
  const approve = body.approve !== false;
  if (!userCode) return Response.json({ error: "userCode is required" }, { status: 400 });

  const col = await pendingAuth();
  const doc = await col.findOne({ userCode, status: "pending" });
  if (!doc || new Date(doc.expiresAt) < new Date()) {
    return Response.json({ error: "this sign-in request has expired — run the command again" }, { status: 404 });
  }

  if (!approve) {
    await col.updateOne({ _id: doc._id }, { $set: { status: "denied" } });
    return Response.json({ denied: true });
  }

  const tokenCol = await tokens();
  if ((await tokenCol.countDocuments({ userId: user.id })) >= MAX_TOKENS) {
    return Response.json(
      { error: `you already have ${MAX_TOKENS} tokens — revoke one first` },
      { status: 409 }
    );
  }

  const { secret, hash, prefix } = mintToken();
  await tokenCol.insertOne({
    tokenHash: hash,
    prefix,
    label: doc.device,
    userId: user.id,
    createdAt: new Date(),
    lastUsedAt: null,
  });

  // Held only until the waiting CLI collects it, which deletes the row.
  await col.updateOne(
    { _id: doc._id },
    { $set: { status: "approved", secret, user: { email: user.email, name: user.name } } }
  );

  return Response.json({ approved: true, device: doc.device });
}
