#!/bin/bash
# Wrapper so the preview server can find node/npm even when it launches with a
# minimal PATH (the raw `npm` shebang otherwise fails with "env: node: not found").
set -e

# Prepend common local node install locations if node isn't already on PATH.
for dir in \
  "$HOME/.local/bin" \
  "$HOME/.local/node22/bin" \
  "$HOME/.nvm/versions/node"/*/bin \
  /usr/local/bin \
  /opt/homebrew/bin; do
  [ -x "$dir/node" ] && PATH="$dir:$PATH"
done
export PATH

exec npm run dev
