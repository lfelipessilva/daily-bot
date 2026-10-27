#!/usr/bin/env node
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { resolveDateRange } from './lib/dates.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: daily [options] [directory]

Generate a daily standup summary from local git commits.

Options:
  -d, --date <when>     Day to summarize: today, yesterday (default),
                        MM/DD/YYYY, or YYYY-MM-DD
      --since <date>    Start of range (YYYY-MM-DD or MM/DD/YYYY).
                        Overrides -d when set with --until
      --until <date>    End of range. Defaults to --since when omitted
      --raw             Print collected git activity and skip Gemini
      --copy            Copy the summary to the clipboard (pbcopy)
      --out <file>      Write the summary to a file
  -v, --verbose         Print scan and API logs
  -h, --help            Show this help

Arguments:
  directory             Folder of git repos to scan
                        (default: PROJECTS_DIR or the current directory)
`.trim());
  process.exit(0);
}

const isVerbose = args.includes('--verbose') || args.includes('-v');
const isRaw = args.includes('--raw');
const shouldCopy = args.includes('--copy');

function getArgValue(flag) {
  const index = args.findIndex((arg) => arg === flag || arg.startsWith(`${flag}=`));
  if (index === -1) return null;
  if (args[index].includes('=')) {
    return args[index].split('=').slice(1).join('=');
  }
  return args[index + 1] || null;
}

const outFile = getArgValue('--out');

const VALUE_FLAGS = new Set([
  '--date', '-d',
  '--since', '--until',
  '--out',
]);

const log = {
  info: (msg) => isVerbose && console.log(`\x1b[36m[INFO]\x1b[0m ${msg}`),
  success: (msg) => isVerbose && console.log(`\x1b[32m[SUCCESS]\x1b[0m ${msg}`),
  warn: (msg) => isVerbose && console.log(`\x1b[33m[WARN]\x1b[0m ${msg}`),
  error: (msg) => console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`),
  debug: (label, content) => {
    if (!isVerbose) return;
    console.log(`\n\x1b[35m=== [DEBUG] ${label} ===\x1b[0m`);
    console.log(content);
    console.log(`\x1b[35m=== [END ${label}] ===\x1b[0m\n`);
  }
};

const homeDir = process.env.HOME || process.env.USERPROFILE || '';
const envPath = path.join(homeDir, '.daily-bot.env');
const configPath = path.join(homeDir, '.daily-bot.json');

log.info(`Looking for configuration in: ${envPath}`);
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  log.success(`Loaded configuration from ~/.daily-bot.env`);
} else {
  dotenv.config();
  log.warn(`No global .env found at ~/.daily-bot.env. Using local directory .env`);
}

const DEFAULT_SKIP_DIRS = ['node_modules', 'vendor', 'dist', '.next', 'coverage'];
const MAX_COMMITS_PER_REPO = 50;
const MAX_LOG_CHARS = 50_000;
const SCAN_CONCURRENCY = 8;

function loadUserConfig() {
  if (!fs.existsSync(configPath)) {
    return { skipDirs: [], ignore: [], promptExtra: '' };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    log.success(`Loaded configuration from ~/.daily-bot.json`);
    return {
      skipDirs: Array.isArray(raw.skipDirs) ? raw.skipDirs.map(String) : [],
      ignore: Array.isArray(raw.ignore) ? raw.ignore.map(String) : [],
      promptExtra: typeof raw.promptExtra === 'string' ? raw.promptExtra : '',
    };
  } catch (err) {
    log.error(`Failed to parse ~/.daily-bot.json: ${err.message}`);
    process.exit(1);
  }
}

const userConfig = loadUserConfig();
const SKIP_DIRS = new Set([...DEFAULT_SKIP_DIRS, ...userConfig.skipDirs]);

if (!isRaw && !process.env.GEMINI_API_KEY) {
  log.error('Missing GEMINI_API_KEY environment variable. Exiting.');
  process.exit(1);
}

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
if (!isRaw) {
  log.info(`Using Gemini Model: "${MODEL_NAME}"`);
}

const positionalArgs = args.filter((arg, i) => {
  if (arg.startsWith('-')) return false;
  const prev = args[i - 1];
  if (VALUE_FLAGS.has(prev)) return false;
  return true;
});

const ROOT_DIR = positionalArgs[0] || process.env.PROJECTS_DIR || process.cwd();
log.info(`Scanning target directory: "${path.resolve(ROOT_DIR)}"`);

let ai = null;
if (!isRaw) {
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

let targetDate;
try {
  targetDate = resolveDateRange({
    date: getArgValue('--date') || getArgValue('-d') || undefined,
    since: getArgValue('--since') || undefined,
    until: getArgValue('--until') || undefined,
  });
} catch (err) {
  log.error(err.message);
  process.exit(1);
}

log.info(`Target date: ${targetDate.exact} (${targetDate.label}), since="${targetDate.since}" until="${targetDate.until}"`);

function git(cwd, gitArgs) {
  return execFileSync('git', gitArgs, {
    cwd,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

function getRepoActivity(repoPath) {
  const root = path.resolve(ROOT_DIR);
  const repoName = path.relative(root, repoPath) || path.basename(repoPath);

  try {
    let authorName = '';
    let authorEmail = '';

    try {
      authorName = git(repoPath, ['config', 'user.name']);
    } catch {}

    try {
      authorEmail = git(repoPath, ['config', 'user.email']);
    } catch {}

    if (!authorName && !authorEmail) {
      log.warn(`[${repoName}] No git user.name or user.email configured.`);
      return null;
    }

    const authorFilter = authorEmail || authorName;
    log.info(`[${repoName}] Detected Git Author: "${authorName}" <${authorEmail || 'no-email'}>`);

    const logOut = git(repoPath, [
      'log',
      '--all',
      `--since=${targetDate.since}`,
      `--until=${targetDate.until}`,
      `--author=${authorFilter}`,
      `--max-count=${MAX_COMMITS_PER_REPO}`,
      '--pretty=format:%x1e%h%x1f%s%x1f%ci%x1f%D',
      '--shortstat',
    ]);

    const commits = [];
    if (logOut) {
      const records = logOut.split('\x1e').map((r) => r.trim()).filter(Boolean);
      for (const record of records) {
        const lines = record.split('\n').map((l) => l.trim()).filter(Boolean);
        if (!lines.length) continue;
        const [meta, ...statLines] = lines;
        const [hash, subject, date, refs = ''] = meta.split('\x1f');
        if (!hash || !subject) continue;
        const shortstat = statLines.join(' ').trim();
        const refLabel = refs.trim() ? ` [${refs.trim()}]` : '';
        const statLabel = shortstat ? ` | ${shortstat}` : '';
        commits.push(`- [${hash}] ${subject} (${date})${refLabel}${statLabel}`);
      }
    }

    let status = '';
    try {
      status = git(repoPath, ['status', '--porcelain']);
    } catch {}

    const stashes = [];
    try {
      const stashOut = git(repoPath, [
        'stash',
        'list',
        '--format=%gd%x1f%ci%x1f%gs',
      ]);
      if (stashOut) {
        const rangeStart = new Date(targetDate.since.replace(' ', 'T'));
        const rangeEnd = new Date(targetDate.until.replace(' ', 'T'));
        for (const line of stashOut.split('\n')) {
          const [ref, createdAt, subject] = line.split('\x1f');
          if (!ref || !createdAt) continue;
          const created = new Date(createdAt);
          if (Number.isNaN(created.getTime())) continue;
          if (created < rangeStart || created > rangeEnd) continue;
          stashes.push(`- ${ref} ${subject} (${createdAt})`);
        }
      }
    } catch {}

    if (!commits.length && !status && !stashes.length) {
      log.info(`[${repoName}] No commits, status, or stashes found.`);
      return null;
    }

    if (commits.length) {
      log.success(`[${repoName}] Found ${commits.length} commit(s).`);
    }
    if (stashes.length) {
      log.success(`[${repoName}] Found ${stashes.length} stash(es) in range.`);
    }

    const sections = [];
    if (commits.length) {
      sections.push(`Commits:\n${commits.join('\n')}`);
    }
    if (status) {
      sections.push(`Uncommitted:\n${status}`);
    }
    if (stashes.length) {
      sections.push(`Stashes:\n${stashes.join('\n')}`);
    }

    return `### Repository: ${repoName}\n${sections.join('\n\n')}`;
  } catch (err) {
    log.error(`[${repoName}] Failed to read git activity: ${err.message}`);
    return null;
  }
}

function shouldIgnoreRepo(repoPath, root) {
  const relative = path.relative(root, repoPath) || path.basename(repoPath);
  return userConfig.ignore.some((prefix) => {
    return relative === prefix || relative.startsWith(`${prefix}/`);
  });
}

function findGitRepos(dir, repos = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    log.warn(`Cannot read directory: ${dir} (${err.message})`);
    return repos;
  }

  if (entries.some((entry) => entry.name === '.git')) {
    repos.push(dir);
    return repos;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === '.git' || SKIP_DIRS.has(entry.name)) continue;
    findGitRepos(path.join(dir, entry.name), repos);
  }

  return repos;
}

async function mapPool(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

async function collectActivity() {
  if (!fs.existsSync(ROOT_DIR)) {
    log.error(`Directory does not exist: ${ROOT_DIR}`);
    process.exit(1);
  }

  const root = path.resolve(ROOT_DIR);
  const repos = findGitRepos(root).filter((repoPath) => {
    if (shouldIgnoreRepo(repoPath, root)) {
      const name = path.relative(root, repoPath) || path.basename(repoPath);
      log.info(`Ignoring repository: ${name}`);
      return false;
    }
    return true;
  });

  log.info(`Found ${repos.length} git repositor${repos.length === 1 ? 'y' : 'ies'}.`);

  const blocks = await mapPool(repos, SCAN_CONCURRENCY, async (repoPath) => {
    const repoName = path.relative(root, repoPath) || path.basename(repoPath);
    log.info(`Scanning git repository: ${repoName}`);
    return getRepoActivity(repoPath);
  });

  return blocks.filter(Boolean).join('\n\n');
}

function capLogs(rawLogs) {
  if (rawLogs.length <= MAX_LOG_CHARS) return rawLogs;
  log.warn(`Collected logs truncated from ${rawLogs.length} to ${MAX_LOG_CHARS} characters.`);
  return `${rawLogs.slice(0, MAX_LOG_CHARS)}\n\n[truncated]`;
}

function toTerminalText(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[*•]\s+/gm, '- ')
    .replace(/^#+\s+/gm, '')
    .trim();
}

function deliverOutput(body) {
  console.log(`\n================ DAILY SUMMARY (${targetDate.exact}) ================\n`);
  console.log(body);
  console.log('\n===============================================\n');

  if (outFile) {
    fs.writeFileSync(path.resolve(outFile), `${body}\n`, 'utf-8');
    log.success(`Wrote summary to ${path.resolve(outFile)}`);
  }

  if (shouldCopy) {
    const result = spawnSync('pbcopy', [], {
      input: body,
      encoding: 'utf-8',
    });
    if (result.error || result.status !== 0) {
      log.error(`Failed to copy to clipboard: ${result.error?.message || result.stderr || 'pbcopy failed'}`);
    } else {
      log.success('Copied summary to clipboard.');
    }
  }
}

function isRetryableApiError(err) {
  const status = err?.status || err?.code || err?.error?.code;
  if (status === 429 || status === 503) return true;
  const message = String(err?.message || '');
  return /\b429\b|\b503\b|RESOURCE_EXHAUSTED|UNAVAILABLE/i.test(message);
}

async function generateWithGemini(rawLogs) {
  const promptExtra = userConfig.promptExtra
    ? `\n\nInstruções extras do usuário:\n${userConfig.promptExtra}`
    : '';

  const prompt = `
Você é um assistente de engenharia de software focado em preparar resumos para Daily Standup.
Abaixo estão os commits e o trabalho em andamento do desenvolvedor nos repositórios locais referentes a ${targetDate.label} (${targetDate.display}). Cada commit pode incluir data, refs/branches e shortstat (arquivos/linhas alteradas):

${rawLogs}

Escreva um resumo direto e técnico em português, pronto para colar no terminal. Sem preâmbulo.

A data já aparece no cabeçalho do terminal. Não repita a data, o dia da semana nem "${targetDate.display}" em lugar nenhum do texto.

Formato obrigatório, em texto puro (sem markdown: sem asteriscos, sem negrito, sem crases, sem cabeçalhos com #). Agrupe pelo nome do repositório, na ordem em que os commits aparecem. Um repositório por bloco. Não misture mudanças de repositórios diferentes na mesma frase. Use shortstats para ser mais específico sobre o que mudou. Sem hash de commit.

O que foi feito:
Uma frase curta do foco do período, sem data.

Nome do repositório:
- o que mudou nesse repositório, em frases curtas.

Em andamento:
Inclua esta seção somente se houver Uncommitted ou Stashes. Liste o trabalho local ainda não commitado, por repositório quando fizer sentido.

Próximos passos:
- próximo passo lógico, um por linha, com hífen. Quando fizer sentido, cite o repositório.

Use hífen para listas. Não use *, **, _, nem blocos de código. Não comece com "Resumo para a Daily".${promptExtra}
`.trim();

  log.debug('PROMPT SENT TO GEMINI', prompt);

  const startTime = Date.now();
  log.info(`Calling Gemini API (${MODEL_NAME})...`);

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
      });

      const elapsedMs = Date.now() - startTime;
      log.success(`Gemini API response received in ${elapsedMs}ms (attempt ${attempt}).`);
      return toTerminalText(response.text);
    } catch (err) {
      lastError = err;
      if (attempt === 1 && isRetryableApiError(err)) {
        log.warn(`Gemini API retryable error (${err.message}). Retrying once...`);
        continue;
      }
      break;
    }
  }

  throw lastError;
}

async function main() {
  log.info('Starting daily-bot execution...');
  const collected = await collectActivity();

  if (!collected) {
    console.log(`Nenhuma atividade encontrada para ${targetDate.label} (${targetDate.exact}).`);
    return;
  }

  const rawLogs = capLogs(collected);

  if (isRaw) {
    deliverOutput(rawLogs);
    log.info('Finished daily-bot execution.');
    return;
  }

  let body;
  try {
    body = await generateWithGemini(rawLogs);
  } catch (err) {
    log.error(`API Call failed: ${err.message}`);
    log.warn('Falling back to raw collected logs.');
    body = rawLogs;
  }

  deliverOutput(body);
  log.info('Finished daily-bot execution.');
}

await main();
