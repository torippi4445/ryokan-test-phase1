// 実Claude API: 女将の日本語返信を、客の言語のメール本文に翻訳する（Stage2のE）。
// 金額・在庫・約束を勝手に変えない、という制約を守る。

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-4-8"; // コスト優先なら "claude-haiku-4-5"（約1/5）

const client = new Anthropic();

export async function translateReply(
  japanese: string,
  targetLanguage: string,
  guestName: string | null,
  innNameEn: string
): Promise<string> {
  const system = `あなたは日本の旅館の女将の返信を、宿泊客の言語に翻訳して、そのまま送れるメール本文に仕上げる翻訳者です。
ルール:
- 自然で丁寧な${targetLanguage}にする。
- 原文の意味・金額・在庫・約束を一切変えない（勝手に追加・削除しない）。
- 宛名は客名（あれば）、末尾は宿名「${innNameEn}」で署名。
- 出力は翻訳後のメール本文だけ（前置き・解説・引用符は付けない）。`;
  const user = `宛先の客: ${guestName ?? "(unknown)"}\n女将の日本語返信:\n${japanese}`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  });
  const block = res.content.find((b) => b.type === "text");
  return block && "text" in block ? block.text.trim() : "";
}
