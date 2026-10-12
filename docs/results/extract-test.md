# 実践テスト結果: 汚いメール6通 — Before(正規表現) → After(実Claude `claude-opus-4-8`)

実行: `npm run test:extract` の出力を保存したもの。
入力メールの元データは `data/dirty-emails.json`。

---

## real-01 — Booking: 本文に質問あり・定型文まみれ

**From**: noreply@mailing.booking.com
**Subject**: New message regarding booking 3892011 — Booking.com
**本文（届いたメール）**:
```
Booking.com

You have a new message from María González about reservation 3892011 (check-in 24 Dec 2026).

Hi, we will arrive around 11pm by car. Is late check-in possible and do you have parking? Thank you!

--
Reply to this guest by logging in to the Extranet. Do not reply to this email address.
Manage your property: https://admin.booking.com
You are receiving this because you are a Booking.com partner.
© 1996–2026 Booking.com™. All rights reserved.
Unsubscribe | Privacy | Terms
```

- ❌ **Before**: 定型文ごと丸呑みで抽出。日付を「12月20日」と**捏造**（"2026" の "20" を誤検出）。結果は RED。
- ✅ **After**: 種別=**問い合わせ**。抽出=`"Hi, we will arrive around 11pm by car. Is late check-in possible and do you have parking? Thank you!"` → **RED**（late_arrival）。日付の捏造なし。

---

## real-02 — Agoda: 本文に質問が来ない（ログイン誘導のみ）

**From**: messaging@agoda.com
**Subject**: You have a new guest message - Agoda
**本文**:
```
Dear Partner,

You have received a new message from a guest for booking ID 884512290.

To read and reply to this message, please log in to YCS (Agoda Partner Hub).

This is an automated notification. Do not reply to this email.
Agoda Company Pte. Ltd.
```

- ❌ **Before**: 既定の RED に放置（中身がないのに「要対応」っぽく見える）。
- ✅ **After**: 種別=**OTA通知のみ(本文なし)** → 振り分けせず。
  メモ: 「Agodaに新着メッセージが届いています(予約ID: 884512290)。本文には客のメッセージ内容が含まれていないため、YCS(Agoda Partner Hub)にログインして内容をご確認ください。」

---

## real-03 — Booking: 予約確定通知（問い合わせではない）

**From**: noreply@booking.com
**Subject**: Booking confirmed: 3892011, María González, 24-26 Dec
**本文**:
```
New reservation confirmed!

Guest: María González
Dates: 24 Dec 2026 – 26 Dec 2026 (2 nights)
Room: Japanese-style room, 2 guests
Price: ¥36,000 total
Free cancellation until 21 Dec.

No action needed. Manage in the Extranet.
```

- ❌ **Before**: "Price ¥36,000" に釣られ **YELLOW（料金問い合わせ）と誤検知**。
- ✅ **After**: 種別=**問い合わせでない** → 振り分けせず。
  メモ: 「Booking.comからの予約確定通知です。María González様、2026年12月24〜26日(2泊)、和室2名様、合計¥36,000。対応不要です。」

---

## real-04 — 直メール: 質問＋長い署名＋引用

**From**: thomas.muller@example.com
**Subject**: Re: Your inn
**本文**:
```
Hello,

Do you offer vegetarian dinner? My wife cannot eat meat or fish.

Best regards,
Thomas Müller
Sent from my iPhone

On Mon, Jun 8, 2026, Minoya Ryokan wrote:
> Thank you for your interest. Please let us know if you have any questions.
> Parking is available and check-in is from 3pm.
> Minoya Ryokan
```

- ❌ **Before**: 引用文の "parking / check-in" を拾い、引用の "Jun 8" から日付も誤抽出 → YELLOW（parking/checkin/availability/meal混在）。
- ✅ **After**: 抽出=`"Do you offer vegetarian dinner? My wife cannot eat meat or fish."` だけ → **YELLOW（meal_allergyのみ）**。

---

## real-05 — Expedia: レビュー依頼（宣伝、問い合わせではない）

**From**: no-reply@expedia.com
**Subject**: How was your stay? Leave a review
**本文**:
```
Thanks for hosting!

Guests love reading reviews. Remind your guest to rate their stay.
Tip: properties with Wi-Fi and free parking get more bookings!

Expedia Group Partner Central. Unsubscribe here.
```

- ❌ **Before**: 宣伝文の "Wi-Fi and free parking" に釣られ **YELLOWと誤検知**。
- ✅ **After**: 種別=**問い合わせでない** → 振り分けせず。
  メモ: 「Expediaからのレビュー依頼・宣伝メールです。対応不要です。」

---

## real-06 — 直メール: 多言語混在＋複数質問

**From**: sophie@example.fr
**Subject**: Question
**本文**:
```
Bonjour! We plan to visit in November. Is there an elevator? My mother uses a wheelchair. Also, how much for 2 people 2 nights? Merci!
```

- ✅ **Before**: RED（accessibility が最優先）。元々OK。
- ✅ **After**: 抽出=`"We plan to visit in November. Is there an elevator? My mother uses a wheelchair. Also, how much for 2 people 2 nights?"` → **RED**。維持。

---

## まとめ

| メール | Before | After |
|---|---|---|
| 01 Booking 質問あり | 丸呑み・日付捏造 | ✅ 質問だけ抽出 → RED |
| 02 Agoda 本文なし | RED放置 | ✅ OTA通知のみ → ログイン案内 |
| 03 予約確定 | ❌ 料金YELLOW誤検知 | ✅ 問い合わせでない |
| 04 署名＋引用 | ❌ 引用拾い・日付誤抽出 | ✅ 質問だけ → YELLOW |
| 05 宣伝 | ❌ YELLOW誤検知 | ✅ 問い合わせでない |
| 06 多言語複数 | ✅ RED | ✅ RED 維持 |

**4つの破綻が解消、元々OKの2つも維持。** 抽出＝実Claude、色分け＝ルールベース（SPEC §5維持）。
