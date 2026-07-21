// أدوات مشتركة: قراءة الملفات الحقيقية، استخراج مقاطع منها بعلامات مرجعية،
// وتشغيلها في سياق vm معزول بدل mock كامل للمتصفح.
// الهدف: اختبار الكود الفعلي في index.html و sw.js كما هو — بلا نسخ أو إعادة كتابة
// منطق منفصل قد ينحرف عن الأصل.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..", "..");

export function readIndexHtml() {
  return fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
}
export function readSw() {
  return fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
}

/**
 * يستخرج النص بين علامتين حرفيّتين موجودتين فعلاً في المصدر (شاملاً البداية،
 * غير شاملة النهاية). يرمي خطأً واضحاً إن لم تُوجد العلامة — هذا يحمينا من
 * اختبار يمرّ صامتاً على كود فارغ لو تغيّر تعليق أو عنوان قسم مستقبلاً.
 */
export function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start === -1) {
    throw new Error("لم توجد علامة البداية في المصدر: " + startMarker.slice(0, 70));
  }
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) {
    throw new Error("لم توجد علامة النهاية في المصدر: " + endMarker.slice(0, 70));
  }
  return source.slice(start, end);
}

/** يستخرج كل كتل <script> غير الخارجية من ملف HTML */
export function extractAllScripts(html) {
  return [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

/** ينفّذ كوداً داخل سياق vm معطى ويعيد نفس السياق (المتغيرات var/function تُصبح خصائص عليه) */
export function runInContext(code, context, filename = "extracted.js") {
  vm.createContext(context);
  new vm.Script(code, { filename }).runInContext(context);
  return context;
}

/** عنصر DOM وهمي بأدنى واجهة تكفي الكود المُختبَر */
export function mockElement(id = "") {
  return {
    id,
    style: {},
    dataset: {},
    textContent: "",
    innerHTML: "",
    value: "",
    classList: {
      add() {}, remove() {}, toggle() {}, contains() { return false; },
    },
    addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    appendChild() {}, focus() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

/** مستند وهمي يبني عناصر عند الطلب ويتذكرها (getElementById يعيد نفس العنصر لنفس الـid) */
export function mockDocument() {
  const elements = new Map();
  return {
    _elements: elements,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, mockElement(id));
      return elements.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    createElement() { return mockElement(); },
    body: mockElement("body"),
    documentElement: mockElement("html"),
  };
}

/** Store وهمي بواجهة get/set/load مطابقة لواجهة Store الحقيقية في index.html */
export function mockStore(initial = {}) {
  const data = { ...initial };
  return {
    _data: data,
    get(k, d) { return k in data ? data[k] : d; },
    set(k, v) { data[k] = v; },
    load() {},
  };
}
