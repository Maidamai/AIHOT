import { redirect } from "react-router";
import { adminGet } from "@aihot/web/lib/admin.server";
import type { LoaderArgs } from "@aihot/web/lib/route-types";
import topics from "../../../industry/topics.json";
import { readerHeaders } from "./reader-shell.tsx";

export const headers=readerHeaders;
export async function loader({request}:LoaderArgs) {
  await adminGet<unknown>(request,"/api/admin/me");
  const topicId=new URL(request.url).searchParams.get("topicId");
  const topic=topics.topics.find(topic=>topic.slug===topicId);
  throw redirect(topic?`/topics/${encodeURIComponent(topic.slug)}`:"/topics",{headers:readerHeaders()});
}
export default function BusinessTopics(){return null;}
