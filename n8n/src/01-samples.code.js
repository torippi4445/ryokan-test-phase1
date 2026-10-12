// n8n Code node「サンプル受信メール」 (Run Once for All Items)
// IMAP を繋ぐ前のテスト用。本番では Email Trigger (IMAP) ノードに置き換える。
const emails = [
  { id: "mail-001", from: "john.weaver@example.com", subject: "Question about your inn",
    body: "Hello, we are planning to hike the Nakasendo next month. Is there parking at your inn, and what time is check-in? Thank you!" },
  { id: "mail-002", from: "noreply@booking.com", subject: "You have a new message from a guest - Booking.com",
    body: "Dear Partner, you have received a new message from your guest Maria Lopez regarding booking 4412987:\n\n----\nHi! Do you have any room available on December 24th for 2 people, 1 night? And how much would it be? We are very excited to visit Magome.\n----\n\nPlease reply through the Booking.com extranet." },
  { id: "mail-003", from: "t.becker@example.de", subject: "Travelling with my grandmother",
    body: "Good evening. I would like to stay with my grandmother who uses a wheelchair. Is your building OK for her? Are there many stairs? We really want to experience a traditional ryokan." },
  { id: "mail-004", from: "airbnb-guest@example.com", subject: "Re: Your Airbnb reservation - new message",
    body: "Automated notification from Airbnb. Your guest wrote:\n\n\"Is there free Wi-Fi in the rooms? Also, do you provide yukata and towels? Thanks!\"" },
  { id: "mail-005", from: "sophie.martin@example.fr", subject: "Dinner question",
    body: "Hello, one of us is vegetarian and another has a gluten allergy. Can you prepare an allergy-friendly dinner for us? We would like to book for 2 nights in November." },
  { id: "mail-006", from: "dave.cooper@example.com", subject: "Late arrival",
    body: "Our train is delayed and we will probably arrive after midnight. Is that OK? We don't want to cause trouble. Please let us know." },
];
return emails.map((e) => ({ json: e }));
