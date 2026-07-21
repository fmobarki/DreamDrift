// فحوصات سلامة سريعة (smoke tests) على مستوى المستودع كاملاً — خط دفاع أول
// رخيص التكلفة يُشغَّل أولاً في CI قبل الاختبارات الأعمق. يكتشف أخطاء نشر
// شائعة: أيقونة مفقودة، manifest غير متطابق، أو كود مكسور نحوياً.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, readIndexHtml, extractAllScripts, extractBetween } from "./helpers/extract.mjs";

describe("index.html — سلامة عامة", () => {
  test("كل كتل <script> صحيحة نحوياً", () => {
    const scripts = extractAllScripts(readIndexHtml());
    assert.ok(scripts.length > 0, "يجب وجود سكربت واحد على الأقل");
    scripts.forEach((s, i) => {
      assert.doesNotThrow(() => new Function(s), `سكربت #${i} يحتوي خطأ نحوياً`);
    });
  });

  test("شارة الشجرة المصغّرة في الرئيسية: كل معرّفاتها موجودة في HTML وتُحدَّث فعلياً من renderTree", () => {
    const html = readIndexHtml();
    ["treeBadgeIcon", "treeBadgeStation", "treeBadgeBar"].forEach((id) => {
      assert.match(html, new RegExp(`id="${id}"`), `العنصر ${id} يجب أن يوجد في HTML`);
      assert.match(html, new RegExp(`getElementById\\("${id}"\\)`), `renderTree يجب أن يُحدّث ${id}`);
    });
  });

  test("لا بقايا لبطاقة الشجرة الكاملة القديمة المكرَّرة في الرئيسية (treeStage/treeMap بلا لاحقة 2)", () => {
    const html = readIndexHtml();
    // بعد التصميم الجديد: النسخة الكاملة تحمل لاحقة \"2\" فقط (في رحلتي)،
    // والرئيسية تستخدم معرّفات الشارة المصغّرة الجديدة حصراً
    assert.equal(html.includes('id="treeStage"'), false);
    assert.equal(html.includes('id="treeMap"'), false);
    assert.match(html, /id="treeStage2"/);
    assert.match(html, /id="treeMap2"/);
  });

  test("نسبة النوم (scoreNum/scoreGrade/score-track) لا تستخدم أبيض مُثبَّتاً — يختفي في السمة الفاتحة", () => {
    // خلل حقيقي وُجد ميدانياً: fill="white" مباشرة على نص SVG يبقى أبيض دائماً
    // بصرف النظر عن السمة، فيختفي فوق بطاقة السمة الفاتحة شبه البيضاء.
    // نتحقق من عنصري النسبة تحديداً لا نحظر fill="white" عموماً — فبعض
    // الزخارف (القمر، الوجه) تستخدمه بأمان فوق أيقونات ملوّنة ذاتية الاكتفاء.
    const html = readIndexHtml();
    const scoreBlock = extractBetween(html, '<div class="score-ring" id="scoreRing">', "</div>\n    <div class=\"score-info\">");
    assert.equal(scoreBlock.includes('fill="white"'), false, "لا نص داخل حلقة النسبة يجب أن يستخدم fill أبيض ثابتاً");
    const scoreNumTag = scoreBlock.match(/<text[^>]*id="scoreNum"[^>]*>/)?.[0] || "";
    const scoreGradeTag = scoreBlock.match(/<text[^>]*id="scoreGrade"[^>]*>/)?.[0] || "";
    assert.match(scoreNumTag, /style="fill:var\(--text\)"/, "scoreNum يجب أن يستخدم var(--text)");
    assert.match(scoreGradeTag, /style="fill:var\(--muted\)"/, "scoreGrade يجب أن يستخدم var(--muted)");
  });

  test("متغيرات السطوح الشفافة (--w03..--w25) لا تحتوي مرجعية دائرية في :root", () => {
    // خلل حقيقي وقع أثناء البناء الآلي: استبدال شامل طال تعريف المتغيرات نفسها
    // فأنتج --w08:var(--w08) بدل rgba(255,255,255,.08) — يُبطل المتغير كلياً.
    const html = readIndexHtml();
    const opacities = ["03","04","05","06","07","08","09","1","12","15","2","25"];
    opacities.forEach((op) => {
      assert.equal(html.includes(`--w${op}:var(--w${op})`), false, `--w${op} يجب ألا يشير لنفسه`);
    });
  });

  test("لا خلفيات/حدود بيضاء شفافة خام (rgba(255,255,255,.03-.25)) خارج نظام متغيرات --wNN — تختفي في السمة الفاتحة", () => {
    const html = readIndexHtml();
    // نستثني أسطر Canvas (ctx.fillStyle/strokeStyle) التي يجب أن تبقى ألواناً حرفية
    const offendingLines = html.split("\n").filter((l) => {
      if (l.includes("ctx.fillStyle") || l.includes("ctx.strokeStyle")) return false;
      if (l.includes("--w")) return false; // تعريف المتغير نفسه، لا استخدام خام
      return /rgba\(255,255,255,\.(0[3-9]|1|12|15|2|25)\)/.test(l);
    });
    assert.deepEqual(offendingLines, [], "وُجد استخدام خام لم يُحوَّل لمتغير --wNN");
  });

  test("لا بقايا نصية لـ'binaural' خارج منطق الترحيل المتعمَّد (حذف المفتاح من بيانات مستخدمين قدامى)", () => {
    const html = readIndexHtml();
    const linesWithBinaural = html.split("\n").filter((l) => /binaural/i.test(l));
    // سطر واحد فقط مسموح بذكر الكلمة — وقد تظهر فيه مرتين (فحص "in" ثم "delete")
    assert.equal(linesWithBinaural.length, 1, "أي وجود خارج سطر واحد يعني بقايا ميتة أو حذف منطق الترحيل بالخطأ");
    assert.match(linesWithBinaural[0], /delete data\.mixLevels\.binaural/, "السطر المسموح يجب أن يكون سطر تنظيف الترحيل تحديداً");
  });

  test("لا زر/دالة تشخيص مؤقتة متروكة (audioDiag)", () => {
    assert.equal(readIndexHtml().includes("audioDiag"), false);
  });

  test("يشير إلى manifest.json و sw.js بمسارات نسبية (تعمل تحت أي مسار فرعي)", () => {
    const html = readIndexHtml();
    assert.match(html, /<link rel="manifest" href="manifest\.json">/);
    assert.match(html, /serviceWorker\.register\(['"]\.\/sw\.js['"]\)/);
  });

  test("وسوم الأيقونات تشير لملفات حقيقية موجودة فعلاً على القرص (لا SVG مضمّن متروك)", () => {
    const html = readIndexHtml();
    const iconHrefs = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(iconHrefs.length >= 2, "يجب وجود روابط أيقونات");
    iconHrefs.forEach((href) => {
      assert.equal(href.startsWith("data:"), false, `الأيقونة "${href}" لا يجب أن تكون data-URI مضمّنة`);
      assert.ok(fs.existsSync(path.join(ROOT, href)), `الملف غير موجود: ${href}`);
    });
  });
});

describe("السمة الفاتحة — أُلغيت نهائياً بقرار مقصود (2026-07-21)", () => {
  test("لا وجود لأي قاعدة body.light في CSS", () => {
    const html = readIndexHtml();
    assert.equal(html.includes("body.light"), false);
  });

  test("لا وجود لآلية تبديل السمة (theme.toggle/theme.set) أو زر التبديل", () => {
    const html = readIndexHtml();
    ["theme.toggle()", "theme.set(", 'id="themeBtn"'].forEach((needle) => {
      assert.equal(html.includes(needle), false, `"${needle}" يجب ألا يوجد بعد إلغاء السمة`);
    });
  });

  test("لا صف إعدادات أو حساب يعرض اختيار السمة (p_theme/pTheme/sTheme)", () => {
    const html = readIndexHtml();
    ["p_theme", 'id="pTheme"', 'id="sTheme"'].forEach((needle) => {
      assert.equal(html.includes(needle), false, `"${needle}" يجب ألا يوجد بعد إلغاء السمة`);
    });
  });

  test("meta[theme-color] ثابت على اللون الداكن دائماً", () => {
    const html = readIndexHtml();
    assert.match(html, /<meta name="theme-color" content="#0B1020">/);
  });
});

describe("اتساق رقم الإصدار وخارطة الطريق (تعارض إصدارات وُجد ميدانياً)", () => {
  test("لا بطاقة مزامنة سحابية مكرّرة في الإعدادات — مُغطاة فقط في خارطة الطريق", () => {
    const html = readIndexHtml();
    assert.equal(html.includes('class="card cloud-coming"'), false);
  });

  test("شارة خارطة الطريق الكبيرة ديناميكية (لا رقم ثابت مثل 'v 1.1')، وsyncAppVersion يُحدّثها", () => {
    const html = readIndexHtml();
    assert.match(html, /<div class="coming-version" id="comingVersionBadge">/);
    assert.match(html, /comingVersionBadge["']\)/);
  });

  test("لا يوجد أي feature مُدرَج كـ'locked' في خارطة الطريق بشارة إصدار أقدم من أو تساوي الإصدار الحالي", () => {
    // كان هذا الخلل الجوهري: ميزة "locked" ببطاقة v1.3 بينما الإصدار الحالي 1.3 —
    // تناقض منطقي (لو الإصدار صدر، يجب أن تكون الميزة منجزة لا مقفلة)
    const html = readIndexHtml();
    const appVersionMatch = html.match(/const APP_VERSION = "(\d+)\.(\d+)\.(\d+)"/);
    assert.ok(appVersionMatch, "APP_VERSION غير موجود");
    const currentMinor = parseInt(appVersionMatch[2], 10);
    const lockedBadges = [...html.matchAll(/coming-ver-badge">v(\d+)\.(\d+)</g)];
    lockedBadges.forEach(([, , minor]) => {
      assert.ok(parseInt(minor, 10) > currentMinor, `شارة v${minor} يجب أن تكون أحدث من الإصدار الحالي (فرعي ${currentMinor})`);
    });
  });

  test("لا وصف يذكر 'موجات ثنائية' المحذوفة ضمن ميزات 'برمجة الدماغ' المُنجَزة", () => {
    const html = readIndexHtml();
    assert.equal(html.includes("موجات ثنائية"), false);
  });
});

describe("sw.js — سلامة عامة", () => {
  test("صحيح نحوياً", () => {
    const swPath = path.join(ROOT, "sw.js");
    assert.doesNotThrow(() => new Function(fs.readFileSync(swPath, "utf8")));
  });

  test("لا بقايا لـ'binaural'", () => {
    const content = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
    assert.equal(content.toLowerCase().includes("binaural"), false);
  });

  test("يستدعي self.skipWaiting() عند التثبيت (شرط عمل شريط التحديث)", () => {
    const content = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
    assert.match(content, /self\.skipWaiting\(\)/);
  });
});

describe("manifest.json", () => {
  const manifestPath = path.join(ROOT, "manifest.json");
  let manifest;

  test("JSON صالح", () => {
    assert.doesNotThrow(() => { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); });
  });

  test("يحتوي الحقول الأساسية المطلوبة لتثبيت PWA", () => {
    ["name", "short_name", "start_url", "display", "background_color", "theme_color", "icons"].forEach((key) => {
      assert.ok(manifest[key] !== undefined, `الحقل "${key}" مفقود`);
    });
  });

  test("يحتوي أيقونة 192x192 وأخرى 512x512 على الأقل (شرط التثبيت في Chrome)", () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    assert.ok(sizes.includes("192x192"), "أيقونة 192x192 مطلوبة");
    assert.ok(sizes.includes("512x512"), "أيقونة 512x512 مطلوبة");
  });

  test("يحتوي أيقونة maskable واحدة على الأقل (أندرويد adaptive icons)", () => {
    assert.ok(manifest.icons.some((i) => i.purpose === "maskable"));
  });

  test("كل مسارات الأيقونات المذكورة موجودة فعلاً على القرص", () => {
    manifest.icons.forEach((icon) => {
      assert.ok(fs.existsSync(path.join(ROOT, icon.src)), `ملف الأيقونة غير موجود: ${icon.src}`);
    });
  });

  test("theme_color في manifest.json يطابق meta[theme-color] في index.html (اتساق الهوية البصرية)", () => {
    const html = readIndexHtml();
    const m = html.match(/<meta name="theme-color" content="([^"]+)">/);
    assert.ok(m, "meta[theme-color] غير موجود في index.html");
    assert.equal(manifest.theme_color.toLowerCase(), m[1].toLowerCase());
  });
});

describe("بنية المستودع", () => {
  ["index.html", "manifest.json", "sw.js", "README.md", "LICENSE", ".gitignore"].forEach((file) => {
    test(`الملف الجذري "${file}" موجود`, () => {
      assert.ok(fs.existsSync(path.join(ROOT, file)));
    });
  });

  test("package.json (إن وُجد) لأدوات التطوير فقط — بلا اعتماديات وبلا خطوة بناء لملفات التطبيق", () => {
    const pkgPath = path.join(ROOT, "package.json");
    if (!fs.existsSync(pkgPath)) return; // لا مشكلة إن غاب كلياً
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    assert.equal(pkg.dependencies, undefined, "لا اعتماديات إنتاج — الاختبارات تستخدم node:test المدمج فقط");
    assert.equal(pkg.scripts?.build, undefined, "التطبيق يُنشَر كما هو، بلا خطوة بناء");
  });
});
