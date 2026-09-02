import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { loadTrash } from "@/lib/data";
import { TRASH_DAYS } from "@/lib/limits";
import PageHead from "../PageHead";
import TrashList from "./TrashList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trash · Artifacts" };

export default async function Trash() {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const items = await loadTrash(user.id);

  return (
    <>
      <PageHead title="Trash" count={items.length} />
      <p className="settingslede">
        Deleted artifacts wait here for {TRASH_DAYS} days, then go for good on
        their own. Their <code>/a/</code> links stay closed the whole time —
        restoring one is what opens it again.
      </p>
      <TrashList items={items} retentionDays={TRASH_DAYS} />
    </>
  );
}
