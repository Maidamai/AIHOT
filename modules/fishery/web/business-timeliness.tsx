import { useEffect, useState } from "react";
import { addDays, beijingDate, beijingMidnight } from "@aihot/contracts/time";
import { BUSINESS_FIELD_STATE_LABELS, type BusinessGuidePayload, type BusinessGuideReaderItem } from "../business-contracts.ts";
import { businessTimelinessGuidance, projectBusinessTimeliness } from "../business-timeliness.ts";

// Only these business pages refresh their date projection; no request or model call is needed.
export function useBusinessNow(checkedAt:string) {
  const [now,setNow]=useState(()=>new Date(checkedAt));
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>;
    const refresh=()=>{
      clearTimeout(timer);
      const current=new Date();setNow(current);
      const nextMidnight=beijingMidnight(addDays(beijingDate(current),1)).getTime();
      timer=setTimeout(refresh,Math.max(1,nextMidnight-current.getTime()+50));
    };
    const visible=()=>{if(document.visibilityState==="visible")refresh();};
    refresh();window.addEventListener("focus",refresh);document.addEventListener("visibilitychange",visible);
    return ()=>{clearTimeout(timer);window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",visible);};
  },[checkedAt]);
  return now;
}
export function BusinessTimeliness({item,now}:{item:BusinessGuideReaderItem;now:Date}) {
  const t=projectBusinessTimeliness(item.payload.dates,now,item.payload.topicId),elapsed=t.expiry.state==="elapsed"||t.deadline.state==="elapsed";
  const day=beijingDate(now);
  const missingDate=(date:BusinessGuidePayload["dates"]["deadline"])=>`${BUSINESS_FIELD_STATE_LABELS[date.state??"unknown"]}（${date.reason||"尚无已采纳证据"}）`;
  return <div className="business-timeliness" data-elapsed={elapsed||undefined} role="status" aria-label="文载时效与适用状态">
    <strong>{t.label}</strong>
    <p>{elapsed?"仅供历史参考。":"文载日期比较仅用于核对时效。"}{businessTimelinessGuidance(item.payload.topicId)}</p>
    <span>北京时间核对日 {day}{` · 文载截止日期 ${t.deadline.lastDate??missingDate(item.payload.dates.deadline)}`}{` · 文载失效日期 ${t.expiry.lastDate??missingDate(item.payload.dates.expiresAt)}`}</span>
  </div>;
}
