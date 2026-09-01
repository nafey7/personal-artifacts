import { projects, toObjectId } from "@/lib/mongo";
import { slugify } from "@/lib/slug";

export const MAX_PROJECT_NAME = 80;

// Finds one of the user's projects by id, slug or exact name, so the CLI can
// pass whichever the caller has to hand. Returns the document or null.
export async function findProject(value, userId) {
  const key = String(value ?? "").trim();
  if (!key) return null;

  const col = await projects();
  const _id = toObjectId(key);
  return await col.findOne({
    userId,
    $or: _id ? [{ _id }, { slug: key }, { name: key }] : [{ slug: key }, { name: key }],
  });
}

// Every project the user owns, sorted by name. Used both to list them and to
// put the list into the "unknown project" error, so a caller that misspelt a
// name can see what it should have said.
export async function listProjects(userId) {
  const col = await projects();
  return await col.find({ userId }).sort({ name: 1 }).toArray();
}

// Creates a project, or explains why it can't. Names only have to be unique
// within one account. Returns { project } or { error, status }.
export async function createProject(rawName, userId) {
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) return { error: "name is required", status: 400 };
  if (name.length > MAX_PROJECT_NAME) return { error: "name is too long", status: 400 };

  const col = await projects();
  const existing = await col.findOne({ name, userId });
  if (existing) {
    return { error: "a project with that name already exists", status: 409 };
  }

  const now = new Date();
  const doc = { name, slug: slugify(name, "project"), userId, createdAt: now, updatedAt: now };
  const { insertedId } = await col.insertOne(doc);
  return { project: { ...doc, _id: insertedId } };
}

export function publicProject(doc) {
  return { id: doc._id.toString(), name: doc.name, slug: doc.slug };
}
