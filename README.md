# To-Do App

A simple to-do list app built with plain HTML, CSS, and JavaScript. Tasks are stored in Supabase, so they sync across every device you sign in on.

## Files

| File | What it does |
|------|--------------|
| `index.html` | The page layout |
| `styles.css` | Colors, fonts, spacing (supports light and dark mode) |
| `app.js` | All the app logic: sign-in, adding, editing, sorting, syncing |
| `briefing.js` | The Task Tracker tab: shows the daily briefing and remembers what's ticked off |
| `config.js` | Your Supabase project address and publishable key |
| `schema.sql` | The tasks table and privacy rules (already run in Supabase) |
| `briefings.sql` | The daily briefing tables, privacy rules and save function |
| `dashboard.html` | The Whiteboard dashboard page (sign-in, charts, lists) |
| `dashboard.js` | The Whiteboard dashboard logic: sign-in, approved-list check, reading the sheet, drawing the charts |
| `whiteboard.sql` | The Whiteboard tables, approved list, privacy rules and save function |
| `whiteboard-sync/` | The "Whiteboard sync" Google Apps Script that sends the WHITEBOARD sheet to Supabase |
| `whiteboard-logo.png` | The company logo shown on the dashboard |

## How to run it

**Online:** This app is hosted on GitHub Pages at https://wendy10501.github.io/to-do-app/ . Open it on your phone and use "Add to Home Screen" to get an app icon.

## Features

The app has two tabs. The one you used last opens next time; a link ending in `#tracker` opens the Task Tracker.

**Task Tracker** shows the daily briefing, the same one that's emailed each morning:

- The banner, the numbers (due today, overdue, meetings, action items), the Action Items and the Daily Summary
- Tick off action items on any device; ticks sync like tasks do
- Items that came from the To-Do List stay in step with it: tick one in either place and it's ticked in both
- "+ Add to To-Do" turns an email or note item into a task due today, so it doesn't get lost when tomorrow's briefing arrives
- "Open email" jumps straight to the email the item came from
- Use the arrows to look back at the last two weeks of briefings

**To-Do List** is the original app:

- Add tasks with a due date, priority (High, Normal, Low), and list
- Tasks group into Overdue, Today, Upcoming, and No date
- Filter by Today, Upcoming, Done, or by list; search by name
- Click a task's name to rename it
- Flag button toggles high priority
- Delete and "Clear completed" both have Undo
- Export your tasks to a file and import them again (for backups or moving to another computer)

## Where tasks are saved

Tasks are saved in your Supabase project (`todo-app`) under your account, so they show up on your phone, computer, and any browser once you sign in. Row-level security means each account can only see its own tasks. A copy is also kept on each device so the list appears instantly.

The first time you sign in on a device that has tasks from the old, device-only version, those tasks are moved into your account automatically.

## How the daily briefing gets into the app

1. Every morning the "IPMI Daily Briefing" scheduled task (a Claude routine at claude.ai/code/routines) writes the briefing, emails it, then saves the same content to Supabase by calling `save_briefing` with a private token.
2. `save_briefing` checks the token, then stores the briefing for that account and date. Sending the same day again replaces it; ticks are kept.
3. The app reads the briefings and stores ticks in `briefing_checks`. Row-level security means each account only sees its own.

