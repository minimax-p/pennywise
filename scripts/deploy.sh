#!/usr/bin/env bash
# Puts Pennywise on your server, from your computer. Run it from the repository:
#
#   ./scripts/deploy.sh                 build this checkout and put it live
#   ./scripts/deploy.sh password        change the login password
#   ./scripts/deploy.sh rollback        go back to the version before
#   ./scripts/deploy.sh restart         restart, e.g. after editing /opt/pennywise/.env
#   ./scripts/deploy.sh logs            show the app's log
#   ./scripts/deploy.sh backup          back up the database and download the file into backups/
#   ./scripts/deploy.sh remove-docker   delete the old Docker install, once you're happy without it
#
# The first run sets the server up: a PostgreSQL database for Pennywise, /opt/pennywise, a pm2
# process on 127.0.0.1:3200 (where nginx already points) and a daily backup. If it finds the
# old Docker install, it copies your data out of its MariaDB, checks every row, and switches
# over; if anything goes wrong on the way, the old install is started again.
#
# Your computer builds the app, so the server only runs it. You need Node.js 18+ and SSH
# access as root. The server address is asked once and saved in .env.deploy (not committed).
set -euo pipefail

cd "$(dirname "$0")/.."
CONFIG=.env.deploy
# shellcheck source=/dev/null
[ -f "$CONFIG" ] && . "./$CONFIG"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() {
    printf '\n\033[31m%s\033[0m\n' "$*" >&2
    exit 1
}

save_config() {
    {
        echo "# Where scripts/deploy.sh puts Pennywise"
        printf 'SSH_TARGET=%q\n' "$SSH_TARGET"
        printf 'SSH_KEY=%q\n' "${SSH_KEY:-}"
        printf 'APP_PORT=%q\n' "${APP_PORT:-3200}"
    } >"$CONFIG"
}

if [ -z "${SSH_TARGET:-}" ]; then
    read -r -p "Server to deploy to, as you'd ssh to it (e.g. root@203.0.113.7): " SSH_TARGET
    read -r -p "SSH key file, if you use one (e.g. ~/.ssh/my-server, or press Enter): " SSH_KEY
    [ -n "$SSH_TARGET" ] || die "No server given."
    save_config
    echo "Saved to $CONFIG"
