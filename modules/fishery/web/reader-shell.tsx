// Legacy reader routes retain private responses while resolving their main-site destination.
export const readerHeaders=()=>({"Cache-Control":"private, no-store","X-Robots-Tag":"noindex, nofollow"});
