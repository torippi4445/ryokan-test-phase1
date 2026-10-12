// ナレッジベース参照テスト。
//   npm run kb
//
// data/test-inquiries.json の問い合わせを1件ずつ処理し、
//   ①Claude抽出 → ②ルールでトリアージ → ③ナレッジ照合して回答生成 → ④最終判断
// を表示する。結果は out/kb-test.md にも保存。
//
// 重要な安全ルール（ここで実装している降格）:
//   緑 + ナレッジ full     → 自動送信してよい
//   緑 + ナレッジ partial  → 黄に降格（女将の確認が必要）
//   緑 + ナレッジ none     → 赤に降格（女将が判断）
//   黄                     → 常に女将の確認
//   赤                     → AIは回答を書かない（SPEC §5）

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { InboundEmail, TriageTable, Tier } from "./types.ts";
import { classify } from "./classify.ts";
import { extract } from "./extract.ts";
import {
  answerFromKnowledge,
  referenceFactsForOwner,
  loadKnowledge,
  type GroundedAnswer,
} from "./answer.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(root, rel), "utf8")) as T;

const table = readJson<TriageTable>("data/triage-rules.json");
const inquiries = readJson<(InboundEmail & { note?: string })[]>("data/test-inquiries.json");
const knowledge = loadKnowledge();

const BADGE: Record<Tier, string> = { GREEN: "🟢 緑", YELLOW: "🟡 黄", RED: "🔴 赤" };
const COVERAGE_LABEL: Record<string, string> = {
  full: "✅ ナレッジで完全に answerable",
  partial: "⚠️ ナレッジで一部のみ answerable",
  none: "❌ ナレッジに情報なし",
};

/** ナレッジのカバー状況に応じてトリアージを降格する。 */
function applyCoverage(tier: Tier, coverage: string): { final: Tier; reason: string } {
  if (tier === "GREEN") {
    if (coverage === "full") return { final: "GREEN", reason: "ナレッジで完全に答えられるため自動送信可" };
    if (coverage === "partial")
      return { final: "YELLOW", reason: "ナレッジが一部しかカバーしていないため黄へ降格（女将確認）" };
    return { final: "RED", reason: "ナレッジに情報が無いため赤へ降格（女将判断）" };
  }
  if (tier === "YELLOW") {
    if (coverage === "none")
      return { final: "RED", reason: "ナレッジに情報が無いため赤へ降格（AIは下書きを作らない）" };
    return { final: "YELLOW", reason: "金額・在庫・約束が絡むため女将の確認が必要" };
  }
  return { final: "RED", reason: "個別事情のため女将が判断（AIは回答を書かない）" };
}

const md: string[] = [
  "# ナレッジベース参照テスト結果",
  "",
  `実行: ${new Date().toISOString()} / モデル: claude-opus-4-8`,
  `ナレッジ: \`data/knowledge/inn-knowledge.md\``,
  "",
];

console.log(`\n=== ナレッジ参照テスト（${inquiries.length}件） ===\n`);

