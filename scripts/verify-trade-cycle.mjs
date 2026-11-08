/** Offline readiness checks; no exchange orders, production DB changes or deployment. */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
const checks=[
  ['typecheck','npm',['run','typecheck']],
  ['lint','npm',['run','lint']],
  ['tests','node',['--experimental-strip-types','--test',...readdirSync('tests').filter(x=>x.endsWith('.test.mjs')).sort().map(x=>`tests/${x}`),'scripts/fleet-config.test.mjs']],
  ['static_build','npm',['run','build']],
];
let ok=true;
for (const [name,cmd,args] of checks) {
  console.log(`\n--- ${name} ---`);
  const env={...process.env};
  // Build compiles routes, but deliberately cannot be used as a DB connectivity test.
  if(name==='static_build') env.DATABASE_URL='postgresql://unused:unused@localhost:5432/unused';
  const result=spawnSync(cmd,args,{stdio:'inherit',env});
  if(result.status!==0){ok=false;console.error(`${name} failed (${result.status ?? 'process error'})`);}
}
const protection=readFileSync('src/lib/trade-protection.ts','utf8').includes('protected_trade_unavailable');
console.log('\nReadiness:',JSON.stringify({offlineChecks:ok?'passed':'failed',liveTradingBlocked:protection,productionConnectivity:'not tested',migrationsApplied:'not checked',realExchangeTrade:'not tested'}));
// Passing offline checks must not imply the system is ready for live orders.
if(!ok) process.exitCode=1;
