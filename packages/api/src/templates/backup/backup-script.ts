export function backupScriptContent(
  privateIp: string,
  bucket: string,
  prefix: string,
  endpoint: string,
  region: string,
  retention: number,
  dbUser: string,
  dbPassword: string,
) {
  const fullPath = prefix ? `${prefix}/` : "";
  return `#!/bin/bash
set -euo pipefail

# HAForge PostgreSQL Backup Script
# Dumps all user databases individually, uploads to S3, and enforces retention.
# Only runs on the current Patroni leader node.

PRIVATE_IP="${privateIp}"
BUCKET="${bucket}"
PREFIX="${fullPath}"
ENDPOINT="${endpoint}"
REGION="${region}"
RETENTION=${retention}
DB_USER="${dbUser}"
DB_PASSWORD="${dbPassword}"
DB_HOST="127.0.0.1"
DB_PORT="5432"
SSL_MODE="require"

export PATH="$PATH:$HOME/.local/bin:/usr/local/bin"

LOG_FILE="/opt/haforge/backup.log"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') [haforge-backup] $1" >> "$LOG_FILE"
}

# Check if this node is the leader via Patroni REST API
# GET /leader returns 200 only on the leader node
LEADER_HTTP=$(curl -sk https://127.0.0.1:8008/leader -o /dev/null -w '%{http_code}' 2>/dev/null || echo '000')
if [ "$LEADER_HTTP" != "200" ]; then
  log "Skipping backup — this node is not the leader (REST API /leader returned HTTP $LEADER_HTTP)"
  exit 0
fi

FAILED_DBS=""
SUCCESS_COUNT=0
TOTAL_COUNT=0

# Get list of user databases (exclude system databases)
DB_LIST=$(PGPASSWORD="$DB_PASSWORD" psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d postgres -t -A -c "
  SELECT datname FROM pg_database
  WHERE datistemplate = false
    AND datname NOT IN ('postgres')
  ORDER BY datname;
" 2>> "$LOG_FILE")

if [ -z "$DB_LIST" ]; then
  log "No user databases found to back up"
fi

# Also always back up the postgres database for roles/global objects
DB_LIST="postgres
$DB_LIST"

# Dump each database individually
for DB_NAME in $DB_LIST; do
  DB_NAME=$(echo "$DB_NAME" | xargs)  # trim whitespace
  [ -z "$DB_NAME" ] && continue

  TOTAL_COUNT=$((TOTAL_COUNT + 1))
  SAFE_DB_NAME=$(echo "$DB_NAME" | tr '.' '_')
  FILENAME="pg_backup_\${SAFE_DB_NAME}_\${TIMESTAMP}.dump"
  DUMP_PATH="/tmp/\${FILENAME}"

  log "Starting backup of database '$DB_NAME': $FILENAME"
  PGPASSWORD="$DB_PASSWORD" pg_dump -Fc -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" -f "$DUMP_PATH" >> "$LOG_FILE" 2>&1
  PG_EXIT=$?

  if [ $PG_EXIT -ne 0 ] || [ ! -f "$DUMP_PATH" ]; then
    log "ERROR: pg_dump failed for database '$DB_NAME' (exit code: $PG_EXIT)"
    FAILED_DBS="$FAILED_DBS $DB_NAME"
    rm -f "$DUMP_PATH" 2>/dev/null
    continue
  fi

  DUMP_SIZE=$(stat -c%s "$DUMP_PATH" 2>/dev/null || echo "0")
  DUMP_SIZE_H=$(du -h "$DUMP_PATH" | cut -f1)

  if [ "$DUMP_SIZE" -lt 1024 ]; then
    log "WARNING: Dump for '$DB_NAME' is very small ($DUMP_SIZE bytes) — backup may be incomplete"
  fi

  # Verify dump integrity
  if ! PGPASSWORD="$DB_PASSWORD" pg_restore --list "$DUMP_PATH" >> "$LOG_FILE" 2>&1; then
    log "WARNING: Dump verification (pg_restore --list) failed for '$DB_NAME' — backup may be corrupt"
  else
    log "Dump verified: $DUMP_PATH ($DUMP_SIZE_H)"
  fi

  # Upload to S3
  S3_PATH="s3://$BUCKET/$PREFIX$FILENAME"
  log "Uploading to $S3_PATH"
  if ! aws s3 cp "$DUMP_PATH" "$S3_PATH" --region "$REGION" --endpoint-url "$ENDPOINT" 2>> "$LOG_FILE"; then
    log "ERROR: Upload to S3 failed for '$DB_NAME'"
    FAILED_DBS="$FAILED_DBS $DB_NAME"
    rm -f "$DUMP_PATH"
    continue
  fi

  # Verify upload
  if ! aws s3 ls "$S3_PATH" --region "$REGION" --endpoint-url "$ENDPOINT" > /dev/null 2>&1; then
    log "ERROR: Uploaded file not found in S3 for '$DB_NAME'"
    FAILED_DBS="$FAILED_DBS $DB_NAME"
    rm -f "$DUMP_PATH"
    continue
  fi

  rm -f "$DUMP_PATH"
  log "Backup complete: $FILENAME ($DUMP_SIZE_H)"
  SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
done

# Dump global objects (roles, tablespaces) into a separate SQL file
GLOBALS_FILE="pg_backup_globals_\${TIMESTAMP}.sql"
GLOBALS_PATH="/tmp/\${GLOBALS_FILE}"
log "Starting globals backup: $GLOBALS_FILE"
PGPASSWORD="$DB_PASSWORD" pg_dumpall -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" --globals-only -f "$GLOBALS_PATH" >> "$LOG_FILE" 2>&1
if [ -f "$GLOBALS_PATH" ]; then
  aws s3 cp "$GLOBALS_PATH" "s3://$BUCKET/$PREFIX$GLOBALS_FILE" --region "$REGION" --endpoint-url "$ENDPOINT" 2>> "$LOG_FILE" || true
  rm -f "$GLOBALS_PATH"
  log "Globals backup uploaded: $GLOBALS_FILE"
fi

# Enforce retention — delete old backups beyond retention count
# Group by database name and keep RETENTION per database
for DB_PATTERN in "pg_backup_postgres_" "pg_backup_globals_"; do
  TOTAL=$(aws s3 ls "s3://$BUCKET/$PREFIX" --region "$REGION" --endpoint-url "$ENDPOINT" 2>/dev/null | grep "$DB_PATTERN" | wc -l)
  if [ "$TOTAL" -gt "$RETENTION" ]; then
    DELETE_COUNT=$((TOTAL - RETENTION))
    OLD_FILES=$(aws s3 ls "s3://$BUCKET/$PREFIX" --region "$REGION" --endpoint-url "$ENDPOINT" 2>/dev/null | grep "$DB_PATTERN" | sort -k1,2 | head -n "$DELETE_COUNT" | awk '{print $4}')
    for F in $OLD_FILES; do
      log "Deleting old backup: $F"
      aws s3 rm "s3://$BUCKET/$PREFIX$F" --region "$REGION" --endpoint-url "$ENDPOINT" 2>> "$LOG_FILE"
    done
  fi
done

# Summary
if [ -n "$FAILED_DBS" ]; then
  log "Backup finished with errors: $SUCCESS_COUNT/$TOTAL_COUNT succeeded. Failed:$FAILED_DBS"
  exit 1
else
  log "All backups completed successfully: $SUCCESS_COUNT/$TOTAL_COUNT databases"
fi
`;
}

export function installAwsCliV2Script(): string {
  return `#!/bin/bash
set -euo pipefail

# Install AWS CLI v2 if not already present
if command -v aws &>/dev/null && aws --version 2>&1 | grep -q "aws-cli/2"; then
  echo "AWS CLI v2 already installed"
  exit 0
fi

echo "Installing AWS CLI v2..."
apt-get update -qq && apt-get install -y -qq unzip curl 2>&1 | tail -3
curl --silent --fail -L "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip"
unzip -o -q "/tmp/awscliv2.zip" -d "/tmp/"
/tmp/aws/install --update
rm -rf /tmp/aws /tmp/awscliv2.zip

# Verify
if command -v aws &>/dev/null; then
  echo "AWS CLI v2 installed successfully: $(aws --version)"
else
  echo "ERROR: AWS CLI installation failed"
  exit 1
fi
`;
}
