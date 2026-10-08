#!/bin/bash

# Clockwize launcher
# Opens the installed desktop app (window + Dock icon + menu-bar timer).
# Without it, falls back to the development servers in the browser.

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

if [ -d "/Applications/Clockwize.app" ]; then
    open -a "/Applications/Clockwize.app"
    exit 0
fi

echo "Clockwize.app is not installed - install it with: npm run desktop:install"
echo "Starting the development servers instead..."

if [ ! -d "node_modules" ]; then
    npm run install:all
fi

npm run dev &
DEV_PID=$!
trap 'kill $DEV_PID 2>/dev/null' SIGINT SIGTERM EXIT

# Vite serves the client on 5001 (5000 is taken by macOS AirPlay)
for i in {1..30}; do
    if curl -s http://localhost:5001 > /dev/null 2>&1; then
        open http://localhost:5001
        break
    fi
    sleep 1
done

echo "Clockwize is running at http://localhost:5001 - press Ctrl+C to stop."
wait $DEV_PID
