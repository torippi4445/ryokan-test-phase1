// Stage 1 pipeline (one-way): email → triage → Claude summary+draft → operator.
// No owner-side LINE input yet (that is Stage 2).

import type {
  FaqEntry,
  InboundEmail,
  InnProfile,
  ProcessedInquiry,
  TriageTable,
} from "./types.ts";
import { detectChannel, extractGuestMessage, extractGuestName } from "./intake.ts";
import { triage } from "./triage.ts";
import { generate } from "./claude.ts";

function decideAction(tier: string): { action: string; autoSent: boolean } {
  switch (tier) {
    case "GREEN":
      return { action: "緑: 事前承認済みの定型回答として自動送信（女将は事後にログ確認）。", autoSent: true };
    case "YELLOW":
      return { action: "黄: AI下書きを作成。女将の承認(OK)を待ってから送信。", autoSent: false };
    default:
      return { action: "赤: 回答は書かず、日本語要約のみ女将へ。判断は女将が行う。", autoSent: false };
  }
}

export function processEmail(
  email: InboundEmail,
  table: TriageTable,
  faq: FaqEntry[],
  inn: InnProfile
): ProcessedInquiry {
  const channel = detectChannel(email);
  const guestName = extractGuestName(email, channel);
  const guestMessage = extractGuestMessage(email, channel);

  const triageResult = triage(guestMessage, table);

  const claude = generate({
    guestMessage,
    guestName,
    tier: triageResult.tier,
    matched: triageResult.matched,
    faq,
    inn,
  });

  const { action, autoSent } = decideAction(triageResult.tier);

  return {
    email,
    channel,
    guestName,
    guestMessage,
    triage: triageResult,
    claude,
    action,
    autoSent,
  };
}
