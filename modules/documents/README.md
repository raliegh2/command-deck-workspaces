# Documents

## Overview
Reusable Documents section for the included local Command Deck host. The source and server dependencies ship in this repository; this is a host-integrated module, not a standalone npm package.

## Features
Local uploads, Docling extraction, preview, copy, export and reviewed knowledge import.

## Requirements
Node.js 22.13 or newer, npm, and a browser. Python 3.11+ with root `requirements.txt` supports document/research exports. Docker Desktop/Engine is required for SearXNG and Docling. Start search with `docker compose -p command-deck-local -f config/local-services.compose.yml up -d search`. Start Docling with `docker compose -p command-deck-local -f config/local-services.compose.yml --profile full-documents up -d documents`.

## Installation
From the repository root run `npm ci`, `npm run setup`, then `npm run build` and `npm start`. Open http://127.0.0.1:8788. Install optional browser binaries with `npx playwright install chromium`; Windows uses installed Edge.

## Configuration
Use the root `.env.example` as a variable reference; export variables in your shell. `npm run setup` creates local config from safe examples without overwriting existing files. Register your own project folders and production URLs. Do not commit generated config or runtime data. See [configuration and adapter prerequisites](../../docs/configuration.md) for service commands, ports, platform limits and optional programs. See [configuration and adapter prerequisites](../../docs/configuration.md) for service commands, ports, platform limits and optional programs.

## Usage
Upload a supported document, select Process document, review the text and export or use it.

## Integration
Entry source: `src/components/WorkspaceDocuments.tsx`. The module entry re-exports this component where applicable. Shared authentication is handled by `src/api.ts`; backend routes are registered by `server/app.ts`, `server/local-api.ts`, `server/workspace-api.ts` and `server/engineering.ts`. Import the module into the host with the matching project/state props defined in its source, and keep the shared CSS and backend routes. Root `package.json` and lockfile contain its JavaScript dependencies. Copy the whole host or preserve these imports when extracting it.

## Troubleshooting
Use Operations to check actual service readiness. If unavailable, start the relevant installed dependency and retry. Check that project folders exist and are registered. Errors remain visible beside the initiating action. The host binds to loopback; opening a LAN/public hostname gives a read-only shell. Source changes and knowledge imports require review. Run `npm run check` and `npm test` for regression checks.
