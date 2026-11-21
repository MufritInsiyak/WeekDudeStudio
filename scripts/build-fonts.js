// Copies the Latin and Latin Extended (Turkish letters) font files this app uses into www/fonts and writes www/fonts.css.
const fs = require("fs"), path = require("path");
const FONTS = [["anton", [400]], ["bangers", [400]], ["caveat", [500, 700]], ["comic-neue", [700]], ["permanent-marker", [400]], ["playfair-display", [900]],
  ["press-start-2p", [400]], ["rye", [400]], ["share-tech-mono", [400]], ["special-elite", [400]], ["vt323", [400]]];
const out = []; fs.mkdirSync("www/fonts", { recursive: true });
for (const [pkg, weights] of FONTS) {
  const base = path.join("node_modules", "@fontsource", pkg);
  for (const w of weights) for (const sub of ["latin-ext", "latin"]) {
    const cssFile = path.join(base, `${sub}-${w}.css`); if (!fs.existsSync(cssFile)) continue;
    let css = fs.readFileSync(cssFile, "utf8");
    const uj = path.join(base, "unicode.json"), range = fs.existsSync(uj) ? JSON.parse(fs.readFileSync(uj, "utf8"))[sub] : null;
    css = css.replace(/src:[^;]*;/, (m) => {
      const f = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(m); if (!f) return m;
      fs.copyFileSync(path.join(base, "files", f[1]), path.join("www/fonts", f[1]));
      return `src: url(fonts/${f[1]}) format('woff2');` + (range ? ` unicode-range: ${range};` : "");
    });
    out.push(css);
  }
}
fs.writeFileSync("www/fonts.css", out.join("\n"));
console.log(out.length + " font faces");
