# 小規模旅館向け 多言語問い合わせ自動対応システム

SPEC（`旅館設計書` 内の `SPEC.md` / `SPEC_ja.md`）の実装。Stage 1（一方向）と
Stage 2（双方向）を実装済み。

## Stage 1 — 一方向パイプライン

```
外国語の問い合わせメール
  → ① チャネル判定（OTA通知 / 直メール）＋ 客の本文抽出
  → ② ルールベース3色トリアージ（緑/黄/赤）
  → ③ Claude（※モック）が日本語要約＋返信下書きを生成
  → ④ 運用者へ配信（コンソール表示 ＋ out/inbox.md）
```

## Stage 2 — 双方向パイプライン（SPEC §6/§7）

```
外国語の問い合わせ
  → 日本語要約が女将のLINEへ
  → 女将が日本語で返信（黄はAIの日本語返信案つき／赤は白紙）
  → Claude（※モック）が元の言語へ翻訳
  → 「この内容で送りますか? OK?」確認が女将のLINEに出る
  → OKで、元の言語のまま客へ送信
```

女将さんの体験は「LINEに来た日本語の質問に日本語で答えてOKを押すだけ」。
言語処理は全部見えないところで完結する。色別の挙動:

- 🟢 緑: 自動送信（女将の介在なし）。
- 🟡 黄: AIが**日本語の返信案**を提示 → 女将がOKか日本語で修正 → 翻訳 → 確認 → 送信。
- 🔴 赤: AIは案を作らない → 女将が日本語で記述 → 翻訳 → 確認 → 送信。

## ローカルのデモ実行（TS・課金なし）

Node.js v22.6 以上（TypeScript をビルド無しで直接実行）。追加インストール不要。

```bash
npm start              # = Stage 2（スクリプトモード）
npm run stage1         # Stage 1（一方向）
npm run stage2         # Stage 2（女将の返信はスクリプト再生・再現可能）
npm run stage2 -- -i   # Stage 2 対話モード（女将の日本語返信を端末で生入力）
```

## n8n + LINE で実機配線（課金なし）

`n8n/` に、n8n へインポートできるワークフローと立ち上げ手順を用意。Claude は
モックのままなので無料で「LINEに振り分け結果が届く／LINEで双方向に答える」まで試せる。

- `n8n/SETUP.md` … ゼロから（n8n起動・LINEチャネル作成・トークン・インポート・実行）
- `n8n/stage1-line-push.json` … 手動実行で振り分け済み日本語カードをLINEへ
- `n8n/stage2-line-twoway.json` … LINE Webhookで双方向（翻訳＋確認ゲート）
- `n8n/src/*.code.js` … 各Codeノードの中身（`node n8n/build.mjs` で検証＋JSON再生成）

サンプル6通（架空の旅館 美濃屋旅館 宛て）を処理。Stage 1 は `out/inbox.md`、
Stage 2 は `out/stage2-log.md` に出力する。

## 3色トリアージ（システムの心臓部）

分類は **必ず事前定義のカテゴリルール**（`data/triage-rules.json`）で行う。
AIに「簡単か難しいか」を自由判断させない（SPEC §5）。

| 色 | 意味 | 例 | 送信 |
|----|------|----|------|
| 🟢 緑 | 完全自動。固定回答・間違えても実害小 | 駐車場、チェックイン時刻、Wi-Fi、アクセス | FAQから自動送信 |
| 🟡 黄 | AI下書き → 女将承認。金額・在庫・約束が絡む | 空室確認、料金、アレルギー対応、予約申込 | 承認後に送信 |
| 🔴 赤 | 最初から女将へ。個別事情・交渉・クレーム | 車椅子、予約変更、深夜到着 | AIは回答を書かない |

**安全ルール（コードで担保）**
1. 振り分けはカテゴリルールのみ（`src/triage.ts`）。
2. 1通が複数該当 → 最も保守的な色を採用（RED > YELLOW > GREEN）。
3. どのルールにも該当しない → 既定の **RED**（迷ったら赤）。
4. **赤は `draftReply` を必ず null**＝AIは回答を書かない（`src/claude.ts`）。

## ファイル構成

