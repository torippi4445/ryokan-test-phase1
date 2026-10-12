// 3-tier triage (SPEC §5). Classification is driven ONLY by the predefined
// category rules in data/triage-rules.json — never by free AI judgment.
//
// Rules:
//  - Match every rule whose keyword appears in the guest message.
//  - If multiple categories match, the MOST CONSERVATIVE tier wins (RED > YELLOW > GREEN).
//  - If nothing matches, fall back to the table's default (RED) — "when in doubt, red".

import type { TriageTable, TriageResult, MatchedCategory, Tier } from "./types.ts";

const SEVERITY: Record<Tier, number> = { GREEN: 0, YELLOW: 1, RED: 2 };

function mostConservative(tiers: Tier[]): Tier {
  return tiers.reduce((worst, t) => (SEVERITY[t] > SEVERITY[worst] ? t : worst), "GREEN");
}

export function triage(guestMessage: string, table: TriageTable): TriageResult {
  const text = guestMessage.toLowerCase();
  const matched: MatchedCategory[] = [];

  for (const rule of table.rules) {
    const hit = rule.keywords.find((kw) => text.includes(kw.toLowerCase()));
    if (hit) {
      matched.push({
        category: rule.category,
        tier: rule.tier,
        descriptionJa: rule.descriptionJa,
        faqCategory: rule.faqCategory,
        matchedKeyword: hit,
      });
    }
  }

  if (matched.length === 0) {
    return {
      tier: table.default,
      matched: [],
      reason: `どのカテゴリルールにも該当せず。安全側に倒して既定の ${table.default} に分類。`,
    };
  }

  const tier = mostConservative(matched.map((m) => m.tier));
  const cats = matched.map((m) => `${m.category}(${m.tier})`).join(", ");
  const reason =
    matched.length === 1
      ? `カテゴリ「${matched[0].category}」に該当 → ${tier}。`
      : `複数該当 [${cats}]。最も保守的な ${tier} を採用。`;

  return { tier, matched, reason };
}
