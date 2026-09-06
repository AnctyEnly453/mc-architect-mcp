# MC Engineer · Minecraft Building MCP

[中文](README.md) · [Downloads](https://github.com/AnctyEnly453/mc-architect-mcp/releases) · [MIT](LICENSE)

A local Fabric mod and MCP server for designing, changing, inspecting, and debugging structures and redstone projects in **Minecraft Java 1.21.11 single-player worlds**. Previously named MC Architect MCP; the repository URL and `mcarchitect` mod ID remain unchanged.

**Version 0.9.1 works in ordinary saves. No prebuilt redstone computer is required.**

## Features

- Persistent, named modules with local coordinates, hierarchy, rotation, and reusable templates.
- Offline design previews and incremental construction plans.
- Construction in stages and chunks, with pause/resume, restart recovery, conflict checks, and journal-based rollback.
- Terrain, block-state, collision, lighting, and walkability inspection.
- Temporary spectator cameras, screenshots, and player-view restoration.
- Redstone stimulus sequences, real signal assertions, recovery, and waveforms.
- Optional redstone-only acceleration and parallel wire-network computation.
- An optional physical-computer terminal that opens only when its world-specific binding is available.

Bulk designs live in local JSON files. MCP responses contain summaries, progress, and artifact paths. The Fabric mod performs actual world reads and writes; offline previews do not simulate circuits.

## Installation

Requirements: **Minecraft Java 1.21.11, Fabric Loader 0.18.6+, Fabric API 0.141.3+1.21.11, Java 21+, and Node.js 22+**.

1. Download `mcarchitect-0.9.1.jar` from [Releases](https://github.com/AnctyEnly453/mc-architect-mcp/releases). Put it and the matching Fabric API in your game instance’s `mods` directory, replacing the older mod, then restart Minecraft.
2. Build the MCP bridge:

   ```text
   git clone https://github.com/AnctyEnly453/mc-architect-mcp.git
   cd mc-architect-mcp/bridge
   npm ci
   npm run build
   ```

3. Launch Minecraft and open a single-player world. The mod creates `config/mcarchitect.json` inside that game instance on first launch.
4. Configure your MCP client, replacing the example paths with your own:

   ```toml
   [mcp_servers.mcengineer]
   command = "node"
   args = ["D:/minecraft/mc-architect-mcp/bridge/dist/index.js"]

   [mcp_servers.mcengineer.env]
   MCA_CONFIG = "D:/MinecraftInstance/config/mcarchitect.json"
   ```

`MCA_CONFIG` points to the game instance configuration, not a save. If omitted, the bridge uses the platform’s default `.minecraft/config/mcarchitect.json`. The local HTTP service listens on `127.0.0.1` and uses a random bearer token. Do not publish this configuration file.

To build the mod from source, run `./gradlew build` in `mod/` (`.\gradlew.bat build` on Windows). The JAR is written to `mod/build/libs/`.

## Tools and workflow

| Tool | Purpose |
|---|---|
| `mc_world` | World identity, save list, create/open/close/save, game tick rate |
| `mc_workspace` | Projects, module trees, ports, revision history, interactive previews |
| `mc_edit` | Edit/remove modules, import designs, restore source revisions |
| `mc_build` | Incremental plans, deployment, status, pause, resume, rollback |
| `mc_inspect` | Terrain, states, collision, lighting, and access checks |
| `mc_camera` | Temporary camera, movement, screenshots, player-view restoration |
| `mc_test` | Real redstone inputs, assertions, input recovery, and waveforms |
| `mc_redstone` | Redstone acceleration, wire optimization, measured throughput |
| `mc_keyboard` | Program input and live readings for a bound physical computer |

Start with `mc_world context`, then create a project using the returned world identity. Organize the design into named modules, plan and preview changes, deploy, and poll status. Verify buildings with in-game views and access checks; verify circuits with actual signal tests.

## Saves without a computer

Building does not depend on the computer terminal. Installing the mod does not place a computer, import a demo save, or create a keyboard binding.

- F8 shows a brief message in an unbound save instead of opening an empty terminal.
- The terminal requires a binding for the current world and dimension, loaded controls, and existing redstone-wire probes.
- If chunks unload or components disappear, the panel hides readings and disables operations instead of showing missing signals as zero.
- F8 is remappable in Minecraft’s controls. It opens the optional terminal; building is controlled through MCP.

Compatible computers support `LDI`, `ADD`, `IN`, `OUT`, and `HLT`, with up to eight instructions. Program writes drive physical buttons and physical RAM; the mod does not emulate the CPU in software. See the [binding and port contract](docs/computer-keyboard.md) to connect an existing compatible circuit.

## Redstone acceleration

Acceleration is independent of computer bindings and disabled by default. With permission to run game commands:

```text
/mcengineer redstone 128 8
/mcengineer redstone status
/mcengineer redstone off
```

`128` is the maximum redstone substeps per game tick and `8` is the worker count. Actual throughput depends on workload and budget; world/entity time stays unchanged. Update-order-sensitive circuits and mechanical devices require separate validation. See [implementation and limits](docs/redstone-acceleration.md).

## Examples and development

`bridge/examples/signal-bus/` contains a modular four-bit bus and a test suite. Replace its `worldId` with the current world identity and choose a suitable origin before using it. From `bridge/`:

```text
npm run workspace -- create /path/to/my-bus examples/signal-bus/workspace.json
npm run workspace -- plan /path/to/my-bus
npm run workspace -- preview /path/to/my-bus
```

Previews do not modify the world. This is a workflow example, not a certified circuit library. Run `npm test` in `bridge/` and `gradlew check` in `mod/`; CI checks both components.

## Upgrading from 0.5

The named-project workflow introduced in 0.7 **replaces the old 32-tool interface, atomic blueprint endpoints, and construction scripts**. Update the mod and bridge together and reload your MCP client. Old examples remain in Git history; current work uses `mc_workspace`, `mc_edit`, and `mc_build`.

New deployment journals do not adopt legacy undo records. Existing worlds can still be opened, but future work needs a new local project workspace. The mod ID and authentication configuration remain `mcarchitect`.

## Limits and documentation

The builder handles ordinary blocks and block states, not bulk container/NBT editing, automatic routing, or CPU synthesis. Rollback restores the blocks changed by that deployment, not entity, fluid, or circuit execution history. Construction budgets are soft limits and cannot guarantee overall game performance.

[Workspace and recovery](docs/workspace.md) · [Local API](docs/protocol.md) · [Computer terminal](docs/computer-keyboard.md) · [Changelog](CHANGELOG.md)
