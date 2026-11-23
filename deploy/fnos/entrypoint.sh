#!/bin/bash
set -euo pipefail
umask 077
export HOME=/data/home XDG_CONFIG_HOME=/data/home/.config XDG_CACHE_HOME=/data/home/.cache DISPLAY=:99
mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" /data/browser-profile /tmp/cainiao
chmod 700 "$HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"
if [ -n "${CAINIAO_GATEWAY_SOCKET:-}" ]; then
  gateway_dir="$(dirname "$CAINIAO_GATEWAY_SOCKET")"
  if [ ! -d "$gateway_dir" ] || [ ! -w "$gateway_dir" ]; then
    printf 'fnOS gateway target is not writable by package UID %s: %s\n' "$(id -u)" "$gateway_dir" >&2
    exit 1
  fi
fi
export LINGTU_BROWSER_PATH="$(node --input-type=module -e "import { chromium } from 'playwright'; process.stdout.write(chromium.executablePath())")"
pids=()
cleanup() {
  trap - TERM INT EXIT
  kill -TERM "${pids[@]}" 2>/dev/null || true
  wait || true
}
trap cleanup TERM INT EXIT
Xvfb :99 -screen 0 1440x900x24 -nolisten tcp -ac &
pids+=("$!")
for attempt in {1..100}; do
  [ -S /tmp/.X11-unix/X99 ] && break
  sleep 0.1
done
[ -S /tmp/.X11-unix/X99 ] || exit 1
x11vnc -display :99 -localhost -rfbport 5900 -forever -shared -nopw -quiet &
pids+=("$!")
websockify --web=/usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900 &
pids+=("$!")
cd /app
# The Node service owns the fnOS unified-gateway socket and removes it on SIGTERM.
node windows/workbench/nas/main.mjs &
pids+=("$!")
if [ -n "${CAINIAO_GATEWAY_SOCKET:-}" ]; then
  for attempt in {1..200}; do
    [ -S "$CAINIAO_GATEWAY_SOCKET" ] && break
    sleep 0.1
  done
  if [ ! -S "$CAINIAO_GATEWAY_SOCKET" ]; then
    printf 'fnOS gateway socket did not become ready.\n' >&2
    exit 1
  fi
fi
# Fail the entire container if any essential child dies; Docker restarts the unit.
set +e
wait -n "${pids[@]}"
status=$?
[ "$status" -ne 0 ] || status=1
exit "$status"
