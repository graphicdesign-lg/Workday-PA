# ChatGPT — Asana Operator (setup)

ChatGPT keeps **Asana** in step with the team board and with what you tell it in the chat, using ChatGPT's Asana app.

Everything else stays in the main setup:
- **Brain, planning, briefs and task management:** Claude, the Workday PA on Drew's PC.
- **The board:** live at graphicdesign-lg.github.io/Workday-PA.

```
        ┌──────────── live Asana sync (every ~15 s, read-only) ────────────┐
        ▼                                                                  │
 Workday PA (Claude, Drew's PC) ──publishes──► Board (GitHub Pages + Firebase)
        │                                          │  ▲
        └── private ChatGPT feed (pending updates) │  │ paste ChatGPT's reply → "Sync from ChatGPT"
                         ▼                         ▼  │
                 ChatGPT "Asana Operator" ──Asana app──► Asana
```

## 1. Connect Asana in ChatGPT (once)
chatgpt.com → profile → **Settings → Apps** → **Asana** → **Connect** → approve.
- If you're on a Business/Team workspace, an admin may need to allow the app first.

## 2. Create the project (once)
1. **Projects → New project → "Asana Operator – Workday PA"**.
2. Open the project → **Instructions**, then paste the full text of [`chatgpt/ASANA-OPERATOR-INSTRUCTIONS.txt`](chatgpt/ASANA-OPERATOR-INSTRUCTIONS.txt).
3. In that text, replace `<paste the "ChatGPT feed link" …>` with the feed link from your PA: **Settings → Team site sync → ChatGPT feed link**.
   - Keep the link private. Anyone who has it can read the pending-updates list and board status (no email, no passwords).
4. Leave the project's files and memory empty, and don't add other apps to these chats.

## 3. Daily loop
1. Open the project in ChatGPT and start a new chat with **"sync"**.
   - ChatGPT reads the feed, lists the pending Asana updates and carries them out. It may ask you to confirm Asana writes.
2. Talk to it about real work, e.g. "Stellan is edited and uploaded, tell Calvin". It proposes the exact Asana comment or completion and does it once you say yes.
3. Copy ChatGPT's **whole reply** → board → **Asana updates → Sync from ChatGPT** → **Sync to board**. The board then:
   - ticks off ✅ items;
   - logs ChatGPT's Asana changes to History;
   - moves stages, adds notes and creates follow-ups.
4. You don't have to do anything else. Drew's PA re-reads Asana every ~15 s, so ChatGPT's changes appear on the board and in the Brief, and the feed refreshes every minute.

If ChatGPT can't open the feed, use **Copy all open for ChatGPT** on the board and paste the list instead.

## Who does what
| | Claude (Workday PA) | ChatGPT (Asana Operator) |
|---|---|---|
| Plans, priorities, briefs, stages | ✅ | suggests stages only |
| Reads Asana | ✅ live, read-only | ✅ the tasks it works on |
| Writes to Asana | ❌ | ✅ listed updates + changes you approve in chat |
| Writes to the board / Firebase | ✅ | ❌ (you paste its sync block) |
| Email, calendar | ✅ read-only on Drew's PC | ❌ |
