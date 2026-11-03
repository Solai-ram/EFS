#!/bin/sh
# One-time (or repeat-safe) import of voice files into the running backend volume.
#
# On production server (from repo root):
#   chmod +x backend/scripts/importUploadsToVolume.sh
#   ./backend/scripts/importUploadsToVolume.sh                    # from backend/uploads on host
#   ./backend/scripts/importUploadsToVolume.sh /path/to/backup    # from a backup folder
#
# Copies into mapims_efs_backend:/app/uploads/ (Docker volume mapims_efs_uploads_data).

set -e

CONTAINER="${EFS_BACKEND_CONTAINER:-mapims_efs_backend}"
SRC="${1:-$(dirname "$0")/../uploads}"

if [ ! -d "$SRC" ]; then
  echo "Source directory not found: $SRC" >&2
  exit 1
fi

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "Container not running: $CONTAINER" >&2
  exit 1
fi

echo "Importing uploads from: $SRC"
echo "Into container: $CONTAINER:/app/uploads/"
docker cp "$SRC/." "$CONTAINER:/app/uploads/"
echo "Done. Files in volume:"
docker exec "$CONTAINER" sh -c 'find /app/uploads -type f | wc -l' | xargs -I{} echo "  {} file(s)"