```
data/
  inn-profile.json        架空の旅館プロフィール＋料金
  faq.json                FAQナレッジベース（緑の自動回答・黄の下書きに使用）
  triage-rules.json       トリアージ表（カテゴリルール）
  sample-emails.json      サンプル受信メール（直メール＋OTA通知、緑黄赤を網羅）
  owner-line-replies.json Stage 2: 女将の日本語返信スクリプト（再現用）
src/
  types.ts             共通型
  intake.ts            チャネル判定・客本文/氏名の抽出（SPEC §4）
  triage.ts            3色トリアージ（SPEC §5）
  claude.ts            Claude層（★モック。実API差し替えはここ1ファイル：要約/日本語下書き/翻訳）
  pipeline.ts          intake → triage → claude → 対応決定
  delivery.ts          Stage 1 の運用者向け配信（コンソール／markdown）
  index.ts             Stage 1 エントリポイント
  line.ts              Stage 2: LINE/客チャネルの送受信シミュレーション
  conversation.ts      Stage 2: 双方向エンジン（緑自動／黄・赤は翻訳＋確認ゲート）
  owners.ts            Stage 2: 女将エージェント（スクリプト再生／対話入力）
  stage2.ts            Stage 2 エントリポイント
out/
  inbox.md             Stage 1 ダイジェスト
  stage2-log.md        Stage 2 双方向会話ログ
```

## Claude をモックから実APIへ

`src/claude.ts` のモック関数だけを差し替える（上流・下流は無変更）:
`summarize`（日本語要約）/ `draftJapaneseForOwner`（黄の日本語下書き）/
`translateJaToGuest`（女将の日本語→客の言語）。末尾のTODOにAnthropicSDK雛形あり、
`claude-opus-4-8` を使用。**RED は必ず draftReply=null**、翻訳は女将の
金額・在庫・約束を勝手に変えない、という契約を維持すること。

---

# ナレッジベース参照モード（実Claude API）★現在の主戦場

固定FAQの連結ではなく、**宿ナレッジを読んでその宿固有の事情に沿って回答**する仕組み。

```bash
npm run kb          # ナレッジ参照テスト（結果は out/kb-test.md にも保存）
npm run test:extract # 汚いメールからの抽出テスト（Before/After）
npm run e2e          # 端から端まで（抽出→分類→翻訳→メール文面、送信はドライラン）
npm run e2e:send     # 上記＋実際にメール送信（.env に SMTP_USER/SMTP_PASS が必要）
```

## 自分の架空の宿でテストする手順

1. **`data/knowledge/inn-knowledge.md` を書き換える** — これがAIの唯一の情報源。
   見出し（`##`）で区切り、数字・時刻・条件を具体的に書くほど精度が上がる。
   **ここに書いていないことをAIは絶対に答えない**（女将さんに回す）。
2. **`data/test-inquiries.json` に問い合わせを書く** — `id` / `from` / `subject` / `body`。
   `note` は任意のメモ（期待する挙動を書いておくと検証しやすい）。
3. **`data/triage-rules.json` でカテゴリと色を調整**（任意） — 例: ペット可否のカテゴリを追加する。
   **カテゴリと色の対応は人間が決める**。AIは「どのカテゴリに当たるか」の判定だけを行う（SPEC §5）。
4. `npm run kb` を実行。

## 処理の流れ

```
問い合わせ
 → ① extract.ts   実Claude: 署名・引用・OTA定型文を捨て、客の質問だけ抽出
 → ② classify.ts  実Claude: 人間が定義したカテゴリのどれに当たるかを判定
                  （色の決定は人間のルール。最も保守的な色が勝つ）
 → ③ answer.ts    実Claude: ナレッジだけを根拠に回答生成
                  赤のときは返信文を作らず、女将向けの「参考事実」だけ拾う
 → ④ 降格判定      緑でもナレッジが不十分なら黄／赤へ降格（でっち上げ防止）
```

## 安全設計（崩さないこと）

| ルール | 実装場所 |
|---|---|
| ナレッジに無いことは答えない。推測・一般論で補完しない | `answer.ts` のシステムプロンプト |
| 緑＋ナレッジ不足 → 黄/赤に**降格**して女将確認へ | `run-kb-test.ts` の `applyCoverage` |
| 赤ではAIは客への返信文を書かない（参考事実のみ） | `answer.ts` の `referenceFactsForOwner` |
| カテゴリと色は人間が定義。AIは当てはめのみ | `data/triage-rules.json` ＋ `classify.ts` |
| 複数カテゴリ該当時は最も保守的な色を採用 | `classify.ts` |
| どのカテゴリにも該当しなければ既定の赤 | `data/triage-rules.json` の `default` |

## 残タスク（本番化）

- IMAP/Gmail のメール監視を実トリガー化（届いたメールで動かす）。
- ナレッジ参照モードを LINE（n8n Stage2）に接続する。
  現在 n8n 側はモックのままなので、女将が自由に打つと `(mock未登録)` になる。
- n8n でのオーケストレーション化（メール監視トリガー、スケジュール等）。
