// Bản web: đổi tên web.html -> index.html và bỏ file chỉ dành cho extension.
import { renameSync, rmSync, existsSync } from "node:fs";
if (existsSync("dist-web/web.html")) renameSync("dist-web/web.html", "dist-web/index.html");
rmSync("dist-web/manifest.json", { force: true });
