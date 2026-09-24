---
name: sync-command-center
description: Rebuild data/asana-fleet.json (the feed the Bot Command Center dashboard in Claude Design reads) from its two systems of record — the AI Agents Implementation Project in Asana and the Virtrify Brain Canon Index in Google Drive — validate it, then commit and push. Use when asked to "sync the command center", "update the bot dashboard", "refresh the fleet from Asana", or when the scheduled sync routine runs.
---

# Sync Bot Command Center (repo edition)

Two sources, zero invention. Every value in the feed traces to Asana or the Brain.

This is the repo-local copy of the `sync-command-center` skill, adapted to this repo:
the dashboard (`Bot Command Center.dc.html`) lives in Claude Design and pulls
`data/asana-fleet.json` from this repo. This repo only holds the feed, so a sync
never edits dashboard code — shape changes are recorded in the feed and reported.

## Sources (fixed)

| What | Where |
|---|---|
| Fleet: agents, status, owners, platforms | Asana project `1215967034683172` — *AI Agents Implementation Project*, workspace `1207327179702218` |
| Canon: departments, docs, owners, cadence | Google Drive · *Virtrify Brain — Canon Index*, doc `12fUUQyseDxQwBygYT1dPSn730tjnwrU0GNbHDbfWpvA` |
| Feed the dashboard reads | `data/asana-fleet.json` |
| Validator | `scripts/validate-feed.mjs` |

Use the Asana and Google Drive MCP connectors. Never use API tokens, never read `.env` files.

## Run it

1. **Snapshot the current feed.** Keep the existing `data/asana-fleet.json` in memory (or copy it to a temp dir outside the repo) — you need it for the diff in step 7 and as the source of fields you are told to carry over.
2. **Pull Asana.** Asana `get_tasks` on project `1215967034683172` with
   `opt_fields=name,completed,completed_at,assignee.name,due_on,modified_at,num_subtasks,memberships.section.name,notes,custom_fields.name,custom_fields.display_value,permalink_url`.
   Page through every result (follow `next_page` / offset) — a partial pull must never be written.
   Then `get_project` on the same project with `current_status.text` — the project status note is the human summary of what moved; mine it for `activity`.
3. **Pull the Brain.** Google Drive `read_file_content` on the Canon Index doc. Read the version line, last-updated date, owner, the folder/owner table and the review cadence off the page. Never re-describe folders from memory — Drive is the record.
4. **Map every task** per `references/field-mapping.md`. A task with no description gets `prompt: "Logged in Asana, no scope written yet."` — never a plausible-sounding invention.
5. **Write `data/asana-fleet.json`** with a single script (node or python) that builds the whole object and writes it once, 1-space indented JSON, UTF-8, no ASCII escaping. Schema in `references/field-mapping.md`.
6. **Validate.** `node scripts/validate-feed.mjs data/asana-fleet.json`. If it exits non-zero, restore the previous feed (`git checkout -- data/asana-fleet.json`), do **not** commit, and report the validator output.
7. **Report** a short diff against the snapshot: counts per status, what moved section, what's new, what disappeared, what's newly blocked (`locked`), and any entries in `source.shapeChanges`.

## Shape changes (record, don't fix)

New data alone needs nothing else — the dashboard renders whatever is in the JSON. A new *kind* of thing needs a dashboard code change in Claude Design, which is out of scope for this repo. When you detect one, record it under `source.shapeChanges` and surface it in the report:

- A section not in the status table → keep the Asana section name verbatim as `status`, `statusMapped: false`, `cs: null`; list it in `shapeChanges.unmappedSections` as `"<Section> (<n> tasks)"`.
- A department not in the nine canon departments → list it in `shapeChanges.unknownDepartments`.
- A platform or category option not in the known lists → `shapeChanges.unknownPlatforms` / `unknownCategories`.
- Duplicate custom fields with the same name and conflicting values on a task → `shapeChanges.duplicateCustomFields` (one sentence per issue naming the tasks and both values; say which one you used).
- Canon Index version changed vs the snapshot → `shapeChanges.canonRevision: "<old> → <new>"` (the dashboard's `DEFAULT_BRAIN` / `BRAIN_VERSION` need a bump in Claude Design).

Always write `shapeChanges.note` explaining in one or two sentences what needs a Level-1 dashboard update. Omit `shapeChanges` entirely when there is nothing to record.

## Commit and push (only when asked — the scheduled routine asks)

1. `git status --porcelain` — if `data/asana-fleet.json` is unchanged, stop: no commit, report "no changes".
2. If the only change is `source.syncedAt` / `source.label` / the "Fleet synced" activity line, that still counts as a sync — commit it, so the dashboard shows the feed is fresh.
3. `git add data/asana-fleet.json` — stage **only** that file. Never stage anything else, never `git add -A`.
4. `git commit -m "sync: fleet from Asana YYYY-MM-DD"` (today's date, UTC).
5. `git push origin HEAD:main`. If the push is rejected because `main` moved, `git pull --rebase origin main` once and push again. Never force-push.

## Rules

- No synthetic telemetry. Asana has no execution data: no run charts, uptime or "hours saved" until the Asana field exists.
- Status vocabulary mirrors Asana's section names. If Asana renames a section, the mapping table is what changes — don't translate it into nicer words.
- One fact, one home: if Asana and the Brain disagree (e.g. a department name or owner), don't pick silently — record it in `shapeChanges` and the report.
- Never invent a number, owner, date or policy. Missing → say so.
- `gov` (tool clearance table) is not re-sourced by this sync: carry over the snapshot's `gov` and `source.govNote` unchanged.
