export const EXTERNAL_LINKS = Object.freeze({
  repository: "https://github.com/907609732/cainiao-inventory",
  website: "https://lttlt.top"
});

export function externalLink(name) {
  const url = EXTERNAL_LINKS[String(name || "")];
  if (!url) throw new Error("不允许打开未知外部链接");
  return url;
}
