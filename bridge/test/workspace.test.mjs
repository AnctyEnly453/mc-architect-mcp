import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWorkspace, rotateState } from '../dist/workspace-model.js';
import { WorkspaceStore, atomicJSON } from '../dist/workspace-store.js';
import { workspaceDelta, planWorkspace } from '../dist/workspace-plan.js';
import { compileSuite } from '../dist/circuit-suite.js';
import { deployWorkspace, buildStatus, controlWorkspace } from '../dist/workspace-build.js';
import { previewWorkspace } from '../dist/workbench.js';
const p = (x,y=0,z=0) => ({x,y,z});
const block = (x,state='minecraft:stone') => ({from:p(x),to:p(x),block:state});
const source = () => ({format:'mcengineer/workspace/1',projectId:'test',name:'Test',worldId:'world',dimension:'minecraft:overworld',modules:[{id:'a',name:'A',operations:[block(0)]}]});
const revision = source => ({id:'test',source});
async function store() { return new WorkspaceStore(await mkdtemp(join(tmpdir(),'mcengineer-'))); }
test('nested module transforms rotate geometry, component facing and bus sample direction',()=>{
  const s=source();s.origin=p(100,64,0);s.modules=[{id:'root',name:'Root',rotation:90},{id:'child',name:'Child',parent:'root',offset:p(2),operations:[block(1,'minecraft:repeater[facing=north,delay=2,powered=false]')],ports:[{id:'out',kind:'output',positions:[p(1)],sample:'north'}]}];
  const m=resolveWorkspace(s);assert.deepEqual(m.operations[0].from,p(100,64,3));assert.match(m.operations[0].block,/facing=east/);assert.equal(m.ports[0].sample,'east');
  assert.equal(rotateState('minecraft:redstone_wire[north=side,east=none,south=up,west=side,power=0]',90),'minecraft:redstone_wire[east=side,north=side,power=0,south=none,west=up]');
});
test('revision history, optimistic edits and restore preserve project identity',async()=>{
  const w=await store();await w.create(source());const first=await w.read();
  await w.edit(1,{moduleId:'a',module:{id:'a',name:'Moved',offset:p(10),operations:[block(0)]}});
  await assert.rejects(w.edit(1,{moduleId:'a',remove:true}),/Stale/);
  await w.edit(2,{restoreRevision:first.id});assert.equal((await w.read()).source.modules[0].name,'A');assert.equal((await w.history()).length,3);
});
test('incremental final ownership restores underlying module and guards removed cells',()=>{
  const old=source();old.modules.push({id:'overlay',name:'Overlay',operations:[block(0,'minecraft:gold_block'),block(2)]});
  const delta=workspaceDelta(revision(source()),revision(old));assert.equal(delta.diff.changed,1);assert.equal(delta.diff.removed,1);
  assert.equal(delta.stages.get('main').expectedOperations[0].block,'minecraft:gold_block');
  assert.equal(delta.stages.get('__remove').operations[0].block,'minecraft:air');
});
test('prepare/deploy/status/rollback adopt revisions only after confirmed completion',async()=>{
  const w=await store();await w.create(source());const a=await planWorkspace(w);let remote='running',calls=[];
  const c={health:async()=>({capabilities:['project-stream-v1','project-guards-v1','assembly-v1']}),project:async r=>calls.push(r),assembly:async r=>{calls.push(r);return {status:remote}}};
  await deployWorkspace(w,c);await assert.rejects(readFile(join(w.directory,'DEPLOYED.json')));
  remote='complete';await buildStatus(w,c);assert.equal(JSON.parse(await readFile(join(w.directory,'DEPLOYED.json'))).revisionId,a.revisionId);
  await controlWorkspace(w,c,'rollback');remote='rolled_back';await buildStatus(w,c);await assert.rejects(readFile(join(w.directory,'DEPLOYED.json')));
  const b=await planWorkspace(w);assert.notEqual(a.id,b.id,'rolled-back immutable plan cannot be reused');
  assert.ok(calls.some(c=>c.action==='upload'));assert.ok(calls.some(c=>c.action==='start'&&c.steps));
});
test('bus suite expands little-endian vectors and checks timing, directions, widths',()=>{
  const s=source();s.modules[0].ports=[{id:'in',kind:'input',positions:[p(0),p(1)]},{id:'out',kind:'output',positions:[p(2),p(3)],sample:'wire'}];
  const suite={name:'bus',bounds:{from:p(0),to:p(3)},inputs:['a.in'],probes:['a.out'],events:[{tick:0,set:{'a.in':2}}],assertions:[{tick:4,port:'a.out',equals:2}],durationTicks:8};
  const spec=compileSuite(s,suite);assert.deepEqual(spec.events[0].set,{'a.in[0]':false,'a.in[1]':true});assert.equal(spec.assertions[1].min,1);assert.equal(spec.probes[0].face,'wire');
  suite.events[0].set['a.in']=4;assert.throws(()=>compileSuite(s,suite),/width/);suite.events[0].set['a.in']=1;suite.durationTicks=2;assert.throws(()=>compileSuite(s,suite),/duration/);
});

test('a 270-chunk physical computer can be tested while oversized regions are rejected',()=>{
  const s=source();s.modules[0].ports=[{id:'out',kind:'output',positions:[p(0)],sample:'wire'}];
  const suite={name:'modular computer',bounds:{from:p(0),to:p(287,300,239)},inputs:[],probes:['a.out'],events:[],assertions:[],durationTicks:1};
  assert.equal(compileSuite(s,suite).bounds.to.z,239);
  suite.bounds.to=p(383,300,271);
  assert.throws(()=>compileSuite(s,suite),/384 chunks/);
});