One-time setup (already done once it's working):

- Run `briefings.sql` in the Supabase SQL editor.
- Add the routine's publishing token. Only its SHA-256 hash is stored, in `private.briefing_tokens`, which the API can't reach. The token itself lives only in the routine's instructions.
- In the routine's cloud environment, set network access to Custom and allow `vceuihhxhcaywalnvsxu.supabase.co` (keep the default list too). Without this the routine can't reach Supabase.

### Briefing format

The routine sends `{"p_token": "...", "p_data": { ... }}` to `/rest/v1/rpc/save_briefing`, with the publishable key in the `apikey` header. `p_data` looks like this (only `date` is required):

```json
{
  "version": 1,
  "date": "2026-10-21",
  "generated_at": "2026-10-21T06:59:00-07:00",
  "notice": "Only if a source failed, e.g. Couldn't load your task list this morning.",
  "banner": "Here's your day: 2 tasks due today and 6 action items.",
  "stats": { "due_today": 2, "overdue": 1, "meetings": 3, "action_items": 6 },
  "action_items": [
    { "title": "Send owner statements", "source": "Task · High · Due today", "type": "task",
      "high": true, "task_title": "Send owner statements", "task_due": "2026-10-21" },
    { "title": "Reply to the tenant about the water heater", "source": "Email · Tenant name", "type": "email",
      "link": "https://mail.google.com/mail/?authuser=wendy@integritypmnv.com#all/THREAD_ID" }
  ],
  "summary": [
    { "heading": "Top Priorities", "items": [ { "lead": "Water heater.", "text": "Tenant is waiting on a plumber." } ] },
    { "heading": "Today's Schedule", "items": [ { "lead": "9:00–9:30 AM", "text": "Team huddle", "link": "https://meet.google.com/..." } ] }
  ]
}
```

- `type` is `task`, `email`, `note` or `other`. For `task` items, `task_title` must be the task's title exactly as it appears in the app; that's how the two get linked.
- Everything is shown as plain text. Links must start with `https://`.
- Ticks are remembered by each item's wording, so re-sending a day's briefing keeps them as long as the titles don't change.

## Whiteboard dashboard

`dashboard.html` shows the WHITEBOARD Google Sheet (vacancies, move-ins and move-outs, turnover, property checks, onboarding) at https://wendy10501.github.io/to-do-app/dashboard.html . Sign in with the same email and password as the To-Do List.

**Who can see it:** only people whose email is on the approved list in Supabase (the `dashboard_access` table) and confirmed. Anyone can create an account for the To-Do List, but that alone doesn't open the whiteboard. The page itself contains no data from the sheet, so its public address shows nothing until an approved person signs in.

**How the sheet gets here:**

1. A Google Apps Script called "Whiteboard sync" (its own project in Wendy's Google account; the code is in `whiteboard-sync/`) exports the WHITEBOARD as an .xlsx file every 10 minutes and sends it to Supabase by calling `save_whiteboard` with a private token. The script can read Google Drive but not change it.
2. `save_whiteboard` checks the token, then keeps the newest copy in the `whiteboard` table. Only the token's SHA-256 hash is stored, in `private.whiteboard_tokens`, which the API can't reach. The token itself lives only in the script's properties.
3. After you sign in, the dashboard checks the approved list, reads the newest copy and draws everything in your browser. While it's open it checks for a newer copy every 2 minutes, and it warns if nothing has arrived for 30 minutes.

One-time setup (already done once it's working):

1. In the Supabase SQL editor, run `whiteboard.sql`. It creates the approved list with Wendy, Chandler, Ira, Celeste and Ren.
2. In Supabase, under Authentication > Sign In / Providers > Email, make sure **Confirm Email** is on. The approved list relies on it: with it off, anyone could create an account using a teammate's email.
3. Under Authentication > URL Configuration > Redirect URLs, add `https://wendy10501.github.io/to-do-app/**` so confirmation and password-reset emails come back to the dashboard.
4. Signed in to the Google account that can open the WHITEBOARD, go to script.google.com and create a new project named "Whiteboard sync". In Project Settings, tick "Show appsscript.json manifest file in editor". Replace the contents of `Code.gs` and `appsscript.json` with the files in `whiteboard-sync/`, then save.
5. Choose `setup` in the function list and click Run. Approve the permissions (Google warns that it hasn't verified the app because it's your own script: click Advanced, then "Go to Whiteboard sync"). The Execution log shows one line starting with `insert into private.whiteboard_tokens`; run that line in the Supabase SQL editor.
6. Choose `syncWhiteboard` and click Run. The log should say "Sent the WHITEBOARD to Supabase". From then on it runs every 10 minutes.

**Adding or removing people:** in Supabase, open Table Editor > `dashboard_access` and add or delete a row, with the email in lower case. A new person opens the dashboard, taps "First time? Create your account", confirms their email, then signs in. Deleting a row takes the dashboard away from that person the next time it checks (within 2 minutes).

**Turning the sync off:** run `stopSync` in the Whiteboard sync script. Run `setup` again to turn it back on.

## Customizing

To change the list names, edit this line at the top of `app.js`:

```js
const LISTS = ["Work", "Personal", "Errands"];
```

To change colors, edit the values under `:root` at the top of `styles.css`.
