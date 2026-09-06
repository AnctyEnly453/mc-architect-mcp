import {MinecraftClient} from '../dist/client.js';
const [action='status', speed='32', workers='8', budgetMs='20', optimize='true'] = process.argv.slice(2);
if (!['status','configure','disable'].includes(action)) throw Error('Usage: node scripts/redstone.mjs status | disable | configure [speed] [workers] [budgetMs] [true|false]');
const request={action};
if(action==='configure') Object.assign(request,{speed:Number(speed),workers:Number(workers),budgetMs:Number(budgetMs),optimizeWires:optimize!=='false'});
console.log(JSON.stringify(await(await MinecraftClient.create()).redstone(request),null,2));