for (const q of inquiries) {
  console.log("════════════════════════════════════════════════════");
  console.log(`📧 ${q.id}  ${q.note ? "— " + q.note : ""}`);
  console.log(`   From: ${q.from} / Subject: ${q.subject}`);
  console.log(`   原文: ${q.body}`);

  // ① 抽出
  const ex = await extract(q);
  if (ex.type !== "guest_inquiry") {
    console.log(`   ⛔ ${ex.type} — 問い合わせではないため処理対象外`);
    continue;
  }

  // ② カテゴリ分類（カテゴリと色の定義は人間、当てはめだけAI）
  const tr = await classify(ex.guestMessage, table);

  // ③ ナレッジ照合＋回答生成（赤はAIが答えを書かず、女将向けの参考事実だけ拾う）
  let ans: GroundedAnswer | null = null;
  let ref: { facts: string[]; notInKnowledge: string } | null = null;
  if (tr.tier !== "RED") {
    ans = await answerFromKnowledge({
      guestMessage: ex.guestMessage,
      guestName: ex.guestName,
      language: ex.language,
      knowledge,
    });
  } else {
    ref = await referenceFactsForOwner({ guestMessage: ex.guestMessage, knowledge });
  }

  // ④ 最終判断
  const { final, reason } = applyCoverage(tr.tier, ans?.coverage ?? "none");
  const downgraded = final !== tr.tier;

  console.log("");
  console.log(`   ② カテゴリ分類      : ${BADGE[tr.tier]}  ${tr.reason}`);
  if (ans) {
    console.log(`   ③ ナレッジ照合      : ${COVERAGE_LABEL[ans.coverage]}`);
    if (ans.citedFacts.length) {
      console.log(`      根拠にしたナレッジ:`);
      for (const f of ans.citedFacts) console.log(`        ・${f}`);
    }
    if (ans.missing) console.log(`      ⚠️ 答えられなかった点: ${ans.missing}`);
  } else if (ref) {
    console.log(`   ③ ナレッジ照合      : 赤のため返信文は作らない。女将向けの参考事実のみ:`);
    if (ref.facts.length) {
      for (const f of ref.facts) console.log(`        ・${f}`);
    } else {
      console.log(`        （関連する記述がナレッジにありません）`);
    }
    if (ref.notInKnowledge) console.log(`      ⚠️ ナレッジに記載が無い点: ${ref.notInKnowledge}`);
  }
  console.log(`   ④ 最終判断          : ${BADGE[final]}${downgraded ? "  ←【降格】" : ""}  ${reason}`);

  if (ans && ans.answerForGuest) {
    console.log("");
    console.log(`   ${final === "GREEN" ? "✉️ 自動送信する返信" : "✏️ 女将に見せる下書き"}（${ex.language}）:`);
    console.log(ans.answerForGuest.split("\n").map((l) => "      " + l).join("\n"));
    console.log("");
    console.log(`   🇯🇵 日本語版（女将の確認用）:`);
    console.log(ans.answerJa.split("\n").map((l) => "      " + l).join("\n"));
  }

  // markdown 保存用
  md.push(`## ${q.id}${q.note ? " — " + q.note : ""}`, "");
  md.push(`**原文**: ${q.body}`, "");
  md.push(`- 抽出: \`${ex.guestMessage}\` / 言語: ${ex.language}`);
  md.push(`- ② カテゴリ分類: **${BADGE[tr.tier]}** — ${tr.reason}`);
  if (ans) {
    md.push(`- ③ ナレッジ照合: **${COVERAGE_LABEL[ans.coverage]}**`);
    if (ans.citedFacts.length) {
      md.push(`- 根拠にしたナレッジ:`);
      for (const f of ans.citedFacts) md.push(`    - ${f}`);
    }
    if (ans.missing) md.push(`- ⚠️ 答えられなかった点: ${ans.missing}`);
  } else if (ref) {
    md.push(`- ③ ナレッジ照合: 赤のため返信文は作らない。女将向けの参考事実のみ:`);
    if (ref.facts.length) for (const f of ref.facts) md.push(`    - ${f}`);
    else md.push(`    - （関連する記述がナレッジにありません）`);
    if (ref.notInKnowledge) md.push(`- ⚠️ ナレッジに記載が無い点: ${ref.notInKnowledge}`);
  }
  md.push(`- ④ 最終判断: **${BADGE[final]}**${downgraded ? " ←【降格】" : ""} — ${reason}`);
  if (ans && ans.answerForGuest) {
    md.push("", `**${final === "GREEN" ? "自動送信する返信" : "女将に見せる下書き"}（${ex.language}）**`, "", "```", ans.answerForGuest, "```");
    md.push("", `**日本語版（女将の確認用）**`, "", "```", ans.answerJa, "```");
  }
  md.push("");
}

console.log("════════════════════════════════════════════════════\n");

mkdirSync(join(root, "out"), { recursive: true });
writeFileSync(join(root, "out/kb-test.md"), md.join("\n"), "utf8");
console.log("📝 結果を out/kb-test.md に保存しました。\n");
