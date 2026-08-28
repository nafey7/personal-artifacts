import { pendingAuth } from "@/lib/mongo";
import { clientIp, tooManyAttempts } from "@/lib/ratelimit";
import {
  CODE_TTL_SECONDS,
  cleanDeviceName,
  hashCode,
  makeDeviceCode,
  makeUserCode,
} from "@/lib/device";

export const dynamic = "force-dynamic";

// Step one of signing a machine in: the CLI asks for a pair of codes, sends
// the person to the browser with the short one, and keeps the long one to
// collect the token with.
export async function POST(request) {
  if (await tooManyAttempts(`cli:start:${clientIp(request)}`, { limit: 20, windowSeconds: 900 })) {
    return Response.json({ error: "too many sign-in attempts — wait a few minutes" }, { status: 429 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    // device name is optional
  }

  const userCode = makeUserCode();
  const deviceCode = makeDeviceCode();
  const now = new Date();

  const col = await pendingAuth();
  await col.insertOne({
    userCode,
    deviceCodeHash: hashCode(deviceCode),
    device: cleanDeviceName(body.device),
    status: "pending",
    createdAt: now,
    expiresAt: new Date(now.getTime() + CODE_TTL_SECONDS * 1000),
  });

  const origin = new URL(request.url).origin;
  return Response.json(
    {
      userCode,
      deviceCode,
      verifyUrl: `${origin}/cli/auth?code=${userCode}`,
      expiresIn: CODE_TTL_SECONDS,
      pollInterval: 2,
    },
    { status: 201 }
  );
}
