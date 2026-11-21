// Usage: node scripts/use-page.js path/to/new-page.html
// Copies a new version of the Mission Map page into www/index.html and switches the Google Fonts link to the bundled fonts.
const fs = require("fs");
const src = process.argv[2];
if (!src) { console.error("Give the path of the page, e.g. node scripts/use-page.js ~/Downloads/missions.html"); process.exit(1); }
let html = fs.readFileSync(src, "utf8");
const out = html.replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, '<link rel="stylesheet" href="fonts.css">');
fs.writeFileSync("www/index.html", out);
console.log(out === html ? "No Google Fonts link found; page copied as is." : "Page copied and fonts switched to the bundled ones.");
