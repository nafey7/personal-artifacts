import Link from "next/link";

export default function NotFound() {
  return (
    <div className="empty">
      <p>That project doesn&rsquo;t exist — it may have been deleted.</p>
      <Link href="/" className="btn">Back to all artifacts</Link>
    </div>
  );
}
