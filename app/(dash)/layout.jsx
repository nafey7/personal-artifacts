import { loadProjects } from "@/lib/data";
import Sidebar from "./Sidebar";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }) {
  const { projects, unfiled, total } = await loadProjects();

  return (
    <div className="dash">
      <Sidebar projects={projects} unfiled={unfiled} total={total} />
      <main className="main">{children}</main>
    </div>
  );
}
