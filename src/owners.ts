// OwnerAgent implementations: scripted (reproducible) and interactive (live).

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { OwnerAgent } from "./conversation.ts";

interface ScriptEntry {
  reply: string;
  confirm: string;
}

// Plays the okami's Japanese replies from data/owner-line-replies.json.
export class ScriptedOwner implements OwnerAgent {
  private script: Record<string, ScriptEntry>;
  constructor(script: Record<string, ScriptEntry>) {
    this.script = script;
  }

  async reply(ctx: { emailId: string; suggestionJa: string | null }): Promise<string> {
    const e = this.script[ctx.emailId];
    if (!e) return ctx.suggestionJa ?? "確認のうえご連絡いたします。";
    // "OK" means: accept the AI's Japanese draft as-is.
    if (/^(ok|はい|了解)$/i.test(e.reply.trim()) && ctx.suggestionJa) {
      return ctx.suggestionJa;
    }
    return e.reply;
  }

  async confirm(ctx: { emailId: string }): Promise<boolean> {
    const e = this.script[ctx.emailId];
    return !e || /^ok$/i.test(e.confirm.trim());
  }
}

// Prompts the operator to type the okami's Japanese replies live.
export class InteractiveOwner implements OwnerAgent {
  private rl = createInterface({ input: stdin, output: stdout });

  async reply(ctx: { suggestionJa: string | null }): Promise<string> {
    const hint = ctx.suggestionJa
      ? "（空Enterで返信案を採用）"
      : "（日本語で入力）";
    const answer = (await this.rl.question(`   ✍️  女将の返信を入力 ${hint}: `)).trim();
    if (!answer && ctx.suggestionJa) return ctx.suggestionJa;
    return answer || "確認のうえご連絡いたします。";
  }

  async confirm(): Promise<boolean> {
    const a = (await this.rl.question("   ✅ 送信しますか？ (y/n): ")).trim().toLowerCase();
    return a === "" || a === "y" || a === "yes" || a === "ok";
  }

  close(): void {
    this.rl.close();
  }
}
