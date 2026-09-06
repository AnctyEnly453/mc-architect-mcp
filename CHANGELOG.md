# Changelog

## 0.9.1

- Publish the current MC Engineer workflow in the existing MC Architect MCP repository.
- Replace legacy construction tools with persistent named workspaces, module editing, incremental plans, staged deployment, recovery journals, and real redstone testing.
- Add opt-in redstone-only acceleration, parallel wire-network solving, and measured throughput.
- Keep the physical-computer terminal optional: unbound saves receive a short F8 message, with no operation panel or fabricated readings.
- Validate current world/dimension and physical control/probe availability before opening or operating the terminal. Hide stale readings when the circuit becomes unavailable.
- Add a portable keyboard-binding script for compatible existing circuits; do not distribute local save bindings, private configurations, recordings, or demo-world artifacts.
- Update Chinese/English setup documentation and CI for Node.js 22 and Java 21.

This release changes the MCP interface from 0.5. Update the mod and bridge together. Legacy scripts and undo records are not migrated into the new workspace format.
