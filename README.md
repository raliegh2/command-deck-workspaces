# Command Deck Workspaces

A local, single-user React/Express operations workspace with fast local conversation, a shared tool catalog, SearXNG search and Docling document ingestion. This is a generic source release: no user records, documents, credentials, local source folders, deployment snapshots or historical trading results are included.

## Start

Requires Node.js **22.13+** (built-in SQLite), npm and a browser. Windows is the primary supported host for software inventory, Defender and native OCR. Other hosts can use the portable web/search/document features; Windows-only collectors return unavailable there.

```sh
npm ci
npm run setup
npm run build
npm start
```

Open http://127.0.0.1:8788. No application account is needed. Same-origin token authentication, loopback binding, source-review gates and scoped volunteer pairing remain enabled. The public-hostname view is a read-only empty shell. Do not expose the local backend to the Internet.

## Local search and documents

Install Docker Desktop/Engine, then:

```sh
docker compose -p command-deck-local -f config/local-services.compose.yml up -d search uptime
docker compose -p command-deck-local -f config/local-services.compose.yml --profile full-documents up -d documents
```

Use Tools Workspace → Search or Documents. Upload PDF, DOCX, PPTX, PNG or JPEG (20 MB maximum), process, review and export text. Knowledge import requires explicit review. The assistant receives an explicitly labeled 3,500-character excerpt; full text remains available to copy/export. SearXNG sends search queries to public engines; private knowledge search stays local. An optional native extractor is available with Python 3.11+ and `pip install -r requirements.txt`; Windows OCR also needs an installed language pack.

## Sections

Every `modules/<section>/README.md` documents overview, features, requirements, installation, configuration, usage, integration and troubleshooting. Modules are host-integrated exports with shared server code and root dependencies, not independent services.

- [Overview](modules/overview/README.md) — Review projects and planned work.
- [Operations](modules/operations/README.md) — System readiness, tasks, inventories, diagnostics, data validation and service tickets.
- [Tools Workspace](modules/tools/README.md) — A catalog of every registered tool, with inputs, status and readable results.
- [Search](modules/search/README.md) — Shared SearXNG public search and private knowledge search.
- [Documents](modules/documents/README.md) — Local uploads, Docling extraction, preview, copy, export and reviewed knowledge import.
- [Local assistant](modules/assistant/README.md) — Fast deterministic local tasks, conversation history and bounded DeepSeek MCP assistance.
- [Research desk](modules/research/README.md) — Public research collection, source review, schedules and document/spreadsheet exports.
- [Knowledge](modules/knowledge/README.md) — Private notes, document imports and advanced memory review.
- [Production](modules/production/README.md) — Live website availability, audits and reviewed change requests.
- [Cybersecurity](modules/security/README.md) — Project audits, release readiness, security evidence and synthetic assessment labs.
- [Trading intelligence](modules/trading-intelligence/README.md) — Official release collection and historical research context with execution disabled.
- [Projects](modules/projects/README.md) — Registered local folders, project inspection and reviewed source changes.
- [Agent teams](modules/teams/README.md) — A directory of configured responsibilities and routing roles.
- [North Star](modules/northstar/README.md) — A local bridge to an independently installed website studio.
- [Volunteer sync](modules/volunteers/README.md) — Offline attendance and coordinator tasks with scoped device pairing and conflict checks.

## Optional local adapters

Install Ollama and `ollama pull deepseek-r1:1.5b` for model-assisted reasoning. The bundled `integrations/deepseek/scripts/deepseek_mcp.py` provides the stdio MCP harness; set `COMMAND_DECK_PYTHON` if Python is not on PATH. Quick greetings, arithmetic and explicit local requests require no model. No hosted model or paid fallback is enabled.

North Star, web-audit/malware, packet detection and offline trading projects are optional **separate programs**. Register their actual folders using the Projects UI or generated local config before using them. This release includes their host adapters and schemas, not third-party scanners or a broker. Missing adapters produce explicit unavailable errors. Windows Defender is the host scanner; Trivy and Restic use their Docker images. Offline trading never submits orders. Volunteer sync accepts a separately configured synthetic source database (`COMMAND_DECK_CHURCH_DB`); no congregation database is included.

## Configuration and privacy

`npm run setup` copies `.example.json` files into ignored local config and resolves the host project folder. Production configuration starts empty. Edit `config/production.json` and `config/operations.json` with your own app/provider metadata when needed. Use `.env.example` as a reference and export selected variables in your shell; the app does not automatically load a `.env` file. A token is generated locally under ignored `data/`. Optional integrations and credentials stay on your machine. Never commit data, backups, uploaded files or generated config.

## Verification

```sh
npm run check
npm test
npm run build
```

Tests use synthetic fixtures and temporary local state. Service availability is verified separately; unit tests do not imply installed Docker/Ollama/scanners or valid cloud accounts. `docs/verification.md` describes the actual local end-to-end checks and their limits.
