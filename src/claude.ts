// Claude layer — STAGES 1 & 2 USE A MOCK.
//
// This is the single swap point. To go live, replace the mock bodies with real
// Anthropic API calls (see the TODO block at the bottom). Everything upstream
// (intake, triage) and downstream (conversation, delivery) stays the same.
//
// The mock is deterministic and FAQ/dictionary-driven so the demo produces
// meaningful, realistic output without an API key.

import type {
  ClaudeOutput,
  FaqEntry,
  InnProfile,
  MatchedCategory,
  Tier,
} from "./types.ts";

export interface ClaudeInput {
  guestMessage: string;
  guestName: string | null;
  tier: Tier;
  matched: MatchedCategory[];
  faq: FaqEntry[];
  inn: InnProfile;
}

// ---- crude language hint (mock) ----------------------------------------------
function detectLanguage(text: string): string {
  if (/[぀-ヿ一-龯]/.test(text)) return "Japanese";
  if (/\b(bonjour|merci|nous|vous)\b/i.test(text)) return "French";
  if (/\b(guten|danke|grossmutter|ich)\b/i.test(text)) return "German";
  return "English";
}

// ---- detail extraction for a richer, natural Japanese summary (mock) ---------
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

interface Details {
  dateJa?: string;
  people?: number;
  nights?: number;
}

function extractDetails(text: string): Details {
  const det: Details = {};
  const d = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(st|nd|rd|th)?/i);
  if (d) det.dateJa = `${MONTHS[d[1].toLowerCase()]}月${parseInt(d[2], 10)}日`;
  const p = text.match(/\b(\d+)\s*(people|persons|adults|guests|pax)\b/i);
  if (p) det.people = parseInt(p[1], 10);
  const n = text.match(/\b(\d+)\s*nights?\b/i);
  if (n) det.nights = parseInt(n[1], 10);
  return det;
}

function hintList(det: Details): string[] {
  const h: string[] = [];
  if (det.dateJa) h.push(`希望日 ${det.dateJa}`);
  if (det.people) h.push(`${det.people}名`);
  if (det.nights) h.push(`${det.nights}泊`);
  return h;
}

function partyJa(det: Details): string {
  let s = "";
  if (det.people) s += `${det.people}名様`;
  if (det.nights) s += `${det.nights}泊`;
  return s || "ご宿泊";
}

// Turn a matched category into a natural Japanese "what they're asking" clause.
function askClause(category: string, text: string, det: Details): string {
  const t = text.toLowerCase();
  switch (category) {
    case "parking": return "駐車場があるか";
    case "checkin_time": return "チェックインの時刻";
    case "checkout_time": return "チェックアウトの時刻";
    case "wifi": return "客室でWi-Fiが使えるか";
    case "access": return "駅からのアクセス・行き方";
    case "amenities": {
      const it: string[] = [];
      if (/yukata/.test(t)) it.push("浴衣");
      if (/towel/.test(t)) it.push("タオル");
      if (/toothbrush/.test(t)) it.push("歯ブラシ");
      return it.length ? `${it.join("・")}など設備の有無` : "館内設備・アメニティ";
    }
    case "availability": return `${det.dateJa || "ご希望日"}に空室があるか`;
    case "price_quote": return `${partyJa(det)}の料金`;
    case "meal_allergy": {
      const d: string[] = [];
      if (/vegetarian/.test(t)) d.push("ベジタリアン");
      if (/vegan/.test(t)) d.push("ヴィーガン");
      if (/gluten/.test(t)) d.push("グルテンアレルギー");
      if (/halal/.test(t)) d.push("ハラル");
      return d.length ? `${d.join("・")}に対応した夕食が可能か` : "食事・アレルギーへの対応";
    }
    case "booking_request": return "予約を申し込みたい";
    case "accessibility": {
      const who = /grandmother/.test(t) ? "車椅子の祖母"
        : /grandfather/.test(t) ? "車椅子の祖父"
        : /wheelchair/.test(t) ? "車椅子の方" : "配慮が必要な方";
      return `${who}と一緒に宿泊できるか（段差・お風呂など）`;
    }
    case "reservation_change": return "予約内容の変更・キャンセル";
    case "late_arrival": return /midnight/.test(t) ? "深夜（24時以降）の到着でも問題ないか" : "時間外の到着でも問題ないか";
    case "complaint": return "クレーム・返金に関するご連絡";
    case "negotiation": return "料金の値引き交渉";
    default: return "個別の確認が必要なご相談";
  }
}

