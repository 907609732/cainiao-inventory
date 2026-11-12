// Shared delivery boundary: collection-only acceptance must never contact a provider.
export async function deliverInventoryReport({collectOnly=false,daily,runId,buildReport,sendReport,isAccepted=result=>result?.accepted===true}) {
 if(collectOnly){
  const result={skipped:true,reason:'explicit-collect-only'};
  daily.updateRun(runId,{deliveryStatus:'skipped',deliveryReceipt:JSON.stringify(result),finishedAt:new Date().toISOString()});
  return result;
 }
 const report=buildReport();
 daily.updateRun(runId,{deliveryStatus:'unknown'});
 const result=await sendReport(report);
 const accepted=result?.channels?result.accepted:isAccepted(result);
 daily.updateRun(runId,{deliveryStatus:result?.skipped?'skipped':accepted?'accepted':'unknown',...(accepted?{sentAt:new Date().toISOString()}:{}),deliveryReceipt:JSON.stringify(result).slice(0,2000)});
 if(!accepted&&!result?.skipped)throw Error('通知渠道未全部确认受理，请检查各渠道的服务商发送记录');
 return result;
}
