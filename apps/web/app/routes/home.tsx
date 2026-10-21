import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/home";
import type { PoolResponse, TimelineResponse } from "@aihot/contracts/site";
import { cachedPage, loadOr404 } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { filterParams, hasFeedFilters, itemListLd, listPath, pageMeta, readFilters, siteLd } from "../lib/seo";
import { HOME_LABEL, inNav } from "../components/shell/nav";
import type { Screen } from "../components/shell/screens";
import { Timeline } from "../features/feed/Timeline";
import { DayList, Pagination } from "../features/feed/DayList";
import { EmptyState } from "../components/ui/Page";
import { HotTopics } from "../features/feed/HotTopics";
import { ActiveFilters, CategoryTabs, FeedBar, SearchField } from "../features/feed/Filters";

export const handle: Screen = { tab: "featured", name: HOME_LABEL };
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  // Search lives on /all; keep the parameters so old links still land on results.
  if (q && q.trim()) throw redirect(`/all${url.search}`);
  const filters = readFilters(url.searchParams);
  const upstream = new Headers();
  const data = await loadOr404<TimelineResponse>(listPath("/api/site/timeline", filterParams(filters)), { responseHeaders: upstream, signal: request.signal });
  if (data.cards.length > 0) return cachedPage(60, { mode: "timeline" as const, data, filters }, upstream);
  // Qualified references can be readable before any report earns a selected timeline seat.
  // Keep their original publication/collection dates and selection state from the shared pool.
  const page = Math.min(Math.max(Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1, 1), 50);
  const pool = await loadOr404<PoolResponse>(listPath("/api/site/pool", { ...filterParams(filters), page: page > 1 ? page : null }), { responseHeaders: upstream, signal: request.signal });
  return cachedPage(60, { mode: "pool" as const, data: pool, filters }, upstream);
}

export function meta({ loaderData }: Route.MetaArgs) {
  const page = loaderData?.mode === "pool" ? loaderData.data.page : 1;
  const path = listPath("/", { ...(loaderData ? filterParams(loaderData.filters) : {}), page: page > 1 ? page : null });
  const titles = loaderData?.mode === "pool" ? loaderData.data.items.map(i => i.title) : loaderData?.data.cards.map(c => c.item.title) ?? [];
  return pageMeta({ path, noindex: hasFeedFilters(loaderData?.filters), jsonLd: path === "/" ? [...siteLd(), itemListLd("/", loaderData?.mode === "pool" ? "行业动态与资料" : "精选", titles)] : undefined });
}

export default function Home() {
  const loaded = useLoaderData<typeof loader>();
  const { filters } = loaded;
  const title = filters.tag ? `#${filters.tag}` : loaded.mode === "pool" ? "行业动态与资料" : "精选";
  return (
    <div className="pb-6">
      {/* Phones: the bar (精选 | 全部, filter, search), the filter in use, today's hot topics, the feed. */}
      <FeedBar featuredLabel={loaded.mode === "pool" ? "动态与资料" : undefined} base="/" category={filters.category} channel={filters.channel} />
      <ActiveFilters base="/" category={filters.category} channel={filters.channel} tag={filters.tag} />
      <div className={loaded.mode === "pool" ? "mt-3 lg:mt-0" : "hidden lg:block"}>
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">{title}</h1>
        <div className="mb-5 mt-4 hidden lg:flex items-center justify-between gap-4">
          <CategoryTabs base="/" category={filters.category} channel={filters.channel} layoutId="home-cat-desk" className="min-w-0" />
          <SearchField keep={{ category: filters.category }} />
        </div>
      </div>

      {loaded.mode === "pool" ? (
        <>
          <p className="mb-5 mt-2 text-[13px] leading-relaxed text-ink-3">按实际收录展示，尚未标为精选。资料的收录时间不代表原文发布或更新；历史依据与适用条件请核对原文。</p>
          {loaded.data.items.length > 0 ? <DayList items={loaded.data.items} /> : <EmptyState title="暂无相关资讯与资料">这个筛选下暂时没有可读内容，可切换分类或使用搜索。</EmptyState>}
          <Pagination page={loaded.data.page} pageCount={loaded.data.pageCount} href={page => listPath("/", { ...filterParams(filters), page: page > 1 ? page : null })} />
        </>
      ) : (
        <>
          {loaded.data.hot && inNav("/hot") && <HotTopics entries={loaded.data.hot} />}
          <Timeline initial={loaded.data} filters={loaded.data.filters} />
        </>
      )}
    </div>
  );
}
