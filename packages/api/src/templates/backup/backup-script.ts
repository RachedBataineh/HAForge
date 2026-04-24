export function backupScriptContent(
  privateIp: string,
  bucket: string,
  prefix: string,
  endpoint: string,
  region: string,
  retention: number,
  dbUser: string,
  dbName: string,
  dbPassword: string,
) {
  const fullPath = prefix ? `${prefix}/` : "";
  return `#!/bin/bash

# HAForge PostgreSQL Backup Script
# Only runs on the current Patroni leader node

PRIVATE_IP="${privateIp}"
BUCKET="${bucket}"
PREFIX="${fullPath}"
ENDPOINT="${endpoint}"
REGION="${region}"
RETENTION=${retention}
DB_USER="${dbUser}"
DB_NAME="${dbName}"
DB_PASSWORD="${dbPassword}"
DB_HOST="127.0.0.1"

LOG_FILE="/var/log/haforge-backup.log"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') [haforge-backup] $1" >> "$LOG_FILE"
}

# Check if this node is the leader via patronictl
if ! patronictl -c /etc/patroni/config.yml list 2>/dev/null | grep "$PRIVATE_IP" | grep -q "Leader"; then
  log "Skipping backup — this node is not the leader (ip: $PRIVATE_IP)"
  exit 0
fi

# Create backup
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="pg_backup_\${TIMESTAMP}.dump"
DUMP_PATH="/tmp/\${FILENAME}"

log "Starting backup: $FILENAME"
PGPASSWORD="$DB_PASSWORD" pg_dump -Fc -U "$DB_USER" -h "$DB_HOST" -d "$DB_NAME" -f "$DUMP_PATH" >> "$LOG_FILE" 2>&1

if [ ! -f "$DUMP_PATH" ]; then
  log "ERROR: pg_dump failed — no dump file created"
  exit 1
fi

DUMP_SIZE=$(stat -c%s "$DUMP_PATH" 2>/dev/null || echo "0")
DUMP_SIZE_H=$(du -h "$DUMP_PATH" | cut -f1)
log "Dump created: $DUMP_PATH ($DUMP_SIZE_H)"

if [ "$DUMP_SIZE" -lt 1024 ]; then
  log "WARNING: Dump file is very small ($DUMP_SIZE bytes) — backup may be incomplete"
fi

# Upload to S3
S3_PATH="s3://$BUCKET/$PREFIX$FILENAME"
log "Uploading to $S3_PATH"
if ! aws s3 cp "$DUMP_PATH" "$S3_PATH" --region "$REGION" --endpoint-url "$ENDPOINT" 2>> "$LOG_FILE"; then
  log "ERROR: Upload to S3 failed"
  rm -f "$DUMP_PATH"
  exit 1
fi

# Verify upload
if ! aws s3 ls "$S3_PATH" --region "$REGION" --endpoint-url "$ENDPOINT" > /dev/null 2>&1; then
  log "ERROR: Uploaded file not found in S3"
  rm -f "$DUMP_PATH"
  exit 1
fi

# Cleanup local file
rm -f "$DUMP_PATH"
log "Local dump cleaned up"

# Enforce retention — delete old backups beyond retention count
TOTAL=$(aws s3 ls "s3://$BUCKET/$PREFIX" --region "$REGION" --endpoint-url "$ENDPOINT" 2>/dev/null | grep "pg_backup_" | wc -l)
if [ "$TOTAL" -gt "$RETENTION" ]; then
  DELETE_COUNT=$((TOTAL - RETENTION))
  OLD_FILES=$(aws s3 ls "s3://$BUCKET/$PREFIX" --region "$REGION" --endpoint-url "$ENDPOINT" 2>/dev/null | grep "pg_backup_" | sort -k1,2 | head -n "$DELETE_COUNT" | awk '{print $4}')
  for F in $OLD_FILES; do
    log "Deleting old backup: $F"
    aws s3 rm "s3://$BUCKET/$PREFIX$F" --region "$REGION" --endpoint-url "$ENDPOINT" 2>> "$LOG_FILE"
  done
fi

log "Backup complete: $FILENAME"
`;
}
