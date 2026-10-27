const pad = (n) => String(n).padStart(2, '0');

export function formatDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDisplay(d) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function parseLocalDate(raw) {
  const trimmed = raw.trim();

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    const [month, day, year] = trimmed.split('/').map(Number);
    const d = new Date(year, month - 1, day);
    if (
      d.getFullYear() !== year ||
      d.getMonth() !== month - 1 ||
      d.getDate() !== day
    ) {
      return null;
    }
    return d;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    if (
      d.getFullYear() !== year ||
      d.getMonth() !== month - 1 ||
      d.getDate() !== day
    ) {
      return null;
    }
    return d;
  }

  return null;
}

function rangeForDay(d, label) {
  const exact = formatDate(d);
  return {
    since: `${exact} 00:00:00`,
    until: `${exact} 23:59:59`,
    exact,
    display: formatDisplay(d),
    label,
  };
}

export function resolveDateRange({ date, since, until, now = new Date() } = {}) {
  if (since || until) {
    const sinceRaw = since || until;
    const untilRaw = until || since;
    const sinceDate = parseLocalDate(sinceRaw);
    const untilDate = parseLocalDate(untilRaw);

    if (!sinceDate || !untilDate) {
      const bad = !sinceDate ? sinceRaw : untilRaw;
      throw new Error(
        `Invalid date format: "${bad}". Use YYYY-MM-DD or MM/DD/YYYY.`
      );
    }

    if (sinceDate.getTime() > untilDate.getTime()) {
      throw new Error(`--since (${sinceRaw}) is after --until (${untilRaw}).`);
    }

    const sinceExact = formatDate(sinceDate);
    const untilExact = formatDate(untilDate);
    const sameDay = sinceExact === untilExact;

    return {
      since: `${sinceExact} 00:00:00`,
      until: `${untilExact} 23:59:59`,
      exact: sameDay ? sinceExact : `${sinceExact} a ${untilExact}`,
      display: sameDay
        ? formatDisplay(sinceDate)
        : `${formatDisplay(sinceDate)} a ${formatDisplay(untilDate)}`,
      label: sameDay
        ? `o dia ${sinceExact}`
        : `o período de ${formatDisplay(sinceDate)} a ${formatDisplay(untilDate)}`,
    };
  }

  const rawDate = date || 'yesterday';
  const normalized = rawDate.trim().toLowerCase();

  if (normalized === 'today') {
    return rangeForDay(now, 'hoje');
  }

  if (normalized === 'yesterday') {
    if (now.getDay() === 1) {
      const friday = new Date(now);
      friday.setDate(friday.getDate() - 3);
      const sunday = new Date(now);
      sunday.setDate(sunday.getDate() - 1);
      return {
        since: `${formatDate(friday)} 00:00:00`,
        until: `${formatDate(sunday)} 23:59:59`,
        exact: `${formatDate(friday)} a ${formatDate(sunday)}`,
        display: `${formatDisplay(friday)} a ${formatDisplay(sunday)}`,
        label: 'última sexta-feira/fim de semana',
      };
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return rangeForDay(yesterday, 'ontem');
  }

  const parsedDate = parseLocalDate(rawDate);
  if (!parsedDate) {
    throw new Error(
      `Invalid date format passed to --date: "${rawDate}". Use MM/DD/YYYY, YYYY-MM-DD, today, or yesterday.`
    );
  }

  return rangeForDay(parsedDate, `o dia ${rawDate}`);
}
