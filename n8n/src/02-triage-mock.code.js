// n8n Code node「トリアージ + Claude(MOCK) + LINE文面」 (Run Once for All Items)
// 入力: サンプル受信メール（または IMAP Email Trigger の出力を整形したもの）
// 出力: lineText（女将のLINEへ送る日本語カード）と各種メタ情報
// ※ data/*.json と src/*.ts のロジックを n8n 用に1ノードへ自己完結化したもの。
// ※ Claudeはモック（決め打ちテンプレ）。自然文の本当の質は実API接続時に出る。

const FAQ_EN = {
  parking: "Yes, we have free parking for up to 3 cars, no reservation needed.",
  checkin: "Check-in is from 3:00 PM to 6:00 PM. Please arrive by 6:00 PM.",
  checkout: "Check-out is at 10:00 AM.",
  access: "Nearest station is Nakatsugawa (JR Chuo Line); ~30 min by bus to Magome, then a 5-min walk.",
  wifi: "Yes, free Wi-Fi is available in all rooms.",
  amenities: "Each room has yukata, towels, toothbrush, and a tea set; shared hinoki bath.",
};
const RATE = { min: 13000, max: 18000, cur: "JPY" };
const DEFAULT_TIER = "RED";
const SEV = { GREEN: 0, YELLOW: 1, RED: 2 };
const TIER_JA = { GREEN: "緑", YELLOW: "黄", RED: "赤" };
const OTA = ["booking.com", "airbnb", "expedia", "agoda", "rakuten travel"];
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const RULES = [
  { category: "parking", tier: "GREEN", ja: "駐車場の有無", faq: "parking", kw: ["parking", "park the car", "car park", "park my car"] },
  { category: "checkin_time", tier: "GREEN", ja: "チェックイン時刻", faq: "checkin", kw: ["check-in", "check in", "checkin", "arrival time", "what time can we arrive"] },
  { category: "checkout_time", tier: "GREEN", ja: "チェックアウト時刻", faq: "checkout", kw: ["check-out", "check out", "checkout"] },
  { category: "wifi", tier: "GREEN", ja: "Wi-Fi", faq: "wifi", kw: ["wifi", "wi-fi", "wireless", "internet"] },
  { category: "access", tier: "GREEN", ja: "アクセス", faq: "access", kw: ["how far", "from the station", "nearest station", "how to get", "directions", "by bus", "by train"] },
  { category: "amenities", tier: "GREEN", ja: "設備・アメニティ", faq: "amenities", kw: ["amenities", "yukata", "towel", "toothbrush", "shared bath", "public bath"] },
  { category: "availability", tier: "YELLOW", ja: "空室確認", faq: null, kw: ["available", "availability", "any room", "vacancy", "free on", "open on"] },
  { category: "price_quote", tier: "YELLOW", ja: "料金見積もり", faq: null, kw: ["price", "how much", "cost", "rate", "per night", "per person"] },
  { category: "meal_allergy", tier: "YELLOW", ja: "食事・アレルギー対応", faq: null, kw: ["allergy", "allergic", "gluten", "vegetarian", "vegan", "halal", "dietary"] },
  { category: "booking_request", tier: "YELLOW", ja: "予約申込", faq: null, kw: ["i would like to book", "make a reservation", "can i book", "reserve a room", "book a room"] },
  { category: "accessibility", tier: "RED", ja: "車椅子・高齢者配慮", faq: null, kw: ["wheelchair", "disabled", "elderly", "grandmother", "grandfather", "mobility", "accessible"] },
  { category: "reservation_change", tier: "RED", ja: "予約変更・キャンセル", faq: null, kw: ["change my reservation", "modify my booking", "reschedule", "cancel my reservation", "change the date"] },
  { category: "late_arrival", tier: "RED", ja: "時間外の到着", faq: null, kw: ["after midnight", "late at night", "arrive late", "arriving late", "midnight", "late check-in"] },
  { category: "complaint", tier: "RED", ja: "クレーム・返金", faq: null, kw: ["complaint", "disappointed", "refund", "unhappy", "not satisfied", "problem with"] },
  { category: "negotiation", tier: "RED", ja: "値引き交渉", faq: null, kw: ["discount", "negotiate", "special deal", "cheaper", "best price"] },
];

