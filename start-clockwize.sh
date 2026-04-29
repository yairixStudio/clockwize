#!/bin/bash

# Clockwize Launcher Script
# This script starts the Clockwize application and opens it in the default browser

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Change to the project directory
cd "$SCRIPT_DIR"

# Function to cleanup on exit
cleanup() {
    echo "Stopping Clockwize..."
    # Kill all child processes
    pkill -P $$
    exit 0
}

# Set up trap to catch exit signals
trap cleanup SIGINT SIGTERM EXIT

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Start the application in the background
echo "Starting Clockwize..."
npm run dev &

# Wait for the server to be ready (check for port 5173)
echo "Waiting for server to start..."
for i in {1..30}; do
    if curl -s http://localhost:5173 > /dev/null 2>&1; then
        echo "Server is ready!"
        break
    fi
    sleep 1
done

# Open the browser
echo "Opening browser..."
open http://localhost:5173

# Start Menu Bar app if exists
MENUBAR_APP="$SCRIPT_DIR/ClockwizeMenuBar.app"
if [ -d "$MENUBAR_APP" ]; then
    echo "Starting Menu Bar app..."
    open "$MENUBAR_APP"
fi

# Keep the script running
echo "Clockwize is running. Press Ctrl+C to stop."
wait
