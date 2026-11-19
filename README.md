# Workday PA — team board (Drew + KB)

Live site: https://graphicdesign-lg.github.io/Workday-PA/

| Part | Where it runs | Job |
|---|---|---|
| Team board (this repo) | GitHub Pages | Brief, stage board, task editing, notes, messages, history, Ask PA, Asana-update queue |
| Shared data | Firebase `workday-pa` (Firestore) | Stages, assignments, notes, messages, logs, PA requests, live Asana snapshot |
| PA brain | Claude, in the Workday PA on Drew's PC | Live Asana sync (read-only), answers “Ask PA”, publishes the live snapshot |
| Asana writes | ChatGPT with the Asana app | Runs only the items copied from **Asana updates** (see `CHATGPT-SETUP.md`) |

Files: `index.html`, `style.css`, `app.js` (site) · `firebase-config.js` (public web IDs) · `firestore.rules` (security rules, published in the Firebase console) · `data.js` / `data.json` (fallback snapshot when the PA is offline) · `chatgpt/ASANA-OPERATOR-INSTRUCTIONS.txt` (ChatGPT project instructions).

For the local development app, see the [server-side Asana connector](dev/README.md).
