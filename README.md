# Workday PA — team board (Drew + KB)

Live site: https://graphicdesign-lg.github.io/Workday-PA/

| Part | Where it runs | Job |
|---|---|---|
| Team board (this repo) | GitHub Pages | Brief, stage board, task editing, notes, messages, history, Ask PA, Asana-update queue |
| Shared data | Firebase `workday-pa` (Firestore) | Stages, assignments, notes, messages, logs, PA requests, live Asana snapshot |
| Asana sync | Workday PA on Drew's PC | Reads Asana and publishes the shared snapshot |
| Personal PA brain | On each teammate's own computer | Answers “Ask PA” with that teammate's Claude API account and proposes changes for review |
| Asana writes | ChatGPT with the Asana app | Runs only the items copied from **Asana updates** (see `CHATGPT-SETUP.md`) |

Files: `index.html`, `style.css`, `app.js` (site) · `firebase-config.js` (public web IDs) · `firestore.rules` (security rules, published in the Firebase console) · `data.js` / `data.json` (fallback snapshot when the PA is offline) · `chatgpt/ASANA-OPERATOR-INSTRUCTIONS.txt` (ChatGPT project instructions).

## Personal PA setup

1. On your own computer, install Node.js 22 or later and download or clone this repository.
2. Open a terminal in the repository folder and run `node personal-pa.mjs`. Keep it running while you use the PA.
3. Open [your local board](http://127.0.0.1:4180/), select your profile, and open **PA**.
4. Create a key in your own [Claude Console](https://platform.claude.com/settings/keys) account with API billing. Enter the key in **Connect your own PA**. Claude chat and the Claude API use separate billing.
5. Ask your question from **PA**, **Brief**, or a task drawer. Review the proposed change before choosing **Approve and save**.

On Windows you can double-click `Start-Personal-PA.cmd` after installing Node.js. Each teammate connects a separate Claude account. API requests and charges go to that account. The local server keeps the key in memory for the tab's session and expires it after one hour of inactivity. Switching board profiles disconnects the current session. Personal PA conversations stay in the tab. The local board still syncs board changes through the existing Firebase connection. Earlier shared PA requests stay in history.

The PA receives task names, stages, assignments, priorities, due dates, recent stage changes, open Asana queue items, and recent turns in the current personal PA conversation. Asana sync still depends on the existing bridge for fresh Asana data.
