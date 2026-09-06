import { readFile } from 'node:fs/promises';
import { MinecraftClient } from '../dist/client.js';
import { WorkspaceStore } from '../dist/workspace-store.js';
import { compileSuite } from '../dist/circuit-suite.js';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node scripts/bind-keyboard.mjs <computer-workspace> [program.txt]');
const client = await MinecraftClient.create();
const head = await new WorkspaceStore(directory).read();
const context = await client.context();
if (context.worldId !== head.source.worldId || context.dimension !== head.source.dimension)
  throw new Error('Open the workspace’s world and dimension before binding its keyboard.');
const inputs = [
  'cpu.run', 'cpu.manual', 'cpu.reset', 'cpu.view', 'cpu.store', 'io.carryIn',
  ...['hi', 'lo'].flatMap(group => Array.from({ length: 16 }, (_, i) => `key_${group}_${i}.press`)),
  ...Array.from({ length: 8 }, (_, i) => `key_addr_${i}.press`),
  ...Array.from({ length: 5 }, (_, i) => `key_op_${i}.press`),
];
const profile = compileSuite(head.source, {
  name: 'Integrated computer keyboard', inputs,
  probes: ['cpu.pc', 'cpu.opcode', 'cpu.out', 'cpu.clock', 'cpu.halt', 'io.qA',
    'terminal.entry', 'terminal.address', 'terminal.read'],
  events: [], assertions: [], durationTicks: 1, sampleEveryTicks: 1,
});
if (process.argv[3]) profile.program = await readFile(process.argv[3], 'utf8');
const status = await client.keyboard({ action: 'bind', profile });
console.log(JSON.stringify({ bound: status.bound, available: status.available, reason: status.reason }, null, 2));
