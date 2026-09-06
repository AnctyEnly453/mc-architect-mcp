import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
// A source generator, never a live-world construction script.
const directory=resolve(process.argv[2]??'examples/signal-bus');await mkdir(directory,{recursive:true});
const p=(x,y=0,z=0)=>({x,y,z}),op=(from,to,block,stage)=>({from,to,block,stage});
const source={format:'mcengineer/workspace/1',projectId:'signal-bus',name:'四位信号总线工作台',worldId:'REPLACE_WITH_WORLD_CONTEXT',dimension:'minecraft:overworld',origin:p(0,64,0),statePolicy:'redstone',
  stages:[{id:'support'},{id:'logic',dependsOn:['support']},{id:'controls',dependsOn:['logic']}],
  templates:{lane:{operations:[op(p(0),p(7),'minecraft:smooth_stone','support'),op(p(1,1),p(6,1),'minecraft:redstone_wire[east=side,north=none,power=0,south=none,west=side]','logic'),op(p(7,1),p(7,1),'minecraft:redstone_lamp[lit=false]','logic'),op(p(0,1),p(0,1),'minecraft:lever[face=floor,facing=north,powered=false]','controls')]}},
  modules:[{id:'bus',name:'4-bit bus',kind:'circuit',ports:[{id:'data',kind:'input',positions:[0,3,6,9].map(z=>p(0,1,z))},{id:'out',kind:'output',sample:'wire',positions:[0,3,6,9].map(z=>p(6,1,z))}]},
    ...[0,1,2,3].map(i=>({id:'lane'+i,name:'Bit '+i,kind:'signal-lane',parent:'bus',template:'lane',stage:'logic',offset:p(0,0,i*3)})),
    {id:'platform',name:'工作台底座',kind:'structure',stage:'support',operations:[op(p(-2,-1,-2),p(10,-1,11),'minecraft:deepslate_tiles','support')]}]};
const values=[0,5,10,15],suite={name:'4-bit bus vectors',inputs:['bus.data'],probes:['bus.out'],events:values.map((v,i)=>({tick:i*8,set:{'bus.data':v}})),assertions:values.map((v,i)=>({tick:i*8+4,port:'bus.out',equals:v})),durationTicks:32,sampleEveryTicks:1};
await writeFile(join(directory,'workspace.json'),JSON.stringify(source,null,2)+'\n');await writeFile(join(directory,'suite.json'),JSON.stringify(suite,null,2)+'\n');console.log(directory);
