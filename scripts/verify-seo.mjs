import fs from "node:fs";

const html = fs.readFileSync(new URL("../client/index.html", import.meta.url), "utf8");
const title = html.match(/<title>(.*?)<\/title>/s)?.[1] ?? "";
const description = html.match(/name="description" content="([^"]*)"/)?.[1] ?? "";
const keywords = html.match(/name="keywords" content="([^"]*)"/)?.[1] ?? "";
const home = fs.readFileSync(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8");
const headings = [...home.matchAll(/<h2[^>]*>(.*?)<\/h2>/gs)].map((match) => match[1].replace(/<[^>]+>/g, "").trim());
const keywordList = keywords.split(",").map((keyword) => keyword.trim()).filter(Boolean);

const checks = [
  ["title", title.length >= 30 && title.length <= 60, `${title.length} caratteri`],
  ["description", description.length >= 50 && description.length <= 160, `${description.length} caratteri`],
  ["keywords", keywordList.length >= 3 && keywordList.length <= 8, `${keywordList.length} parole chiave`],
  ["h2", headings.length > 0 && headings.every((heading) => heading.length <= 80), `${headings.length} H2, ${headings[0]?.length ?? 0} caratteri`],
];

for (const [name, valid, detail] of checks) console.log(`${valid ? "PASS" : "FAIL"} ${name}: ${detail}`);
if (checks.some(([, valid]) => !valid)) process.exit(1);
