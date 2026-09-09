/**
 * 灵感 #标签 解析工具
 * - 从输入文本中提取 `#中文标签` / `#tag`，返回去重后的标签数组
 * - 支持中英文、数字、下划线、连字符；标签以空白或标点边界结束
 */

const TAG_RE = /#([\p{L}\p{N}_-]+)/gu;

/** 从文本中提取 #标签（去重、保留原始顺序、去除空标签） */
export function extractTags(text: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(TAG_RE)) {
    const tag = m[1].trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

/** 去掉文本中的 #标签 符号，仅保留正文内容（用于灵感正文与任务标题） */
export function stripTags(text: string): string {
  return text.replace(TAG_RE, "").replace(/\s{2,}/g, " ").trim();
}
