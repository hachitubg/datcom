// Fallback for hosts where outbound NTP is unavailable. HTTPS certificate validation stays enabled.
const https = require('https');
const { execFileSync } = require('child_process');
const SOURCES = ['https://1.1.1.1/', 'https://www.google.com/generate_204', 'https://www.microsoft.com/'];
const monotonic = () => Number(process.hrtime.bigint() / 1000000n);

function readTime(url) {
  return new Promise((resolve, reject) => {
    const start = monotonic();
    const request = https.request(url, { method: 'HEAD', headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'DatcomClockSync/1.0' } }, (response) => {
      response.resume();
      const receivedAt = monotonic();
      const date = Date.parse(response.headers.date || '');
      const age = Number(response.headers.age || 0);
      if (!Number.isFinite(date) || age > 1 || receivedAt - start > 6000) {
        reject(new Error('Unusable or delayed HTTPS Date header'));
        return;
      }
      resolve({ source: new URL(url).hostname, time: date + 500 + (receivedAt - start) / 2, receivedAt });
    });
    const deadline = setTimeout(() => request.destroy(new Error('HTTPS time timeout')), 8000);
    request.once('close', () => clearTimeout(deadline));
    request.once('error', reject);
    request.end();
  });
}

function consensus(samples, at = monotonic()) {
  const values = samples.map((sample) => ({ ...sample, estimate: sample.time + at - sample.receivedAt }))
    .sort((a, b) => a.estimate - b.estimate);
  let best = [];
  for (let i = 0; i < values.length; i++) {
    const group = values.slice(i).filter((value) => value.estimate - values[i].estimate <= 3000);
    if (new Set(group.map((value) => value.source)).size >= 2 && group.length > best.length) best = group;
  }
  if (best.length < 2) throw new Error('At least two independent HTTPS time sources must agree within 3 seconds');
  return { time: best.reduce((sum, value) => sum + value.estimate, 0) / best.length, sources: best.map((value) => value.source) };
}

async function syncClock(checkOnly = false) {
  if (!checkOnly && (process.platform !== 'linux' || process.getuid() !== 0)) throw new Error('Clock correction requires root on Linux');
  if (!checkOnly) {
    try {
      const tracking = execFileSync('/usr/bin/chronyc', ['tracking'], { encoding: 'utf8', timeout: 3000 });
      const reference = Date.parse(tracking.match(/Ref time \(UTC\)\s*:\s*(.+)/)?.[1] + ' UTC');
      if (/Leap status\s*:\s*Normal/.test(tracking) && Math.abs(Date.now() - reference) < 1800000) {
        console.log('Chrony is synchronized; HTTPS correction skipped.');
        return;
      }
    } catch { /* HTTPS is the fallback when chrony cannot supply current time. */ }
  }
  const results = await Promise.allSettled(SOURCES.map(readTime));
  const agreed = consensus(results.filter((result) => result.status === 'fulfilled').map((result) => result.value));
  const offsetMs = Math.round(agreed.time - Date.now());
  if (Math.abs(offsetMs) > 86400000) throw new Error('Offset exceeds one day; manual review required');
  const corrected = !checkOnly && Math.abs(offsetMs) > 2000;
  if (corrected) execFileSync('/usr/bin/date', ['--set', `@${(agreed.time / 1000).toFixed(3)}`], { timeout: 5000 });
  console.log(JSON.stringify({ sources: agreed.sources, offsetMs, corrected, time: new Date().toISOString() }));
}

if (require.main === module) syncClock(process.argv.includes('--check')).catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { consensus };