fi
APP_PORT=${APP_PORT:-3200}
APP_DIR=/opt/pennywise
OLD_DIR=${OLD_DIR:-/root/pennywise}
SSH_KEY=${SSH_KEY:-}
SSH_KEY=${SSH_KEY/#\~/$HOME}

# One SSH connection for the whole run: one login, and port forwards to the databases
WORK=$(mktemp -d /tmp/pennywise.XXXXXX)
SSH=(ssh -o ControlPath="$WORK/ssh" -o ServerAliveInterval=20)
[ -n "$SSH_KEY" ] && SSH+=(-i "$SSH_KEY")

cleanup() {
    "${SSH[@]}" -O exit "$SSH_TARGET" >/dev/null 2>&1 || true
    rm -rf "$WORK"
}
trap cleanup EXIT

connect() {
    "${SSH[@]}" -o ControlMaster=yes -o ConnectTimeout=15 -fN "$SSH_TARGET" || die "Couldn't connect to $SSH_TARGET over SSH."
    "${SSH[@]}" "$SSH_TARGET" "mkdir -p $APP_DIR && chmod 700 $APP_DIR && cat > $APP_DIR/server.sh" <scripts/server.sh
}

# Runs a scripts/server.sh command on the server
remote() {
    local args
    args=$(printf '%q ' "$@")
    "${SSH[@]}" "$SSH_TARGET" "APP_DIR=$APP_DIR APP_PORT=$APP_PORT OLD_DIR=$OLD_DIR bash $APP_DIR/server.sh $args"
}

free_port() {
    node -e 'const s = require("net").createServer(); s.listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close(); })'
}

# Forwards a local port to host:port as seen from the server, and prints the local port
forward() {
    local port
    port=$(free_port)
    "${SSH[@]}" -O forward -L "127.0.0.1:$port:$1:$2" "$SSH_TARGET" >/dev/null || die "Couldn't open a tunnel to $1:$2."
    echo "$port"
}

state_value() {
    printf '%s\n' "$STATE" | sed -n "s/^$1=//p"
}

# PostgreSQL on the server, reached through the SSH connection
database_tunnel() {
    local url host_port port
    url=$(remote database-url)
    [ -n "$url" ] || die "The server has no DATABASE_URL in $APP_DIR/.env."
    host_port=${url#*@}
    host_port=${host_port%%/*}
    port=$(forward "${host_port%:*}" "${host_port##*:}")
    DATABASE_URL="${url%%@*}@127.0.0.1:$port/${url#*@*/}"
    export DATABASE_URL
}

check_local() {
    command -v node >/dev/null 2>&1 || die "Install Node.js 18 or newer first (e.g. brew install node@20)."
    [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ] || die "Node.js $(node -v) is too old; install 18 or newer."
    git rev-parse --git-dir >/dev/null 2>&1 || die "Run this from the Pennywise git checkout."
}

build() {
    say "Building Pennywise"
    local lock
    lock=$(node -e 'console.log(require("crypto").createHash("sha256").update(require("fs").readFileSync("package-lock.json")).digest("hex"))')
    if [ "$(cat node_modules/.deployed-lock 2>/dev/null)" != "$lock" ]; then
        npm ci --no-audit --no-fund
        echo "$lock" >node_modules/.deployed-lock
    fi
    npx prisma generate >/dev/null
    NEXT_TELEMETRY_DISABLED=1 npm run build
}

upload() {
    say "Uploading $RELEASE"
    local stage="$WORK/release"
    mkdir -p "$stage/.next"
    cp -R .next/standalone/. "$stage/"
    cp -R .next/static "$stage/.next/static"
    cp -R public "$stage/public"
    rm -f "$stage"/.env*
    COPYFILE_DISABLE=1 tar -czf - -C "$stage" . | remote receive "$RELEASE"
}

migrate() {
    say "Updating the database"
    npx prisma migrate deploy
    node prisma/seed.mjs
}

ask_password() {
    say "Choose the password for logging in to Pennywise"
    local hash
    hash=$(node scripts/hash-password.mjs) || die "No password set."
    printf '%s\n' "$hash" | remote set-env PENNYWISE_PASSWORD_HASH
}

# ---------- Moving off the old Docker install ----------

MOVING=0
COPIED=0

undo_move() {
    [ "$MOVING" = 1 ] || return 0
    say "Putting the old Docker install back"
    if [ "$COPIED" = 1 ]; then remote reset-db || true; fi
    remote start-old-app || true
    echo "Your old install is running again, unchanged. Nothing was deleted."
}

move_from_docker() {
    say "Moving your data from the old Docker install"
    # Only the first migration, so later ones also update the copied data
    local baseline="$WORK/baseline" first
    for first in prisma/migrations/*/; do break; done
    first=$(basename "$first")
    mkdir -p "$baseline/migrations"
    cp prisma/schema.prisma "$baseline/"
    cp -R "prisma/migrations/$first" prisma/migrations/migration_lock.toml "$baseline/migrations/"
    npx prisma migrate deploy --schema "$baseline/schema.prisma" >/dev/null

    MOVING=1
    trap 'undo_move; cleanup' EXIT
    echo "Stopping the old app so nothing changes during the copy"
    remote stop-old-app
    echo "Last MariaDB backup: $(remote dump-old)"

    local old host user password database port
    old=$(remote old-db)
    host=$(printf '%s\n' "$old" | sed -n 's/^MYSQL_HOST=//p')
    user=$(printf '%s\n' "$old" | sed -n 's/^MYSQL_USER=//p')
    password=$(printf '%s\n' "$old" | sed -n 's/^MYSQL_PASSWORD=//p')
    database=$(printf '%s\n' "$old" | sed -n 's/^MYSQL_DATABASE=//p')
    if [ -z "$host" ] || [ -z "$user" ]; then die "Couldn't find the old MariaDB."; fi
    port=$(forward "$host" 3306)
    COPIED=1
    MYSQL_URL=$(USER_="$user" PASS_="$password" node -e \
        'console.log(`mysql://${encodeURIComponent(process.env.USER_)}:${encodeURIComponent(process.env.PASS_)}@127.0.0.1:${process.argv[1]}/${process.argv[2]}`)' \
        "$port" "$database") node scripts/copy-from-mariadb.mjs || die "The copy failed."
}

deploy() {
    check_local
    connect
    say "Checking the server"
    remote check
    remote setup
    STATE=$(remote state)

    RELEASE="$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
    git diff --quiet HEAD -- . || RELEASE="$RELEASE-dirty"
    build
    upload
    database_tunnel

    if [ "$(state_value old_install)" = yes ] && [ "$(state_value data)" = 0 ]; then
        move_from_docker
    elif [ "$(state_value migrations)" != 0 ]; then
        echo "Backup before updating: $(remote backup before-"$RELEASE")"
    fi
    migrate
    [ "$(state_value password)" = yes ] || ask_password

    say "Starting $RELEASE"
    remote activate "$RELEASE" || die "Pennywise didn't start, so the version before stays live."
    if [ "$MOVING" = 1 ]; then
        remote finish-move
        MOVING=0
        trap cleanup EXIT
        say "Moved off Docker"
        echo "The old containers are stopped, not deleted. Once you're happy, free their space with:"
        echo "  ./scripts/deploy.sh remove-docker"
    fi
    remote startup-check
    local domain
    domain=$(state_value domain)
    say "Done${domain:+: https://$domain}"
}

case "${1:-deploy}" in
    deploy) deploy ;;
    password)
        connect
        ask_password
        remote restart
        say "Password changed"
        ;;
    rollback)
        connect
        remote rollback
        ;;
    restart)
        connect
        remote restart
        say "Restarted"
        ;;
    logs)
        connect
        remote logs "${2:-100}"
        ;;
    backup)
        connect
        file=$(remote backup manual)
        mkdir -p backups
        "${SSH[@]}" "$SSH_TARGET" "cat '$file'" >"backups/$(basename "$file")"
        say "Saved backups/$(basename "$file")"
        ;;
    remove-docker)
        connect
        read -r -p "Delete the old Docker install, including its MariaDB data? Your data is in PostgreSQL now. [y/N] " answer
        case "$answer" in [yY]*) remote remove-old ;; *) echo "Left it alone." ;; esac
        ;;
    *) die "Usage: ./scripts/deploy.sh [deploy|password|rollback|restart|logs|backup|remove-docker]" ;;
esac
