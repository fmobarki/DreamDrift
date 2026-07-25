// اختبارات AIKeyCrypto/exportPw/export()/importFile() — استجابة لخلل ميداني
// حقيقي: تصدير البيانات كان يُخرج مفتاح الذكاء الاصطناعي بنص صريح في الملف.
// القرار المُتَّفَق عليه: تشفير حقيقي (لا وهمي) بكلمة مرور يُدخلها المستخدم
// بنفسه، إلزامي دائماً (لا خيار تعطيل) — الأمان والخصوصية أولاً في هذا التطبيق.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readIndexHtml, extractBetween, runInContext, mockDocument, mockStore } from "./helpers/extract.mjs";

const html = readIndexHtml();

// عمليات AIKeyCrypto حقيقية وثقيلة عمداً (PBKDF2 بـ250,000 تكرار) — مهلة ثابتة
// صغيرة قد لا تكفي على أجهزة أبطأ. هذه الدالة تستقصي الشرط بدل الانتظار الأعمى،
// فتكون سريعة عندما يكتمل الشرط مبكراً وآمنة إن استغرق وقتاً أطول حتى سقف معقول.
async function waitFor(conditionFn, { timeout = 2000, interval = 10 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (conditionFn()) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  return conditionFn();
}

// ---------- AIKeyCrypto ----------
const cryptoSource = extractBetween(html, "const AIKeyCrypto = {", "\nconst exportPw = {")
  .replace("const AIKeyCrypto", "var AIKeyCrypto");

function buildCrypto() {
  const context = { console, crypto, btoa, atob, TextEncoder, TextDecoder, Uint8Array };
  runInContext(cryptoSource, context, "ai-key-crypto.js");
  return context.AIKeyCrypto;
}

describe("AIKeyCrypto — تشفير حقيقي (PBKDF2 + AES-GCM)، لا تشفير وهمي بمفتاح مُضمَّن", () => {
  test("تشفير ثم فك تشفير بنفس كلمة المرور يُعيد النص الأصلي بالضبط", async () => {
    const AIKeyCrypto = buildCrypto();
    const blob = await AIKeyCrypto.encrypt("كلمة-مرور-قوية-١٢٣", "sk-real-secret-key-abcdef");
    const decrypted = await AIKeyCrypto.decrypt("كلمة-مرور-قوية-١٢٣", blob);
    assert.equal(decrypted, "sk-real-secret-key-abcdef");
  });

  test("كلمة مرور خاطئة عند فك التشفير ترمي خطأً — لا تُعيد نصاً فاسداً بصمت", async () => {
    const AIKeyCrypto = buildCrypto();
    const blob = await AIKeyCrypto.encrypt("الصحيحة", "sk-secret");
    await assert.rejects(() => AIKeyCrypto.decrypt("الخاطئة", blob));
  });

  test("النص المُشفَّر مختلف في كل مرة حتى بنفس المدخلات — ملح وIV عشوائيان (لا تسريب نمط)", async () => {
    const AIKeyCrypto = buildCrypto();
    const blob1 = await AIKeyCrypto.encrypt("pw", "same-secret");
    const blob2 = await AIKeyCrypto.encrypt("pw", "same-secret");
    assert.notEqual(blob1.salt, blob2.salt);
    assert.notEqual(blob1.iv, blob2.iv);
    assert.notEqual(blob1.ciphertext, blob2.ciphertext);
  });

  test("العبث بالنص المُشفَّر يُسقط فك التشفير — AES-GCM يتحقق من السلامة تلقائياً", async () => {
    const AIKeyCrypto = buildCrypto();
    const blob = await AIKeyCrypto.encrypt("pw", "sk-secret");
    const tampered = { ...blob, ciphertext: blob.ciphertext.slice(0, -4) + "AAAA" };
    await assert.rejects(() => AIKeyCrypto.decrypt("pw", tampered));
  });

  test("يستخدم 250,000 تكرار PBKDF2 على الأقل (مقاومة القوة الغاشمة)", () => {
    assert.ok(buildCrypto().ITERATIONS >= 250000);
  });
});

// ---------- exportPw ----------
const pwModuleSource = extractBetween(html, "const exportPw = {", "\nconst dataManager = {")
  .replace("const exportPw", "var exportPw");

function buildExportPw() {
  const document = mockDocument();
  const T = {
    export_pw_title: "عنوان التصدير", export_pw_desc: "وصف التصدير",
    import_pw_title: "عنوان الاستيراد", import_pw_desc: "وصف الاستيراد",
    export_pw_required: "أدخل كلمة مرور",
  };
  const context = { console, document, t: (k) => T[k] ?? k };
  runInContext(pwModuleSource, context, "export-pw.js");
  return { exportPw: context.exportPw, document };
}

describe("exportPw — نافذة كلمة مرور قابلة للانتظار (Promise) من export/import", () => {
  test("confirm() بكلمة مرور صحيحة يُحقِّق الوعد بنفس القيمة", async () => {
    const { exportPw, document } = buildExportPw();
    const promise = exportPw.ask("export");
    document.getElementById("exportPwInput").value = "my-password";
    exportPw.confirm();
    assert.equal(await promise, "my-password");
  });

  test("cancel() يُحقِّق الوعد بـnull", async () => {
    const { exportPw } = buildExportPw();
    const promise = exportPw.ask("export");
    exportPw.cancel();
    assert.equal(await promise, null);
  });

  test("confirm() بحقل فارغ لا يُحقِّق الوعد ويعرض رسالة خطأ، ثم يقبل المحاولة الثانية", async () => {
    const { exportPw, document } = buildExportPw();
    let resolved = false;
    const promise = exportPw.ask("export").then(() => { resolved = true; });
    document.getElementById("exportPwInput").value = "";
    exportPw.confirm();
    assert.equal(resolved, false, "لا يجب أن يُحقَّق الوعد بحقل فارغ");
    assert.equal(document.getElementById("exportPwError").style.display, "block");
    document.getElementById("exportPwInput").value = "later";
    exportPw.confirm();
    await promise;
    assert.equal(resolved, true);
  });

  test("عنوان الاستيراد يختلف عن عنوان التصدير", () => {
    const { exportPw, document } = buildExportPw();
    exportPw.ask("export");
    assert.equal(document.getElementById("exportPwTitle").textContent, "عنوان التصدير");
    exportPw.cancel();
    exportPw.ask("import");
    assert.equal(document.getElementById("exportPwTitle").textContent, "عنوان الاستيراد");
  });
});

// ---------- dataManager.export/importFile (تكامل كامل مع exportPw وAIKeyCrypto الحقيقيين) ----------
const dmModuleSource = extractBetween(html, "const dataManager = {", "\n/* ============================================================\n   PWA")
  .replace("const dataManager", "var dataManager");

// FileReader وهمي: يُنادي onload بعد microtask واحد (يحاكي async حقيقياً بلا تعقيد)
let onloadCallCount = 0;
class FakeFileReader {
  readAsText(file) {
    Promise.resolve().then(() => { onloadCallCount++; this.onload({ target: { result: file.__text } }); });
  }
}

function buildDataManager(storeData) {
  const document = mockDocument();
  const store = mockStore(storeData || {});
  const anchors = [];
  const realCreateElement = document.createElement;
  document.createElement = (tag) => {
    if (tag === "a") {
      const a = { clicked: false, href: "", download: "", click() { this.clicked = true; } };
      anchors.push(a);
      return a;
    }
    return realCreateElement(tag);
  };
  let toastMsg = null;
  let lastBlobText = null;
  const context = {
    console, document, Store: store,
    toast: (m) => { toastMsg = m; },
    t: (k) => k,
    APP_VERSION: "1.4.0",
    navigator: { userAgent: "test-agent" },
    URL: { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} },
    Blob: class { constructor(parts) { lastBlobText = parts[0]; } },
    FileReader: FakeFileReader,
    crypto, btoa, atob, TextEncoder, TextDecoder, Uint8Array,
    Math, Date, JSON, Object,
  };
  // نُشغِّل الثلاثة (التشفير، نافذة كلمة المرور، مدير البيانات) في نفس سياق vm
  // الواحد تحديداً — حقن AIKeyCrypto كمرجع جاهز من سياق منفصل تماماً (مبني عبر
  // buildCrypto() في سياقه الخاص) تسبَّب في تعارض عبور واقعات (realms) أدّى
  // لعدم انعكاس Store.data=merged بشكل صحيح خارج الـvm عند الاختبار.
  runInContext(cryptoSource, context, "ai-key-crypto.js");
  runInContext(pwModuleSource, context, "export-pw.js");
  runInContext(dmModuleSource, context, "data-manager.js");
  return {
    dataManager: context.dataManager,
    exportPw: context.exportPw,
    document, store,
    getToast: () => toastMsg,
    anchors,
    getLastExportedJSON: () => JSON.parse(lastBlobText),
  };
}

