// Builds importable n8n workflow JSON from the Code-node sources in ./src,
// and validates each Code node by executing it the way n8n does (the body is
// wrapped in a function, so top-level `return` is legal) with mocked globals.
//
//   node n8n/build.mjs          # validate + emit JSON
//
// NOTE: this validates the Code-node JavaScript only. The node wiring must be
// verified by importing the JSON into a real n8n instance.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, "src", f), "utf8");

const samplesCode = read("01-samples.code.js");
const triageCode = read("02-triage-mock.code.js");
const stage2Code = read("03-stage2-statemachine.code.js");

// --- run a Code-node body like n8n does -------------------------------------
function runCode(code, { input = [], staticData = {} } = {}) {
  const $input = {
    all: () => input,
    first: () => input[0],
  };
  const $getWorkflowStaticData = () => staticData;
  const fn = new Function("$input", "$getWorkflowStaticData", code);
  return fn($input, $getWorkflowStaticData);
}

// ============================ VALIDATION ====================================
console.log("== 検証: Stage 1 (samples → triage+mock) ==");
const sampleItems = runCode(samplesCode);
const triaged = runCode(triageCode, { input: sampleItems });
const tally = { GREEN: 0, YELLOW: 0, RED: 0 };
for (const it of triaged) {
  tally[it.json.tier]++;
  console.log(`  ${it.json.tier.padEnd(6)} ${it.json.id}  ${it.json.japaneseSummary}`);
}
console.log(`  集計 → 🟢${tally.GREEN} 🟡${tally.YELLOW} 🔴${tally.RED}`);
console.assert(tally.GREEN === 2 && tally.YELLOW === 2 && tally.RED === 2, "❌ tier 集計が想定外");

console.log("\n== 検証: Stage 2 (webhook ステートマシン, 会話シミュレーション) ==");
const sd = {};
const ev = (text) => ({
  json: { body: { events: [{ type: "message", message: { type: "text", text }, replyToken: "RT" }] } },
});
// 女将が順にメッセージを送る想定。緑→緑通知, 黄→例提示→回答→OK→送信 …
const script = [
  "こんにちは",        // → mail-001 緑 自動送信
  "次",                // → mail-002 黄 返信例提示
  "12月24日は空いています。2名1泊で1名様18,000円、夕食は飛騨牛の会席です。", // → 翻訳→確認
  "OK",                // → 送信
  "次",                // → mail-003 赤 例提示
];
for (const msg of script) {
  const out = runCode(stage2Code, { input: [ev(msg)], staticData: sd });
  const reply = out[0]?.json?.lineText ?? "(返信なし)";
  console.log(`  女将「${msg}」\n    Bot> ${reply.replace(/\n/g, "\n         ")}\n`);
}

// ============================ EMIT JSON =====================================
const codeNode = (name, code, pos) => ({
  parameters: { mode: "runOnceForAllItems", jsCode: code },
  id: randomUUID(),
  name,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: pos,
});

const lineHttpNode = (name, url, jsonBody, pos) => ({
  parameters: {
    method: "POST",
    url,
    authentication: "genericCredentialType",
    genericAuthType: "httpHeaderAuth",
    sendHeaders: true,
    headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
    sendBody: true,
    specifyBody: "json",
    jsonBody,
    options: {},
  },
  id: randomUUID(),
  name,
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: pos,
  credentials: { httpHeaderAuth: { id: "REPLACE_WITH_YOUR_CREDENTIAL_ID", name: "LINE Messaging API" } },
});

const chain = (names) => {
  const c = {};
  for (let i = 0; i < names.length - 1; i++) {
    c[names[i]] = { main: [[{ node: names[i + 1], type: "main", index: 0 }]] };
  }
  return c;
};

const wf = (name, nodes, connections) => ({
  name,
  nodes,
  connections,
  active: false,
  settings: { executionOrder: "v1" },
  pinData: {},
});

// ---- Stage 1 workflow ----
const manual = {
  parameters: {},
  id: randomUUID(),
  name: "▶ 手動実行（テスト）",
  type: "n8n-nodes-base.manualTrigger",
  typeVersion: 1,
  position: [240, 300],
};
const stage1 = wf(
  "旅館 Stage1 — メール→トリアージ→LINE",
  [
    manual,
    codeNode("サンプル受信メール", samplesCode, [460, 300]),
    codeNode("トリアージ+Claude(MOCK)", triageCode, [680, 300]),
    lineHttpNode(
      "LINE ブロードキャスト",
      "https://api.line.me/v2/bot/message/broadcast",
      "={{ JSON.stringify({ messages: [ { type: 'text', text: $json.lineText } ] }) }}",
      [920, 300]
    ),
  ],
  chain(["▶ 手動実行（テスト）", "サンプル受信メール", "トリアージ+Claude(MOCK)", "LINE ブロードキャスト"])
);

// ---- Stage 2 workflow ----
const webhook = {
  parameters: { httpMethod: "POST", path: "line-okami", responseMode: "onReceived", options: {} },
  id: randomUUID(),
  name: "LINE Webhook",
  type: "n8n-nodes-base.webhook",
  typeVersion: 2,
  position: [240, 300],
  webhookId: randomUUID(),
};
const stage2 = wf(
  "旅館 Stage2 — LINE双方向（翻訳+確認）",
  [
    webhook,
    codeNode("Stage2 ステートマシン", stage2Code, [480, 300]),
    lineHttpNode(
      "LINE 返信(reply)",
      "https://api.line.me/v2/bot/message/reply",
      "={{ JSON.stringify({ replyToken: $json.replyToken, messages: [ { type: 'text', text: $json.lineText } ] }) }}",
      [720, 300]
    ),
  ],
  chain(["LINE Webhook", "Stage2 ステートマシン", "LINE 返信(reply)"])
);

writeFileSync(join(here, "stage1-line-push.json"), JSON.stringify(stage1, null, 2));
writeFileSync(join(here, "stage2-line-twoway.json"), JSON.stringify(stage2, null, 2));
console.log("== 出力 ==");
console.log("  n8n/stage1-line-push.json");
console.log("  n8n/stage2-line-twoway.json");
