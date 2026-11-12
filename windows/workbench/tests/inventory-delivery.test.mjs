import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverInventoryReport} from '../core/inventory-delivery.mjs';
test('explicit collect-only records skipped delivery without constructing or contacting notification providers',async()=>{
 const audit=[];
 const result=await deliverInventoryReport({collectOnly:true,runId:'DEMO',daily:{updateRun:(id,value)=>audit.push([id,value])},buildReport:()=>{throw Error('no report delivery expected');},sendReport:()=>{throw Error('must not send');}});
 assert.equal(result.skipped,true);assert.equal(audit.length,1);assert.equal(audit[0][1].deliveryStatus,'skipped');assert.equal(audit[0][1].sentAt,undefined);
});
test('normal delivery records unknown before provider call and retains unknown on ambiguous failure',async()=>{
 const audit=[];
 await assert.rejects(deliverInventoryReport({collectOnly:false,runId:'DEMO',daily:{updateRun:(id,value)=>audit.push(value)},buildReport:()=>({title:'DEMO',text:'DEMO'}),sendReport:async()=>{assert.equal(audit[0].deliveryStatus,'unknown');throw Error('timeout');}}),/timeout/);
 assert.equal(audit.length,1);assert.equal(audit[0].deliveryStatus,'unknown');
});
test('confirmed channel receipts are audited without falsely accepting an unknown provider result',async()=>{
 const audit=[];const daily={updateRun:(id,value)=>audit.push(value)};
 await assert.rejects(deliverInventoryReport({daily,runId:'DEMO',buildReport:()=>({title:'DEMO',text:'DEMO'}),sendReport:async()=>({channels:{email:{status:'unknown'}},accepted:false})}),/未全部确认/);
 assert.equal(audit.at(-1).deliveryStatus,'unknown');
});
