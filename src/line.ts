// LINE + guest channel simulation (Stage 2).
//
// In production this is the LINE Messaging API (push to the okami, receive her
// replies) and the email/OTA send to the guest. Here we record every event into
// a transcript and optionally echo it to the console for a live-demo feel.

import type { LineEvent } from "./types.ts";

export class Channels {
  readonly events: LineEvent[] = [];
  private echo: boolean;
  constructor(echo: boolean) {
    this.echo = echo;
  }

  // System → okami's LINE (Japanese).
  pushToOwner(text: string, tag?: string): void {
    this.record({ dir: "to-owner", text, tag });
  }

  // Okami → system (Japanese). Recorded so the transcript shows what she typed.
  fromOwner(text: string): void {
    this.record({ dir: "from-owner", text });
  }

  // System → guest (original language). The actual outbound reply.
  sendToGuest(text: string, tag?: string): void {
    this.record({ dir: "to-guest", text, tag });
  }

  private record(e: LineEvent): void {
    this.events.push(e);
    if (this.echo) console.log(renderEvent(e));
  }

  drain(): LineEvent[] {
    return this.events.splice(0, this.events.length);
  }
}

export function renderEvent(e: LineEvent): string {
  const body = e.text
    .split("\n")
    .map((l, i) => (i === 0 ? l : "        " + l))
    .join("\n");
  switch (e.dir) {
    case "to-owner":
      return `   📱→女将 LINE${e.tag ? ` [${e.tag}]` : ""}: ${body}`;
    case "from-owner":
      return `   📱←女将 返信      : ${body}`;
    case "to-guest":
      return `   ✉️ →お客様${e.tag ? ` [${e.tag}]` : ""}: ${body}`;
  }
}
