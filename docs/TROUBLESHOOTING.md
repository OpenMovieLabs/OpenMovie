# Troubleshooting

| Symptom                             | What to check                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| Core unavailable                    | Restart the app; inspect terminal logs in development; verify packaged files. |
| FFmpeg missing                      | Reinstall a signed build; development can set both explicit Sidecar paths.    |
| Project is locked                   | Close the other process; only take over a verified stale lock.                |
| Runtime database belongs elsewhere  | Restore the correct `.openmovie/state.sqlite`; never reuse another project's. |
| Provider test fails                 | Check HTTPS Base URL, model, key, protocol and provider account policy.       |
| Remote task awaits approval         | Approve it in Overview, or review the project's remote data policy.           |
| Provider budget reached             | Review reported/unpriced usage; version a higher limit or use a local path.   |
| Proposal cannot be accepted         | Project head changed; regenerate against the current Revision.                |
| Video task remains queued           | Inspect Provider job status; cancel/retry after checking provider limits.     |
| Render fails on hardware encoder    | OpenMovie retries LGPL-compatible encoders; attach the bounded error report.  |
| Disk space warning                  | Clear rebuildable Cache, export/archive old projects, keep Object Store data. |
| YAML external edit is not committed | Review Working Changes and create a Revision through the app or MCP.          |
| Plugin does not appear              | Check manifest path delimiter, API version, `plugin.` ID and in-tree Entry.   |

For integrity problems, run deep Project Doctor before changing files. If only the runtime database
is missing, OpenMovie rebuilds minimal state from valid Movie IR. For loss of Task, Take, Feedback or
Revision history, restore a full export/backup instead.

When reporting bugs, include OS/architecture, OpenMovie version, the bounded public error, whether
the project is on a local/network/cloud-synced disk, and a redacted minimal fixture. Never attach API
keys, private media, the settings database or unredacted Provider responses.
