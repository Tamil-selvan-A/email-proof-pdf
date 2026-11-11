import express from "express";
import multer from "multer";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateBundle, imageSize, listScreenshotFiles, summarizeScreenshots } from "./generate.js";
import { renderLayout } from "./template.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outputRoot = path.join(projectRoot, "output");
const PORT = Number(process.env.PORT) || 3456;
const FROM_VALUES = ["MD|DO Engage", "NP|PA Engage"];

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use("/public", express.static(path.join(projectRoot, "public")));
app.use("/output", express.static(outputRoot));

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, _file, cb) => {
      if (!req.uploadDir) {
        const dir = path.join(outputRoot, "_uploads", String(Date.now()));
        await mkdir(dir, { recursive: true });
        req.uploadDir = dir;
      }
      cb(null, req.uploadDir);
    },
    filename: (_req, file, cb) => {
      const base = path.basename(file.originalname).replace(/^.*[/\\]/, "");
      cb(null, base);
    },
  }),
});

function resolveInside(root, inputPath) {
  const resolved = path.resolve(root, inputPath || "");
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Folder must stay inside the project directory.");
  }
  return resolved;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(projectRoot, "public", "index.html"));
});

app.get("/api/screenshots", async (req, res) => {
  try {
    if (!req.query.folder) throw new Error("Upload a screenshot folder first.");
    const folder = resolveInside(projectRoot, req.query.folder);
    const files = await listScreenshotFiles(folder);
    const summary = summarizeScreenshots(files);
    const items = [];
    for (const [stem, filePath] of Object.entries(files)) {
      const size = await imageSize(filePath);
      items.push({
        stem,
        name: path.basename(filePath),
        width: size.width,
        height: size.height,
      });
    }
    items.sort((a, b) => a.stem.localeCompare(b.stem, undefined, { numeric: true }));
    res.json({ folder: path.relative(projectRoot, folder), items, ...summary });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/media", async (req, res) => {
  try {
    const filePath = resolveInside(projectRoot, req.query.file);
    res.sendFile(filePath);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/preview", async (req, res) => {
  try {
    if (!req.query.folder) {
      res.status(400).send("Upload a screenshot folder first.");
      return;
    }
    const folder = resolveInside(projectRoot, req.query.folder);
    const files = await listScreenshotFiles(folder);
    const stem = String(req.query.stem || "").toLowerCase();
    const imagePath = files[stem];
    if (!imagePath) {
      res.status(404).send(`Screenshot "${stem}" was not found.`);
      return;
    }
    const { width } = await imageSize(imagePath);
    const html = renderLayout({
      viewType: req.query.viewType === "mobile" ? "mobile" : "desktop",
      from: req.query.from || "",
      to: req.query.to || "",
      cc: req.query.cc || "",
      subject: req.query.subject || "",
      imageSrc: `/media?file=${encodeURIComponent(path.relative(projectRoot, imagePath))}`,
      contentWidth: width,
      fitPreview: true,
    });
    res.type("html").send(html);
  } catch (error) {
    res.status(400).send(error.message);
  }
});

app.post("/api/upload-screenshots", upload.array("files", 200), async (req, res) => {
  try {
    const folder = req.uploadDir;
    if (!folder) throw new Error("No files uploaded.");
    const files = await listScreenshotFiles(folder);
    const summary = summarizeScreenshots(files);
    const items = [];
    for (const [stem, filePath] of Object.entries(files)) {
      const size = await imageSize(filePath);
      items.push({ stem, name: path.basename(filePath), width: size.width, height: size.height });
    }
    res.json({
      folder: path.relative(projectRoot, folder),
      items,
      ...summary,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/outputs", async (_req, res) => {
  try {
    await mkdir(outputRoot, { recursive: true });
    const names = await readdir(outputRoot);
    const items = [];
    for (const name of names) {
      if (name.startsWith("_") || name.startsWith(".")) continue;
      const pdfPath = path.join(outputRoot, name, `${name}.pdf`);
      try {
        const info = await stat(pdfPath);
        items.push({
          name,
          size: formatSize(info.size),
          modified: info.mtime.toLocaleString(),
          mtime: info.mtimeMs,
          download: `/output/${encodeURIComponent(name)}/${encodeURIComponent(name)}.pdf`,
        });
      } catch {
        continue;
      }
    }
    items.sort((a, b) => b.mtime - a.mtime);
    res.json({ items });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

async function deleteLinkedUpload(jobDir) {
  try {
    const source = JSON.parse(await readFile(path.join(jobDir, "source.json"), "utf8"));
    if (!source.uploadFolder) return;
    const uploadDir = resolveInside(projectRoot, source.uploadFolder);
    const rel = path.relative(path.join(outputRoot, "_uploads"), uploadDir);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return;
    await rm(uploadDir, { recursive: true, force: true });
  } catch {
    // Older jobs may not have source.json.
  }
}

app.delete("/api/outputs/:name", async (req, res) => {
  try {
    const dir = resolveInside(outputRoot, req.params.name);
    if (path.basename(dir).startsWith("_")) throw new Error("Cannot delete that folder.");
    await deleteLinkedUpload(dir);
    await rm(dir, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete("/api/outputs", async (_req, res) => {
  try {
    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(outputRoot, { recursive: true });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/generate", async (req, res) => {
  try {
    const {
      outputName,
      folder,
      from,
      to,
      cc = "",
      layouts: rawLayouts,
    } = req.body || {};

    if (!outputName?.trim()) throw new Error("Final output file name is required.");
    if (!folder?.trim()) throw new Error("Upload a screenshot folder first.");
    if (!FROM_VALUES.includes(from)) throw new Error("From must be MD|DO Engage or NP|PA Engage.");
    if (!to?.trim()) throw new Error("Common To is required.");

    const screenshotFolder = resolveInside(projectRoot, folder);
    await stat(screenshotFolder);
    const files = await listScreenshotFiles(screenshotFolder);
    const summary = summarizeScreenshots(files);
    if (!summary.pairCount) throw new Error("Upload matching m1/d1 image pairs.");
    if (summary.mobile !== summary.desktop) {
      throw new Error(`Need the same number of mobile and desktop files. Found ${summary.mobile} mobile and ${summary.desktop} desktop.`);
    }

    const layouts = buildLayouts({
      from: from.trim(),
      to: to.trim(),
      cc: String(cc || "").trim(),
      pairCount: summary.pairCount,
      rawLayouts,
    });

    const result = await generateBundle({
      projectRoot,
      outputName: outputName.trim(),
      layouts,
      screenshotFolder,
      publicBase: `http://127.0.0.1:${PORT}`,
    });

    const mergedRel = path.relative(projectRoot, result.mergedPath);
    res.json({
      ok: true,
      merged: mergedRel,
      download: `/output/${mergedRel.split(path.sep).slice(1).join("/")}`,
      pages: result.pages,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

function buildLayouts({ from, to, cc, pairCount, rawLayouts }) {
  if (Array.isArray(rawLayouts) && rawLayouts.length) {
    return rawLayouts.map((row) => {
      const viewType = row.viewType === "desktop" ? "desktop" : "mobile";
      const subject = String(row.subject || "").trim();
      if (!subject) throw new Error("Subject is required for each pair.");
      return {
        viewType,
        imageStem: String(row.imageStem || "").trim().toLowerCase(),
        from: (row.from || from).trim(),
        to: (row.to || to).trim(),
        cc: (row.cc ?? cc).trim(),
        subject,
      };
    });
  }

  throw new Error("Subject is required for each pair.");
}

app.listen(PORT, () => {
  console.log(`PDF generator: http://localhost:${PORT}`);
});
