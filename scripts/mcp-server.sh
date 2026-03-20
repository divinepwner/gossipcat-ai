#!/bin/bash
cd "$(dirname "$0")/.."
exec npx ts-node -r tsconfig-paths/register -P tsconfig.json apps/cli/src/mcp-server.ts
