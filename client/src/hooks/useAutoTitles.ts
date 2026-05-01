import { useEffect, type RefObject } from "react";

/**
 * 自动为 ref 容器内所有 <td> / <th> 填充 title 属性（悬停显示完整内容）。
 * 配合全局样式 `.report-page td/th { max-width: 30ch; ... }` 实现超出 30 字符
 * 截断为省略号，鼠标悬停浮现原文。
 *
 * 仅当单元格没有显式 title 时才注入，避免覆盖业务自定义 tooltip。
 */
export function useAutoTitles<T extends HTMLElement>(
  ref: RefObject<T | null>,
  deps: ReadonlyArray<unknown>
): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>("td, th").forEach((cell) => {
      if (cell.getAttribute("title")) return;
      const text = (cell.innerText || cell.textContent || "").trim();
      if (text) cell.title = text;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
