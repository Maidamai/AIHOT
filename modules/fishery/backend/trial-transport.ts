// Fixed cumulative authorization; historical reservations retain their original amounts.
export const TRIAL = Object.freeze({ id:"deepseek-fishery-20261020", maxRequests:20, reserveMicroCny:400_000, maxReservedMicroCny:10_000_000,
  maxWireBytes:12_000, inputTokenCeiling:100_000, maxOutputTokens:2048, endpoint:"https://api.deepseek.com/chat/completions", model:"deepseek-flash", verifiedVersion:"DeepSeek-V4.1-Flash-1017", verifiedAt:"2026-10-20" });
export function validateTrialWire(url:unknown,options:RequestInit|undefined) {
  if(url!==TRIAL.endpoint||options?.method!=="POST"||typeof options.body!=="string"||Buffer.byteLength(options.body)>TRIAL.maxWireBytes) throw new Error("Trial request destination/method/size refused");
  const b=JSON.parse(options.body), allowed=["model","messages","temperature","max_tokens","response_format","thinking"];
  if(Object.keys(b).some(k=>!allowed.includes(k))||b.model!==TRIAL.model||b.max_tokens!==TRIAL.maxOutputTokens||b.thinking?.type!=="disabled"||Object.keys(b.thinking).length!==1||b.response_format?.type!=="json_object") throw new Error("Trial final request parameters refused");
  if(!Array.isArray(b.messages)||b.messages.length!==2||b.messages[0].role!=="system"||b.messages[1].role!=="user"||b.messages.some((m:Record<string,unknown>)=>typeof m.content!=="string"||Object.keys(m).some(k=>!["role","content"].includes(k)))) throw new Error("Only two plain-text messages are permitted");
  return {wireBytes:Buffer.byteLength(options.body),model:b.model as string};
}
export function trialUsage(value:unknown) {
  const u=value as Record<string,unknown>|null;
  if(!u||!Number.isInteger(u.prompt_tokens)||!Number.isInteger(u.completion_tokens)||Number(u.prompt_tokens)<0||Number(u.prompt_tokens)>TRIAL.inputTokenCeiling||Number(u.completion_tokens)<0||Number(u.completion_tokens)>TRIAL.maxOutputTokens) throw new Error("Trial usage missing/invalid/outside reserved bounds; stop");
  // Peak uncached input CNY2/M + output CNY8/M; no cache/idle discount assumed.
  return {promptTokens:Number(u.prompt_tokens),completionTokens:Number(u.completion_tokens),estimatedMicroCny:Number(u.prompt_tokens)*2+Number(u.completion_tokens)*8};
}
export function trialCapacity(entries:{state:string;reservedMicroCny:number}[],requiredCalls=1) {
  if(!Number.isInteger(requiredCalls)||requiredCalls<1||requiredCalls>2) throw new Error("Invalid stage capacity request");
  if(entries.some(e=>!Number.isSafeInteger(e.reservedMicroCny)||e.reservedMicroCny<0)) throw new Error("Trial historical reservation missing/invalid; manual reconciliation required");
  if(entries.some(e=>e.state!=="received")) throw new Error("Trial has pending, refused or unknown outcome; manual reconciliation required");
  if(entries.length+requiredCalls>TRIAL.maxRequests||entries.reduce((sum,e)=>sum+e.reservedMicroCny,0)+requiredCalls*TRIAL.reserveMicroCny>TRIAL.maxReservedMicroCny) throw new Error("Trial hard request/reservation limit reached");
}
export function installTrialTransport(callbacks:{reserve:(wireBytes:number)=>Promise<number>;settle:(id:number,state:"received"|"refused"|"unknown",usage:ReturnType<typeof trialUsage>|null,responseModel?:string|null)=>Promise<void>},transport:typeof fetch=globalThis.fetch) {
  const previous=globalThis.fetch;
  globalThis.fetch=async(input,options)=>{
    const checked=validateTrialWire(input,options),id=await callbacks.reserve(checked.wireBytes);
    let settled=false;
    try {
      // A redirect must never cause a second billable POST or send original text to another host.
      const response=await transport(input,{...options,redirect:"error"});
      const data=await response.clone().json() as {usage?:unknown;model?:unknown};
      if(!response.ok) {await callbacks.settle(id,"refused",null);settled=true;return response;}
      const usage=trialUsage(data.usage);
      await callbacks.settle(id,"received",usage,typeof data.model==="string"?data.model.slice(0,200):null);settled=true;
      return response;
    } catch(error) {if(!settled) await callbacks.settle(id,"unknown",null);throw error;}
  };
  return ()=>{globalThis.fetch=previous;};
}
