# Local configuration and optional adapters

The setup script creates ignored local `config/*.json` files from the safe examples. It preserves existing files. Export environment variables in your shell; `.env.example` is documentation, not an automatically loaded file. Public-hostname pages remain read-only; the local server binds to 127.0.0.1.

| Capability | Setup |
| --- | --- |
| Core host | Node 22.13+, `npm ci`, `npm run setup`, `npm run build`, `npm start` |
| Search | Docker Engine; start the `search` compose service. Fixed loopback port 8082. Setup generates a unique SearXNG local secret. Public searches are sent to search engines. |
| Documents | Start `documents` with compose profile `full-documents`. CPU service uses up to 3 GB RAM and persistent model storage. First conversion may download public models. Fixed loopback port 5001. |
| Native extraction / research exports | Python 3.11+, `pip install -r requirements.txt`; set `COMMAND_DECK_PYTHON` to the interpreter. Native image OCR uses Windows with an installed language pack. Docling is preferred. |
| Local reasoning | Install Ollama, `ollama pull deepseek-r1:1.5b`. The bundled Python stdio MCP harness starts automatically. Set `COMMAND_DECK_DEEPSEEK_PLUGIN` only to override its directory. No hosted model API key is used. |
| Knowledge | Default vault is `data/vault`; set `COMMAND_DECK_VAULT` to an existing local vault to use your own notes. Uploaded content stays in review until explicitly approved. |
| Website checks | `npx playwright install chromium` on Linux; installed Edge is used on Windows. Register only exact website/project URLs you own. Live checks are read-only. |
| Backups | Restic runs through Docker. Select a local destination under Operations → Recovery → Advanced settings. Encryption credentials remain in ignored local data. Recovery tests use a separate target folder. |
| Dependency scan | Trivy runs through Docker. Register a real local project folder before scanning. Missing images/dependencies report unavailable. |
| Host malware scan | Windows Defender is the host scanner; the audit adapter can also use a separately installed web-audit project. This is not a malware-execution sandbox. |
| North Star | Requires an independently installed studio exposing `server/index.ts` through tsx and `/api/health` in local mode. Register it as `northstar`, install/build its dependencies, and use the section. The adapter launches it on 8790 with `NORTHSTAR_LOCAL_ONLY=1`. |
| Web audit | Install a compatible checkout with `webaudit.py`; register its folder as `malware-lab` or set `COMMAND_DECK_WEBAUDIT_DIR`. Follow that program's dependency/install instructions. |
| Packet detector | Install a compatible `ddos_detect` Python module and its dependencies; register its folder as `ddos-detector`. The adapter starts `python -m ddos_detect serve` on 8787. Packet capture may need local OS permissions. |
| Volunteer source | Set `COMMAND_DECK_CHURCH_DB` to a separately prepared synthetic SQLite source with `members(id,group_id,display_name)`, using group `synthetic-group`. No member records ship in this repository. Device access is scoped and revocable. |
| Production/cloud | Starts empty. Add your own app metadata to generated `production.json` and `operations.json`. Provider/Discord secrets are optional server-side environment variables and are never required for ordinary local tools. Roles describe responsibilities, not continuously running agents. |
| Trading | Offline adapters require a separately installed historical research project. No broker execution is enabled. Official source collection is separate from validation and does not establish profitability. |

Missing optional programs produce a clear unavailable/needs-setup result; the host does not substitute synthetic success. Synthetic fixtures are used only by tests.
