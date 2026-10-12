// カテゴリ分類（実Claude API）。
//
// SPEC §5 の原則は維持する:
//   「人間が事前に線を引き、AIはその線に沿って分類するだけ」
//   → カテゴリの定義と色（緑/黄/赤）の対応は data/triage-rules.json のまま（人間が決める）。
//   → AIがやるのは「この問い合わせがどのカテゴリに当たるか」の判定のみ。
//   → AIに「簡単か難しいか」を自由判断させることは絶対にしない。
//
// キーワード完全一致（triage.ts）では
//   "arrive around 8pm" が late_arrival に、"trouble walking" が accessibility に
// マッチせず既定の赤へ落ちてしまうため、マッチングだけを意味理解に置き換える。

import Anthropic from "@anthropic-ai/sdk";
import type { TriageTable, TriageResult, MatchedCategory, Tier } from "./types.ts";

const MODEL = "claude-opus-4-8";
const client = new Anthropic();

const SEVERITY: Record<Tier, number> = { GREEN: 0, YELLOW: 1, RED: 2 };

export async function classify(
  guestMessage: string,
  table: TriageTable
): Promise<TriageResult> {
  const catalog = table.rules
    .map((r) => `- ${r.category}: ${r.descriptionJa}（例となる語: ${r.keywords.slice(0, 5).join(", ")}）`)
    .join("\n");

  const system = `あなたは日本の旅館に届いた問い合わせを、あらかじめ人間が定義したカテゴリに仕分ける分類器です。

# カテゴリ一覧（人間が定義済み。これ以外を作ってはいけない）
${catalog}

# ルール
- 問い合わせが該当するカテゴリを、上の一覧から**すべて**選んでください。
- 「例となる語」は参考です。語が一致しなくても、意味的に該当すればそのカテゴリを選んでください。
  例: 「20時に到着します」は late_arrival に該当（時間外の到着）。
      「母が歩くのが難しい」は accessibility に該当（身体配慮）。
- どのカテゴリにも該当しない場合は空の配列を返してください（推測で無理に当てはめない）。
- カテゴリの重要度や難易度を判断してはいけません。該当するかどうかだけを見てください。
- reason には、なぜそのカテゴリを選んだかを日本語で簡潔に書いてください。`;

  const SCHEMA = {
    type: "object",
    properties: {
      categories: {
        type: "array",
        items: { type: "string" },
        description: "該当するカテゴリ名の配列。一覧に無い名前を返してはいけない。",
      },
      reason: { type: "string", description: "選定理由（日本語・簡潔に）" },
    },
    required: ["categories", "reason"],
    additionalProperties: false,
  };

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: `問い合わせ:\n${guestMessage}` }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  });

  const block = res.content.find((b) => b.type === "text");
  const j = JSON.parse(block && "text" in block ? block.text : "{}") as {
    categories: string[];
    reason: string;
  };

  // 返ってきたカテゴリ名を、人間が定義したルールに突き合わせる（未知の名前は捨てる）
  const matched: MatchedCategory[] = [];
  for (const name of j.categories ?? []) {
    const rule = table.rules.find((r) => r.category === name);
    if (!rule) continue;
    matched.push({
      category: rule.category,
      tier: rule.tier,
      descriptionJa: rule.descriptionJa,
      faqCategory: rule.faqCategory,
      matchedKeyword: "(意味一致)",
    });
  }

  if (matched.length === 0) {
    return {
      tier: table.default,
      matched: [],
      reason: `どのカテゴリにも該当せず。安全側に倒して既定の ${table.default} に分類。（${j.reason ?? ""}）`,
    };
  }

  // 色の決定は従来どおり「最も保守的な色が勝つ」（人間が決めたルール）
  const tier = matched.reduce<Tier>(
    (worst, m) => (SEVERITY[m.tier] > SEVERITY[worst] ? m.tier : worst),
    "GREEN"
  );
  const cats = matched.map((m) => `${m.category}(${m.tier})`).join(", ");
  return {
    tier,
    matched,
    reason: `該当 [${cats}] → 最も保守的な ${tier} を採用。${j.reason ?? ""}`,
  };
}
