#!/usr/bin/env bash
# The server side of scripts/deploy.sh. deploy.sh uploads it to /opt/pennywise/server.sh on
# every run and calls it over SSH, one command per step. You can also run it on the server:
#
#   bash /opt/pennywise/server.sh logs       the app's log
#   bash /opt/pennywise/server.sh backup     back up the database now
#   bash /opt/pennywise/server.sh rollback   go back to the version before
#
# Layout:
#   /opt/pennywise/.env               settings, including the database password (only root can read it)
#   /opt/pennywise/releases/<name>    each deployed version; "current" links to the live one
#   /opt/pennywise/backups            daily database backups, kept for two weeks
#   /opt/pennywise/ecosystem.config.cjs   the pm2 process, listening on 127.0.0.1:$APP_PORT
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/pennywise}
APP_PORT=${APP_PORT:-3200}
OLD_DIR=${OLD_DIR:-/root/pennywise}
DB_NAME=${DB_NAME:-pennywise}
DB_USER=${DB_USER:-pennywise}
ENV_FILE=$APP_DIR/.env
KEEP_RELEASES=3

die() {
    echo "$*" >&2
    exit 1
}

# Node and pm2 are often installed with nvm, which non-interactive SSH sessions don't load
find_node() {
    if ! command -v pm2 >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
        # shellcheck disable=SC1091
        . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
    fi
    if ! command -v pm2 >/dev/null 2>&1; then
        for dir in /usr/local/bin "$HOME"/.nvm/versions/node/*/bin "$HOME/.volta/bin" "$HOME/.local/bin"; do
            if [ -x "$dir/pm2" ]; then PATH="$dir:$PATH"; fi
        done
    fi
    # Wherever an interactive login shell finds it
    if ! command -v pm2 >/dev/null 2>&1; then
        local found
        found=$(bash -lic 'command -v pm2' 2>/dev/null </dev/null | tail -n 1 || true)
        if [ -x "$found" ]; then PATH="$(dirname "$found"):$PATH"; fi
    fi
}

as_postgres() {
    (cd / && if [ "$(id -u)" -eq 0 ]; then runuser -u postgres -- "$@"; else sudo -u postgres "$@"; fi)
}

psql_admin() {
    as_postgres psql -v ON_ERROR_STOP=1 -qtAX "$@"
}

env_get() {
    [ -f "$2" ] || return 0
    sed -n "s/^$1=//p" "$2" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

env_set() {
    local tmp
    tmp=$(mktemp "$3.XXXXXX")
    { if [ -f "$3" ]; then grep -v "^$1=" "$3" || true; fi; printf '%s=%s\n' "$1" "$2"; } >"$tmp"
    chmod 600 "$tmp"
    mv "$tmp" "$3"
}

old_compose() {
    (cd "$OLD_DIR" && docker compose "$@")
}

old_install_exists() {
    [ -f "$OLD_DIR/docker-compose.yml" ] && command -v docker >/dev/null 2>&1 \
        && [ -n "$(old_compose ps --all -q db 2>/dev/null)" ]
}

cmd_check() {
    find_node
    local missing=()
    for tool in node pm2 psql pg_dump openssl tar gzip; do
        command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
    done
    if [ ${#missing[@]} -gt 0 ]; then
        die "The server is missing: ${missing[*]}. Pennywise needs Node.js 18+, pm2 and PostgreSQL 13+."
    fi
    local major
    major=$(node -p 'process.versions.node.split(".")[0]')
    [ "$major" -ge 18 ] || die "The server has Node.js $(node -v); Pennywise needs 18 or newer."
    [ "$(id -u)" -eq 0 ] || sudo -n true 2>/dev/null || die "Log in as root, or as a user that can sudo without a password."
    echo "node=$(node -v) postgres=$(psql_admin -c 'SHOW server_version' | cut -d' ' -f1)"
}

write_ecosystem() {
    cat >"$APP_DIR/ecosystem.config.cjs" <<'EOF'
// The pm2 process for Pennywise, written by server.sh. Settings come from .env next to it.
const fs = require("fs");
const path = require("path");

const env = {};
for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
}
const current = path.join(__dirname, "current");
env.PENNYWISE_RELEASE = path.basename(fs.realpathSync(current));

module.exports = {
    apps: [{
        name: "pennywise",
        cwd: current,
        script: "server.js",
        env: {NODE_ENV: "production", ...env},
        node_args: "--max-old-space-size=256",
        max_memory_restart: "350M",
    }],
};
EOF
}

write_backup_script() {
    cat >"$APP_DIR/backup.sh" <<EOF
#!/usr/bin/env bash
# Backs up the Pennywise database into $APP_DIR/backups. Daily ones are kept for two weeks.
# Restore one into an empty database: see "Backups" in README.md.
set -euo pipefail
label=\${1:-daily}
file="$APP_DIR/backups/pennywise-\$(date +%Y-%m-%d-%H%M%S)-\$label.sql.gz"
trap 'rm -f "\$file.tmp"' EXIT
cd /
runuser -u postgres -- pg_dump --no-owner --no-privileges "$DB_NAME" | gzip >"\$file.tmp"
mv "\$file.tmp" "\$file"
find "$APP_DIR/backups" -name 'pennywise-*-daily.sql.gz' -mtime +14 -delete
find "$APP_DIR/backups" -name 'pennywise-*-before-*.sql.gz' -mtime +30 -delete
echo "\$file"
EOF
    chmod 700 "$APP_DIR/backup.sh"
    if [ -d /etc/cron.d ]; then
        printf '# Daily Pennywise database backup\n23 4 * * * root %s/backup.sh daily >/dev/null 2>&1\n' "$APP_DIR" >/etc/cron.d/pennywise
        chmod 644 /etc/cron.d/pennywise
    fi
}

cmd_setup() {
    mkdir -p "$APP_DIR/releases" "$APP_DIR/backups"
    chmod 700 "$APP_DIR"
    touch "$ENV_FILE"
    chmod 600 "$ENV_FILE"

    # Pennywise's own database role, with a password only .env knows
    if [ -z "$(env_get DATABASE_URL "$ENV_FILE")" ]; then
        local password port
        password=$(openssl rand -hex 24)
        port=$(psql_admin -c 'SHOW port')
        if [ "$(psql_admin -c "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'")" = 1 ]; then
            psql_admin -c "ALTER ROLE \"$DB_USER\" WITH LOGIN PASSWORD '$password'"
        else
            psql_admin -c "CREATE ROLE \"$DB_USER\" WITH LOGIN PASSWORD '$password'"
        fi
        env_set DATABASE_URL "postgresql://$DB_USER:$password@127.0.0.1:$port/$DB_NAME" "$ENV_FILE"
    fi
    create_database

    # Settings carried over from the Docker install: same password, same login sessions
    if [ -f "$OLD_DIR/.env" ]; then
        local key value
        for key in PENNYWISE_PASSWORD_HASH SESSION_SECRET PENNYWISE_NAME PENNYWISE_USER_ID TZ DOMAIN TYPESAFE_API_KEY \
            PLAID_CLIENT_ID PLAID_SECRET PLAID_ENV PLAID_COUNTRY_CODES PLAID_TOKEN_ENCRYPTION_KEY; do
            value=$(env_get "$key" "$OLD_DIR/.env")
            if [ -z "$(env_get "$key" "$ENV_FILE")" ] && [ -n "$value" ]; then env_set "$key" "$value" "$ENV_FILE"; fi
        done
    fi
    [ -n "$(env_get SESSION_SECRET "$ENV_FILE")" ] || env_set SESSION_SECRET "$(openssl rand -base64 32)" "$ENV_FILE"
    [ -n "$(env_get TZ "$ENV_FILE")" ] || env_set TZ "$(cat /etc/timezone 2>/dev/null || echo UTC)" "$ENV_FILE"
    env_set PORT "$APP_PORT" "$ENV_FILE"
    env_set HOSTNAME 127.0.0.1 "$ENV_FILE"

    write_ecosystem
    write_backup_script
}

create_database() {
    if [ "$(psql_admin -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")" != 1 ]; then
        psql_admin -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\" ENCODING 'UTF8' TEMPLATE template0" 2>/dev/null \
            || psql_admin -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\" ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0"
    fi
}

# What deploy.sh needs to decide what to do, as key=value lines
cmd_state() {
    local migrations=0 data=0 current=""
    if [ "$(psql_admin -d "$DB_NAME" -c "SELECT to_regclass('public._prisma_migrations') IS NOT NULL" 2>/dev/null)" = t ]; then
        migrations=$(psql_admin -d "$DB_NAME" -c 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')
        if [ "$(psql_admin -d "$DB_NAME" -c "SELECT to_regclass('public.\"Account\"') IS NOT NULL")" = t ]; then
            data=$(psql_admin -d "$DB_NAME" -c 'SELECT (SELECT count(*) FROM "Account") + (SELECT count(*) FROM "Transaction")')
        fi
    fi
    [ -L "$APP_DIR/current" ] && current=$(basename "$(readlink "$APP_DIR/current")")
    echo "migrations=$migrations"
    echo "data=$data"
    echo "current=$current"
    echo "old_install=$(old_install_exists && [ ! -f "$APP_DIR/.moved-from-docker" ] && echo yes || echo no)"
    echo "password=$([ -n "$(env_get PENNYWISE_PASSWORD_HASH "$ENV_FILE")" ] && echo yes || echo no)"
    echo "domain=$(env_get DOMAIN "$ENV_FILE")"
}

cmd_database_url() {
    env_get DATABASE_URL "$ENV_FILE"
}

cmd_set_env() {
    local value
    IFS= read -r value
    env_set "$1" "$value" "$ENV_FILE"
}

cmd_receive() {
    local dir="$APP_DIR/releases/$1"
    rm -rf "$dir"
    mkdir -p "$dir"
    tar -xzf - -C "$dir" --warning=no-unknown-keyword 2>/dev/null || tar -xzf - -C "$dir"
}

healthy() {
    local release=$1 body
    for _ in $(seq 1 45); do
        body=$(node -e '
            fetch(process.argv[1]).then((r) => r.text()).then((t) => console.log(t), () => process.exit(1))
        ' "http://127.0.0.1:$APP_PORT/api/health" 2>/dev/null || true)
        case "$body" in *'"ok":true'*"\"release\":\"$release\""*) return 0 ;; esac
        sleep 2
    done
    return 1
}

switch_to() {
    ln -sfn "releases/$1" "$APP_DIR/current.new"
    mv -T "$APP_DIR/current.new" "$APP_DIR/current"
    write_ecosystem
    pm2 startOrReload "$APP_DIR/ecosystem.config.cjs" --update-env >/dev/null
}

cmd_activate() {
    find_node
    local release=$1 previous=""
    [ -d "$APP_DIR/releases/$release" ] || die "No release $release"
    [ -L "$APP_DIR/current" ] && previous=$(basename "$(readlink "$APP_DIR/current")")
    switch_to "$release"
    if healthy "$release"; then
        pm2 save >/dev/null 2>&1 || true
        prune
        echo "Pennywise $release is live on 127.0.0.1:$APP_PORT"
        return 0
    fi
    echo "The new version didn't start. Its log:" >&2
    pm2 logs pennywise --lines 40 --nostream >&2 || true
    if [ -n "$previous" ] && [ "$previous" != "$release" ]; then
        switch_to "$previous"
        healthy "$previous" || true
        echo "Went back to $previous." >&2
    else
        pm2 stop pennywise >/dev/null 2>&1 || true
    fi
    return 1
}

prune() {
    local current keep=0
    current=$(basename "$(readlink "$APP_DIR/current")")
    for dir in $(ls -1 "$APP_DIR/releases" | sort -r); do
        if [ "$dir" = "$current" ]; then continue; fi
        keep=$((keep + 1))
        if [ $keep -ge $KEEP_RELEASES ]; then rm -rf "${APP_DIR:?}/releases/$dir"; fi
    done
}

cmd_rollback() {
    find_node
    local current previous
    current=$(basename "$(readlink "$APP_DIR/current")")
    previous=$(ls -1 "$APP_DIR/releases" | sort | grep -B1 -x "$current" | grep -vx "$current" || true)
    [ -n "$previous" ] || die "There is no version before $current to go back to."
    switch_to "$previous"
    healthy "$previous" || die "$previous didn't start either. See: bash $APP_DIR/server.sh logs"
    pm2 save >/dev/null 2>&1 || true
    echo "Back on $previous. Database changes made by newer versions are kept."
}

cmd_restart() {
    find_node
    write_ecosystem
    pm2 startOrReload "$APP_DIR/ecosystem.config.cjs" --update-env >/dev/null
    healthy "$(basename "$(readlink "$APP_DIR/current")")" || die "Pennywise didn't come back. See: bash $APP_DIR/server.sh logs"
}

cmd_logs() {
    find_node
    pm2 logs pennywise --lines "${1:-100}" --nostream
}

cmd_backup() {
    "$APP_DIR/backup.sh" "${1:-manual}"
}

cmd_startup_check() {
    find_node
    if command -v systemctl >/dev/null 2>&1 && ! systemctl is-enabled "pm2-$(id -un)" >/dev/null 2>&1; then
        echo "pm2 isn't set to start at boot. Run 'pm2 startup' on the server once so Pennywise comes back after a reboot."
    fi
}

# ---------- Moving off the old Docker install ----------

# How to reach the old MariaDB from the server, as key=value lines
cmd_old_db() {
    old_compose start db >/dev/null 2>&1
    local id status=""
    id=$(old_compose ps -q db)
    for _ in $(seq 1 60); do
        status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")
        if [ "$status" = healthy ] || [ "$status" = running ]; then break; fi
        sleep 2
    done
    echo "MYSQL_HOST=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$id" | awk '{print $1}')"
    old_compose exec -T db sh -c 'printf "MYSQL_USER=%s\nMYSQL_PASSWORD=%s\nMYSQL_DATABASE=%s\n" "$MARIADB_USER" "$MARIADB_PASSWORD" "$MARIADB_DATABASE"'
}

cmd_stop_old_app() {
    old_compose stop app >/dev/null 2>&1
}

cmd_start_old_app() {
    old_compose start app >/dev/null 2>&1
}

# A last MariaDB backup, next to the PostgreSQL ones
cmd_dump_old() {
    local file
    file="$APP_DIR/backups/mariadb-$(date +%Y-%m-%d-%H%M%S)-before-move.sql.gz"
    old_compose exec -T db sh -c 'exec mariadb-dump -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" --single-transaction "$MARIADB_DATABASE"' \
        | gzip >"$file"
    echo "$file"
}

# After a failed move: an empty database again, so the next try starts clean
cmd_reset_db() {
    find_node
    pm2 delete pennywise >/dev/null 2>&1 || true
    psql_admin -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE)"
    create_database
}

cmd_finish_move() {
    old_compose stop >/dev/null 2>&1
    date >"$APP_DIR/.moved-from-docker"
}

cmd_remove_old() {
    old_install_exists || [ -f "$OLD_DIR/docker-compose.yml" ] || die "No Docker install at $OLD_DIR."
    [ -f "$APP_DIR/.moved-from-docker" ] || die "Pennywise hasn't been moved off Docker yet; run deploy.sh first."
    old_compose down --volumes --rmi all >/dev/null 2>&1
    local moved
    moved="$OLD_DIR-docker-removed-$(date +%Y-%m-%d)"
    mv "$OLD_DIR" "$moved"
    echo "Removed the Docker containers, images and MariaDB volume. Its .env and backups are in $moved."
}

command=${1:-}
shift || true
case "$command" in
    check) cmd_check ;;
    setup) cmd_setup ;;
    state) cmd_state ;;
    database-url) cmd_database_url ;;
    set-env) cmd_set_env "$@" ;;
    receive) cmd_receive "$@" ;;
    activate) cmd_activate "$@" ;;
    rollback) cmd_rollback ;;
    restart) cmd_restart ;;
    logs) cmd_logs "$@" ;;
    backup) cmd_backup "$@" ;;
    startup-check) cmd_startup_check ;;
    old-db) cmd_old_db ;;
    stop-old-app) cmd_stop_old_app ;;
    start-old-app) cmd_start_old_app ;;
    dump-old) cmd_dump_old ;;
    reset-db) cmd_reset_db ;;
    finish-move) cmd_finish_move ;;
    remove-old) cmd_remove_old ;;
    *) die "Usage: server.sh check|setup|state|activate <release>|rollback|restart|logs|backup|remove-old" ;;
esac
