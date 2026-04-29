#!/bin/bash

# Clockwize Menu Bar - Build Script
# This script compiles the Swift source files into a macOS app bundle

set -e

# צבעים להודעות
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}🔨 Building Clockwize Menu Bar${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# תיקיות
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$SCRIPT_DIR/.."
BUILD_DIR="$SCRIPT_DIR/build"
APP_NAME="ClockwizeMenuBar"

# בדיקה אם xcodebuild זמין
if command -v xcodebuild &> /dev/null; then
    echo -e "${YELLOW}📦 Building with xcodebuild...${NC}"
    
    cd "$SCRIPT_DIR"
    
    xcodebuild -project ClockwizeMenuBar.xcodeproj \
        -scheme ClockwizeMenuBar \
        -configuration Release \
        -derivedDataPath "$BUILD_DIR" \
        build 2>&1 | while read line; do
            # סינון פלט לקריאות
            if [[ "$line" == *"error:"* ]]; then
                echo -e "${RED}$line${NC}"
            elif [[ "$line" == *"warning:"* ]]; then
                echo -e "${YELLOW}$line${NC}"
            elif [[ "$line" == *"BUILD SUCCEEDED"* ]]; then
                echo -e "${GREEN}$line${NC}"
            elif [[ "$line" == *"BUILD FAILED"* ]]; then
                echo -e "${RED}$line${NC}"
            fi
        done
    
    # מציאת האפליקציה שנבנתה
    BUILT_APP=$(find "$BUILD_DIR" -name "ClockwizeMenuBar.app" -type d | head -1)
    
    if [ -d "$BUILT_APP" ]; then
        echo -e "${GREEN}✓ Build successful${NC}"
        
        # העתקה לתיקיית הפרויקט
        rm -rf "$PROJECT_DIR/ClockwizeMenuBar.app"
        cp -R "$BUILT_APP" "$PROJECT_DIR/ClockwizeMenuBar.app"
        
        echo ""
        echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${GREEN}✅ Build completed successfully!${NC}"
        echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
        echo -e "App location: ${YELLOW}$PROJECT_DIR/ClockwizeMenuBar.app${NC}"
        echo ""
        echo -e "To run: ${CYAN}open \"$PROJECT_DIR/ClockwizeMenuBar.app\"${NC}"
        exit 0
    else
        echo -e "${RED}✗ Could not find built app${NC}"
        exit 1
    fi
else
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}❌ xcodebuild not found${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "To build the Menu Bar app, you need one of the following:"
    echo ""
    echo -e "${YELLOW}Option 1: Install Xcode from the App Store${NC}"
    echo -e "  After installing, run this script again."
    echo ""
    echo -e "${YELLOW}Option 2: Update Command Line Tools${NC}"
    echo -e "  Run these commands:"
    echo -e "  ${CYAN}sudo rm -rf /Library/Developer/CommandLineTools${NC}"
    echo -e "  ${CYAN}xcode-select --install${NC}"
    echo ""
    echo -e "${YELLOW}Option 3: Open the Xcode project manually${NC}"
    echo -e "  Open: ${CYAN}$SCRIPT_DIR/ClockwizeMenuBar.xcodeproj${NC}"
    echo -e "  Then press Cmd+B to build"
    echo ""
    exit 1
fi
