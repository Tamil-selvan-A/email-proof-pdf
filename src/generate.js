import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { PDFDocument, rgb } from "pdf-lib";
import { isImageName, renderLayout, stemOf } from "./template.js";

const PX_TO_PT = 72 / 96;
const BORDER = rgb(200 / 255, 200 / 255, 200 / 255);

const IMAGE_SIZE_CACHE = new Map();

export async function listScreenshotFiles(folder) {
  const names = await readdir(folder);
  const files = {};
  for (const name of names) {
    if (name.startsWith(".")) continue;
    if (!isImageName(name)) continue;
    files[stemOf(name)] = path.join(folder, name);
  }
  return files;
}

export function summarizeScreenshots(files) {
  const stems = Object.keys(files);
  const mobile = stems.filter((stem) => /^m\d+$/.test(stem)).length;
  const desktop = stems.filter((stem) => /^d\d+$/.test(stem)).length;
  return {
    stems: stems.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    mobile,
    desktop,
    total: stems.length,
    pairCount: Math.min(mobile, desktop) || Math.floor(stems.length / 2),
  };
}

export async function imageSize(filePath) {
  if (IMAGE_SIZE_CACHE.has(filePath)) return IMAGE_SIZE_CACHE.get(filePath);
  const buf = await readFile(filePath);
  const size = parseImageSize(buf);
  if (!size) throw new Error(`Could not read image size: ${filePath}`);
  IMAGE_SIZE_CACHE.set(filePath, size);
  return size;
}

function parseImageSize(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    return jpegSize(buf);
  }
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
    return webpSize(buf);
  }
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  return null;
}