function buildJapaneseSummary(input: ClaudeInput, det: Details): string {
  const who = input.guestName ? `${input.guestName} 様` : "海外のお客様";
  if (input.matched.length === 0) {
    return `${who}より、定型カテゴリに当てはまらないお問い合わせです。内容をご確認のうえご対応ください。`;
  }
  const clauses = input.matched.map((m) => askClause(m.category, input.guestMessage, det));
  const body = clauses.length === 1
    ? clauses[0]
    : clauses.slice(0, -1).join("、") + "、および" + clauses[clauses.length - 1];
  const hints = hintList(det);
  const hintStr = hints.length ? `（${hints.join(" / ")}）` : "";
  return `${who}より、${body}、というお問い合わせです${hintStr}。`;
}

function faqAnswerEn(faqCategory: string | null, faq: FaqEntry[]): string | null {
  if (!faqCategory) return null;
  const e = faq.find((f) => f.category === faqCategory);
  return e ? e.answerEn : null;
}

// English draft for GREEN/YELLOW (Stage 1, and the GREEN auto-reply in Stage 2).
// RED returns null (AI must not answer).
function buildDraftReply(input: ClaudeInput): string | null {
  if (input.tier === "RED") return null;

  const greeting = input.guestName ? `Dear ${input.guestName},` : "Dear guest,";
  const parts: string[] = [
    greeting,
    "",
    `Thank you for your inquiry about ${input.inn.nameEn}.`,
    "",
  ];

  for (const m of input.matched) {
    const fixed = faqAnswerEn(m.faqCategory, input.faq);
    if (fixed) {
      parts.push(fixed);
      continue;
    }
    switch (m.category) {
      case "availability":
        parts.push(
          "Regarding availability for your requested dates, let me check our calendar and confirm with you shortly."
        );
        break;
      case "price_quote": {
        const r = input.inn.rates.perPersonPerNightWithMeals;
        parts.push(
          `Our rate is approximately ${r.min.toLocaleString()}–${r.max.toLocaleString()} ${input.inn.rates.currency} per person per night, including breakfast and dinner. I will confirm the exact total for your dates.`
        );
        break;
      }
      case "meal_allergy":
        parts.push(
          "Thank you for letting us know about your dietary needs. We will do our best to accommodate them; let me confirm the details with our kitchen."
        );
        break;
      case "booking_request":
        parts.push(
          "We would be happy to welcome you. Could you let us know your dates, number of guests, and any preferences so we can confirm your reservation?"
        );
        break;
    }
  }

  parts.push("", "We look forward to welcoming you.", `${input.inn.nameEn}`);
  return parts.join("\n");
}

// ---- Stage 1 entry (unchanged contract) --------------------------------------
export function generate(input: ClaudeInput): ClaudeOutput {
  return {
    ...summarize(input),
    draftReply: buildDraftReply(input),
  };
}

// Reused by Stage 2 (GREEN auto-reply is the same English FAQ reply).
export function draftGuestReplyForGreen(input: ClaudeInput): string {
  return buildDraftReply(input) ?? "";
}

// ============================================================================
// Stage 2 additions
// ============================================================================

export function summarize(input: ClaudeInput): { detectedLanguage: string; japaneseSummary: string } {
  const det = extractDetails(input.guestMessage);
  return {
    detectedLanguage: detectLanguage(input.guestMessage),
    japaneseSummary: buildJapaneseSummary(input, det),
  };
}

