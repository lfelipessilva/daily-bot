# daily-bot

Scans the git repos in `PROJECTS_DIR`, collects your commits, and prints a Portuguese daily standup summary.

Once the variables below are set, this is the whole workflow:

```bash
daily
daily -d today
```

`daily` uses yesterday. On Monday that window is Friday through Sunday. `daily -d today` uses today.

## Setup

Node.js 18 or newer, Git, and a [Gemini API key](https://aistudio.google.com/apikey).

```bash
git clone <this-repo-url>
cd daily-bot
npm install
npm link
```

Copy `.env.example` to `~/.daily-bot.env` and fill it in:

```bash
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-3.5-flash-lite
PROJECTS_DIR=/path/to/your/repos
```

`GEMINI_API_KEY` and `PROJECTS_DIR` are required for `daily` with no extra arguments. `GEMINI_MODEL` falls back to `gemini-2.5-flash` when it is omitted.

`PROJECTS_DIR` is a folder of projects. The scan walks nested folders until it finds a `.git` directory, then treats that folder as the repository and does not go deeper. `node_modules`, `vendor`, `dist`, `.next`, and `coverage` are skipped. Commits are limited to your local `git config user.name`, or `user.email` when the name is missing. Nested repos are labeled by their path under `PROJECTS_DIR` (for example `clients/acme/api`).

If `~/.daily-bot.env` is missing, the CLI loads a `.env` file from the current directory instead.

## Other flags

```bash
daily -d yesterday
daily -d 2026-10-24
daily -d 10/24/2026
daily -v
daily -h
```

| Flag | Meaning |
| --- | --- |
| `-d`, `--date` | `today`, `yesterday` (default), `YYYY-MM-DD`, or `MM/DD/YYYY` |
| `-v`, `--verbose` | Scan and API logs |
| `-h`, `--help` | Usage |

A directory argument overrides `PROJECTS_DIR` for that run: `daily /some/other/folder`.
