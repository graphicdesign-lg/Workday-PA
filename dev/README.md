# Asana connector for the local PA

`asana.mjs` is a server-side connector for the Workday PA dev app. It runs on Node.js 22 or later and uses the official Asana API. Keep it on the local PA server. The GitHub Pages board continues to receive its shared snapshot from the existing PA bridge.

In the local PA, open **Connections** and enter a personal access token for Drew's Leather Gallery Asana account. The token stays in server memory for that session. For a developer launch, the server also accepts `ASANA_ACCESS_TOKEN` or `ASANA_PERSONAL_ACCESS_TOKEN` in its environment. The ChatGPT Asana app has its own authorization. Generate the local credential in the [Asana developer console](https://app.asana.com/0/my-apps) and keep it out of Git, client-side JavaScript and chat. [Asana token documentation](https://developers.asana.com/docs/personal-access-token)

The local PA polls Asana once a minute when connected. In a task drawer, **Edit in Asana** saves changes to the name, due date, plain-text description or completion. **Asana discussion** supports new comments and threaded replies to comments with an Asana thread ID. **Use reply draft** copies the draft into the composer for review. Each write has a confirmation, and results refresh the displayed task and discussion. The background snapshot remains available when the connector is disconnected.

The connector exports `createAsanaClient()` with these methods.

| Method | Use |
| --- | --- |
| `request(token, endpoint, params)` | Read an Asana record or list |
| `updateTask(token, taskGid, changes)` | Update `name`, `notes`, `due_on` or `completed` |
| `postComment(token, taskGid, text, parentComment?)` | Post the exact text. Supply a top-level comment's `comment_gid` for a threaded reply |
| `retryAfterMs()` | Wait for Asana's reported rate-limit interval |

The local server verifies the connected user and task workspace. The app keeps its existing snapshot when a read fails and never automatically replays writes. [Task update API](https://developers.asana.com/reference/updatetask) · [Task comment and reply API](https://developers.asana.com/reference/createstoryfortask)
