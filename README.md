# Workday PA — team board (Drew, KB, Calvin)

Live site: https://graphicdesign-lg.github.io/Workday-PA/

| Part | Where it runs | Job |
|---|---|---|
| Team board (this repo) | GitHub Pages | Brief, Work list, stage board, task editing, notes, team + private chats, Handbook, history, Asana-update queue |
| Shared data | Firebase `workday-pa` (Firestore) | Stages, assignments, notes, messages, handbook, logs, live Asana snapshot |
| Asana sync | Workday PA on Drew's PC | Reads Asana and publishes the shared snapshot + private ChatGPT feed |
| Personal PA brain | On each teammate's own computer (`personal-pa.mjs`) | Answers “Ask PA” with that teammate's Claude API account and proposes changes for review |
| Asana writes | ChatGPT with the Asana app | Runs only the items from **Asana updates** (see `CHATGPT-SETUP.md`) |

Files:
- `index.html`, `style.css`, `app.js`: the site.
- `firebase-config.js`: public web IDs.
- `firestore.rules`: security rules, published in the Firebase console.
- `data.js` / `data.json`: fallback snapshot.
- `personal-pa.mjs` / `Start-Personal-PA.cmd`: the personal PA server.
- `chatgpt/`: ChatGPT project instructions and live-update prompts.

## Personal PA setup
1. On your own computer, install Node.js 22 or later, then download or clone this repository.
2. In the repository folder, run `node personal-pa.mjs`, or double-click `Start-Personal-PA.cmd`. Keep it running while you use the PA.
3. Open http://127.0.0.1:4180/, select your profile and open **PA**.
4. Create a key in your own [Claude Console](https://platform.claude.com/settings/keys) account (API billing; separate from a Claude chat subscription). Enter it under **Connect your own PA**.
5. Ask from **PA**, **Brief** or a task drawer. Review each proposed change, then choose **Approve and save**.

Each teammate connects their own Claude account, and API charges go to that account.
- The local server keeps the key in memory only, and forgets it after an hour of inactivity or when you switch profiles.
- Conversations stay in the browser tab.
- The PA receives task names, stages, assignments, priorities, due dates, recent stage changes, open Asana-update items, the loaded Work list, Handbook pages and recent turns of the current conversation.
- On the GitHub Pages site the PA tab links to this setup. The rest of the board works there as normal.

## Work list
Open **Work list** and load the JSON file for your work plan.
- It is saved per profile in this browser.
- Rows keep their order and action text.
- Confirmed links open the Asana task, and uncertain matches are flagged.

## Handbook
**📘 Handbook** holds shared markdown pages: how-tos, checklists and things to remember. Anyone on the board can write and edit them, checklists can be ticked, every edit is logged, and pages are archived rather than deleted. The personal PA can use the pages when answering.
