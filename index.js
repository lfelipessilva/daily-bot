#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

// --------------------------------------------------
// CLI Argument Parsing
// --------------------------------------------------
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: daily [options] [directory]

Generate a daily standup summary from local git commits.

Options:
  -d, --date <when>   Day to summarize: today, yesterday (default),
                      MM/DD/YYYY, or YYYY-MM-DD
  -v, --verbose       Print scan and API logs
  -h, --help          Show this help

Arguments:
  directory           Folder of git repos to scan
                      (default: PROJECTS_DIR or the current directory)
`.trim());
  process.exit(0);
}

const isVerbose = args.includes('--verbose') || args.includes('-v');

function getArgValue(flag) {
  const index = args.findIndex((arg) => arg === flag || arg.startsWith(`${flag}=`));
  if (index === -1) return null;
  if (args[index].includes('=')) {
    return args[index].split('=')[1];
  }
  return args[index + 1] || null;
}

// --------------------------------------------------
// Logger (only logs if --verbose is present, errors always show)
// --------------------------------------------------
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

// --------------------------------------------------
// Environment Configuration
// --------------------------------------------------
const homeDir = process.env.HOME || process.env.USERPROFILE || '';
const envPath = path.join(homeDir, '.daily-bot.env');

log.info(`Looking for configuration in: ${envPath}`);
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  log.success(`Loaded configuration from ~/.daily-bot.env`);
} else {
  dotenv.config();
  log.warn(`No global .env found at ~/.daily-bot.env. Using local directory .env`);
}

if (!process.env.GEMINI_API_KEY) {
  log.error('Missing GEMINI_API_KEY environment variable. Exiting.');
  process.exit(1);
}

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
log.info(`Using Gemini Model: "${MODEL_NAME}"`);

// Resolve root directory: first non-flag positional argument, or env var, or cwd
const positionalArgs = args.filter((arg, i) => {
  if (arg.startsWith('-')) return false;
  const prev = args[i - 1];
  if (prev === '--date' || prev === '-d') return false;
  return true;
});

const ROOT_DIR = positionalArgs[0] || process.env.PROJECTS_DIR || process.cwd();
log.info(`Scanning target directory: "${path.resolve(ROOT_DIR)}"`);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --------------------------------------------------
// Date Parameter Parsing
// --------------------------------------------------
function resolveDateRange() {
  const rawDate = getArgValue('--date') || getArgValue('-d') || 'yesterday';
  const normalized = rawDate.trim().toLowerCase();

  const pad = (n) => String(n).padStart(2, '0');
  const formatDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const formatDisplay = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

  if (normalized === 'today') {
    const today = new Date();
    const exact = formatDate(today);
    return {
      since: `${exact} 00:00:00`,
      until: `${exact} 23:59:59`,
      exact,
      display: formatDisplay(today),
      label: 'hoje'
    };
  }

  if (normalized === 'yesterday') {
    const isMonday = new Date().getDay() === 1;
    if (isMonday) {
      // Look back to Friday if running on Monday
      const friday = new Date();
      friday.setDate(friday.getDate() - 3);
      const sunday = new Date();
      sunday.setDate(sunday.getDate() - 1);
      const exact = `${formatDate(friday)} a ${formatDate(sunday)}`;
      return {
        since: `${formatDate(friday)} 00:00:00`,
        until: `${formatDate(sunday)} 23:59:59`,
        exact,
        display: `${formatDisplay(friday)} a ${formatDisplay(sunday)}`,
        label: 'última sexta-feira/fim de semana'
      };
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const exact = formatDate(yesterday);
    return {
      since: `${exact} 00:00:00`,
      until: `${exact} 23:59:59`,
      exact,
      display: formatDisplay(yesterday),
      label: 'ontem'
    };
  }

  // Handle explicit dates: American MM/DD/YYYY or ISO YYYY-MM-DD
  let parsedDate;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(rawDate)) {
    const [month, day, year] = rawDate.split('/');
    parsedDate = new Date(`${year}-${month}-${day}T00:00:00`);
  } else {
    parsedDate = new Date(rawDate);
  }

  if (isNaN(parsedDate.getTime())) {
    log.error(`Invalid date format passed to --date: "${rawDate}". Use MM/DD/YYYY, today, or yesterday.`);
    process.exit(1);
  }

  const formattedStr = formatDate(parsedDate);
  return {
    since: `${formattedStr} 00:00:00`,
    until: `${formattedStr} 23:59:59`,
    exact: formattedStr,
    display: formatDisplay(parsedDate),
    label: `o dia ${rawDate}`
  };
}

const targetDate = resolveDateRange();
log.info(`Target date: ${targetDate.exact} (${targetDate.label}), since="${targetDate.since}" until="${targetDate.until}"`);

// --------------------------------------------------
// Git Operations
// --------------------------------------------------
function getGitCommits(repoPath) {
  const repoName = path.basename(repoPath);
  try {
    let authorName = '';
    let authorEmail = '';

    try {
      authorName = execSync('git config user.name', { cwd: repoPath, encoding: 'utf-8' }).trim();
    } catch {}

    try {
      authorEmail = execSync('git config user.email', { cwd: repoPath, encoding: 'utf-8' }).trim();
    } catch {}

    if (!authorName && !authorEmail) {
      log.warn(`[${repoName}] No git user.name or user.email configured.`);
      return null;
    }

    log.info(`[${repoName}] Detected Git Author: "${authorName}" <${authorEmail || 'no-email'}>`);

    const authorFilter = authorName || authorEmail;
    const gitCmd = `git log --all --since="${targetDate.since}" --until="${targetDate.until}" --author="${authorFilter}" --pretty=format:"- [%h] %s (%ci)"`;

    const commits = execSync(gitCmd, { cwd: repoPath, encoding: 'utf-8' }).trim();

    if (!commits) {
      log.info(`[${repoName}] 0 commits found for this author.`);
      return null;
    }

    const commitCount = commits.split('\n').length;
    log.success(`[${repoName}] Found ${commitCount} commit(s).`);
    return commits;

  } catch (err) {
    log.error(`[${repoName}] Failed to read git log: ${err.message}`);
    return null;
  }
}

async function collectActivity() {
  if (!fs.existsSync(ROOT_DIR)) {
    log.error(`Directory does not exist: ${ROOT_DIR}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(ROOT_DIR, { withFileTypes: true });
  log.info(`Found ${entries.length} items in root folder.`);

  const summaryData = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const fullPath = path.join(ROOT_DIR, entry.name);
    const gitDir = path.join(fullPath, '.git');

    if (fs.existsSync(gitDir)) {
      log.info(`Scanning git repository: ${entry.name}`);
      const logs = getGitCommits(fullPath);
      if (logs) {
        summaryData.push(`### Repository: ${entry.name}\n${logs}`);
      }
    } else {
      log.warn(`Skipping non-git folder: ${entry.name}`);
    }
  }

  return summaryData.join('\n\n');
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

