#!/bin/sh
set -e

UPLOADS="/app/uploads"
BUNDLED="/app/uploads-bundled"

mkdir -p "$UPLOADS/feedback-voice" "$UPLOADS/feedback-voice/ai_voice"

# Seed the AI Voice Guide prompts baked into the image, file by file (none ship by default;
# admins upload them on the Bot Conversation screen). Only the prompt folder:
# employee recordings must never ship in the image or be copied from it.
# Never overwrites, so prompts an admin uploaded survive every restart. Not `cp -rn`:
# BusyBox treats an existing directory as "already there" and silently copies nothing.
if [ -d "$BUNDLED/feedback-voice/ai_voice" ]; then
  cd "$BUNDLED"
  find ./feedback-voice/ai_voice -type f | while IFS= read -r file; do
    target="$UPLOADS/${file#./}"
    if [ ! -e "$target" ]; then
      mkdir -p "$(dirname "$target")"
      cp "$file" "$target"
    fi
  done
  cd /app
fi

exec node src/index.js
