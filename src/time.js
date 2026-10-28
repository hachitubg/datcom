const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

function vietnamTimeParts(date = new Date()) {
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
}
function vietnamDate(date = new Date()) { return vietnamTimeParts(date).date; }
function getOrderCutoffInfo(time, now = new Date()) {
  const cutoffTime = /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(time || '')) ? time : '10:45';
  const cutoff = new Date(`${vietnamDate(now)}T${cutoffTime}:00+07:00`);
  return { cutoffTime, cutoffAt: cutoff.toISOString(), isOrderClosed: now.getTime() >= cutoff.getTime(),
    remainingSeconds: Math.max(0, Math.floor((cutoff.getTime() - now.getTime()) / 1000)) };
}
module.exports = { TIME_ZONE, vietnamTimeParts, vietnamDate, getOrderCutoffInfo };
