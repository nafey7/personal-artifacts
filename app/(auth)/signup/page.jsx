import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import AuthForm from "../AuthForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create account · Artifacts" };

export default async function SignUp() {
  if (await currentUser()) redirect("/");
  return <AuthForm mode="signup" next="/" inviteOnly={Boolean(process.env.SIGNUP_CODE)} />;
}
