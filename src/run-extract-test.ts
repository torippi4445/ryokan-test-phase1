// 汚いメール6通で Before(正規表現抽出) → After(Claude抽出) を比較する実践テスト。
//   1) プロジェクト直下に .env を作り ANTHROPIC_API_KEY=sk-... を書く
//   2) npm run test:extract
//
// Before = 今のモック(intake.ts の正規表現)で抽出 → トリアージ
// After  = 実Claudeで「判定＋本文抽出」→ きれいな本文だけトリアージ

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { InboundEmail, TriageTable, FaqEntry, InnProfile } from "./types.ts";
import { processEmail } from "./pipeline.ts";
import { triage } from "./triage.ts";
import { extract } from "./extract.ts";

// ANTHROPIC_API_KEY は npm script の `node --env-file=.env` で読み込まれる。
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(root, rel), "utf8")) as T;
const inn = readJson<InnProfile>("data/inn-profile.json");
const faq = readJson<FaqEntry[]>("data/faq.json");
const table = readJson<TriageTable>("data/triage-rules.json");
const emails = readJson<(InboundEmail & { expect: string })[]>("data/dirty-emails.json");

const KIND_LABEL: Record<string, string> = {
  guest_inquiry: "問い合わせ",
  ota_notification_no_message: "OTA通知のみ(本文なし)",
  non_inquiry: "問い合わせでない",
};

console.log(`\n=== Before(正規表現) → After(実Claude: ${"claude-opus-4-8"}) ===\n`);

for (const e of emails) {
  // Before: 現行モックの抽出＋トリアージ
  const before = processEmail(e, table, faq, inn);

  // After: Claudeで判定＋抽出 → guest_inquiry のときだけルールベースでトリアージ
  const ex = await extract(e);
  let afterVerdict: string;
  if (ex.type === "guest_inquiry") {
    const t = triage(ex.guestMessage, table);
    afterVerdict = `🎯 ${t.tier}（${t.reason}）`;
  } else {
    afterVerdict = `⛔ ${KIND_LABEL[ex.type]} → 振り分けせず。${ex.note ? "メモ: " + ex.note : ""}`;
  }

  console.log("────────────────────────────────────────────");
  console.log(`📧 ${e.id}`);
  console.log(`   期待        : ${e.expect}`);
  console.log("");
  console.log(`   [Before] 抽出: ${JSON.stringify(before.guestMessage.slice(0, 90))}${before.guestMessage.length > 90 ? "…" : ""}`);
  console.log(`   [Before] 結果: ${before.triage.tier}（${before.triage.reason}）`);
  console.log("");
  console.log(`   [After]  種別: ${KIND_LABEL[ex.type]}  / 言語: ${ex.language}`);
  console.log(`   [After]  抽出: ${JSON.stringify(ex.guestMessage)}`);
  console.log(`   [After]  結果: ${afterVerdict}`);
}
console.log("────────────────────────────────────────────\n");
