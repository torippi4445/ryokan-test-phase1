// ナレッジベース参照型の回答生成（実Claude API）。
//
// 設計の核心: AIは data/knowledge/inn-knowledge.md に書かれていることだけを根拠に答える。
// ナレッジに無いことは「答えられない」と正直に返し、女将さんへエスカレーションする。
// → でっち上げ（ハルシネーション）を構造的に防ぐ。

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MODEL = "claude-opus-4-8";
const client = new Anthropic();

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadKnowledge(): string {
  return readFileSync(join(root, "data/knowledge/inn-knowledge.md"), "utf8");
}

/** ナレッジが質問をどこまでカバーしているか。 */
export type Coverage = "full" | "partial" | "none";

export interface GroundedAnswer {
  /** ナレッジで質問に答えられる範囲 */
  coverage: Coverage;
  /** 客の言語での返信本文。coverage が none のときは空文字。 */
  answerForGuest: string;
  /** 上と同じ内容の日本語版（女将さんが確認するため）。 */
  answerJa: string;
  /** ナレッジで答えられなかった点（日本語）。full なら空文字。 */
  missing: string;
  /** 回答の根拠にしたナレッジ内の記述（日本語・箇条書き）。検証用。 */
  citedFacts: string[];
}

const SCHEMA = {
  type: "object",
  properties: {
    coverage: {
      type: "string",
      enum: ["full", "partial", "none"],
      description:
        "ナレッジだけで質問に完全に答えられる=full / 一部だけ答えられる=partial / まったく答えられない=none",
    },
    answer_for_guest: {
      type: "string",
      description:
        "客の言語での返信本文。答えられる部分のみを書く。coverage が none なら空文字。",
    },
    answer_ja: {
      type: "string",
      description: "answer_for_guest と同じ内容の日本語版。女将さんの確認用。none なら空文字。",
    },
    missing: {
      type: "string",
      description:
        "ナレッジに情報が無く答えられなかった点を日本語で簡潔に。full なら空文字。",
    },
    cited_facts: {
      type: "array",
      items: { type: "string" },
      description: "回答の根拠にしたナレッジ内の記述を日本語で列挙（検証用）。",
    },
  },
  required: ["coverage", "answer_for_guest", "answer_ja", "missing", "cited_facts"],
  additionalProperties: false,
};

function systemPrompt(knowledge: string): string {
  return `あなたは日本の小さな旅館の問い合わせ対応を補助するアシスタントです。

# 絶対的なルール
以下の「宿ナレッジ」に書かれている情報だけを根拠に回答してください。
- ナレッジに書かれていないことは、**推測・一般論・常識で補完してはいけません**。
- 「たぶん」「一般的には」「おそらく」で答えることを禁じます。
- ナレッジに無いことを聞かれたら coverage を partial または none にし、missing にその点を書いてください。
- 一部だけ答えられる場合は、答えられる部分だけを answer_for_guest に書き、残りは missing に回してください。
  答えられない部分について、返信本文の中で憶測を書かないでください。
- 料金・空室・日程の確約など、ナレッジの記述を超える約束をしてはいけません。

# 回答の書き方
- 客の言語（問い合わせと同じ言語）で、自然で丁寧な文章にすること。
- 宿名で署名すること。
- 質問された内容に直接答えること。関係のない情報を並べないこと。
- ナレッジにある具体的な数字・時刻・条件（金額、時間、期限、部屋名など）は正確に反映すること。
- cited_facts には、回答の根拠にしたナレッジ内の記述を日本語で列挙すること。

# 宿ナレッジ
${knowledge}`;
}

/**
 * 赤（女将判断）のとき用。**客への返信文は作らず**、女将が判断するための
 * ナレッジ上の関連事実だけを日本語で拾って渡す。
 * SPEC §5「赤ではAIは回答を書かない」を守りつつ、判断材料は提供する。
 */
export async function referenceFactsForOwner(input: {
  guestMessage: string;
  knowledge: string;
}): Promise<{ facts: string[]; notInKnowledge: string }> {
  const system = `あなたは日本の旅館の女将さんが判断するための「下調べ係」です。

# やること
お客様からの問い合わせに関連する事実を、以下の「宿ナレッジ」から**拾い出すだけ**。

# 絶対的なルール
- **お客様への返信文を書いてはいけません。** 女将さん向けの箇条書きの事実だけを返します。
- ナレッジに書かれていないことを補完・推測してはいけません。
- 判断や推奨（「〜すべきです」等）を書いてはいけません。判断するのは女将さんです。
- 問い合わせに関係する事実がナレッジに無い場合は facts を空にし、not_in_knowledge にその旨を書いてください。

# 宿ナレッジ
${input.knowledge}`;

  const SCHEMA = {
    type: "object",
    properties: {
      facts: {
        type: "array",
        items: { type: "string" },
        description: "問い合わせに関連するナレッジ上の事実（日本語・箇条書き）。返信文ではない。",
      },
      not_in_knowledge: {
        type: "string",
        description: "問い合わせのうち、ナレッジに記載が無い点（日本語）。無ければ空文字。",
      },
    },
    required: ["facts", "not_in_knowledge"],
    additionalProperties: false,
  };

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: `お客様からの問い合わせ:\n${input.guestMessage}` }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  });

  const block = res.content.find((b) => b.type === "text");
  const j = JSON.parse(block && "text" in block ? block.text : "{}") as {
    facts: string[];
    not_in_knowledge: string;
  };
  return { facts: j.facts ?? [], notInKnowledge: j.not_in_knowledge ?? "" };
}

export async function answerFromKnowledge(input: {
  guestMessage: string;
  guestName: string | null;
  language: string;
  knowledge: string;
}): Promise<GroundedAnswer> {
  const user = `お客様の名前: ${input.guestName ?? "(不明)"}
お客様の言語: ${input.language}

お客様からの問い合わせ:
${input.guestMessage}`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt(input.knowledge),
    messages: [{ role: "user", content: user }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  });

  const block = res.content.find((b) => b.type === "text");
  const raw = block && "text" in block ? block.text : "{}";
  const j = JSON.parse(raw) as {
    coverage: Coverage;
    answer_for_guest: string;
    answer_ja: string;
    missing: string;
    cited_facts: string[];
  };

  return {
    coverage: j.coverage,
    answerForGuest: j.answer_for_guest,
    answerJa: j.answer_ja,
    missing: j.missing,
    citedFacts: j.cited_facts ?? [],
  };
}
