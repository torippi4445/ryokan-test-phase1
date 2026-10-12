// 実践テスト: 実際のOTA/直メールに近い「汚い」メールを今のパイプライン
// (intake + triage, モック) に通して、どこで壊れるかを可視化する。
//   node n8n/test-realistic.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(join(here, "src", "02-triage-mock.code.js"), "utf8");

// 1通だけ処理するため、$input を1メールで差し込む
function runOne(email) {
  const $input = { all: () => [{ json: email }], first: () => ({ json: email }) };
  const fn = new Function("$input", "$getWorkflowStaticData", code);
  return fn($input, () => ({}))[0].json;
}

// ---- リアルな汚いメール群（HTML→テキスト化した後に近い見た目） ----
const EMAILS = [
  {
    id: "real-01 (Booking: 本文に質問あり・定型文まみれ)",
    from: "noreply@mailing.booking.com",
    subject: "New message regarding booking 3892011 — Booking.com",
    body: `Booking.com\n\nYou have a new message from María González about reservation 3892011 (check-in 24 Dec 2026).\n\nHi, we will arrive around 11pm by car. Is late check-in possible and do you have parking? Thank you!\n\n--\nReply to this guest by logging in to the Extranet. Do not reply to this email address.\nManage your property: https://admin.booking.com\nYou are receiving this because you are a Booking.com partner.\n© 1996–2026 Booking.com™. All rights reserved.\nUnsubscribe | Privacy | Terms`,
    expect: "黄/赤: 深夜到着＋駐車場。本文に質問あり → 抽出できてほしい",
  },
  {
    id: "real-02 (Agoda: 本文に質問が来ない=ログイン誘導のみ)",
    from: "messaging@agoda.com",
    subject: "You have a new guest message - Agoda",
    body: `Dear Partner,\n\nYou have received a new message from a guest for booking ID 884512290.\n\nTo read and reply to this message, please log in to YCS (Agoda Partner Hub).\n\nThis is an automated notification. Do not reply to this email.\nAgoda Company Pte. Ltd.`,
    expect: "本文に質問が無い → そもそも抽出不能（データが来ない）",
  },
  {
    id: "real-03 (Booking: 予約確定通知=問い合わせではない)",
    from: "noreply@booking.com",
    subject: "Booking confirmed: 3892011, María González, 24-26 Dec",
    body: `New reservation confirmed!\n\nGuest: María González\nDates: 24 Dec 2026 – 26 Dec 2026 (2 nights)\nRoom: Japanese-style room, 2 guests\nPrice: ¥36,000 total\nFree cancellation until 21 Dec.\n\nNo action needed. Manage in the Extranet.`,
    expect: "問い合わせではない（確定通知） → 振り分け対象外にしたい",
  },
  {
    id: "real-04 (直メール: 質問＋長い署名＋引用)",
    from: "thomas.muller@example.com",
    subject: "Re: Your inn",
    body: `Hello,\n\nDo you offer vegetarian dinner? My wife cannot eat meat or fish.\n\nBest regards,\nThomas Müller\nSent from my iPhone\n\nOn Mon, Jun 8, 2026, Minoya Ryokan wrote:\n> Thank you for your interest. Please let us know if you have any questions.\n> Parking is available and check-in is from 3pm.\n> Minoya Ryokan`,
    expect: "黄: ベジタリアン夕食。引用部分の『parking/check-in』を拾って誤分類しないでほしい",
  },
  {
    id: "real-05 (Expedia: レビュー依頼=宣伝、問い合わせではない)",
    from: "no-reply@expedia.com",
    subject: "How was your stay? Leave a review",
    body: `Thanks for hosting!\n\nGuests love reading reviews. Remind your guest to rate their stay.\nTip: properties with Wi-Fi and free parking get more bookings!\n\nExpedia Group Partner Central. Unsubscribe here.`,
    expect: "問い合わせではない（宣伝）。本文の『Wi-Fi/parking』に釣られないでほしい",
  },
  {
    id: "real-06 (直メール: 多言語混在＋複数質問)",
    from: "sophie@example.fr",
    subject: "Question",
    body: `Bonjour! We plan to visit in November. Is there an elevator? My mother uses a wheelchair. Also, how much for 2 people 2 nights? Merci!`,
    expect: "赤: 車椅子（個別配慮）が最優先。料金(黄)も混在 → 最も保守的=赤にしたい",
  },
];

const SEV = { GREEN: 0, YELLOW: 1, RED: 2 };
console.log("\n=== 実践テスト: 汚いメール6通 → 今のパイプライン（モック） ===\n");
for (const e of EMAILS) {
  const r = runOne(e);
  console.log("────────────────────────────────────────────");
  console.log(`📧 ${e.id}`);
  console.log(`   channel : ${r.channel}`);
  console.log(`   抽出した本文: ${JSON.stringify(r.guestMessage.slice(0, 120))}${r.guestMessage.length > 120 ? "…" : ""}`);
  console.log(`   → 分類  : ${r.tier}  (${r.reason})`);
  console.log(`   要約    : ${r.japaneseSummary}`);
  console.log(`   期待    : ${e.expect}`);
}
console.log("────────────────────────────────────────────\n");
