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