describe("dataManager.export — استبعاد المفتاح الخام وتشفيره دائماً بلا خيار تعطيل", () => {
  test("بلا مفتاح ذكاء اصطناعي أصلاً: يُصدَّر فوراً بلا أي طلب كلمة مرور، وaiKeyEncrypted=null", async () => {
    const { dataManager, anchors, getLastExportedJSON } = buildDataManager({ name: "فهد" });
    await dataManager.export();
    assert.equal(anchors.length, 1, "يجب تنزيل ملف واحد فوراً بلا انتظار");
    const exported = getLastExportedJSON();
    assert.equal(exported.aiKeyEncrypted, null);
  });

  test("مع وجود مفتاح: ينتظر كلمة المرور فعلياً قبل إنتاج أي ملف", async () => {
    const { dataManager, exportPw, document, anchors } = buildDataManager({ aiApiKey: "sk-real-secret" });
    const promise = dataManager.export();
    await waitFor(() => document.getElementById("exportPwModal").classList.contains("show"));
    assert.equal(anchors.length, 0, "لا ملف قبل إدخال كلمة المرور");
    document.getElementById("exportPwInput").value = "my-strong-password";
    exportPw.confirm();
    await promise;
    assert.equal(anchors.length, 1);
  });

  test("إلغاء طلب كلمة المرور يُلغي التصدير بالكامل — لا ملف يُنزَّل", async () => {
    const { dataManager, exportPw, anchors, getToast, document } = buildDataManager({ aiApiKey: "sk-real-secret" });
    const promise = dataManager.export();
    await waitFor(() => document.getElementById("exportPwModal").classList.contains("show"));
    exportPw.cancel();
    await promise;
    assert.equal(anchors.length, 0);
    assert.ok(getToast());
  });

  test("الملف المُصدَّر لا يحتوي aiApiKey/aiModelOverride كنص صريح إطلاقاً — الخلل الأصلي المُصلَح", async () => {
    const { dataManager, exportPw, document, getLastExportedJSON } = buildDataManager({
      aiApiKey: "sk-super-secret-plaintext", aiModelOverride: "custom-model", name: "فهد",
    });
    const promise = dataManager.export();
    await waitFor(() => document.getElementById("exportPwModal").classList.contains("show"));
    document.getElementById("exportPwInput").value = "pw123";
    exportPw.confirm();
    await promise;
    const exported = getLastExportedJSON();
    const rawJSON = JSON.stringify(exported);
    assert.equal(rawJSON.includes("sk-super-secret-plaintext"), false, "المفتاح الخام يجب ألا يظهر نصاً صريحاً في الملف المُصدَّر إطلاقاً");
    assert.equal(exported.data.aiApiKey, undefined);
    assert.equal(exported.data.aiModelOverride, undefined);
    assert.ok(exported.aiKeyEncrypted.salt && exported.aiKeyEncrypted.iv && exported.aiKeyEncrypted.ciphertext);
    assert.equal(exported.data.name, "فهد");
  });

  test("فك تشفير الملف المُصدَّر بنفس كلمة المرور يُعيد المفتاح الأصلي بالضبط (تكامل تصدير→استيراد)", async () => {
    const { dataManager, exportPw, document, getLastExportedJSON } = buildDataManager({
      aiApiKey: "sk-original-key-999", aiModelOverride: "gpt-4o-mini",
    });
    const promise = dataManager.export();
    await waitFor(() => document.getElementById("exportPwModal").classList.contains("show"));
    document.getElementById("exportPwInput").value = "correct-horse-battery";
    exportPw.confirm();
    await promise;
    const exported = getLastExportedJSON();
    const AIKeyCrypto = buildCrypto();
    const decrypted = JSON.parse(await AIKeyCrypto.decrypt("correct-horse-battery", exported.aiKeyEncrypted));
    assert.equal(decrypted.key, "sk-original-key-999");
    assert.equal(decrypted.model, "gpt-4o-mini");
  });
});

