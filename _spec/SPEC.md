# SPEC — Multilingual Inquiry Auto-Response System for Small Ryokan

## 1. What we're building
A demo system that helps a small, family-run Japanese inn (ryokan) handle inbound
inquiries from foreign (mostly English-speaking) guests without the owner needing
to read or write any foreign language, and without learning any new app.

The owner ("okami", typically older and not tech-savvy) interacts only through
**LINE, in Japanese**. The system absorbs the entire language barrier behind the scenes.

This is a sales-demo artifact first: it must run end-to-end on a fake inn's data so
it can be shown to a real prospect.

## 2. Target user (keep this concrete while building)
- A small ryokan / minshuku in Magome–Tsumago (Nakasendo, Gifu/Nagano).
- Guests: Western FIT (free independent travelers), inquiries in English.
- Owner is not comfortable with English or with new software.
- The inn already lists on OTAs (Booking.com / Airbnb) and uses email.

## 3. Tech stack
- **n8n** as the orchestration / workflow layer.
- **Claude API** for understanding, translation, summarization, and reply drafting.
- **LINE Official Account + Messaging API** for two-way contact with the owner.
- Email (IMAP / Gmail) as the inbound channel.

## 4. Input channels — important constraint
Do **not** attempt to read OTA in-platform messages directly. Booking.com / Airbnb
messages live inside their platforms and require official connectivity-partner API
access that is not realistic for an individual at demo stage.

Instead, treat **email as the single inbound funnel**:
- Direct guest emails, AND
- OTA "you have a new message" notification emails that land in the inn's mailbox.

n8n monitors that one mailbox and distinguishes OTA-origin vs direct by sender/subject.
This mirrors how real inns actually operate today.

## 5. Core design — 3-tier triage (the heart of the system)
Every incoming inquiry is classified into one of three tiers. **The classification
must be driven by predefined category rules, NOT by asking the AI to freely judge
"is this easy or hard".** Humans (the operator + the owner) draw the line in advance;
the AI only sorts inquiries into the lines that were drawn.

- **GREEN — full auto.** Fixed answers, low harm if wrong.
  e.g. "Is there parking?", "What time is check-in?", "Do you have Wi-Fi?",
  "How far from the station?"
  → AI translates, answers from the inn's FAQ, and sends automatically.
  Owner only reviews logs after the fact.

- **YELLOW — AI drafts, owner approves.** Answer exists but involves price,
  availability, or a promise; a mistake causes real trouble.
  e.g. "Any room on Dec 24?", "Price for 2 people, 1 night?", "Allergy-friendly dinner?"
  → AI drafts the reply; owner taps OK in LINE before it sends.

- **RED — straight to the owner.** Individual circumstances, negotiation, complaints,
  irregular cases.
  e.g. "Traveling with my grandmother in a wheelchair — is the building OK?",
  "I need to change my reservation", "Arriving after midnight".
  → AI only translates/summarizes; it does NOT write an answer. Owner decides.

### Safety rules (do not remove)
1. Triage by category rules, never by free AI judgment of difficulty.
2. **A human checkpoint must always exist before any GUEST-facing send on YELLOW/RED.**
   GREEN auto-sends only for the pre-approved fixed categories.
3. Start conservative: when in doubt, classify as YELLOW or RED. Only demote a
   category to GREEN after it has proven to be reliably routine, in agreement with
   the owner. Do not pre-load GREEN to look impressive — trust is earned via zero incidents.

## 6. Language flow
Foreign-language inquiry
→ Claude summarizes it into Japanese ("what is the guest asking")
→ delivered to owner's LINE in Japanese
→ owner replies in Japanese, in LINE
→ Claude translates that into the original language
→ owner sees "Send this? OK?" confirmation in LINE
→ on OK, reply is sent to the guest in their original language.

The owner's whole experience: "A Japanese question arrives in LINE, I answer in
Japanese, I tap OK." All language handling is invisible to them.

## 7. Build order (do NOT build everything two-way at once)
**Stage 1 (build first): one-way.**
Foreign inquiry → Japanese summary + draft reply → delivered to operator's own
LINE or email. No owner-side LINE input yet. This alone demonstrates the core value
("dissolving the language barrier") and is enough to show a prospect.

**Stage 2 (add next): two-way.**
Owner replies in Japanese in LINE → translate → confirm → send. This needs the
LINE Messaging API two-way setup; defer it so the LINE integration doesn't eat all
the time up front.

## 8. Demo data needed
A fake inn profile + an FAQ knowledge base (parking, check-in/out times, access,
Wi-Fi, amenities, meal/allergy notes, cancellation policy) for the AI to answer GREEN
items and draft YELLOW items. A triage table mapping common inquiry types to
green/yellow/red is the next thing to produce.

## 9. Out of scope (parking lot — not now)
- Direct OTA API integration.
- A self-built platform / "mini-Etsy" style marketplace.
- Anything requiring SNS-based customer acquisition (sales is referral + in-person).
