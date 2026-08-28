import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import AuthForm from "../AuthForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create account · Artifacts" };

export default async function SignUp({ searchParams }) {
  if (await currentUser()) redirect("/");
  const { next } = await searchParams;
  // Only in-app paths, so ?next= can't be pointed at another site.
  const target = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return <AuthForm mode="signup" next={target} inviteOnly={Boolean(process.env.SIGNUP_CODE)} />;
}
