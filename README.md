# Email proof PDF generator

Local tool for email proof PDFs. Upload mobile and desktop screenshots, fill the header, preview in the browser, then export one merged PDF.

## Layout

Each page has:

- Left label: **Desktop View** or **Mobile View**
- Header fields: From, To, CC, Subject
- Screenshot under the header

## Folder structure

```text
pdf-generator/
  src/              server, HTML template, Playwright export
  public/           form UI
  templates/        shared layout CSS
  output/<name>/    generated HTML, page PDFs, and merged PDF
```

## Screenshot names

Upload a folder of images named:

- Desktop: `d1.png`, `d2.jpg`, …
- Mobile: `m1.png`, `m2.jpg`, …

Pair count is `files ÷ 2`. Eight files become four pairs (`m1+d1` … `m4+d4`). Page order is **m1, d1, m2, d2**, and so on. From, To, and CC are shared. Each pair has its own Subject.

## Run

```bash
npm install
npm start
```

Open [http://localhost:3456](http://localhost:3456).

1. Set the final file name.
2. Upload the screenshots folder.
3. Fill From, To, and CC.
4. Enter a Subject for each pair.
5. Preview and generate.

Use **View generated files** to open or delete old output.
