# daily-bot

A small CLI that scans git repositories in a folder, collects your commits for a day, and asks Gemini for a Portuguese daily standup summary.

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer
- Git, with `user.name` or `user.email` set in the repos you want scanned
- A [Gemini API key](https://aistudio.google.com/apikey)

## Install

```bash
git clone <this-repo-url>
cd daily-bot
npm install
```

To run it as `daily` from anywhere:

```bash
npm link
```

## Configure

Create `~/.daily-bot.env` (preferred) or a `.env` file in this directory:

```bash
GEMINI_API_KEY=your_key_here
```

Optional:

```bash
GEMINI_MODEL=gemini-2.5-flash
PROJECTS_DIR=/path/to/your/repos
```

`GEMINI_MODEL` defaults to `gemini-2.5-flash`. `PROJECTS_DIR` is used when you do not pass a directory on the command line.

## Run

Scan every git repository that is a **direct child** of a folder:

```bash
node index.js /path/to/your/repos
```

Or, after `npm link`:

```bash
daily /path/to/your/repos
```

With no path, the tool uses `PROJECTS_DIR`, then the current directory.

By default it looks at yesterday. On Monday, "yesterday" covers Friday through Sunday.

```bash
node index.js /path/to/your/repos --date today
node index.js /path/to/your/repos --date yesterday
node index.js /path/to/your/repos --date 2026-10-24
node index.js /path/to/your/repos --date 10/24/2026
```

`-d` is the short form of `--date`. Add `--verbose` or `-v` to print scan and API logs. The summary is always printed.

Only commits authored by your local `git config user.name` (or `user.email` if the name is missing) are included.
