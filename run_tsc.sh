#!/bin/bash
cd /c/chandra-1212-main/playwright-crx-enhanced/backend
node node_modules/typescript/lib/tsc.js --noEmit 2>&1 | tail -60 > /c/chandra-1212-main/tsc_out.txt
echo "EXIT:$?" >> /c/chandra-1212-main/tsc_out.txt
