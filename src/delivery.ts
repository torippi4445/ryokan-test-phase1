// Delivery to the operator (Stage 1). In Stage 1 the "delivery" is a console
// card + a markdown digest written to out/inbox.md. In production this is where
// the operator's LINE push / email send would go.

import type { ProcessedInquiry } from "./types.ts";

const TIER_BADGE: Record<string, string> = {
  GREEN: "🟢 GREEN",
  YELLOW: "🟡 YELLOW",
  RED: "🔴 RED",
};

export function formatConsole(p: ProcessedInquiry): string {
  const L: string[] = [];
  L.push("────────────────────────────────────────────────────────");
  L.push(`${TIER_BADGE[p.triage.tier]}   [${p.channel.toUpperCase()}]  ${p.email.id}`);
  L.push(`From   : ${p.email.from}${p.guestName ? `  (${p.guestName})` : ""}`);
  L.push(`Subject: ${p.email.subject}`);
  L.push(`言語   : ${p.claude.detectedLanguage}`);
  L.push("");
  L.push(`📩 原文(抜粋): ${truncate(p.guestMessage, 160)}`);
  L.push("");
  L.push(`🇯🇵 日本語要約: ${p.claude.japaneseSummary}`);
  L.push(`🔎 振り分け理由: ${p.triage.reason}`);
  L.push(`➡️  対応: ${p.action}`);
  if (p.claude.draftReply) {
    L.push("");
    L.push(p.autoSent ? "✉️ 自動送信した返信:" : "✏️ 返信下書き（承認待ち）:");
    L.push(indent(p.claude.draftReply));
  } else {
    L.push("");
    L.push("✏️ 返信下書き: なし（赤のためAIは回答を書かない）");
  }
  return L.join("\n");
}

export function formatMarkdown(items: ProcessedInquiry[]): string {
  const counts = { GREEN: 0, YELLOW: 0, RED: 0 };
  for (const p of items) counts[p.triage.tier]++;

  const M: string[] = [];
  M.push("# 受信トレイ（運用者向けダイジェスト） — Stage 1");
  M.push("");
  M.push(`生成: ${new Date().toISOString()}`);
  M.push("");
  M.push(`- 🟢 緑（自動送信）: ${counts.GREEN} 件`);
  M.push(`- 🟡 黄（承認待ち）: ${counts.YELLOW} 件`);
  M.push(`- 🔴 赤（女将判断）: ${counts.RED} 件`);
  M.push("");

  for (const p of items) {
    M.push(`## ${TIER_BADGE[p.triage.tier]} — ${p.email.id} (${p.channel})`);
    M.push("");
    M.push(`- **From**: ${p.email.from}${p.guestName ? ` (${p.guestName})` : ""}`);
    M.push(`- **Subject**: ${p.email.subject}`);
    M.push(`- **言語**: ${p.claude.detectedLanguage}`);
    M.push(`- **原文**: ${p.guestMessage.replace(/\n/g, " ")}`);
    M.push(`- **日本語要約**: ${p.claude.japaneseSummary}`);
    M.push(`- **振り分け理由**: ${p.triage.reason}`);
    M.push(`- **対応**: ${p.action}`);
    if (p.claude.draftReply) {
      M.push("");
      M.push(p.autoSent ? "**自動送信した返信:**" : "**返信下書き（承認待ち）:**");
      M.push("");
      M.push("```");
      M.push(p.claude.draftReply);
      M.push("```");
    }
    M.push("");
  }
  return M.join("\n");
}

function truncate(s: string, n: number): string {
  const oneLine = s.replace(/\n/g, " ");
  return oneLine.length > n ? oneLine.slice(0, n) + "…" : oneLine;
}

function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => "    " + l)
    .join("\n");
}
