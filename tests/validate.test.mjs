// اختبارات Validate — طبقة تحقق أساسية خفيفة الوزن (بلا مكتبة خارجية) للمدخلات
// التي تُخزَّن أو تُستخدَم لاحقاً في حسابات، حيث قيمة فاسدة قد تُنتج NaN صامتاً.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readIndexHtml, extractBetween, runInContext } from "./helpers/extract.mjs";

const html = readIndexHtml();
const moduleSource = extractBetween(html, "const Validate = {", "\nfunction wrapCanvasText")
  .replace("const Validate", "var Validate");

function buildValidate() {
  const context = { console, Math, Object, String, Number };
  runInContext(moduleSource, context, "validate.js");
  return context.Validate;
}

describe("Validate.time — صيغة HH:MM صحيحة فعلياً لا شكلية فقط", () => {
  const Validate = buildValidate();

  test("قيم صحيحة تُقبَل كما هي", () => {
    ["00:00", "23:59", "08:00", "14:30"].forEach((v) => {
      assert.equal(Validate.time(v, "FALLBACK"), v);
    });
  });

  test("ساعة ≥24 أو دقيقة ≥60 تُرفَض رغم مطابقة الصيغة الشكلية HH:MM", () => {
    assert.equal(Validate.time("24:00", "FB"), "FB");
    assert.equal(Validate.time("12:60", "FB"), "FB");
    assert.equal(Validate.time("99:99", "FB"), "FB");
  });

  test("نص عشوائي، فارغ، أو undefined يعود للقيمة الاحتياطية", () => {
    assert.equal(Validate.time("hello", "FB"), "FB");
    assert.equal(Validate.time("", "FB"), "FB");
    assert.equal(Validate.time(undefined, "FB"), "FB");
    assert.equal(Validate.time(null, "FB"), "FB");
  });

  test("رقم واحد فقط (بلا نقطتين) يُرفَض", () => {
    assert.equal(Validate.time("8", "FB"), "FB");
    assert.equal(Validate.time("800", "FB"), "FB");
  });

  test("مسافات إضافية حول قيمة صحيحة تُرفَض (لا تشذيب ضمني قد يُخفي إدخالاً فاسداً)", () => {
    assert.equal(Validate.time(" 08:00", "FB"), "FB");
    assert.equal(Validate.time("08:00 ", "FB"), "FB");
  });
});

describe("Validate.ratingInList — تقييم صحيح ضمن نطاق مغلق", () => {
  const Validate = buildValidate();

  test("قيم ضمن النطاق تُقبَل", () => {
    [1, 2, 3, 4, 5].forEach((n) => {
      assert.equal(Validate.ratingInList(n, [1,2,3,4,5], -1), n);
      assert.equal(Validate.ratingInList(String(n), [1,2,3,4,5], -1), n, "نص رقمي يجب تحويله");
    });
  });

  test("خارج النطاق يعود للاحتياطي", () => {
    assert.equal(Validate.ratingInList(0, [1,2,3,4,5], -1), -1);
    assert.equal(Validate.ratingInList(6, [1,2,3,4,5], -1), -1);
    assert.equal(Validate.ratingInList(100, [1,2,3,4,5], -1), -1);
  });

  test("قيم عشرية أو غير رقمية تُرفَض حتى لو كانت 'قريبة' من قيمة صحيحة", () => {
    assert.equal(Validate.ratingInList(3.5, [1,2,3,4,5], -1), -1);
    assert.equal(Validate.ratingInList("abc", [1,2,3,4,5], -1), -1);
    assert.equal(Validate.ratingInList(undefined, [1,2,3,4,5], -1), -1);
    assert.equal(Validate.ratingInList(null, [1,2,3,4,5], -1), -1);
  });
});

describe("Validate.apiKeyLooksValid — فحص معقولية أساسي لمفتاح API", () => {
  const Validate = buildValidate();

  test("مفاتيح بطول واقعي من مزوّدين مختلفين تُقبَل", () => {
    assert.equal(Validate.apiKeyLooksValid("sk-proj-abcdefghijklmnopqrstuvwxyz1234567890"), true);
    assert.equal(Validate.apiKeyLooksValid("AIzaSyD-1234567890abcdefghijklmnopqrstuv"), true);
    assert.equal(Validate.apiKeyLooksValid("sk-ant-api03-1234567890abcdefghij"), true);
  });

  test("فارغ أو قصير جداً (لصق جزئي بالخطأ) يُرفَض", () => {
    assert.equal(Validate.apiKeyLooksValid(""), false);
    assert.equal(Validate.apiKeyLooksValid("sk-123"), false);
    assert.equal(Validate.apiKeyLooksValid(undefined), false);
  });

  test("يحتوي مسافة داخلية (لصق خاطئ لأكثر من كلمة) يُرفَض", () => {
    assert.equal(Validate.apiKeyLooksValid("sk-abc def ghi jklmnopqrst"), false);
  });

  test("طويل بشكل غير منطقي (لصق محتوى خاطئ بالكامل، فقرة كاملة مثلاً) يُرفَض", () => {
    assert.equal(Validate.apiKeyLooksValid("a".repeat(301)), false);
    assert.equal(Validate.apiKeyLooksValid("a".repeat(300)), true, "300 بالضبط لا يزال ضمن الحد");
  });

  test("مسافات بادئة/تابعة تُشذَّب قبل الفحص", () => {
    assert.equal(Validate.apiKeyLooksValid("  sk-abcdefghijklmnop  "), true);
  });
});