describe("dataManager.importFile — فك التشفير عند الاستيراد بأمان تدريجي", () => {
  test("نسخة بلا aiKeyEncrypted: تستورد طبيعياً بلا أي طلب كلمة مرور", async () => {
    const built = buildDataManager({});
    const backup = JSON.stringify({
      meta: { app: "DreamDrift", date: "2026-07-01" },
      data: { name: "صديق", moods: { "2026-06-01": 3 } },
    });
    const input = { files: [{ __text: backup }] };
    built.dataManager.importFile(input);
    await waitFor(() => built.store.get("name") === "صديق");
    assert.equal(built.store.get("name"), "صديق");
  });

  test("نسخة بمفتاح مُشفَّر + كلمة مرور صحيحة: يستعيد المفتاح فعلياً", async () => {
    // أولاً نُصدِّر نسخة حقيقية بمفتاح لنحصل على aiKeyEncrypted صحيحاً بنيوياً
    const exporter = buildDataManager({ aiApiKey: "sk-restored-key" });
    const exportPromise = exporter.dataManager.export();
    await waitFor(() => exporter.document.getElementById("exportPwModal").classList.contains("show"));
    exporter.document.getElementById("exportPwInput").value = "shared-pw";
    exporter.exportPw.confirm();
    await exportPromise;
    const backupWithKey = exporter.getLastExportedJSON();

    // الآن نستورد هذه النسخة في بيئة مستخدم جديدة بلا أي مفتاح مسبق
    const importer = buildDataManager({});
    const input = { files: [{ __text: JSON.stringify(backupWithKey) }] };
    importer.dataManager.importFile(input);
    await waitFor(() => importer.document.getElementById("exportPwModal").classList.contains("show"));
    importer.document.getElementById("exportPwInput").value = "shared-pw";
    importer.exportPw.confirm();
    await waitFor(() => importer.store.get("aiApiKey") === "sk-restored-key");
    assert.equal(importer.store.get("aiApiKey"), "sk-restored-key");
  });

  test("نسخة بمفتاح مُشفَّر + كلمة مرور خاطئة: يستورد كل شيء ما عدا المفتاح، بلا فشل كامل", async () => {
    const exporter = buildDataManager({ aiApiKey: "sk-key", name: "فهد" });
    const exportPromise = exporter.dataManager.export();
    await waitFor(() => exporter.document.getElementById("exportPwModal").classList.contains("show"));
    exporter.document.getElementById("exportPwInput").value = "correct-pw";
    exporter.exportPw.confirm();
    await exportPromise;
    const backupWithKey = exporter.getLastExportedJSON();

    const importer = buildDataManager({});
    const input = { files: [{ __text: JSON.stringify(backupWithKey) }] };
    importer.dataManager.importFile(input);
    await waitFor(() => importer.document.getElementById("exportPwModal").classList.contains("show"));
    importer.document.getElementById("exportPwInput").value = "wrong-password";
    importer.exportPw.confirm();
    await waitFor(() => importer.store.get("name") === "فهد");
    assert.equal(importer.store.get("name"), "فهد", "بقية البيانات يجب أن تُستورَد رغم فشل كلمة المرور");
    assert.equal(importer.store.get("aiApiKey", null), null, "المفتاح لا يُستعاد بكلمة مرور خاطئة");
    assert.ok(importer.getToast());
  });
});
