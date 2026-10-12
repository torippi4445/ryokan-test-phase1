# 端から端まで（D 抽出組み込み ＋ E 実翻訳 ＋ メール返信ドライラン）

実行: `npm run e2e`（実Claude `claude-opus-4-8`。メールは実送信せず内容を表示）。
対象は「直メールの問い合わせ」2件（OTAはメール返信不可のため対象外）。

流れ: 受信メール → Claude抽出 → ルール振り分け → 日本語要約＋原文(=LINEに届く) → 女将が日本語で返信 → Claudeが客の言語へ翻訳 → 送信メール生成。

---

## ケース1: ベジタリアン夕食（直メール・YELLOW）

**受信** From: thomas.muller@example.com / Subject: Re: Your inn

**女将のLINEに届く内容**
- 🟡 要確認 ｜ 言語: English
- 要約: Thomas Müller 様より、ベジタリアンに対応した夕食が可能か、というお問い合わせです。
- 原文: Do you offer vegetarian dinner? My wife cannot eat meat or fish.

**女将の返信（日本語）**: ベジタリアンの夕食、ご用意できます。お肉とお魚を使わない献立に変更いたしますのでご安心ください。

**送信するメール（English）**
```
To: thomas.muller@example.com
Subject: Re: Re: Your inn

Dear Mr. Müller,

Thank you for your message. We are pleased to inform you that we can prepare a vegetarian dinner for you. Please rest assured that we will adjust the menu to exclude both meat and fish.

We look forward to welcoming you.

Warm regards,
Minoya Ryokan
```

---

## ケース2: 車椅子＋料金（直メール・RED）

**受信** From: sophie@example.fr / Subject: Question

**女将のLINEに届く内容**
- 🔴 女将判断 ｜ 言語: English (with French greetings)
- 要約: Sophie 様より、2名様2泊の料金、および車椅子の方と一緒に宿泊できるか（段差・お風呂など）、というお問い合わせです（2名 / 2泊）。
- 原文: We plan to visit in November. Is there an elevator? My mother uses a wheelchair. Also, how much for 2 people 2 nights?

**女将の返信（日本語）**: 車椅子の方も1階のお部屋でしたら段差なくご案内できます。エレベーターはございませんが1階で完結します。料金は2名2泊・1名様1泊18,000円で、合計72,000円です。

**送信するメール（English）**
```
To: sophie@example.fr
Subject: Re: Question

Bonjour Sophie,

Thank you very much for your inquiry.

For guests using a wheelchair, we can accommodate you in a room on the first floor, where there are no steps. While we do not have an elevator, everything can be arranged within the first floor.

Regarding the rate, it is 18,000 yen per person per night for 2 guests over 2 nights, for a total of 72,000 yen.

We look forward to welcoming you.

Warm regards,
Minoya Ryokan
```

---

## 検証ポイント

- 抽出＝実Claude（署名・引用・定型文を除去）、色分け＝ルールベース（SPEC §5維持）、翻訳＝実Claude。
- 金額・在庫・約束を改変しない（72,000円／18,000円、エレベーター無し等が正確）。
- 残りの「本物化」: ①女将のLINE往復を実機に（IMAP→LINE→webhook）、②メールを実送信（SMTP/Gmail）。
