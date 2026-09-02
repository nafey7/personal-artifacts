import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { countTrash, loadProjects } from "@/lib/data";
import Sidebar from "./Sidebar";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }) {
  // Everything under this group is behind the session; there is no anonymous
  // view of the dashboard.
  const user = await currentUser();
  if (!user) redirect("/signin");

  const [{ projects, total }, trash] = await Promise.all([
    loadProjects(user.id),
    countTrash(user.id),
  ]);

  return (
    <div className="dash">
      <Sidebar projects={projects} total={total} trash={trash} user={user} />
      <main className="main">{children}</main>
    </div>
  );
}
