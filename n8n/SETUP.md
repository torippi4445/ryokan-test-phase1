# n8n + LINE セットアップ手順（ゼロから）

Claude はモックのまま、**n8n（無料・OSS自己ホスト）** と **LINE公式アカウント（Messaging API・応答メッセージは無料）** で配線を組む手順。
ゴール:
- **Stage 1**: ボタン1つで、振り分け済みの日本語カード6件が自分のLINEに届く。
- **Stage 2**: ボットとLINEで会話 → 日本語で答える → 英訳の確認 → 送信、を体験する。

> ⚠️ 本手順の Code ノードのロジックは検証済み（`node n8n/build.mjs`）。ただし
> n8n 実機でのインポートは未確認です。詰まったら画面のエラーを教えてください。

---

## 0. 全体像と費用

| 要素 | 課金 |
|------|------|
| n8n（Docker/npx 自己ホスト） | 無料 |
| LINE公式アカウント Messaging API（reply/応答） | 無料 |
| LINE broadcast/push | 無料枠 月200通（テストには十分） |
| ngrok（Stage2のWebhook公開用） | 無料枠でOK |
| Claude API | **今回は使わない**（モック）。実接続時のみ従量課金 |

---

## 1. n8n をローカルで起動

**Docker（推奨）**
```bash
docker run -it --rm --name n8n -p 5678:5678 -v n8n_data:/home/node/.n8n docker.n8n.io/n8nio/n8n
```
**または npx**
```bash
npx n8n
```
ブラウザで http://localhost:5678 を開き、初回アカウントを作成。

---

## 2. LINE公式アカウントと Messaging API チャネルを作る

1. https://developers.line.biz/console/ にLINEアカウントでログイン。
2. **Provider** を新規作成（例: 美濃屋旅館）。
3. その中に **Messaging API チャネル** を新規作成（名前・業種など入力）。
4. 作成後、チャネルの **「Messaging API」タブ**:
   - **Channel access token (long-lived)** を「発行(Issue)」→ コピーして控える。← n8nで使う
   - 下部の **QRコード/Bot basic ID** から、自分のスマホLINEで **このボットを友だち追加**。
5. **「Messaging API」タブの応答設定**:
   - **Webhook** … 利用する(ON)。（URLは後でStage2のときに設定）
   - **応答メッセージ（自動応答）** … OFF（ボットが二重返信しないように）。
   - **あいさつメッセージ** … 任意（OFF推奨）。

---

## 3. n8n に LINE の認証情報を登録

n8n 画面左メニュー **Credentials → New → "Header Auth"** を選ぶ:
- **Name**（資格情報の名前）: `LINE Messaging API`
- **Header Name**: `Authorization`
- **Header Value**: `Bearer ここにチャネルアクセストークン`
  （`Bearer ` の後に半角スペース＋手順2でコピーしたトークン）

保存。これをワークフローのHTTPノードが参照する。

---

## 4. Stage 1 を動かす（メール→トリアージ→LINE）

1. n8n 右上 **⋮ → Import from File** で `n8n/stage1-line-push.json` を読み込む。
2. **「LINE ブロードキャスト」ノード**を開き、**Credential to connect with** で手順3の
   `LINE Messaging API` を選択（インポート直後は「未設定」表示のことがある）。
3. 左上 **▶ Test workflow** をクリック。
4. スマホのLINE（ボットと友だちになっているアカウント）に、振り分け済みの
   日本語カードが **6通** 届けば成功。

> 仕組み: 手動トリガー → サンプル受信メール6件 → Code（トリアージ＋Claudeモック）→
> LINE broadcast。`broadcast` は「友だち全員」へ送るのでテスト最速。
> 実運用で特定相手に送るなら `…/message/push` ＋ `to`(userId) に変更。

### （任意）実メール（IMAP）に切り替え
「サンプル受信メール」ノードを **Email Trigger (IMAP)** ノードへ置換し、宿の
メールボックスを監視。出力の `text`/`subject`/`from` を「トリアージ」ノードの
`process()` 入力（`body`/`subject`/`from`/`id`）に合わせてマッピングする。

---

## 5. Stage 2 を動かす（LINE双方向）

Webhookで「女将のLINEメッセージ」を受けるため、n8nを**公開URL**にする。

### 5-1. 公開URLを用意（ngrok）
```bash
ngrok http 5678
```
表示された `https://xxxx.ngrok-free.app` を控える。

### 5-2. ワークフローを読み込む
1. `n8n/stage2-line-twoway.json` を Import。
2. **「LINE 返信(reply)」ノード**の Credential に `LINE Messaging API` を選択。
3. 右上トグルで **ワークフローを Active（有効）** にする
   （本番Webホックは Active 時のみ受信）。
4. **「LINE Webhook」ノード**を開き、表示される **Production URL** を確認。
   形は `https://localhost:5678/webhook/line-okami`。これの先頭を ngrok のURLに
   置き換えた `https://xxxx.ngrok-free.app/webhook/line-okami` が公開Webフック。

### 5-3. LINE側にWebフックURLを登録
LINE Developers → チャネル → **Messaging API タブ → Webhook URL** に
`https://xxxx.ngrok-free.app/webhook/line-okami` を設定 → **Verify** で200が返ればOK
（**Use webhook** をONに）。

### 5-4. 会話してみる
スマホのLINEでボットに何か送るたびに、6件のデモが1ステップずつ進む:
- 緑の問い合わせ → 「🟢 自動送信しました」通知
- 黄/赤 → 「返信例（コピーして送信OK）」が出る → その日本語を送る
  → 「英訳した内容、送りますか？OK/やめる」 → **OK** で英訳が返る（=客へ送る想定）
- いつでも **「リセット」** で最初から。

> 状態は n8n の Workflow Static Data に保持（1人テスト想定）。複数同時客を
> さばくには、userIdごとの状態管理・実際の問い合わせ流入（メール）との連携が必要。

---

## 6. （任意・将来）Claude を実APIに

今回はモック（Code内の固定/辞書）。実接続するなら Code ノードの該当箇所を
**HTTP Request → `https://api.anthropic.com/v1/messages`**（`x-api-key`,
`anthropic-version: 2023-06-01`, model `claude-opus-4-8`）に置換。
要約・黄の日本語下書き・翻訳の3か所。**従量課金**になるので、まずは現状のモックで
配線確認 → 本番直前に差し替えが安全。

---

## 7. トラブルシュート

- **LINEに届かない**: ①ボットと友だちになっているか ②Credentialの値が
  `Bearer <token>`（スペース必須）か ③broadcastは月200通の枠 ④HTTPノードの
  実行結果（n8n上の出力/エラー）を確認。`401`=トークン誤り、`400`=本文JSON誤り。
- **Webフックが200にならない**: ワークフローがActiveか／ngrokが起動中か／URL末尾
  `/webhook/line-okami` か。
- **ボットが二重に返信する**: LINE側「応答メッセージ（自動応答）」をOFFに。
- **Verifyは通るが会話が進まない**: 「Use webhook」ON＆「応答メッセージ」OFF、
  Stage2ワークフローがActiveか確認。