function detectChannel(from, subject) {
  const f = (from || "").toLowerCase();
  const s = (subject || "").toLowerCase();
  return OTA.some((o) => f.includes(o) || s.includes(o)) ? "ota" : "direct";
}
function extractGuestName(from, body, channel) {
  if (channel === "direct") return (from.split("@")[0] || "").replace(/[._]/g, " ") || null;
  const m = body.match(/(?:from your guest|from guest|guest)\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/);
  return m ? m[1] : null;
}
function extractGuestMessage(body, channel) {
  if (channel === "direct") return body.trim();
  const fenced = body.match(/----\s*([\s\S]*?)\s*----/);
  if (fenced) return fenced[1].trim();
  const quoted = body.match(/(?:wrote|message)\s*:\s*\n?\s*"?([\s\S]*?)"?\s*$/i);
  if (quoted) return quoted[1].trim();
  return body.trim();
}
function triage(text) {
  const t = text.toLowerCase();
  const matched = [];
  for (const r of RULES) {
    const hit = r.kw.find((k) => t.includes(k));
    if (hit) matched.push(r);
  }
  if (matched.length === 0) return { tier: DEFAULT_TIER, matched: [], reason: "未該当 → 既定RED（迷ったら赤）" };
  const tier = matched.reduce((w, m) => (SEV[m.tier] > SEV[w] ? m.tier : w), "GREEN");
  return { tier, matched, reason: matched.map((m) => `${m.category}(${m.tier})`).join(", ") };
}

// --- 詳細抽出（日付の和訳・人数・泊数） ---
function extract(text) {
  const det = {};
  const d = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(st|nd|rd|th)?/i);
  if (d) { det.dateJa = `${MONTHS[d[1].toLowerCase()]}月${parseInt(d[2], 10)}日`; }
  const p = text.match(/\b(\d+)\s*(people|persons|adults|guests|pax)\b/i);
  if (p) det.people = parseInt(p[1], 10);
  const n = text.match(/\b(\d+)\s*nights?\b/i);
  if (n) det.nights = parseInt(n[1], 10);
  return det;
}
function hintList(det) {
  const h = [];
  if (det.dateJa) h.push(`希望日 ${det.dateJa}`);
  if (det.people) h.push(`${det.people}名`);
  if (det.nights) h.push(`${det.nights}泊`);
  return h;
}
function partyJa(det) {
  let s = "";
  if (det.people) s += `${det.people}名様`;
  if (det.nights) s += `${det.nights}泊`;
  return s || "ご宿泊";
}

// --- 「何を聞いているか」を自然な日本語の節にする ---
function askClause(category, text, det) {
  const t = text.toLowerCase();
  switch (category) {
    case "parking": return "駐車場があるか";
    case "checkin_time": return "チェックインの時刻";
    case "checkout_time": return "チェックアウトの時刻";
    case "wifi": return "客室でWi-Fiが使えるか";
    case "access": return "駅からのアクセス・行き方";
    case "amenities": {
      const it = [];
      if (/yukata/.test(t)) it.push("浴衣");
      if (/towel/.test(t)) it.push("タオル");
      if (/toothbrush/.test(t)) it.push("歯ブラシ");
      return it.length ? `${it.join("・")}など設備の有無` : "館内設備・アメニティ";
    }
    case "availability": return `${det.dateJa || "ご希望日"}に空室があるか`;
    case "price_quote": return `${partyJa(det)}の料金`;
    case "meal_allergy": {
      const d = [];
      if (/vegetarian/.test(t)) d.push("ベジタリアン");
      if (/vegan/.test(t)) d.push("ヴィーガン");
      if (/gluten/.test(t)) d.push("グルテンアレルギー");
      if (/halal/.test(t)) d.push("ハラル");
      return d.length ? `${d.join("・")}に対応した夕食が可能か` : "食事・アレルギーへの対応";
    }
    case "booking_request": return "予約を申し込みたい";
    case "accessibility": {
      const who = /grandmother/.test(t) ? "車椅子の祖母" : /grandfather/.test(t) ? "車椅子の祖父" : /wheelchair/.test(t) ? "車椅子の方" : "配慮が必要な方";
      return `${who}と一緒に宿泊できるか（段差・お風呂など）`;
    }
    case "reservation_change": return "予約内容の変更・キャンセル";
    case "late_arrival": return /midnight/.test(t) ? "深夜（24時以降）の到着でも問題ないか" : "時間外の到着でも問題ないか";
    case "complaint": return "クレーム・返金に関するご連絡";
    case "negotiation": return "料金の値引き交渉";
    default: return "個別の確認が必要なご相談";
  }
}

