# Workday PA — team board (Drew, KB, Calvin)

Live site: https://graphicdesign-lg.github.io/Workday-PA/

| Part | Where it runs | Job |
|---|---|---|
| Team board (this repo) | GitHub Pages | Brief, Work list, stage board, task editing, notes, team + private chats, Handbook, history, Asana-update queue |
| Shared data | Firebase `workday-pa` (Firestore) | Stages, assignments, notes, messages, handbook, logs, live Asana snapshot |
| Asana sync | Workday PA on Drew's PC | Reads Asana and publishes the shared snapshot + private ChatGPT feed |
| Personal PA brain | On each teammate's own computer (`personal-pa.mjs`) | Answers “Ask PA” with that teammate's own Claude subscription (claude.ai, via Claude Code — no API key) and proposes changes for review |
| Asana writes | ChatGPT with the Asana app | Runs only the items from **Asana updates** (see `CHATGPT-SETUP.md`) |

Files:
- `index.html`, `style.css`, `app.js`: the site.
- `firebase-config.js`: public web IDs.
- `firestore.rules`: security rules, published in the Firebase console.
- `data.js` / `data.json`: fallback snapshot.
- `personal-pa.mjs` / `Start-Personal-PA.cmd`: the personal PA server.
- `chatgpt/`: ChatGPT project instructions and live-update prompts.

## Personal PA setup
You need your **own Claude subscription** (Pro, Max or Team on claude.ai). No API key or Claude Console account is used.
1. On your own computer, install Node.js 22 or later and the [Claude desktop app](https://claude.ai/download). Open its **Code** tab once so Claude Code installs. A separate Claude Code install also works.
2. Download or clone this repository, then double-click `Start-Personal-PA.cmd`, or run `node personal-pa.mjs`. Keep it running while you use the PA.
3. Open http://127.0.0.1:4180/, select your profile and open **PA**.
4. Click **Sign in with Claude**, log in with your own claude.ai account in the window and browser that open, then click **Connect my Claude**.
5. Ask from **PA**, **Brief** or a task drawer. Review each proposed change, then choose **Approve and save**.

How it works:
- Answers count toward your own Claude plan's usage.
- Sign-in is stored in a private Claude Code profile in `.claude-pa/<profile>` on your computer, kept separate from any other Claude Code setup.
- Claude runs with every tool switched off: it can only read the board details sent with your question and suggest a change.
- Conversations stay in the browser tab.
- **Live Asana:** on Drew's PC the board reads Asana straight from the Workday PA app (checked every ~15 s). Everywhere else it comes through team sync, which needs Drew's PA running with **Team site sync** connected. If neither is available, the board shows **Asana offline** and when the data is from.
- The PA receives task names, stages, assignments, priorities, due dates, recent stage changes, open Asana-update items, the loaded Work list, Handbook pages and recent turns of the current conversation.
- On the GitHub Pages site the PA tab links to this setup. The rest of the board works there as normal.

## Work list
Open **Work list** and load the JSON file for your work plan.
- It is saved per profile in this browser.
- Rows keep their order and action text.
- Confirmed links open the Asana task, and uncertain matches are flagged.

## Handbook
**📘 Handbook** holds shared markdown pages: how-tos, checklists and things to remember. Anyone on the board can write and edit them, checklists can be ticked, every edit is logged, and pages are archived rather than deleted. The personal PA can use the pages when answering.
