// اختبارات recordCalmSession — توسيع "سجل التهدئة" ليشمل كل أنواع التهدئة
// لا تمارين التنفّس فقط (كان اسمه يَعِد بأكثر مما يفعل فعلياً).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readIndexHtml, extractBetween, runInContext, mockStore } from "./helpers/extract.mjs";

const html = readIndexHtml();
const moduleSource = extractBetween(html, "function recordCalmSession", "\nconst breathe = {");

function buildRecorder(storeData) {
  const store = mockStore(storeData);
  let touched = false;
  const context = {
    console, Store: store,
    app: { touchJourneyDay(){ touched = true; } },
    Date, Object, JSON, Math,
  };
  runInContext(moduleSource, context, "record-calm.js");
  return { recordCalmSession: context.recordCalmSession, store, wasTouched: () => touched };
}

describe("recordCalmSession — تسجيل موحّد لكل أنواع التهدئة", () => {
  test("يسجّل جلسة تنفّس بحقل type وعدد الدورات", () => {
    const { recordCalmSession, store } = buildRecorder({});
    recordCalmSession("breath", { cycles: 5 });
    const s = store.get("breatheSessions");
    assert.equal(s.length, 1);
    assert.equal(s[0].type, "breath");
    assert.equal(s[0].cycles, 5);
    assert.ok(s[0].ts, "يجب تسجيل طابع زمني");
  });

  test("يسجّل جلسة استرخاء صوتي بنوعها الخاص", () => {
    const { recordCalmSession, store } = buildRecorder({});
    recordCalmSession("voice", { lines: 9 });
    assert.equal(store.get("breatheSessions")[0].type, "voice");
  });

  test("يسجّل جلسة مازج أصوات مع مدتها", () => {
    const { recordCalmSession, store } = buildRecorder({});
    recordCalmSession("sounds", { minutes: 30 });
    const s = store.get("breatheSessions")[0];
    assert.equal(s.type, "sounds");
    assert.equal(s.minutes, 30);
  });

  test("بلا نوع محدَّد: يُعامَل كتمرين تنفّس (السلوك التاريخي)", () => {
    const { recordCalmSession, store } = buildRecorder({});
    recordCalmSession();
    assert.equal(store.get("breatheSessions")[0].type, "breath");
  });

  test("يتراكم فوق السجلات القديمة بلا استبدالها", () => {
    const { recordCalmSession, store } = buildRecorder({
      breatheSessions: [{ cycles: 5, ts: "2026-01-01T00:00:00.000Z" }],
    });
    recordCalmSession("voice");
    const s = store.get("breatheSessions");
    assert.equal(s.length, 2);
    assert.equal(s[0].cycles, 5, "السجل القديم يبقى كما هو");
    assert.equal(s[1].type, "voice");
  });

  test("سقف 30 سجلاً: يحذف الأقدم لا الأحدث", () => {
    const old = Array.from({ length: 30 }, (_, i) => ({ type: "breath", ts: "t"+i, cycles: i }));
    const { recordCalmSession, store } = buildRecorder({ breatheSessions: old });
    recordCalmSession("voice");
    const s = store.get("breatheSessions");
    assert.equal(s.length, 30);
    assert.equal(s[29].type, "voice", "الأحدث يجب أن يبقى");
    assert.equal(s[0].cycles, 1, "الأقدم (index 0) هو من يُحذَف");
  });

  test("يُحدِّث يوم الرحلة عند كل تسجيل", () => {
    const { recordCalmSession, wasTouched } = buildRecorder({});
    recordCalmSession("breath", { cycles: 5 });
    assert.equal(wasTouched(), true);
  });
});
