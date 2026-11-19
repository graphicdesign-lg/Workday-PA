# Live-update prompts for ChatGPT (Asana Operator)

Use these inside the **"Asana Operator – Workday PA"** project, after the instructions from `ASANA-OPERATOR-INSTRUCTIONS.txt` are in place and FEED_URL is filled in.

Each prompt ends with a ✅/❌ list and a `workday-pa-sync` block. Paste that whole reply into the board: **Asana updates → Sync from ChatGPT → Sync to board**.

---

## 1. Start of day — run the live update (paste as the first message)
```
Run the live update now.
1. Open FEED_URL and read the latest feed.
2. Give me a 5-line status: pending Asana updates (count + who they're for), anything "Ready to upload" for Calvin, anything "Changes requested", and anything due today/tomorrow.
3. List the pending [U-ref] updates you're about to do, then do them in Asana one by one.
4. Check those tasks in Asana for new comments since yesterday that need a reply or a board stage change, and propose them (don't post replies without my OK).
5. Finish with the ✅/❌ list and the workday-pa-sync block.
```

## 2. During the day — quick sync (any time)
```
sync
```
ChatGPT re-reads the feed, does any new pending updates and returns the sync block.

## 3. Tell it what happened (it updates Asana, then you paste the block into the board)
```
Live update: <what happened>.
Examples:
- Stellan 3S is edited and on the server — tell Calvin it's ready to upload.
- Calvin uploaded Castro Coffee Table Brown and Grayson chair to the website.
- KB reshot the Kuta left cushion; Drew needs to re-edit it.
Make the matching Asana changes (show me the exact comment wording first), then give me the workday-pa-sync block with the right board stages.
```

## 4. End of day — wrap-up
```
End-of-day wrap-up.
1. Open FEED_URL.
2. Anything still pending that you can do now — do it.
3. Tell me in 5 bullets what was updated in Asana today and what's still open (with who it's for).
4. Add followUps for anything that must happen tomorrow.
5. Finish with the ✅/❌ list and the workday-pa-sync block.
```

## 5. Optional — scheduled check (ChatGPT Tasks)
If your ChatGPT plan has **Tasks** (scheduled prompts), you can schedule this every weekday at 08:30 and 15:00 inside the project:
```
Open FEED_URL and tell me how many Asana updates are pending, who they're for, and anything "Ready to upload" or "Changes requested". Don't change Asana in this scheduled run — I'll say "sync" to apply them.
```
This scheduled run only *reports*. Scheduled runs may not be able to use the Asana app, and Asana changes should happen while you're present to approve them.

---

### How it stays live
- **Drew's PA (Claude)** re-reads Asana every ~15 s and refreshes FEED_URL every minute.
- **ChatGPT** makes the Asana changes. They appear on the board automatically within about 15 s, through the PA's live sync.
- **Pasting ChatGPT's sync block** into the board records the rest: ticks, stage moves, notes and follow-ups.
