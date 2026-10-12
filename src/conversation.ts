// Stage 2 two-way engine (SPEC §6/§7).
//
//   GREEN  → auto-send the FAQ reply, log to the okami. No human gate.
//   YELLOW → AI gives the okami a Japanese draft; she approves or rewrites in JP.
//   RED    → no AI draft; the okami writes the answer in Japanese herself.
//   YELLOW/RED then: Claude translates her Japanese → guest language →
//            "Send this? OK?" confirmation → on OK, send in the guest's language.
//
// The okami's input is abstracted behind OwnerAgent, so the same engine runs
// from a scripted transcript (reproducible demo) or live stdin (sales demo).

import type {
  ConversationResult,
  FaqEntry,
  InnProfile,
  ProcessedInquiry,
} from "./types.ts";
import { Channels } from "./line.ts";
import {
  draftJapaneseForOwner,
  translateJaToGuest,
  type ClaudeInput,
} from "./claude.ts";

export interface OwnerAgent {
  // The okami reads a Japanese prompt (summary + optional draft) and replies in JP.
  reply(ctx: {
    emailId: string;
    promptJa: string;
    suggestionJa: string | null;
  }): Promise<string>;
  // The okami sees the Japanese preview of what will go out and approves it.
  confirm(ctx: {
    emailId: string;
    previewJa: string;
    targetLanguage: string;
  }): Promise<boolean>;
}

function toClaudeInput(p: ProcessedInquiry, faq: FaqEntry[], inn: InnProfile): ClaudeInput {
  return {
    guestMessage: p.guestMessage,
    guestName: p.guestName,
    tier: p.triage.tier,
    matched: p.triage.matched,
    faq,
    inn,
  };
}

export async function runConversation(
  p: ProcessedInquiry,
  owner: OwnerAgent,
  ch: Channels,
  faq: FaqEntry[],
  inn: InnProfile
): Promise<ConversationResult> {
  const base = { inquiry: p };

  // --- GREEN: full auto -------------------------------------------------------
  if (p.triage.tier === "GREEN") {
    const reply = p.claude.draftReply ?? "";
    ch.pushToOwner(`🟢 自動対応しました。${p.claude.japaneseSummary}（事後確認用）`, "log");
    ch.sendToGuest(reply, "auto");
    return {
      ...base,
      state: "AUTO_SENT",
      ownerReplyJa: null,
      finalGuestReply: reply,
      translationIsMock: false,
      transcript: ch.drain(),
    };
  }

  // --- YELLOW / RED: two-way with a human gate --------------------------------
  const ci = toClaudeInput(p, faq, inn);
  const suggestionJa = draftJapaneseForOwner(ci); // null for RED

  const tierLabel = p.triage.tier === "YELLOW" ? "🟡 要確認" : "🔴 女将判断";
  const promptLines = [
    `${tierLabel}：${p.claude.japaneseSummary}`,
    `お客様の言語：${p.claude.detectedLanguage}`,
  ];
  if (suggestionJa) {
    promptLines.push(`返信案：${suggestionJa}`);
    promptLines.push("→ この案でよければ「OK」、修正は日本語でご返信ください。");
  } else {
    promptLines.push("→ AIは回答を作成していません。日本語でご返信ください。");
  }
  const promptJa = promptLines.join("\n");
  ch.pushToOwner(promptJa);

  // The okami answers in Japanese.
  const ownerReplyJa = await owner.reply({
    emailId: p.email.id,
    promptJa,
    suggestionJa,
  });
  ch.fromOwner(ownerReplyJa);

  // Claude translates her Japanese into the guest's language.
  const { text: guestText, isMock } = translateJaToGuest(
    ownerReplyJa,
    p.claude.detectedLanguage
  );

  // "Send this? OK?" — shown to the okami in Japanese (she can't read the guest's
  // language; she approves her own words, which the system sends translated).
  const previewJa =
    `お客様へ以下を送ります（${p.claude.detectedLanguage}に翻訳済み）。\n` +
    `元の日本語：${ownerReplyJa}\n送信しますか？（OK / キャンセル）`;
  ch.pushToOwner(previewJa, "confirm");

  const ok = await owner.confirm({
    emailId: p.email.id,
    previewJa,
    targetLanguage: p.claude.detectedLanguage,
  });

  if (!ok) {
    ch.pushToOwner("送信をキャンセルしました。", "cancel");
    return {
      ...base,
      state: "CANCELLED",
      ownerReplyJa,
      finalGuestReply: null,
      translationIsMock: isMock,
      transcript: ch.drain(),
    };
  }

  ch.sendToGuest(guestText, "approved");
  return {
    ...base,
    state: "SENT",
    ownerReplyJa,
    finalGuestReply: guestText,
    translationIsMock: isMock,
    transcript: ch.drain(),
  };
}
