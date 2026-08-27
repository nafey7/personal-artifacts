export default function PageHead({ title, count, latest, children }) {
  return (
    <header className="pagehead">
      <div>
        <h1>{title}</h1>
        <p className="crumbs">
          {count} artifact{count === 1 ? "" : "s"}
          {latest ? <> · last published {latest}</> : null}
        </p>
      </div>
      {children}
    </header>
  );
}
