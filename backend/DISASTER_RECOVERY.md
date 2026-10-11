# Disaster Recovery Runbook

The Production Readiness check `backup_restore` passes only when a **COMPLETED** backup
operation newer than the RPO is recorded in the `backupoperations` collection. Nothing in
the API can create that record; it is written by the backup CLI after a real `mongodump`
succeeds and the archive is verified.

## Policy (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `DR_BACKUP_DIRECTORY` | `backups/mongodb` | Where archives are written on the operator host |
| `DR_BACKUP_STORAGE_PROVIDER` | `local_filesystem` | Recorded with each backup; production warns on `local_filesystem` |
| `DR_BACKUP_RETENTION_DAYS` | `30` | Recorded as `expiresAt` on each backup |
| `DR_BACKUP_RPO_HOURS` | `24` | Readiness warns when the latest completed backup is older than this |
| `DR_BACKUP_RTO_HOURS` | `4` | Target time to restore service |
| `DR_ALLOW_PRODUCTION_RESTORE` | `false` | Must stay `false` except during an approved, audited production restore |

## Taking a backup

Run on an authorized host with [MongoDB Database Tools](https://www.mongodb.com/docs/database-tools/) installed and
`MONGO_URI` pointing at the database to back up:

```bash
cd backend
npm run backup:dry-run   # prints the plan; writes nothing
npm run backup:apply     # runs mongodump, verifies the archive, records evidence
```

`backup:apply`:

1. Runs `mongodump --archive --gzip`.
2. Fails if the archive is missing or empty, and computes its SHA-256.
3. Writes a `BackupOperation` (`COMPLETED` or `FAILED`) with a redacted URI, archive size
   and checksum, and an immutable `AuditLog` entry.

Use `--no-record` only for throwaway local backups; without the record, readiness cannot see the backup.

Then copy the archive to encrypted off-host storage (for example an S3 bucket with
server-side encryption and versioning) and record its checksum alongside it. A backup
that only exists on the operator's disk is not a disaster-recovery backup.

To meet a 24-hour RPO, schedule `npm run backup:apply` at least daily (cron, a scheduled CI
job with a dedicated read-only database user, or Atlas Cloud Backup, see below).

### MongoDB Atlas Cloud Backup

If the production cluster uses Atlas Cloud Backup snapshots, those snapshots are the primary
recovery mechanism, but this control plane cannot see them. Keep running a periodic
`backup:apply` so restore drills have a portable archive and readiness has recorded evidence.

## Restore drill (staging only)

Restores are never executed through the HTTP API. Rehearse against an **isolated
non-production cluster**:

```bash
cd backend
node scripts/restore-database.js --dry-run \
  --archive=backups/mongodb/<archive>.archive.gz \
  --target-uri="mongodb+srv://<user>:<pass>@<staging-cluster>/"
# after reviewing the plan:
node scripts/restore-database.js --apply --confirm-restore \
  --archive=backups/mongodb/<archive>.archive.gz \
  --target-uri="mongodb+srv://<user>:<pass>@<staging-cluster>/"
```

The restore CLI refuses:

- `--apply` without `--confirm-restore`;
- any target on the same cluster as the configured `MONGO_URI` (`SOURCE_TARGET_SAME_DATABASE`), whatever
  the operator's `NODE_ENV`, because `mongorestore --archive` restores into the database names stored in the archive;
- production restores unless `DR_ALLOW_PRODUCTION_RESTORE=true` **and** `--allow-production-restore` are both set.

After the drill, verify on staging: booking, payment, invoice, refund and audit-log counts match
the source at backup time; an admin can sign in; and a known booking reference resolves. Record
the drill date, archive checksum, measured restore time (compare with the RTO) and operator in the
team's operations log, and create a restore plan from **Admin → Disaster Recovery** with the drill
reference as the reason so the attempt appears in the restore history.

## Production restore

Production restore needs explicit business approval. Use the same CLI with
`DR_ALLOW_PRODUCTION_RESTORE=true` set temporarily on the operator host plus
`--allow-production-restore`, take a fresh backup first, and unset the override immediately afterwards.
