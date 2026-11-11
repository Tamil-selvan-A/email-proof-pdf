const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff"];

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function viewLabel(type) {
  return type === "mobile" ? "Mobile View" : "Desktop View";
}

export function layoutCss() {
  return `/* Print-safe layout. Do not use zoom/transform — those break Playwright PDFs. */
@page { margin: 0; size: auto; }

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: #ffffff;
  color: #1f2836;
  font-family: Arial, Helvetica, sans-serif;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.page {
  width: fit-content;
  min-width: var(--page-width);
  min-height: var(--page-height, auto);
  margin: 0;
  padding: 90px 79px 0 0;
  background: #ffffff;
  position: relative;
  overflow: visible;
}

.view-label {
  position: absolute;
  left: 80px;
  top: 118px;
  min-width: 188px;
  text-align: center;
  font-size: 28px;
  line-height: 1;
  padding: 18px 16px;
  border: 2px solid #c8c8c8;
  background: #ffffff;
  color: #1f2836;
}

.email-card {
  margin-left: var(--gutter);
  width: max(var(--content-width), min-content);
  border: 2px solid #c8c8c8;
  background: #ffffff;
  overflow: hidden;
}

.meta {
  background: linear-gradient(180deg, #fbfbfb 0%, #ececec 100%);
  padding: 36px 34px 28px 24px;
}

.row {
  display: flex;
  align-items: flex-start;
  margin-bottom: 18px;
}

.row:last-child {
  margin-bottom: 0;
}

.key {
  width: 132px;
  flex: 0 0 132px;
  padding-top: 12px;
  padding-right: 16px;
  text-align: right;
  font-size: 26px;
  line-height: 1.2;
  color: #1f2836;
}

.val {
  flex: 1 1 auto;
  min-height: 52px;
  min-width: 0;
  background: #ffffff;
  border: 1px solid #cfcfcf;
  border-radius: 10px;
  padding: 11px 16px;
  font-size: 28px;
  line-height: 1.25;
  color: #1f2836;
  word-break: break-word;
}

.val.single-line {
  flex: 1 0 auto;
  min-width: max-content;
  white-space: nowrap;
  word-break: normal;
}

.shot {
  display: block;
  width: 100%;
  height: auto;
  max-width: 100%;
  border: 0;
  outline: 0;
  vertical-align: top;
}
`;
}

export function renderLayout({
  viewType = "desktop",
  from = "",
  to = "",
  cc = "",
  subject = "",
  imageSrc,
  contentWidth,
  cssHref = null,
  fitPreview = false,
}) {
  const gutter = viewType === "mobile" ? 394 : 400;
  const rightPad = 79;
  const pageWidth = gutter + contentWidth + rightPad;
  const cssBlock = cssHref
    ? `<link rel="stylesheet" href="${escapeHtml(cssHref)}">`
    : `<style>${layoutCss()}</style>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${pageWidth}">
  <title>${escapeHtml(viewLabel(viewType))}</title>
  ${cssBlock}
  <style>
    :root {
      --page-width: ${pageWidth}px;
      --gutter: ${gutter}px;
      --content-width: ${contentWidth}px;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="view-label">${escapeHtml(viewLabel(viewType))}</div>
    <div class="email-card">
      <div class="meta">
        <div class="row">
          <div class="key">From:</div>
          <div class="val single-line">${escapeHtml(from)}</div>
        </div>
        <div class="row">
          <div class="key">To:</div>
          <div class="val single-line">${escapeHtml(to)}</div>
        </div>
        <div class="row">
          <div class="key">CC:</div>
          <div class="val single-line">${escapeHtml(cc)}</div>
        </div>
        <div class="row">
          <div class="key">Subject:</div>
          <div class="val">${escapeHtml(subject)}</div>
        </div>
      </div>
      <img class="shot" src="${escapeHtml(imageSrc)}" alt="Email screenshot" decoding="sync" loading="eager">
    </div>
  </div>
  ${fitPreview ? previewFitScript() : ""}
</body>
</html>`;
}

function previewFitScript() {
  return `<script>
    function fitPreview() {
      const page = document.querySelector(".page");
      if (!page) return;
      const scale = Math.min(1, window.innerWidth / page.offsetWidth);
      page.style.transformOrigin = "top left";
      page.style.transform = "scale(" + scale + ")";
      document.body.style.width = "100%";
      document.body.style.overflow = "hidden";
      document.body.style.height = page.offsetHeight * scale + "px";
    }
    addEventListener("load", fitPreview);
    addEventListener("resize", fitPreview);
  </script>`;
}

export function isImageName(name) {
  const lower = name.toLowerCase();
  return IMAGE_EXTS.some((ext) => lower.endsWith(ext));
}

export function stemOf(filename) {
  return filename.replace(/\.[^.]+$/, "").toLowerCase();
}
