"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 暗黑风格自定义下拉选择器
 *
 * 为什么不用原生 <select>：
 *   展开后的选项列表是**浏览器/操作系统渲染**的（不是 DOM），CSS 对它只有极有限的
 *   影响力 —— `color-scheme: dark` 在部分 Chrome/Edge + Windows 主题下仍会给出
 *   白底，而 <option> 的 color 却按页面继承成浅色，于是出现「白底白字看不见」。
 *   各家浏览器对 option 背景的支持也不一致，无法可靠修复，只能自己画。
 *
 * 两个必须注意的实现点：
 *   1. 菜单用 createPortal 挂到 document.body。调用方（如 Sheet 抽屉）的面板带
 *      overflow-y-auto，普通绝对定位的下拉会被滚动容器裁掉下半截；
 *      挂到 body 顶层才不会被任何祖先的 overflow / transform 影响。
 *   2. ESC 用**捕获阶段**监听并 stopPropagation。抽屉自身在 document 冒泡阶段
 *      监听 ESC 关闭，若不抢先拦截，按一次 ESC 会把下拉和整个抽屉一起关掉。
 */

export interface DarkSelectOption<T extends string> {
  value: T;
  label: string;
  /** 选项左侧的色点类名（如象限色 `bg-cat-deep`），可选 */
  dot?: string;
}

interface DarkSelectProps<T extends string> {
  value: T;
  options: readonly DarkSelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** 悬浮提示 */
  title?: string;
  /** 无障碍名称 */
  ariaLabel?: string;
  /** 触发器样式（尺寸由调用方决定，默认走内置的暗色输入框样式） */
  className?: string;
  /** 展开菜单的最小宽度，默认与触发器等宽 */
  menuMinWidth?: number;
}

/** 触发器与菜单之间的间距 */
const GAP = 6;
/** 距离视口边缘的安全边距 */
const EDGE = 8;

/**
 * useLayoutEffect 在 SSR 阶段会告警，这里退化为 useEffect。
 * 客户端实际走 layout 版本 —— 它在浏览器绘制前同步测量，因此菜单
 * 「先按下方定位、量完高度发现放不下再翻到上方」不会产生肉眼可见的跳动。
 */
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function DarkSelect<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  title,
  ariaLabel,
  className,
  menuMinWidth,
}: DarkSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [menuHeight, setMenuHeight] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : options[0];

  const close = useCallback(() => setOpen(false), []);

  const openMenu = useCallback(() => {
    const el = triggerRef.current;
    if (disabled || !el || options.length === 0) return;
    setRect(el.getBoundingClientRect());
    setActiveIndex(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }, [disabled, options, value]);

  const choose = useCallback(
    (next: T) => {
      setOpen(false);
      triggerRef.current?.focus();
      if (next !== value) onChange(next);
    },
    [onChange, value]
  );

  // 打开期间跟随滚动 / 缩放重算位置（捕获阶段可覆盖抽屉内部的滚动容器）。
  // 首次定位已由 openMenu() 完成，这里只装监听器，避免在 effect 体内写 state。
  useEffect(() => {
    if (!open) return;
    const sync = () => {
      const el = triggerRef.current;
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [open]);

  // 量取菜单真实高度，用于判断向下还是向上展开
  useIsoLayoutEffect(() => {
    if (!open) return;
    const el = menuRef.current;
    if (el) setMenuHeight(el.offsetHeight);
  }, [open, options.length]);

  // 外点关闭 + ESC 关闭（捕获阶段抢占，避免连带关闭外层抽屉）
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  // 键盘移动高亮时把该项滚进可视区
  useEffect(() => {
    if (!open) return;
    const item = menuRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % options.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + options.length) % options.length);
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case "Enter":
        // 阻止 keydown 默认行为，否则 <button> 会再触发一次 click 把菜单关掉
        e.preventDefault();
        if (options[activeIndex]) choose(options[activeIndex].value);
        break;
      case "Tab":
        close();
        break;
      default:
        break;
    }
  };

  // 定位：默认向下展开；下方空间不足且上方更宽裕时翻到上方
  const layout = (() => {
    if (!rect || typeof window === "undefined") return null;
    const width = Math.max(rect.width, menuMinWidth ?? 0);
    const left = Math.min(
      Math.max(EDGE, rect.left),
      Math.max(EDGE, window.innerWidth - width - EDGE)
    );
    const spaceBelow = window.innerHeight - rect.bottom - GAP - EDGE;
    const spaceAbove = rect.top - GAP - EDGE;
    const maxHeight = Math.max(160, Math.max(spaceBelow, spaceAbove));
    const height = Math.min(menuHeight, maxHeight);
    const flip = menuHeight > 0 && menuHeight > spaceBelow && spaceAbove > spaceBelow;
    const top = flip ? Math.max(EDGE, rect.top - GAP - height) : rect.bottom + GAP;
    return { left, top, width, maxHeight };
  })();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "flex min-w-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1.5 text-left text-[11px] text-foreground outline-none transition-colors",
          "hover:border-white/20 focus-visible:border-cat-deep/40 disabled:opacity-60",
          open && "border-cat-deep/40",
          className
        )}
      >
        {selected?.dot && <span className={cn("size-2 shrink-0 rounded-full", selected.dot)} />}
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? "—"}</span>
        <ChevronDown
          className={cn(
            "size-3 shrink-0 text-subtle-foreground transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      {open &&
        layout &&
        createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            style={{
              left: layout.left,
              top: layout.top,
              width: layout.width,
              maxHeight: layout.maxHeight,
            }}
            // 实色暗底（不用半透明 + blur）：彻底杜绝任何底色透白的情况
            className="animate-fade-in fixed z-[200] overflow-y-auto rounded-xl border border-white/12 bg-elevated p-1 shadow-[0_20px_45px_-14px_rgba(0,0,0,0.9)] ring-1 ring-black/40"
          >
            {options.map((option, i) => {
              const isSelected = option.value === value;
              const isActive = i === activeIndex;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-index={i}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => choose(option.value)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors",
                    isSelected ? "text-foreground" : "text-muted-foreground",
                    isActive && "bg-white/[0.09]"
                  )}
                >
                  {option.dot && <span className={cn("size-2 shrink-0 rounded-full", option.dot)} />}
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {isSelected && <Check className="size-3 shrink-0 text-cat-deep" />}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
