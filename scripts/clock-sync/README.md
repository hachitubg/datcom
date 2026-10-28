# Server Clock

Business dates and order cutoffs explicitly use Asia/Ho_Chi_Minh.
SQLite timestamps stay UTC and browsers display them in Vietnam time.
Do not rewrite historical timestamps to compensate for clock drift without auditing
the individual records.

Chrony is the primary service. This VPS currently receives no outbound NTP replies.
An HTTPS fallback checks every five minutes and after reboot. It validates TLS,
requires two independent sources to agree within three seconds, rejects cached or
slow responses and offsets above a day, and skips while Chrony is synchronized.
HTTP Date headers have one-second resolution: this is an approximate fallback.

Install/update as root from the repo (back up existing files first):

```sh
install -D -m 644 scripts/sync-system-clock.cjs /usr/local/lib/datcom-clock/sync-system-clock.cjs
install -m 644 scripts/clock-sync/datcom-clock-sync.service /etc/systemd/system/datcom-clock-sync.service
install -m 644 scripts/clock-sync/datcom-clock-sync.timer /etc/systemd/system/datcom-clock-sync.timer
systemctl daemon-reload
systemctl enable --now datcom-clock-sync.timer
systemctl start datcom-clock-sync.service
```

Read-only verification:

```sh
date -Is
chronyc tracking
systemctl list-timers datcom-clock-sync.timer
journalctl -u datcom-clock-sync.service -n 20 --no-pager
node /usr/local/lib/datcom-clock/sync-system-clock.cjs --check
```

No inbound firewall ports or TLS verification changes are needed.
