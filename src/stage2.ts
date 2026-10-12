// Stage 2 entry point — two-way pipeline over the fake inn's sample emails.
//   npm run stage2              # scripted okami replies (reproducible)
//   npm run stage2 -- --interactive   # type the okami's replies live

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type {
  ConversationResult,
  FaqEntry,
  InboundEmail,
  InnProfile,
  TriageTable,
} from "./types.ts";
import { processEmail } from "./pipeline.ts";
import { Channels, renderEvent } from "./line.ts";
import { runConversation } from "./conversation.ts";
import { ScriptedOwner, InteractiveOwner } from "./owners.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = <T>(rel: string): T =>
  JSON.parse(readFileSync(join(root, rel), "utf8")) as T;

const inn = readJson<InnProfile>("data/inn-profile.json");
const faq = readJson<FaqEntry[]>("data/faq.json");
const table = readJson<TriageTable>("data/triage-rules.json");
const emails = readJson<InboundEmail[]>("data/sample-emails.json");
const script = readJson<{ replies: Record<string, { reply: string; confirm: string }> }>(
  "data/owner-line-replies.json"
).replies;

const interactive = process.argv.includes("--interactive") || process.argv.includes("-i");
const owner = interactive ? new InteractiveOwner() : new ScriptedOwner(script);

console.log(`\n🏯 ${inn.name} (${inn.nameEn}) — Stage 2 双方向パイプライン`);
console.log(`   女将はLINEで日本語のみ。翻訳は裏側で完結（SPEC §6）。`);
console.log(`   ⚠️  Claude / LINE はモックです。${interactive ? "（対話モード）" : "（スクリプトモード）"}\n`);

const ch = new Channels(true); // echo events live
const results: ConversationResult[] = [];

for (const email of emails) {
  const p = processEmail(email, table, faq, inn);
  const badge = { GREEN: "🟢", YELLOW: "🟡", RED: "🔴" }[p.triage.tier];
  console.log("────────────────────────────────────────────────────────");
  console.log(`${badge} ${p.email.id} [${p.channel.toUpperCase()}] ${p.email.subject}`);
  console.log(`   📩 原文: ${p.guestMessage.replace(/\n/g, " ")}`);
  const r = await runConversation(p, owner, ch, faq, inn);
  console.log(`   …状態: ${r.state}${r.translationIsMock ? " ⚠️翻訳モック未登録" : ""}`);
  results.push(r);
}

console.log("────────────────────────────────────────────────────────\n");

const counts = { AUTO_SENT: 0, SENT: 0, CANCELLED: 0 };
for (const r of results) counts[r.state]++;
console.log(
  `集計: 🟢自動送信 ${counts.AUTO_SENT} / ✅承認送信 ${counts.SENT} / 🚫キャンセル ${counts.CANCELLED}\n`
);

if (interactive) (owner as InteractiveOwner).close();

mkdirSync(join(root, "out"), { recursive: true });
writeFileSync(join(root, "out/stage2-log.md"), buildMarkdown(results), "utf8");
console.log("📝 会話ログを out/stage2-log.md に書き出しました。\n");

function buildMarkdown(items: ConversationResult[]): string {
  const M: string[] = ["# Stage 2 双方向会話ログ", "", `生成: ${new Date().toISOString()}`, ""];
  for (const r of items) {
    const p = r.inquiry;
    M.push(`## ${p.triage.tier} — ${p.email.id} (${p.channel}) → ${r.state}`);
    M.push("");
    M.push(`- **原文**: ${p.guestMessage.replace(/\n/g, " ")}`);
    M.push(`- **日本語要約**: ${p.claude.japaneseSummary}`);
    if (r.ownerReplyJa) M.push(`- **女将の返信(日本語)**: ${r.ownerReplyJa}`);
    if (r.finalGuestReply) M.push(`- **お客様へ送信(${p.claude.detectedLanguage})**: ${r.finalGuestReply.replace(/\n/g, " ")}`);
    M.push("");
    M.push("```");
    for (const e of r.transcript) M.push(renderEvent(e));
    M.push("```");
    M.push("");
  }
  return M.join("\n");
}
