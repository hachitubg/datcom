#!/usr/bin/env bash
set -Eeuo pipefail

TARGET_SHA="${1:-}"
APP_DIR="${APP_DIR:-/var/www/datcom}"
PM2_APP="${PM2_APP:-datcom}"
HEALTH_BASE_URL="${HEALTH_BASE_URL:-http://127.0.0.1:3000}"
LOCK_FILE="${LOCK_FILE:-/var/lock/datcom-deploy.lock}"

if [[ ! "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid target commit: $TARGET_SHA" >&2
  exit 2
fi

cd "$APP_DIR"
test -d .git
test -f .env

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another deployment is already running." >&2
  exit 3
fi

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Tracked files on VPS have local changes; refusing to deploy." >&2
  git status --short
  exit 4
fi

git fetch --prune origin main
if [[ "$(git rev-parse origin/main)" != "$TARGET_SHA" ]]; then
  echo "Target commit is not the current origin/main." >&2
  exit 5
fi

PREVIOUS_SHA="$(git rev-parse HEAD)"
DEPLOY_STAMP="$(date -u +%Y%m%d-%H%M%S)"
BACKUP_DIR="$APP_DIR/backups/ci-$DEPLOY_STAMP-$PREVIOUS_SHA"
export APP_DIR BACKUP_DIR

echo "Creating SQLite snapshots in $BACKUP_DIR"
node <<'NODE'
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const appDir = process.env.APP_DIR;
const backupDir = process.env.BACKUP_DIR;
fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });

const registryPath = path.join(appDir, 'sites', 'sites.json');
const sites = fs.existsSync(registryPath)
  ? (JSON.parse(fs.readFileSync(registryPath, 'utf8')).sites || [])
  : [];
const databases = [
  { name: 'main', source: path.join(appDir, 'datcom.db') },
  ...sites.map((site) => ({ name: site.slug, source: path.resolve(site.db_path) }))
];

function snapshot(source, destination) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(source, (openError) => {
      if (openError) return reject(openError);
      const escaped = destination.replace(/'/g, "''");
      db.run(`VACUUM INTO '${escaped}'`, (backupError) => {
        db.close((closeError) => backupError || closeError
          ? reject(backupError || closeError)
          : resolve());
      });
    });
  });
}

(async () => {
  const manifest = [];
  for (const item of databases) {
    if (!fs.existsSync(item.source)) throw new Error(`Missing database: ${item.source}`);
    const destination = path.join(backupDir, `${item.name}.db`);
    await snapshot(item.source, destination);
    fs.chmodSync(destination, 0o600);
    manifest.push({ ...item, backup: destination });
  }
  fs.writeFileSync(
    path.join(backupDir, 'manifest.json'),
    JSON.stringify({ createdAt: new Date().toISOString(), databases: manifest }, null, 2),
    { mode: 0o600 }
  );
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
NODE

DEPLOY_PHASE="code"

restore_databases() {
  export BACKUP_DIR
  node <<'NODE'
const fs = require('fs');
const path = require('path');
const manifest = JSON.parse(fs.readFileSync(path.join(process.env.BACKUP_DIR, 'manifest.json'), 'utf8'));
for (const item of manifest.databases) {
  fs.rmSync(`${item.source}-wal`, { force: true });
  fs.rmSync(`${item.source}-shm`, { force: true });
  fs.copyFileSync(item.backup, item.source);
}
NODE
}

health_check() {
  local path="$1"
  local _attempt
  for _attempt in {1..20}; do
    if curl --fail --silent --show-error --max-time 5 "$HEALTH_BASE_URL$path" | grep -q '"date"'; then
      return 0
    fi
    sleep 2
  done
  echo "Health check failed: $path" >&2
  return 1
}

rollback() {
  local exit_code=$?
  trap - ERR
  set +e
  echo "Deployment failed. Rolling back to $PREVIOUS_SHA" >&2

  if [[ "$DEPLOY_PHASE" == "activated" ]]; then
    pm2 stop "$PM2_APP"
    restore_databases
  fi

  git checkout --detach "$PREVIOUS_SHA"
  npm ci --omit=dev
  pm2 restart "$PM2_APP" --update-env
  health_check "/api/today"
  pm2 save
  echo "Rollback completed." >&2
  exit "$exit_code"
}
trap rollback ERR

echo "Deploying $TARGET_SHA (previous: $PREVIOUS_SHA)"
git checkout --detach "$TARGET_SHA"
npm ci --omit=dev
npm run check
npm test

DEPLOY_PHASE="activated"
pm2 restart "$PM2_APP" --update-env

mapfile -t HEALTH_PATHS < <(node <<'NODE'
const fs = require('fs');
const registryPath = 'sites/sites.json';
const sites = fs.existsSync(registryPath)
  ? (JSON.parse(fs.readFileSync(registryPath, 'utf8')).sites || [])
  : [];
console.log('/api/today');
for (const site of sites.filter((item) => item.active)) {
  console.log(`/${site.slug}/api/today`);
}
NODE
)

for path in "${HEALTH_PATHS[@]}"; do
  health_check "$path"
done

pm2 save
trap - ERR
echo "Deployment successful: $TARGET_SHA"
