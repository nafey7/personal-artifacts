import { tokens } from "@/lib/mongo";
import { requireUser } from "@/lib/guard";
import { mintToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";

const MAX_TOKENS = 10;

function present(doc) {
  return {
    id: doc._id.toString(),
    label: doc.label,
    prefix: doc.prefix,
    createdAt: new Date(doc.createdAt).toISOString(),
    lastUsedAt: doc.lastUsedAt ? new Date(doc.lastUsedAt).toISOString() : null,
  };
}

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;

  const col = await tokens();
  const docs = await col.find({ userId: user.id }).sort({ createdAt: -1 }).toArray();
  return Response.json({ tokens: docs.map(present) });
}

export async function POST(request) {
  const { user, response } = await requireUser();
  if (response) return response;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const label = typeof body.label === "string" ? body.label.trim().slice(0, 60) : "";
  if (!label) return Response.json({ error: "name this token so you can tell it apart later" }, { status: 400 });

  const col = await tokens();
  if ((await col.countDocuments({ userId: user.id })) >= MAX_TOKENS) {
    return Response.json(
      { error: `you already have ${MAX_TOKENS} tokens — revoke one first` },
      { status: 409 }
    );
  }

  const { secret, hash, prefix } = mintToken();
  const doc = {
    tokenHash: hash,
    prefix,
    label,
    userId: user.id,
    createdAt: new Date(),
    lastUsedAt: null,
  };
  const { insertedId } = await col.insertOne(doc);

  // The only time the full token is ever returned.
  return Response.json({ token: { ...present({ ...doc, _id: insertedId }), secret } }, { status: 201 });
}