// YELLOW only: a Japanese starting draft shown to the okami in LINE. The okami
// can approve it or rewrite it in Japanese. RED returns null (AI must not draft).
export function draftJapaneseForOwner(input: ClaudeInput): string | null {
  if (input.tier !== "YELLOW") return null;
  const cats = new Set(input.matched.map((m) => m.category));
  if (cats.has("availability") || cats.has("price_quote")) {
    return "ご希望日の空室を確認し、改めてご連絡いたします。料金は1名様1泊2食付きで13,000〜18,000円です。";
  }
  if (cats.has("meal_allergy")) {
    return "アレルギーについて承知しました。厨房と相談のうえ、できる限り対応いたします。";
  }
  if (cats.has("booking_request")) {
    return "ご予約ありがとうございます。ご希望の日程・人数をお知らせいただければ確定いたします。";
  }
  return "お問い合わせありがとうございます。確認のうえご返信いたします。";
}

// Mock JP→guest-language translation. A real translator (Claude) would handle
// any sentence; the mock knows the demo's sentences via a dictionary and flags
// anything it doesn't (isMock=true) so the demo stays honest.
const JA_TO_EN: Record<string, string> = {
  "12月24日は空いています。2名1泊で1名様18,000円、夕食は飛騨牛の会席です。":
    "December 24th is available. For 2 guests for 1 night, it is 18,000 yen per person, and dinner is a Hida beef kaiseki course.",
  "車椅子でも1階のお部屋でしたら段差なくご案内できます。お風呂は少し介助が必要ですが対応いたします。":
    "If she uses a wheelchair, we can offer a ground-floor room with no steps. The bath needs a little assistance, but we are happy to help.",
  "ベジタリアンとグルテンアレルギー、どちらも対応できます。当日、念のため改めて確認させていただきます。":
    "We can accommodate both vegetarian and gluten-allergy needs. To be safe, we will confirm the details with you again on the day.",
  "深夜のご到着で問題ございません。玄関の鍵の場所をご案内しますので、ご安心してお越しください。":
    "Arriving after midnight is no problem at all. We will tell you where to find the entrance key, so please come with peace of mind.",
  // YELLOW suggestion drafts (used if the okami approves them as-is)
  "ご希望日の空室を確認し、改めてご連絡いたします。料金は1名様1泊2食付きで13,000〜18,000円です。":
    "Let me check availability for your requested dates and get back to you. The rate is 13,000–18,000 yen per person per night, including breakfast and dinner.",
  "アレルギーについて承知しました。厨房と相談のうえ、できる限り対応いたします。":
    "Thank you for letting us know about the allergy. We will consult our kitchen and do our best to accommodate it.",
  "ご予約ありがとうございます。ご希望の日程・人数をお知らせいただければ確定いたします。":
    "Thank you for your reservation request. If you let us know your preferred dates and number of guests, we will confirm it.",
};

export function translateJaToGuest(
  ja: string,
  targetLanguage: string
): { text: string; isMock: boolean } {
  const key = ja.trim();
  if (targetLanguage === "English" && JA_TO_EN[key]) {
    return { text: JA_TO_EN[key], isMock: false };
  }
  // Mock has no entry — flag it. A real Claude call would translate properly.
  return { text: `(mock translation unavailable → ${targetLanguage}) ${ja}`, isMock: true };
}

// ============================================================================
// TODO (mock → real): replace mock bodies with Claude calls.
//
//   import Anthropic from "@anthropic-ai/sdk";
//   const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
//   // summarize(): ask for a Japanese summary of the foreign inquiry.
//   // draftJapaneseForOwner(): YELLOW only, Japanese draft from the FAQ.
//   // translateJaToGuest(): translate the okami's Japanese into the guest's language.
//   // model: "claude-opus-4-8"
//
// Contracts to keep: RED never gets a draft; translation must never silently
// alter price/availability/promises written by the okami.
// ============================================================================
