# To-Do App

A simple to-do list app built with plain HTML, CSS, and JavaScript. No installs, frameworks, or accounts needed.

## Files

| File | What it does |
|------|--------------|
| `index.html` | The page layout |
| `styles.css` | Colors, fonts, spacing (supports light and dark mode) |
| `app.js` | All the app logic: adding, editing, sorting, saving |

## How to run it

**On your computer:** Keep the three files in the same folder and double-click `index.html`. It opens in your browser.

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

Tasks are stored in your browser's local storage. They stay put between visits, but only on the same computer and browser. Clearing your browser data erases them, so use **Export** now and then as a backup.

## Customizing

To change the list names, edit this line at the top of `app.js`:

```js
const LISTS = ["Work", "Personal", "Errands"];
```

To change colors, edit the values under `:root` at the top of `styles.css`.
