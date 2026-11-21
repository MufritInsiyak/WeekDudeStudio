const express = require("express");
const path = require("path");

const app = express();
const port = Number(process.env.PORT) || 3000;
const wwwDir = path.join(__dirname, "www");

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
