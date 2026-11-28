const express = require("express");
const path = require("path");

const app = express();
const port = Number(process.env.PORT) || 3000;
const wwwDir = path.join(__dirname, "www");

const ICAL_MAX_BYTES = 2 * 1024 * 1024;
function isAllowedGoogleIcalUrl(raw) {
  try {
    const u = new URL(String(raw || ""));
    return u.protocol === "https:" && u.hostname === "calendar.google.com" && u.pathname.startsWith("/calendar/ical/");
  } catch (_e) {
    return false;
  }
}

app.get("/api/ical-proxy", async (req, res) => {
  const target = typeof req.query.url === "string" ? req.query.url.trim() : "";
  if (!isAllowedGoogleIcalUrl(target)) {
    res.status(400).json({ error: "Only https://calendar.google.com/calendar/ical/ URLs are allowed." });
    return;
  }
  try {
    const upstream = await fetch(target, {
      headers: { "Accept": "text/calendar,text/plain;q=0.9,*/*;q=0.8" },
      signal: AbortSignal.timeout(10000)
    });
    if (!upstream.ok) {
      res.status(upstream.status).type("text/plain").send("Upstream error: HTTP " + upstream.status);
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > ICAL_MAX_BYTES) {
      res.status(413).type("text/plain").send("Calendar feed too large.");
      return;
    }
    res.status(200).type("text/calendar; charset=utf-8").send(buf.toString("utf8"));
  } catch (err) {
    res.status(502).type("text/plain").send(err && err.message ? err.message : "Failed to fetch calendar feed.");
  }
});

const GH_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
app.get("/api/github-release", async (req, res) => {
  const repo = typeof req.query.repo === "string" ? req.query.repo.trim() : "";
  if (!GH_REPO_RE.test(repo)) {
    res.status(400).json({ error: "Expected repo as owner/name." });
    return;
  }
  const [owner, name] = repo.split("/");
  const headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "Mission-Map-Updater/1.0"
  };
  try {
    let r = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(10000)
    });
    if (r.status === 404) {
      const tagsRes = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tags?per_page=1`, {
        headers,
        signal: AbortSignal.timeout(10000)
      });
      if (tagsRes.ok) {
        const tags = await tagsRes.json();
        if (Array.isArray(tags) && tags.length && tags[0].name) {
          res.status(200).json({
            tag_name: tags[0].name,
            name: tags[0].name,
            body: "",
            html_url: `https://github.com/${owner}/${name}/releases`,
            published_at: "",
            assets: [],
            from_tags: true
          });
          return;
        }
      }
      res.status(404).json({ error: "No published GitHub releases or tags found for this repository." });
      return;
    }
    if (!r.ok) {
      res.status(r.status).json({ error: "GitHub API HTTP " + r.status });
      return;
    }
    const data = await r.json();
    res.status(200).json({
      tag_name: data.tag_name || "",
      name: data.name || data.tag_name || "",
      body: typeof data.body === "string" ? data.body.slice(0, 4000) : "",
      html_url: data.html_url || `https://github.com/${owner}/${name}/releases`,
      published_at: data.published_at || "",
      assets: Array.isArray(data.assets) ? data.assets.slice(0, 20).map((a) => ({
        name: a.name || "",
        size: Number(a.size) || 0,
        browser_download_url: a.browser_download_url || "",
        content_type: a.content_type || ""
      })) : []
    });
  } catch (err) {
    res.status(502).json({ error: err && err.message ? err.message : "Could not contact GitHub." });
  }
});

app.use(express.static(wwwDir, {
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
    }
  }
}));

app.use((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.sendFile(path.join(wwwDir, "index.html"));
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Mission Map listening on http://0.0.0.0:${port}`);
});
