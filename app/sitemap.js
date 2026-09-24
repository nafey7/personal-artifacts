export default function sitemap() {
  const site = "https://artifacts.pallason.com";
  return [
    { url: `${site}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${site}/signup`, changeFrequency: "yearly", priority: 0.6 },
    { url: `${site}/signin`, changeFrequency: "yearly", priority: 0.4 },
  ];
}
