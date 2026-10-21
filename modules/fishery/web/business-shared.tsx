import type { ReactNode } from "react";
import { dateLabel } from "./shared.tsx";
import "./business.css";
export const BUSINESS_KINDS={business_guide:"业务指南",policy_reference:"政策资料",dynamic_article:"动态文章"};
export function SafeSource({url,children}:{url:string|null|undefined;children:ReactNode}) {
  let safe=false;try{safe=["https:","http:"].includes(new URL(url??"").protocol);}catch{}
  return safe?<a href={url!} target="_blank" rel="noopener noreferrer">{children} ↗</a>:<span>{children}（链接待确认）</span>;
}
export function BusinessDate({value}:{value:{value:string|null;precision:string}}){return <>{dateLabel(value)}</>;}
export function BusinessUnknown(){return <span className="business-unknown">未知，待确认</span>;}

export function isHistorical(date:{precision:string;value:string|null},reference:string){
  if(!date.value)return false;
  const latest=date.precision==="year"?date.value+"-12-31":date.precision==="month"?new Date(Date.UTC(Number(date.value.slice(0,4)),Number(date.value.slice(5,7)),0)).toISOString().slice(0,10):date.value;
  return Date.parse(reference)-Date.parse(latest+"T00:00:00Z")>=7*86400000;
}
