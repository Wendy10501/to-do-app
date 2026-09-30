# To-Do App

A simple to-do list app built with plain HTML, CSS, and JavaScript. Tasks are stored in Supabase, so they sync across every device you sign in on.

## Files

| File | What it does |
|------|--------------|
| `index.html` | The page layout |
| `styles.css` | Colors, fonts, spacing (supports light and dark mode) |
| `app.js` | All the app logic: sign-in, adding, editing, sorting, syncing |
| `config.js` | Your Supabase project address and publishable key |
| `schema.sql` | The database table and privacy rules (already run in Supabase) |

## How to run it

**Online:** This app is hosted on GitHub Pages at https://wendy10501.github.io/to-do-app/ . Open it on your phone and use "Add to Home Screen" to get an app icon.

## Features

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

## Customizing

To change the list names, edit this line at the top of `app.js`:

```js
const LISTS = ["Work", "Personal", "Errands"];
```

To change colors, edit the values under `:root` at the top of `styles.css`.