function summaryJa(name, matched, det, text) {
  const who = name ? `${name} 様` : "海外のお客様";
  if (!matched.length) {
    return `${who}より、定型カテゴリに当てはまらないお問い合わせです。内容をご確認のうえご対応ください。`;
  }
  const clauses = matched.map((m) => askClause(m.category, text, det));
  const body = clauses.length === 1 ? clauses[0] : clauses.slice(0, -1).join("、") + "、および" + clauses[clauses.length - 1];
  const hints = hintList(det);
  const hintStr = hints.length ? `（${hints.join(" / ")}）` : "";
  return `${who}より、${body}、というお問い合わせです${hintStr}。`;
}

function draftEn(name, tier, matched) {
  if (tier === "RED") return null;
  const parts = [name ? `Dear ${name},` : "Dear guest,", "", "Thank you for your inquiry about Minoya Ryokan.", ""];
  for (const m of matched) {
    if (m.faq && FAQ_EN[m.faq]) { parts.push(FAQ_EN[m.faq]); continue; }
    if (m.category === "availability") parts.push("Let me check availability for your dates and confirm shortly.");
    else if (m.category === "price_quote") parts.push(`Our rate is about ${RATE.min.toLocaleString()}–${RATE.max.toLocaleString()} ${RATE.cur} per person per night incl. 2 meals; I will confirm the exact total.`);
    else if (m.category === "meal_allergy") parts.push("Thank you for telling us about your dietary needs; we will do our best and confirm with our kitchen.");
    else if (m.category === "booking_request") parts.push("We'd be glad to welcome you. Please share your dates and number of guests so we can confirm.");
  }
  parts.push("", "We look forward to welcoming you.", "Minoya Ryokan");
  return parts.join("\n");
}

function categoriesJa(matched, tier) {
  const names = matched.length ? matched.map((m) => m.ja).join("・") : "定型外";
  return `${TIER_JA[tier]}（${names}）`;
}

function buildCard(e, channel, name, tier, summary, draftReply, matched) {
  const head = { GREEN: "🟢 自動送信", YELLOW: "🟡 要確認（承認待ち）", RED: "🔴 女将の判断が必要" }[tier];
  const chJa = channel === "ota" ? "OTA通知" : "直メール";
  const L = [
    `${head}　|　${chJa}・${e.id}`,
    `👤 ${name ? name + " 様" : "海外のお客様"}`,
    "──────────────",
    "📩 ご質問の要約",
    summary,
    "",
    `🏷 分類：${categoriesJa(matched, tier)}`,
  ];
  if (tier === "GREEN") L.push("→ FAQに基づき自動でお客様へ返信します（女将は事後確認のみ）。");
  else if (tier === "YELLOW") L.push("→ 下の返信案をご確認のうえ「OK」で送信してください。");
  else L.push("→ 個別のご事情です。日本語でご返信ください（AIは回答を作成しません）。");
  if (draftReply) {
    L.push("──────────────");
    L.push(tier === "GREEN" ? "✉️ お客様へ送信した返信（英語）" : "✏️ 返信下書き（英語・未送信）");
    L.push(draftReply);
  }
  return L.join("\n");
}

function process(e) {
  const channel = detectChannel(e.from, e.subject);
  const name = extractGuestName(e.from, e.body, channel);
  const guestMessage = extractGuestMessage(e.body, channel);
  const tr = triage(guestMessage);
  const det = extract(guestMessage);
  const japaneseSummary = summaryJa(name, tr.matched, det, guestMessage);
  const draftReply = draftEn(name, tr.tier, tr.matched);
  const lineText = buildCard(e, channel, name, tr.tier, japaneseSummary, draftReply, tr.matched);

  return {
    id: e.id, channel, tier: tr.tier, guestName: name, guestMessage,
    japaneseSummary, reason: tr.reason, draftReply, lineText,
  };
}

return $input.all().map((it) => ({ json: process(it.json) }));