// --------------------------------------------------
// AI Generation
// --------------------------------------------------
async function generateDailySummary(rawLogs) {
  if (!rawLogs) {
    console.log(`Nenhum commit encontrado para ${targetDate.label} (${targetDate.exact}).`);
    return;
  }

  const prompt = `
Você é um assistente de engenharia de software focado em preparar resumos para Daily Standup.
Abaixo estão os commits realizados pelo desenvolvedor nos repositórios locais referentes a ${targetDate.label} (${targetDate.display}). Cada commit inclui a data exata:

${rawLogs}

Escreva um resumo direto e técnico em português, pronto para colar no terminal. Sem preâmbulo.

Formato obrigatório, em texto puro (sem markdown: sem asteriscos, sem negrito, sem crases, sem cabeçalhos com #):

Resumo para a Daily (${targetDate.display}):

O que foi feito:
${targetDate.label.charAt(0).toUpperCase() + targetDate.label.slice(1)} (${targetDate.display}), uma frase curta do foco do dia.
- Tema (área): o que mudou, agrupado por contexto. Sem hash de commit.

Próximos passos:
- próximo passo lógico, um por linha, com hífen.

Use hífen para listas. Não use *, **, _, nem blocos de código.
`.trim();

  log.debug('PROMPT SENT TO GEMINI', prompt);

  const startTime = Date.now();
  log.info(`Calling Gemini API (${MODEL_NAME})...`);

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
    });

    const elapsedMs = Date.now() - startTime;
    log.success(`Gemini API response received in ${elapsedMs}ms.`);

    console.log(`\n================ DAILY SUMMARY (${targetDate.exact}) ================\n`);
    console.log(toTerminalText(response.text));
    console.log('\n===============================================\n');

  } catch (err) {
    log.error(`API Call failed: ${err.message}`);
  }
}

// --------------------------------------------------
// Main Execution
// --------------------------------------------------
log.info('Starting daily-bot execution...');
const logs = await collectActivity();
await generateDailySummary(logs);
log.info('Finished daily-bot execution.');
