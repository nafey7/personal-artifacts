import { randomBytes } from "crypto";
import { artifacts } from "@/lib/mongo";

export const dynamic = "force-dynamic";

function slugify(title) {
  const base = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const suffix = randomBytes(3).toString("hex");
  return `${base || "artifact"}-${suffix}`;
}

export async function POST(request) {
  const secret = process.env.UPLOAD_TOKEN;
  if (!secret) {
    return Response.json({ error: "UPLOAD_TOKEN not configured" }, { status: 500 });
  }

  const auth = request.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const html = typeof body.html === "string" ? body.html : "";
  if (!title || !html) {
    return Response.json({ error: "title and html are required" }, { status: 400 });
  }

  const slug = slugify(title);
  const col = await artifacts();
  await col.insertOne({ slug, title, html, createdAt: new Date() });

  const origin = new URL(request.url).origin;
  return Response.json({ slug, url: `${origin}/a/${slug}` }, { status: 201 });
}
