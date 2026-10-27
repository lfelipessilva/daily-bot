import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDate,
  parseLocalDate,
  resolveDateRange,
} from '../lib/dates.js';

describe('parseLocalDate', () => {
  it('parses YYYY-MM-DD as local midnight', () => {
    const d = parseLocalDate('2026-10-24');
    assert.ok(d);
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 9);
    assert.equal(d.getDate(), 24);
    assert.equal(d.getHours(), 0);
  });

  it('parses MM/DD/YYYY as local midnight', () => {
    const d = parseLocalDate('10/24/2026');
    assert.ok(d);
    assert.equal(formatDate(d), '2026-10-24');
  });

  it('rejects invalid calendar dates', () => {
    assert.equal(parseLocalDate('2026-13-01'), null);
    assert.equal(parseLocalDate('02/30/2026'), null);
  });
});

describe('resolveDateRange', () => {
  it('resolves today to the local calendar day', () => {
    const now = new Date(2026, 9, 27, 15, 30, 0);
    const range = resolveDateRange({ date: 'today', now });
    assert.equal(range.exact, '2026-10-27');
    assert.equal(range.since, '2026-10-27 00:00:00');
    assert.equal(range.until, '2026-10-27 23:59:59');
    assert.equal(range.label, 'hoje');
  });

  it('on Monday uses Friday through Sunday for yesterday', () => {
    const monday = new Date(2026, 9, 26, 10, 0, 0);
    assert.equal(monday.getDay(), 1);
    const range = resolveDateRange({ date: 'yesterday', now: monday });
    assert.equal(range.since, '2026-10-23 00:00:00');
    assert.equal(range.until, '2026-10-25 23:59:59');
    assert.equal(range.exact, '2026-10-23 a 2026-10-25');
    assert.equal(range.label, 'última sexta-feira/fim de semana');
  });

  it('keeps YYYY-MM-DD on the local calendar day', () => {
    const range = resolveDateRange({ date: '2026-10-24' });
    assert.equal(range.exact, '2026-10-24');
    assert.equal(range.since, '2026-10-24 00:00:00');
    assert.equal(range.until, '2026-10-24 23:59:59');
    assert.equal(range.display, '24/10/2026');
  });

  it('throws on invalid --date', () => {
    assert.throws(
      () => resolveDateRange({ date: 'not-a-date' }),
      /Invalid date format/
    );
  });

  it('uses --since/--until and overrides -d', () => {
    const range = resolveDateRange({
      date: 'today',
      since: '2026-10-20',
      until: '2026-10-22',
    });
    assert.equal(range.since, '2026-10-20 00:00:00');
    assert.equal(range.until, '2026-10-22 23:59:59');
    assert.equal(range.exact, '2026-10-20 a 2026-10-22');
  });

  it('defaults until to since when only --since is set', () => {
    const range = resolveDateRange({ since: '10/24/2026' });
    assert.equal(range.exact, '2026-10-24');
    assert.equal(range.since, '2026-10-24 00:00:00');
    assert.equal(range.until, '2026-10-24 23:59:59');
  });
});