function jpegSize(buf) {
  let offset = 2;
  while (offset < buf.length) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1];
    const length = buf.readUInt16BE(offset + 2);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return {
        height: buf.readUInt16BE(offset + 5),
        width: buf.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function webpSize(buf) {
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    return {
      width: 1 + buf.readUIntLE(24, 3),
      height: 1 + buf.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8 ") {
    return {
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    const bits = buf.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  return null;
}

async function waitForPaint(page) {
  await page.waitForFunction(() => {
    const imgs = [...document.images];
    return imgs.length > 0 && imgs.every((img) => img.complete && img.naturalWidth > 0);
  }, { timeout: 120000 });

  await page.evaluate(async () => {
    await Promise.all(
      [...document.images].map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())),
    );
    if (document.fonts?.ready) await document.fonts.ready;
  });

  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

function box(relX, relY, relW, relH, pageH) {
  return {
    x: relX * PX_TO_PT,
    y: (pageH - (relY + relH)) * PX_TO_PT,
    width: relW * PX_TO_PT,
    height: relH * PX_TO_PT,
  };
}

async function renderPdf(page, htmlUrl, pdfPath, imagePath, contentWidth) {
  await page.setViewportSize({ width: 2400, height: 900 });
  await page.goto(htmlUrl, { waitUntil: "load", timeout: 120000 });
  await waitForPaint(page);

  const readMetrics = () => page.evaluate(() => {
    const pageEl = document.querySelector(".page");
    const img = document.querySelector(".shot");
    const card = document.querySelector(".email-card");
    const pageBox = pageEl.getBoundingClientRect();
    const imgBox = img.getBoundingClientRect();
    const cardBox = card.getBoundingClientRect();
    return {
      width: Math.ceil(pageBox.width),
      height: Math.ceil(pageBox.height),
      pageX: pageBox.left,
      pageY: pageBox.top,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      image: {
        x: imgBox.left - pageBox.left,
        y: imgBox.top - pageBox.top,
        width: imgBox.width,
        height: imgBox.height,
      },
      card: {
        x: cardBox.left - pageBox.left,
        y: cardBox.top - pageBox.top,
        width: cardBox.width,
        height: cardBox.height,
      },
    };
  });

  let metrics = await readMetrics();
  const neededWidth = Math.ceil(metrics.pageX + metrics.width + 8);
  if (neededWidth > 2400) {
    await page.setViewportSize({ width: neededWidth, height: 900 });
    metrics = await readMetrics();
  }

  if (metrics.naturalWidth !== contentWidth) {
    console.warn(
      `Image natural width ${metrics.naturalWidth}px differs from layout ${contentWidth}px`,
    );
  }

  const headerHeight = Math.max(1, Math.round(metrics.image.y));
  const viewW = Math.max(Math.ceil(metrics.pageX + metrics.width), metrics.width);
  const viewH = Math.max(Math.ceil(metrics.pageY + headerHeight + 16), headerHeight + 16);
  await page.setViewportSize({ width: viewW, height: viewH });

  const headerPng = await page.screenshot({
    type: "png",
    omitBackground: false,
    clip: {
      x: Math.max(0, Math.floor(metrics.pageX)),
      y: Math.max(0, Math.floor(metrics.pageY)),
      width: metrics.width,
      height: headerHeight,
    },
  });

  await writeSinglePagePdf(pdfPath, imagePath, metrics, headerPng);
  return metrics;
}

async function embedScreenshot(pdf, imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  const imageBytes = await readFile(imagePath);
  if (ext === ".png") return pdf.embedPng(imageBytes);
  if (ext === ".jpg" || ext === ".jpeg") return pdf.embedJpg(imageBytes);
  throw new Error(`Use PNG or JPG for screenshots so they can be embedded at original quality (${path.basename(imagePath)}).`);
}

async function writeSinglePagePdf(pdfPath, imagePath, metrics, headerPng) {
  const pdf = await PDFDocument.create();
  const pageW = metrics.width * PX_TO_PT;
  const pageH = metrics.height * PX_TO_PT;
  const page = pdf.addPage([pageW, pageH]);

  page.drawRectangle({
    x: 0,
    y: 0,
    width: pageW,
    height: pageH,
    color: rgb(1, 1, 1),
  });

  const header = await pdf.embedPng(headerPng);
  page.drawImage(header, box(0, 0, metrics.width, metrics.image.y, metrics.height));

  const photo = await embedScreenshot(pdf, imagePath);
  page.drawImage(photo, box(
    metrics.image.x,
    metrics.image.y,
    metrics.image.width,
    metrics.image.height,
    metrics.height,
  ));

  const card = box(metrics.card.x, metrics.card.y, metrics.card.width, metrics.card.height, metrics.height);
  const stroke = 2 * PX_TO_PT;
  page.drawRectangle({
    x: card.x + card.width - stroke,
    y: card.y,
    width: stroke,
    height: card.height,
    color: BORDER,
  });
  page.drawRectangle({
    x: card.x,
    y: card.y,
    width: stroke,
    height: card.height,
    color: BORDER,
  });
  page.drawRectangle({
    x: card.x,
    y: card.y,
    width: card.width,
    height: stroke,
    color: BORDER,
  });

  await writeFile(pdfPath, await pdf.save());
}

export async function generateBundle({
  projectRoot,
  outputName,
  layouts,
  screenshotFolder,
  publicBase = "http://127.0.0.1:3456",
}) {
  const safeName = outputName.replace(/\.pdf$/i, "").replace(/[^\w.-]+/g, "_") || "output";
  const outDir = path.join(projectRoot, "output", safeName);
  const htmlDir = path.join(outDir, "html");
  const pagesDir = path.join(outDir, "pages");
  await mkdir(htmlDir, { recursive: true });
  await mkdir(pagesDir, { recursive: true });

  const files = await listScreenshotFiles(screenshotFolder);
  const resolved = [];

  for (const [index, layout] of layouts.entries()) {
    const stem = (layout.imageStem || "").toLowerCase().trim();
    const imagePath = files[stem];
    if (!imagePath) {
      const available = Object.keys(files).sort().join(", ") || "(none)";
      throw new Error(
        `No screenshot named "${stem}" in ${screenshotFolder}. Found: ${available}`,
      );
    }
    const { width, height } = await imageSize(imagePath);
    const ext = path.extname(imagePath);
    const fileBase = `${String(index + 1).padStart(2, "0")}-${layout.viewType}-${stem}`;
    const htmlPath = path.join(htmlDir, `${fileBase}.html`);
    const pdfPath = path.join(pagesDir, `${fileBase}.pdf`);
    const assetName = `${fileBase}${ext}`;
    await copyFile(imagePath, path.join(htmlDir, assetName));
    const html = renderLayout({
      viewType: layout.viewType,
      from: layout.from,
      to: layout.to,
      cc: layout.cc,
      subject: layout.subject,
      imageSrc: `./${assetName}`,
      contentWidth: width,
    });
    await writeFile(htmlPath, html, "utf8");
    resolved.push({ ...layout, stem, imagePath, width, height, htmlPath, pdfPath, fileBase });
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-lcd-text", "--hide-scrollbars"],
  });

  try {
    const context = await browser.newContext({
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    for (const item of resolved) {
      const htmlUrl = `${publicBase}/output/${encodeURIComponent(safeName)}/html/${encodeURIComponent(item.fileBase)}.html`;
      await renderPdf(page, htmlUrl, item.pdfPath, item.imagePath, item.width);
    }
    await context.close();
  } finally {
    await browser.close();
  }

  const merged = await PDFDocument.create();
  for (const item of resolved) {
    const bytes = await readFile(item.pdfPath);
    const doc = await PDFDocument.load(bytes);
    const copied = await merged.copyPages(doc, [0]);
    copied.forEach((p) => merged.addPage(p));
  }

  const mergedPath = path.join(outDir, `${safeName}.pdf`);
  await writeFile(mergedPath, await merged.save());
  await writeFile(
    path.join(outDir, "source.json"),
    JSON.stringify(
      { uploadFolder: path.relative(projectRoot, screenshotFolder) },
      null,
      2,
    ),
  );

  return {
    outputDir: outDir,
    mergedPath,
    pages: resolved.map((item) => ({
      fileBase: item.fileBase,
      viewType: item.viewType,
      stem: item.stem,
      width: item.width,
      height: item.height,
      html: path.relative(projectRoot, item.htmlPath),
      pdf: path.relative(projectRoot, item.pdfPath),
    })),
  };
}
