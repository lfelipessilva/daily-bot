# daily-bot

Scans the git repos in `PROJECTS_DIR`, collects your commits (plus uncommitted work and stashes), and prints a Portuguese daily standup summary.

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

`GEMINI_API_KEY` is required unless you use `--raw`. `PROJECTS_DIR` is required for `daily` with no directory argument. `GEMINI_MODEL` falls back to `gemini-2.5-flash` when it is omitted.

`PROJECTS_DIR` is a folder of projects. The scan walks nested folders until it finds a `.git` directory, then treats that folder as the repository and does not go deeper. `node_modules`, `vendor`, `dist`, `.next`, and `coverage` are skipped by default. Commits are limited to your local `git config user.email`, or `user.name` when the email is missing. Nested repos are labeled by their path under `PROJECTS_DIR` (for example `clients/acme/api`).

If `~/.daily-bot.env` is missing, the CLI loads a `.env` file from the current directory instead.

### Optional `~/.daily-bot.json`

Loaded after the env file:

```json
{
  "skipDirs": ["build", "tmp"],
  "ignore": ["legacy/old-app", "experiments"],
  "promptExtra": "Mencione o ticket se o commit começar com ABC-"
}
```

| Field | Meaning |
| --- | --- |
| `skipDirs` | Extra directory names to skip while walking |
| `ignore` | Repo path prefixes under the scan root to skip |
| `promptExtra` | Extra Portuguese instructions appended to the standup prompt |

## Other flags

```bash
daily -d yesterday
daily -d 2026-10-24
daily -d 10/24/2026
daily --since 2026-10-20 --until 2026-10-22
daily --raw
daily --copy
daily --out daily.md
daily -v
daily -h
```

| Flag | Meaning |
| --- | --- |
| `-d`, `--date` | `today`, `yesterday` (default), `YYYY-MM-DD`, or `MM/DD/YYYY` |
| `--since` / `--until` | Custom range (`YYYY-MM-DD` or `MM/DD/YYYY`). Overrides `-d`. If only `--since` is set, `--until` defaults to the same day |
| `--raw` | Print collected git activity and skip Gemini |
| `--copy` | Copy the summary to the clipboard (`pbcopy`) |
| `--out <file>` | Write the summary to a file |
| `-v`, `--verbose` | Scan and API logs |
| `-h`, `--help` | Usage |

A directory argument overrides `PROJECTS_DIR` for that run: `daily /some/other/folder`.

## Tests

```bash
npm test
```
