// Stage 1 entry point. Runs the one-way pipeline over the fake inn's sample
// emails and prints the operator-facing result. Run with: `npm start`.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type {
  FaqEntry,
  InboundEmail,
  InnProfile,
  TriageTable,
} from "./types.ts";
import { processEmail } from "./pipeline.ts";
import { formatConsole, formatMarkdown } from "./delivery.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = <T>(rel: string): T =>
  JSON.parse(readFileSync(join(root, rel), "utf8")) as T;

const inn = readJson<InnProfile>("data/inn-profile.json");
const faq = readJson<FaqEntry[]>("data/faq.json");
const table = readJson<TriageTable>("data/triage-rules.json");
const emails = readJson<InboundEmail[]>("data/sample-emails.json");

console.log(`\n🏯 ${inn.name} (${inn.nameEn}) — Stage 1 一方向パイプライン`);
console.log(`   ${inn.locationEn}`);
console.log(`   ⚠️  Claude はモック応答です（API未接続）。\n`);

const results = emails.map((e) => processEmail(e, table, faq, inn));

for (const r of results) console.log(formatConsole(r));
console.log("────────────────────────────────────────────────────────\n");

const counts = { GREEN: 0, YELLOW: 0, RED: 0 };
for (const r of results) counts[r.triage.tier]++;
console.log(
  `集計: 🟢${counts.GREEN}（自動送信） / 🟡${counts.YELLOW}（承認待ち） / 🔴${counts.RED}（女将判断）\n`
);

mkdirSync(join(root, "out"), { recursive: true });
writeFileSync(join(root, "out/inbox.md"), formatMarkdown(results), "utf8");
console.log("📝 ダイジェストを out/inbox.md に書き出しました。\n");
