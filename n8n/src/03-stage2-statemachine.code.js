// n8n Code node「Stage2 双方向ステートマシン」 (Run Once for All Items)
// 入力: LINE Webhook ノードの出力（$json.body.events）
// 出力: { replyToken, lineText } を LINE reply ノードへ渡す（無ければ空 = 返信しない）
//
// 女将がボットにメッセージを送るたびに、組み込みの6件デモを1ステップずつ進める。
// 緑=自動送信の通知 / 黄・赤=返信例を提示→女将が日本語で答える→翻訳→「送りますか?」
// →「OK」で英訳を送信。状態は Workflow Static Data に保持（1人テスト想定）。

const QUEUE = [
  { id: "mail-001", tier: "GREEN", summary: "外国人のお客様：駐車場の有無、チェックイン時刻。",
    greenEn: "Yes, we have free parking (up to 3 cars). Check-in is 3:00–6:00 PM." },
  { id: "mail-002", tier: "YELLOW", summary: "Maria Lopez 様：12/24の空室と料金（2名1泊）。",
    answerJa: "12月24日は空いています。2名1泊で1名様18,000円、夕食は飛騨牛の会席です。" },
  { id: "mail-003", tier: "RED", summary: "t becker 様：車椅子の祖母と宿泊可能か（段差・お風呂）。",
    answerJa: "車椅子でも1階のお部屋でしたら段差なくご案内できます。お風呂は少し介助が必要ですが対応いたします。" },
  { id: "mail-004", tier: "GREEN", summary: "外国人のお客様：Wi-Fiと浴衣・タオルの有無。",
    greenEn: "Yes, free Wi-Fi in all rooms. Yukata, towels and a tea set are provided in every room." },
  { id: "mail-005", tier: "YELLOW", summary: "sophie martin 様：ベジタリアン＋グルテンアレルギー対応の夕食。",
    answerJa: "ベジタリアンとグルテンアレルギー、どちらも対応できます。当日、念のため改めて確認させていただきます。" },
  { id: "mail-006", tier: "RED", summary: "dave cooper 様：列車遅延で深夜到着になる。",
    answerJa: "深夜のご到着で問題ございません。玄関の鍵の場所をご案内しますので、ご安心してお越しください。" },
];

const JA_TO_EN = {
  "12月24日は空いています。2名1泊で1名様18,000円、夕食は飛騨牛の会席です。":
    "December 24th is available. For 2 guests for 1 night, it is 18,000 yen per person, and dinner is a Hida beef kaiseki course.",
  "車椅子でも1階のお部屋でしたら段差なくご案内できます。お風呂は少し介助が必要ですが対応いたします。":
    "If she uses a wheelchair, we can offer a ground-floor room with no steps. The bath needs a little assistance, but we are happy to help.",
  "ベジタリアンとグルテンアレルギー、どちらも対応できます。当日、念のため改めて確認させていただきます。":
    "We can accommodate both vegetarian and gluten-allergy needs. To be safe, we will confirm the details with you again on the day.",
  "深夜のご到着で問題ございません。玄関の鍵の場所をご案内しますので、ご安心してお越しください。":
    "Arriving after midnight is no problem at all. We will tell you where to find the entrance key, so please come with peace of mind.",
};
function translate(ja) {
  const t = JA_TO_EN[ja.trim()];
  return t ? { text: t, isMock: false } : { text: `(mock未登録) ${ja}`, isMock: true };
}

const sd = $getWorkflowStaticData("global");
if (typeof sd.idx !== "number") { sd.idx = 0; sd.stage = "idle"; sd.pending = null; }

function badge(t) { return { GREEN: "🟢", YELLOW: "🟡要確認", RED: "🔴女将判断" }[t]; }

// 現在の問い合わせを提示。緑は自動送信通知で即 idle のまま idx を進める。
function present() {
  if (sd.idx >= QUEUE.length) {
    return "✅ デモは以上です（6件）。『リセット』で最初から。";
  }
  const item = QUEUE[sd.idx];
  if (item.tier === "GREEN") {
    sd.idx += 1; sd.stage = "idle";
    return `${badge(item.tier)} ${item.summary}\n🟢 自動送信しました：\n${item.greenEn}\n\n（何か送ると次の問い合わせへ）`;
  }
  sd.stage = "await_answer";
  return `${badge(item.tier)} ${item.summary}\n\n返信例（コピーして送信OK）：\n${item.answerJa}\n\n→ 日本語で答えを送ってください。`;
}

function handle(text) {
  const t = text.trim();
  if (/^(リセット|reset)$/i.test(t)) {
    sd.idx = 0; sd.stage = "idle"; sd.pending = null;
    return "🔄 リセットしました。何か送ると最初の問い合わせから始まります。";
  }
  if (sd.stage === "await_answer") {
    const { text: en, isMock } = translate(t);
    sd.pending = { ja: t, en };
    sd.stage = "await_confirm";
    const warn = isMock ? "\n⚠️翻訳モック未登録（実APIでは正しく翻訳されます）" : "";
    return `お客様へ以下を送ります（英語に翻訳済み）。${warn}\n元の日本語：${t}\n\n［英訳］\n${en}\n\n送信しますか？「OK」/「やめる」`;
  }
  if (sd.stage === "await_confirm") {
    const ok = /^(ok|はい|送る|送信)$/i.test(t);
    const p = sd.pending; sd.pending = null; sd.idx += 1; sd.stage = "idle";
    if (ok) return `✉️ 送信しました：\n${p.en}\n\n（何か送ると次の問い合わせへ）`;
    return "🚫 送信をやめました。\n\n（何か送ると次の問い合わせへ）";
  }
  // idle
  return present();
}

const items = $input.all();
const body = items.length ? (items[0].json.body || items[0].json) : {};
const events = (body && body.events) || [];
const out = [];
for (const ev of events) {
  if (ev.type === "message" && ev.message && ev.message.type === "text" && ev.replyToken) {
    out.push({ json: { replyToken: ev.replyToken, lineText: handle(ev.message.text) } });
  }
}
return out; // 空配列なら返信ノードは動かない（Webスト検証の空イベント等）
