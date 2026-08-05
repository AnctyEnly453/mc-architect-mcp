# Local protocol

The Fabric mod listens on `127.0.0.1` only. The default port is `8765`. Every request except `/v1/health` requires:

```text
Authorization: Bearer <token>
```

The token and port are stored in Minecraft's `config/mcarchitect.json`.

## Endpoints

### `GET /v1/health`

Returns mod and world availability. It does not expose world data and requires no token.

### Client and title-screen endpoints

- `GET /v1/ui`: current screen and local-world state.
- `GET /v1/worlds`: compatible single-player save summaries.
- `POST /v1/open-world`: starts a save using `{ "levelId": "World Folder" }`.
- `POST /v1/disconnect`: saves and returns to the title screen.
- `POST /v1/screenshot`: writes the current framebuffer to a controlled PNG path.

### Camera inspection endpoints

- `POST /v1/camera/begin`: saves position, dimension, rotation, game mode, and FOV; `{ "spectator": true }` enters spectator mode.
- `POST /v1/camera/move`: accepts optional `position`, `yaw`, `pitch`, and `fov` fields while a camera session is active.
- `POST /v1/camera/restore`: restores the complete saved player state and ends the camera session.

Only one camera session may be active. FOV is limited to 30-110 and pitch to -90 through 90 degrees. Disconnecting clears an abandoned camera session and restores its FOV.

### `GET /v1/context`

Returns the first local player's position, rotation, dimension, and game mode.

### `POST /v1/fill`

Fills an inclusive cuboid with one block state and creates an undo transaction.

```json
{
  "from": { "x": 0, "y": 64, "z": 0 },
  "to": { "x": 9, "y": 68, "z": 9 },
  "block": "minecraft:stone_bricks"
}
```

Block IDs may include state properties, for example `minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]`. Operations are limited to 262,144 unique blocks, must remain inside loaded chunks, and may not overwrite or place block entities.

### `POST /v1/scan`

Scans an inclusive loaded region using one of five modes:

- `summary`: elevation and slope statistics, natural/water/tree/artificial coverage, and up to eight connected flat-area candidates.
- `heightmap`: per-column surface heights, surface block states, and terrain classes encoded as RLE in `z,x` order.
- `collision`: RLE cells classified as `standable`, `passable`, or `blocked` using actual block collision shapes.
- `lighting`: block-light and sky-light histograms plus dark standable cells and conservative zero-light spawn-risk candidates.
- `full`: the original exact block-state palette and RLE runs in `y,z,x` order with X changing fastest.

```json
{
  "from": { "x": 0, "y": -64, "z": 0 },
  "to": { "x": 127, "y": 318, "z": 127 },
  "mode": "summary"
}
```

The HTTP compatibility default is `full` when `mode` is omitted. The MCP tool defaults to `summary`. Surface modes accept up to 262,144 X/Z columns; `collision`, `lighting`, and `full` accept up to 262,144 blocks. Terrain classes are conservative heuristics based on the top block and fluid state, so `artificial` indicates likely construction rather than a guaranteed structure boundary.

### `POST /v1/access`

Searches actual loaded-world collision geometry from one player-feet cell to as many as 32 goals. The request contains `from`/`to` search bounds, `start`, `goals`, and optional `height`, `maxStepUp`, `maxDrop`, and `maxVisited`. The response returns reachability, paths, closest reachable cells for failures, visited count, and whether the search limit was reached.

The search is conservative and block-cell based. It respects actual open/closed collision states but does not reproduce sprint-jumps, crawling, swimming, or every partial-block movement edge case.

### `POST /v1/compare`

Expands up to 256 blueprint cuboids and compares their final desired states directly with loaded world blocks. It returns counts and bounded samples for `missing`, `unexpected`, and `state-mismatch` cells. Set `ignoreState` to compare base block IDs only and `maxDifferences` to control returned samples. Include explicit air operations when unexpected solids inside reserved space must be detected.

### `POST /v1/apply`

Atomically applies up to 256 cuboids as one transaction:

```json
{
  "label": "west wing shell",
  "operations": [
    { "from": { "x": 0, "y": 64, "z": 0 }, "to": { "x": 12, "y": 64, "z": 12 }, "block": "minecraft:stone_bricks" }
  ]
}
```

Set `dryRun` to `true` to return exact bounds, requested and changed block counts, placement and overwrite materials, unloaded chunks, block entities, and player collisions without modifying the world. Set `projectId` to group contiguous transactions for project-level undo.

Construction is idempotent: if a neighbor update or earlier operation has already produced the requested target state, that cell counts as successful rather than a rejected change. A background job whose complete target already exists returns an immediately complete successful result.

### Editing endpoints

- `POST /v1/transform`: copies a region to `target` with optional 0/90/180/270 rotation, X/Z mirror, array copies, spacing, air copying, preview, and project grouping. Directional block states rotate and mirror with the structure.
- `POST /v1/replace`: replaces matching block IDs or exact states inside a region, with preview and project grouping.

### Persistent build jobs

- `POST /v1/jobs`: starts one persistent background job from blueprint operations.
- `GET /v1/jobs/status`: returns active job progress.
- `POST /v1/jobs/control`: accepts `pause`, `resume`, or `cancel`.

Jobs change up to 2,048 blocks per server tick. The immutable plan and progress checkpoint are stored in the save. After a crash or restart, an unfinished job is recovered paused and must be explicitly resumed. Cancel restores blocks from the saved checkpoint. A completed job becomes a normal persistent undo transaction.

### `GET /v1/transactions`

Lists persistent transactions newest first with labels, dimensions, changed block counts, and optional project IDs.

### `POST /v1/undo`

Undoes the newest transaction, a named newest transaction, or the newest contiguous project when `projectId` is supplied.

```json
{ "transactionId": "optional-uuid" }
```

The newest 100 transactions are stored as compressed journals inside the save and survive Minecraft restarts. Only the newest transaction or newest contiguous project can be undone, preserving stack order.

## Parameterized geometry tools

The MCP bridge builds circles/discs, curved walls, domes, and spiral stairs by compiling geometry into the existing atomic blueprint endpoint. Contiguous rows are compressed into cuboids. A shape is rejected before construction when it would exceed 256 cuboids; successful shapes remain one undo transaction. Stair blocks used by the spiral tool receive a tangent-facing state when the caller supplies a bare stair block ID.
