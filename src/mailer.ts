// 実メール送信（Gmail SMTP）。.env の SMTP_USER / SMTP_PASS を使う。
//   SMTP_USER = 送信元Gmailアドレス
//   SMTP_PASS = Googleの「アプリパスワード」(16桁。2段階認証が必要)
// 送信元(from)は認証ユーザーと一致させる必要がある（Gmailの仕様）。

import nodemailer from "nodemailer";

export function mailerConfigured(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function sendMail(opts: { to: string; subject: string; text: string }): Promise<void> {
  const user = process.env.SMTP_USER!;
  const pass = process.env.SMTP_PASS!;
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  await transporter.sendMail({
    from: `Minoya Ryokan <${user}>`,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
  });
}
