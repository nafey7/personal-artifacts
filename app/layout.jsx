export const metadata = { title: "Artifacts" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: "3rem 1.5rem",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#fff",
          color: "#111",
        }}
      >
        <main style={{ maxWidth: 720, margin: "0 auto" }}>{children}</main>
      </body>
    </html>
  );
}
