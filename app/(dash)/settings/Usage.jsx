import { formatBytes } from "@/lib/limits";

// The account's allowance, stated before the upload route has to refuse
// anything. The count is the only total that is capped; bytes are shown so
// the per-artifact limit means something in context.
export default function Usage({ count, bytes, maxCount, maxBytes, trashed }) {
  const share = maxCount > 0 ? Math.min(count / maxCount, 1) : 0;
  const left = Math.max(maxCount - count, 0);
  const tone = share >= 1 ? "is-full" : share >= 0.9 ? "is-near" : "";

  return (
    <section className={`usage ${tone}`} aria-labelledby="usage-title">
      <h2 id="usage-title">Usage</h2>
      <p className="usagefigure">
        <strong>{count.toLocaleString()}</strong> of {maxCount.toLocaleString()} artifacts,{" "}
        <strong>{formatBytes(bytes)}</strong> used
      </p>
      <div
        className="usagemeter"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={maxCount}
        aria-valuenow={count}
        aria-label="Artifacts published against the account limit"
      >
        <span style={{ width: `${(share * 100).toFixed(1)}%` }} />
      </div>
      {trashed?.count > 0 && (
        <p className="usagehint">
          <a href="/trash">{trashed.count.toLocaleString()} artifact
          {trashed.count === 1 ? "" : "s"}</a> in the trash, {formatBytes(trashed.bytes)} —
          they count against neither the artifact limit nor these figures until
          you restore them, and go for good on their own.
        </p>
      )}
      <p className="usagehint">
        {share >= 1
          ? "You are at the limit. Delete an artifact or publish with --update to replace one in place."
          : `${left.toLocaleString()} more artifact${left === 1 ? "" : "s"} before publishing is refused. Each one can be up to ${formatBytes(maxBytes)}.`}
      </p>
    </section>
  );
}
