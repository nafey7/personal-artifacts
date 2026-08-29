import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import ResetForm from "./ResetForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reset password · Artifacts" };

export default async function Reset() {
  if (await currentUser()) redirect("/");
  return (
    <div className="authwrap">
      <ResetForm />
    </div>
  );
}
