// يستخرج كتلة <script> المضمَّنة في index.html إلى ملف مؤقت لفحصها بـESLint —
// ESLint لا يفهم HTML مباشرة، وتجنّبنا إضافة eslint-plugin-html كاعتمادية
// إضافية لأجل هذا فقط. الملف الناتج مؤقت، يُحذَف تلقائياً بعد كل فحص.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const match = html.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/);
if (!match) {
  console.error("لم يُعثر على كتلة <script> مضمَّنة في index.html");
  process.exit(1);
}
fs.writeFileSync(path.join(root, ".lint-extracted.js"), match[1]);
