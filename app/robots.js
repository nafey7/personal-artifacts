export default function robots() {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/signin", "/signup", "/llms.txt"],
        disallow: ["/api/", "/settings", "/trash", "/edit/", "/cli/", "/p/", "/reset"],
      },
    ],
    sitemap: "https://artifacts.pallason.com/sitemap.xml",
    host: "https://artifacts.pallason.com",
  };
}
