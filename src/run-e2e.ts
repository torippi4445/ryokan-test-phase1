// 端から端まで（D + E + メール返信、ドライラン）。
//   npm run e2e            # 台本どおりの女将返信で自動実行
//   npm run e2e -- -i      # 女将の返信を端末で手入力
//
// 受信メール → Claude抽出 → ルール振り分け → 日本語要約＋原文(=LINEに来る内容)
// → 女将が日本語で返信 → Claudeが客の言語へ翻訳 → 送信メール(宛先/件名/本文)を生成。
// ※ メールは実送信せず内容を表示する「ドライラン」。実送信は別途SMTP接続で。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { InboundEmail, TriageTable, FaqEntry, InnProfile } from "./types.ts";
import type { ClaudeInput } from "./claude.ts";
import { summarize, draftJapaneseForOwner } from "./claude.ts";
import { triage } from "./triage.ts";
import { extract } from "./extract.ts";
import { translateReply } from "./translate.ts";
import { sendMail, mailerConfigured } from "./mailer.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(root, rel), "utf8")) as T;
const inn = readJson<InnProfile>("data/inn-profile.json");
const faq = readJson<FaqEntry[]>("data/faq.json");
const table = readJson<TriageTable>("data/triage-rules.json");
const dirty = readJson<(InboundEmail & { expect: string })[]>("data/dirty-emails.json");

const interactive = process.argv.includes("-i") || process.argv.includes("--interactive");
const doSend = process.argv.includes("--send"); // 実メール送信するか
if (doSend && !mailerConfigured()) {
  console.error("⚠️ --send には .env の SMTP_USER / SMTP_PASS が必要です。ドライランに切り替えます。");
}
const sendReal = doSend && mailerConfigured();
const overrideTo = process.env.TEST_GUEST_TO; // 実送信先をテスト用に上書き（自分のアドレス等）

// 直メールの問い合わせ2件（OTAはメール返信不可なので対象外）。台本の女将返信つき。
const CASES: { email: InboundEmail; ownerJa: string }[] = [
  {
    email: dirty.find((e) => e.id.startsWith("real-04"))!,
    ownerJa: "ベジタリアンの夕食、ご用意できます。お肉とお魚を使わない献立に変更いたしますのでご安心ください。",
  },
  {
    email: dirty.find((e) => e.id.startsWith("real-06"))!,
    ownerJa: "車椅子の方も1階のお部屋でしたら段差なくご案内できます。エレベーターはございませんが1階で完結します。料金は2名2泊・1名様1泊18,000円で、合計72,000円です。",
  },
];

const BADGE: Record<string, string> = { GREEN: "🟢", YELLOW: "🟡 要確認", RED: "🔴 女将判断" };
const rl = interactive ? createInterface({ input: stdin, output: stdout }) : null;

console.log(`\n=== 端から端まで（実Claude抽出＋翻訳 / メールはドライラン） ===`);
console.log(`   モード: ${interactive ? "対話入力" : "台本"}\n`);

for (const c of CASES) {
  const email = c.email;
  console.log("════════════════════════════════════════════");
  console.log(`📨 受信メール  From: ${email.from} / Subject: ${email.subject}`);

  // 1) 抽出（実Claude）
  const ex = await extract(email);
  if (ex.type !== "guest_inquiry") {
    console.log(`   ⛔ ${ex.type}（メール返信の対象外）。メモ: ${ex.note}`);
    continue;
  }

  // 2) ルール振り分け（クリーンな本文に対して）
  const tr = triage(ex.guestMessage, table);
  const ci: ClaudeInput = {
    guestMessage: ex.guestMessage,
    guestName: ex.guestName,
    tier: tr.tier,
    matched: tr.matched,
    faq,
    inn,
  };
  const jpSummary = summarize(ci).japaneseSummary;
  const draftJa = draftJapaneseForOwner(ci); // YELLOWのとき日本語の返信案

  // 3) 女将のLINEに来る内容（要約＋原文）
  console.log("");
  console.log(`   📱 女将のLINEに届く内容 ─────────────`);
  console.log(`   ${BADGE[tr.tier]} ｜ 言語: ${ex.language}`);
  console.log(`   要約: ${jpSummary}`);
  console.log(`   原文: ${ex.guestMessage}`);
  if (draftJa) console.log(`   返信案: ${draftJa}`);
  console.log(`   ───────────────────────────`);

  // 4) 女将の日本語返信
  let ownerJa = c.ownerJa;
  if (rl) {
    const hint = draftJa ? "（空Enterで返信案を採用）" : "";
    const typed = (await rl.question(`   ✍️ 女将の返信（日本語）${hint}: `)).trim();
    ownerJa = typed || draftJa || c.ownerJa;
  } else {
    console.log(`   ✍️ 女将の返信（日本語・台本）: ${ownerJa}`);
  }

  // 5) 客の言語へ翻訳（実Claude）
  const guestText = await translateReply(ownerJa, ex.language, ex.guestName, inn.nameEn);

  // 6) 送信メール（ドライラン表示 or 実送信）
  const baseSubject = email.subject.replace(/^\s*(re|fwd)\s*:\s*/i, "");
  const subject = `Re: ${baseSubject}`;
  const to = sendReal ? overrideTo || email.from : email.from;

  console.log("");
  console.log(`   ✉️ 送信するメール（${ex.language}）─────────`);
  console.log(`   To     : ${to}${sendReal && overrideTo ? "（テスト用に上書き）" : ""}`);
  console.log(`   Subject: ${subject}`);
  console.log(`   Body:`);
  console.log(guestText.split("\n").map((l) => "      " + l).join("\n"));
  console.log(`   ───────────────────────────`);

  if (sendReal) {
    try {
      await sendMail({ to, subject, text: guestText });
      console.log(`   ✅ 実送信しました → ${to}`);
    } catch (err) {
      console.log(`   ❌ 送信失敗: ${(err as Error).message}`);
    }
  } else {
    console.log(`   （ドライラン: 実送信していません。--send で送信）`);
  }
}

console.log("════════════════════════════════════════════\n");
rl?.close();
