import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { loadProjects } from "@/lib/data";
import Sidebar from "./Sidebar";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }) {
  // Everything under this group is behind the session; there is no anonymous
  // view of the dashboard.
  const user = await currentUser();
  if (!user) redirect("/signin");

  const { projects, unfiled, total } = await loadProjects(user.id);

  return (
    <div className="dash">
      <Sidebar projects={projects} unfiled={unfiled} total={total} user={user} />
      <main className="main">{children}</main>
    </div>
  );
}
