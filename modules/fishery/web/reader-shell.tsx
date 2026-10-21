import type { ReactNode } from "react";
import { Link, useLocation, useNavigation } from "react-router";
import "./reader.css";

export function ReaderShell({children}:{children:ReactNode}) {
  const navigation=useNavigation();
  return <div className="fishery-reader">
    <a className="reader-skip" href="#fishery-main">跳到正文</a>
    <header className="reader-masthead"><div className="reader-masthead-inner">
      <Link to="/fishery" className="reader-brand" aria-label="远洋渔业资料预览首页"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="1.2"/><path d="m21 10-3 9-8 3 3-9 8-3Z" stroke="currentColor" strokeWidth="1.4"/><path d="M5 27h22M16 1v4M16 27v4" stroke="currentColor"/></svg><span><strong>远洋渔业资料预览</strong><small>内部阅读</small></span></Link>
      <nav aria-label="资料导航"><Link to="/fishery/topics">经营主题</Link><Link to="/fishery">资料</Link><Link to="/admin/fishery">素材工作台 <span aria-hidden="true">↗</span></Link></nav>
    </div></header>
    <main id="fishery-main" className="reader-main" aria-busy={navigation.state==="loading"}>{children}</main>
    <footer className="reader-footer">仅供内部阅读 · 摘要与短引文均附原文出处 · 不代表经营许可或完整法律适用性结论</footer>
  </div>;
}
export function ReaderError({status}:{status:number}) {
  const location=useLocation(),notFound=status===404;
  return <section className="reader-error"><p className="reader-eyebrow">资料访问 · {status}</p><h1>{notFound?"这份资料暂不可读":"资料暂时无法加载"}</h1><p>{notFound?"资料可能尚未完成内部核对，或原文、许可与版本已经变化。请返回当前资料列表核对。":"请重新加载。持续无法访问时，可到素材工作台查看当前状态。"}</p><div className="reader-actions">{!notFound&&<Link reloadDocument to={location.pathname+location.search}>重新加载</Link>}<Link reloadDocument to="/fishery">返回资料列表</Link></div></section>;
}
export const readerHeaders=()=>({"Cache-Control":"private, no-store","X-Robots-Tag":"noindex, nofollow"});
