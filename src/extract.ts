// 実Claude API による「問い合わせ判定 ＋ 本文抽出」段。
// トリアージの手前に1回噛ませることで、署名・引用・OTA定型文・宣伝を捨て、
// 客の質問だけを取り出す。問い合わせでないメール(確定通知/宣伝)も弾く。
//
// ※ ここだけが実APIを使う。下流のトリアージはルールベースのまま（SPEC §5）。

import Anthropic from "@anthropic-ai/sdk";
import type { InboundEmail } from "./types.ts";

export type EmailKind = "guest_inquiry" | "ota_notification_no_message" | "non_inquiry";

export interface Extraction {
  type: EmailKind;
  guestName: string | null;
  guestMessage: string; // 抽出した客の質問（元の言語）。無ければ空文字。
  language: string;
  note: string; // guest_inquiry 以外のとき、女将向けの短い日本語メモ。
}

// 簡単な抽出タスク。コスト優先なら "claude-haiku-4-5" に変更可（料金 約1/5）。
const MODEL = "claude-opus-4-8";

const client = new Anthropic(); // ANTHROPIC_API_KEY を環境から読む

const SYSTEM = `あなたは小さな日本旅館の受信メールを仕分ける担当です。届くメールは次のいずれかです:
客からの問い合わせ / OTA(Booking,Agoda等)の「新着メッセージあり」通知 / 予約確定通知 / レビュー依頼や宣伝 / その他。

メール本文から「客が実際に聞いている質問・要望」だけを、元の言語のまま抽出してください。
次は必ず無視します: メール署名、引用された過去のやり取り(「>」や「On ... wrote:」以降)、
OTAの定型文・法的フッター(© や Unsubscribe など)・宣伝文句。

分類(type):
- guest_inquiry: 客からの実際の質問/要望が含まれる
- ota_notification_no_message: OTAの通知のみで、本文に客のメッセージが入っていない(女将にはログインして確認するよう促す)
- non_inquiry: 予約確定通知・宣伝・レビュー依頼など、問い合わせとして対応不要なもの

guest_name は分かれば入れる(不明なら空文字)。guest_inquiry 以外のときは note に女将向けの短い日本語の案内を書く。`;

const SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["guest_inquiry", "ota_notification_no_message", "non_inquiry"] },
    guest_name: { type: "string", description: "客の氏名。不明なら空文字。" },
    guest_message: { type: "string", description: "抽出した客の質問・要望。元の言語。無ければ空文字。" },
    language: { type: "string", description: "本文の言語。例: English, French, Japanese" },
    note: { type: "string", description: "guest_inquiry 以外のときの女将向け日本語メモ。" },
  },
  required: ["type", "guest_name", "guest_message", "language", "note"],
  additionalProperties: false,
};

export async function extract(email: InboundEmail): Promise<Extraction> {
  const content = `From: ${email.from}\nSubject: ${email.subject}\n\n${email.body}`;
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: "user", content }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  });

  const block = res.content.find((b) => b.type === "text");
  const raw = block && "text" in block ? block.text : "{}";
  const j = JSON.parse(raw) as {
    type: EmailKind;
    guest_name: string;
    guest_message: string;
    language: string;
    note: string;
  };
  return {
    type: j.type,
    guestName: j.guest_name ? j.guest_name : null,
    guestMessage: j.guest_message,
    language: j.language,
    note: j.note,
  };
}
