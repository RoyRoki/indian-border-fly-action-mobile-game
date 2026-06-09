#!/usr/bin/env bash
# Build the Rust engine to WASM and stage it next to the web assets.
set -euo pipefail
cd "$(dirname "$0")"

# Prefer the rustup-managed toolchain (has the wasm32 target); Homebrew's
# standalone rust does not ship wasm32 std.
if [ -x /opt/homebrew/opt/rustup/bin/cargo ]; then
  CARGO=/opt/homebrew/opt/rustup/bin/cargo
elif [ -x "$HOME/.cargo/bin/cargo" ]; then
  CARGO="$HOME/.cargo/bin/cargo"
else
  CARGO=cargo
fi

"$CARGO" build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/indian_border_fly_action_mobile_game.wasm web/game.wasm
echo "Built: web/game.wasm ($(du -h web/game.wasm | cut -f1 | tr -d ' '))"
echo "Run:   python3 -m http.server 8080 -d web   →  http://localhost:8080"
