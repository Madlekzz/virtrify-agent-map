# Field mapping

## Asana section → `status`

Match case-insensitively on the section name.

| Asana section (as seen in the project) | `status` | Colour |
|---|---|---|
| Idea / IDEAS | `Idea` | `#96968f` |
| Working on it / WORKING ON IT | `Building` | `#ea5b0c` |
| Waiting for feedback / WAITING FOR FEEDBACK OR APPROVAL | `Review` | `#f0b232` |
| Live / Done | `Live` | `#3ecf72` |
| Fixing / FIXING | `Fixing` | `#e5484d` |

Mapped sections get `statusMapped: true`. A section not in this table (currently `ACTIVE` and `To do List - 5 minutes`) keeps its Asana name verbatim as `status`, gets `statusMapped: false` and `cs: null`, and is listed in `source.shapeChanges.unmappedSections`. It needs a colour in `DOT` and a column in `colDef` in the Claude Design dashboard before it renders properly — don't guess a mapping.

## Custom fields → fields

| Asana | JSON | Notes |
|---|---|---|
| Department | `seat`, `dept` | Must match a canon department name exactly (list below) |
| Category | `cat` | Agent / Skill / Automation / Deliverables / Idea; missing → `Unset` |
| Platform | `platform` | Claude / Viktor / GrokBot / Netlify / Asana / Google Drive; missing → `Unset` |
| Owner | `owner` | Verbatim, including multiple owners; missing → assignee name; neither → `Unassigned` |
| — | `initials` | First owner's initials, uppercase; `Unassigned` → `—` |
| `num_subtasks` | `subs` | |
| `notes` | `prompt` | 2–3 sentences, the task's real scope, in the dashboard's voice. Empty notes → `"Logged in Asana, no scope written yet."` |
| `permalink_url` | `url` | Fallback: `https://app.asana.com/1/1207327179702218/project/1215967034683172/task/<gid>` |
| `modified_at` | `lastRun` | `"Updated Sep 10"` (en-US short month + day, UTC) |

Duplicate custom fields: some tasks carry two `Department` fields (gid `1218361443737496` vs `1211678013530219`) or two `Status` fields. Use the `Department` field that is present on every task in the project and whose values match canon names; ignore the other and record the conflict in `shapeChanges.duplicateCustomFields`. `Status` custom fields are never used — status comes from section membership.

## Derived fields

**`cls`** — data class by department: Finance → `D` · Recruitment, Onboarding → `E` · Innovation Lab, Marketing → `B` · everything else → `C`.

**`locked`** — `true` when `platform` is Viktor or GrokBot and `cls` is not `A`. Neither tool is cleared above class A, so those agents render as *Blocked*.

**`cs`** — 4 Cs readiness bars from status: Idea `[1,0,0,0]` · Building `[1,1,0,0]` · Review and Fixing `[1,1,1,0]` · Live `[1,1,1,1]` · unmapped `null`.

**`conns`** — all seven keys always present, value `0`/`1`. If a **Connectors** custom field exists, read it. Otherwise infer from the notes (case-insensitive):
- `Google Workspace (Virtrify Brain)` — brain, google drive/doc/workspace/sheet
- `Asana` — asana, ticket, subtask
- `Slack` — slack
- `Gmail` — email, gmail, inbox
- `Google Calendar` — calendar, meeting invite
- `GoHighLevel` — gohighlevel, ghl, crm
- `Fathom / Fireflies` — fathom, fireflies, transcript, recording

**`runs`** — Asana history, not execution history, `[what, when]` pairs in this order, skipping ones that don't apply:
`["Completed in Asana", "<Mon D>"]` · `["Section · <section name verbatim>", "current"]` · `["<n> subtask(s) on the task", "in Asana"]` · `["Due", "<Mon D>"]` · `["Last activity in Asana", "<Mon D>"]`.

## Departments

Nine, from the Brain. Technology and Marketing may have zero Asana tasks and still exist — an empty seat is information.

Leadership · Sales · Account Management · Recruitment · Onboarding · Finance · Innovation Lab · Technology · Marketing

If the Canon Index lists a different set, the Canon Index wins — record it as a shape change.

## Schema

```
{
  source: {
    project: "AI Agents Implementation Project",
    url: "https://app.asana.com/1/1207327179702218/project/1215967034683172",
    syncedAt: "YYYY-MM-DD",
    label: "Asana · synced Mon D, YYYY",
    counts: { tasks, sections, departments },          // distinct sections / departments among the tasks
    canon: { version, updated, owner, doc },           // from the Canon Index page; doc = "Virtrify Brain — Canon Index"
    shapeChanges?: { unmappedSections?, unknownDepartments?, unknownPlatforms?,
                     unknownCategories?, duplicateCustomFields?, canonRevision?, note },
    govNote?: "…"                                      // carried over from previous feed
  },
  bots: [ { id, asanaGid, name, seat, dept, cat, platform, owner, initials,
            status, statusMapped, cls, cs, locked, lastRun, subs, prompt,
            conns: {…7 keys}, runs: [[what, when]], url } ],
  gov:      [ [tool, "✓"|"✗", note, classes, blocked] ],  // carried over from previous feed
  activity: [ [text, when, dotColor] ],
  scheduled:[ [what, when] ]
}
```

`id` is `"a" + asanaGid` — stable across syncs, which keeps a user's local edits and open panels attached to the right agent. Order `bots` as Asana returns them.

`activity` — real dated events only, newest first, max 8:
1. `["Fleet synced from Asana · <n> tasks, <d> departments", "today", "#3ecf72"]` (always first)
2. Tasks completed since the previous sync: `["<name> completed", "<Mon D>", "#3ecf72"]`
3. Newly blocked (locked) agents: `["<name> blocked · <platform> not cleared above class A", "open", "#e5484d"]` (if none new, keep the first currently-blocked one)
4. `["Canon Index <version>", "<updated>", "#ea5b0c"]`
5. Project status note, whitespace-collapsed, max 90 chars: `[text, "project status", "#96968f"]`

`scheduled` — real due dates and cadences only: open-task due dates (`["<name> · due", "YYYY-MM-DD"]`, soonest first, not in the past), and the canon review cadence as stated on the Canon Index page. No invented deadlines.
