// Fails the build when the previous brand (or its domain or old phone number) appears in what customers or
// crawlers can see: the built site (dist/) and, when the backend is next to it, the email and PDF templates.
// Brand details live in frontend/src/config/brand.js and backend/src/config/env.js (see README "Brand").
//
//   node scripts/check-brand.mjs            # after vite build (part of npm run build)
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Assembled at runtime so this file does not trip itself or end up in the build.
const OLD_NAME = ["r", "i", "s", "e", "r"].join("");
const PATTERN = new RegExp(`${OLD_NAME}|778[\\s-]?775[\\s-]?044`, "i");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  { dir: path.join(root, "dist"), required: true },
  // Email and PDF templates (only when the backend is checked out next to the frontend).
  { dir: path.join(root, "../backend/src/services/email"), required: false },
  { dir: path.join(root, "../backend/src/services/invoiceDocuments"), required: false, files: ["pdf.js", "view.js", "company.js", "brandMark.js"] },
  { dir: path.join(root, "../backend/src/services/myBooking"), required: false, files: ["ticketPdf.js"] }
];

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

const problems = [];
let checked = 0;
for (const target of targets) {
  if (!fs.existsSync(target.dir)) {
    if (target.required) {
      console.error(`check-brand: ${target.dir} not found (run vite build first)`);
      process.exit(1);
    }
    continue;
  }
  const files = target.files ? target.files.map((name) => path.join(target.dir, name)).filter((file) => fs.existsSync(file)) : walk(target.dir);
  for (const file of files) {
    if (!/\.(html|js|mjs|css|json|svg|txt|xml|webmanifest)$/i.test(file)) continue;
    checked += 1;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      const match = line.match(PATTERN);
      if (match) {
        const at = Math.max(0, match.index - 40);
        problems.push(`${path.relative(root, file)}:${index + 1}: …${line.slice(at, match.index + 60)}…`);
      }
    });
  }
}

if (problems.length) {
  console.error(`check-brand: the previous brand appears in ${problems.length} place(s):`);
  problems.slice(0, 50).forEach((problem) => console.error(`  ${problem}`));
  console.error("Use the brand settings (frontend/src/config/brand.js, backend env) instead. If this comes from a hosting setting (VITE_*), change that setting.");
  process.exit(1);
}
console.log(`check-brand: ${checked} files checked, no previous-brand text.`);
