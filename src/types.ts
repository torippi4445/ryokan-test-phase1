// Stage 1 — shared types for the multilingual inquiry auto-response pipeline.

export type Tier = "GREEN" | "YELLOW" | "RED";

export type Channel = "direct" | "ota";

export interface InboundEmail {
  id: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string;
}

export interface TriageRule {
  category: string;
  tier: Tier;
  descriptionJa: string;
  faqCategory: string | null;
  keywords: string[];
}

export interface TriageTable {
  description: string;
  default: Tier;
  rules: TriageRule[];
}

export interface MatchedCategory {
  category: string;
  tier: Tier;
  descriptionJa: string;
  faqCategory: string | null;
  matchedKeyword: string;
}

export interface TriageResult {
  tier: Tier;
  matched: MatchedCategory[];
  reason: string;
}

export interface FaqEntry {
  category: string;
  questionJa: string;
  answerJa: string;
  answerEn: string;
}

export interface InnProfile {
  name: string;
  nameEn: string;
  location: string;
  locationEn: string;
  rooms: number;
  description: string;
  descriptionEn: string;
  rates: {
    currency: string;
    perPersonPerNightWithMeals: { min: number; max: number };
    note: string;
    noteEn: string;
  };
  operator: { name: string; deliveryEmail: string; note: string };
}

// What Claude (mocked in Stage 1) produces for one inquiry.
export interface ClaudeOutput {
  detectedLanguage: string;
  japaneseSummary: string;
  draftReply: string | null; // null for RED — AI does not write an answer.
}

// Final record handed to the operator.
export interface ProcessedInquiry {
  email: InboundEmail;
  channel: Channel;
  guestName: string | null;
  guestMessage: string;
  triage: TriageResult;
  claude: ClaudeOutput;
  action: string;
  autoSent: boolean;
}

// ---- Stage 2 (two-way) -------------------------------------------------------

export type ConversationState = "AUTO_SENT" | "SENT" | "CANCELLED";

// One line in the simulated LINE / guest exchange.
export interface LineEvent {
  dir: "to-owner" | "from-owner" | "to-guest";
  text: string;
  tag?: string;
}

export interface ConversationResult {
  inquiry: ProcessedInquiry;
  state: ConversationState;
  ownerReplyJa: string | null; // what the okami typed (null for GREEN auto)
  finalGuestReply: string | null; // what was sent to the guest (original language)
  translationIsMock: boolean; // true if the mock had no real translation
  transcript: LineEvent[];
}
