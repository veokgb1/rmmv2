"use strict";

function encodePendingVoucherCursor(docSnap) {
  if (!docSnap) return null;
  const data = docSnap.data?.() || {};
  const id = String(docSnap.id || "").trim();
  if (!id) return null;

  const rawUpdatedAt = data.updatedAt;
  if (rawUpdatedAt == null) return null;

  let updatedAtMs;
  if (typeof rawUpdatedAt === "number") updatedAtMs = rawUpdatedAt;
  else if (rawUpdatedAt instanceof Date) updatedAtMs = rawUpdatedAt.getTime();
  else if (typeof rawUpdatedAt?.toMillis === "function") updatedAtMs = rawUpdatedAt.toMillis();
  else if (typeof rawUpdatedAt?.seconds === "number") updatedAtMs = rawUpdatedAt.seconds * 1000;
  else if (typeof rawUpdatedAt === "string") updatedAtMs = new Date(rawUpdatedAt).getTime();
  else updatedAtMs = NaN;

  if (!Number.isFinite(updatedAtMs)) return null;

  return { id, updatedAtMs };
}

let pass = 0;
let fail = 0;

function assert(label, cond) {
  if (cond) {
    console.log(`✅ ${label}`);
    pass++;
  } else {
    console.error(`❌ ${label}`);
    fail++;
  }
}

const snap = (id, data) => ({
  id,
  data: () => data,
});

console.log("encodePendingVoucherCursor — unit tests");

assert(
  "updatedAt=null, lastReviewedAt存在 -> null",
  encodePendingVoucherCursor(
    snap("a", {
      updatedAt: null,
      lastReviewedAt: "2026-03-01T00:00:00.000Z",
      : "2026-03-01T00:00:00.000Z",
    })
  ) === null
);

assert(
  "updatedAt缺失 -> null",
  encodePendingVoucherCursor(
    snap("b", {
      lastReviewedAt: "2026-03-01T00:00:00.000Z",
    })
  ) === null
);

const rStr = encodePendingVoucherCursor(
  snap("c", { updatedAt: "2026-03-05T06:00:00.000Z" })
);
assert(
  "ISO string -> 非null",
  rStr !== null && rStr.id === "c" && Number.isFinite(rStr.updatedAtMs)
);

const rSec = encodePendingVoucherCursor(
  snap("d", { updatedAt: { seconds: 1741161600, nanoseconds: 0 } })
);
assert(
  "{seconds} -> seconds*1000",
  rSec !== null && rSec.updatedAtMs === 1741161600 * 1000
);

const rSdk = encodePendingVoucherCursor(
  snap("e", { updatedAt: { toMillis: () => 1741161600000 } })
);
assert(
  "toMillis() -> 正确",
  rSdk !== null && rSdk.updatedAtMs === 1741161600000
);

const d = new Date("2026-03-05T06:00:00.000Z");
const rDate = encodePendingVoucherCursor(snap("f", { updatedAt: d }));
assert(
  "Date -> getTime()",
  rDate !== null && rDate.updatedAtMs === d.getTime()
);

assert("docSnap=null -> null", encodePendingVoucherCursor(null) === null);

assert(
  "id为空 -> null",
  encodePendingVoucherCursor({
    id: "",
    data: () => ({ updatedAt: "2026-03-05T06:00:00.000Z" }),
  }) === null
);

const rNum = encodePendingVoucherCursor(snap("g", { updatedAt: 1741161600000 }));
assert(
  "number -> 原值",
  rNum !== null && rNum.updatedAtMs === 1741161600000
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);