import { useEffect, useState } from "react";
import { addDays, beijingDate, beijingMidnight } from "@aihot/contracts/time";
import type { BusinessGuideReaderItem } from "../business-contracts.ts";
import { projectBusinessTimeliness } from "../business-timeliness.ts";

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
  const t=projectBusinessTimeliness(item.payload.dates,now),elapsed=t.expiry.state==="elapsed"||t.deadline.state==="elapsed";
  const day=beijingDate(now);
  return <div className="business-timeliness" data-elapsed={elapsed||undefined} role="status" aria-label="文载时效与申请状态">
    <strong>{t.label}</strong>
    <p>{elapsed?"仅供历史参考。":"文载日期尚未经过或未知，不代表申报窗口开放。"}是否可申请、是否可捕捞仍须向主管机关核实。</p>
    <span>北京时间核对日 {day}{t.deadline.lastDate?` · 文载截止日期 ${t.deadline.lastDate}`:" · 截止日期未知"}{t.expiry.lastDate?` · 文载失效日期 ${t.expiry.lastDate}`:" · 失效日期未知"}</span>
  </div>;
}
