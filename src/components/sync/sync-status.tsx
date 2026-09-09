"use client";

import { useState } from "react";
import { Cloud, CloudOff, LogOut, Mail } from "lucide-react";
import { useFlow } from "@/components/flow-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * 同步状态胶囊 + 登录面板（非侵入式，固定右上角，不破坏三层布局）
 * - synced=true：显示「已同步」，点开可退出
 * - synced=false：显示「未同步」，点开可邮箱 OTP 登录
 */
export function SyncStatus() {
  const { synced, userEmail, signInWithEmail, signOut } = useFlow();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async () => {
    const v = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return;
    setSending(true);
    await signInWithEmail(v);
    setSending(false);
    setOpen(false);
    setEmail("");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "pointer-events-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px]",
          "border backdrop-blur-md transition-colors",
          synced
            ? "border-cat-rest/25 bg-cat-rest/10 text-cat-rest"
            : "border-white/10 bg-white/[0.04] text-subtle-foreground hover:text-foreground"
        )}
      >
        {synced ? <Cloud className="size-3.5" /> : <CloudOff className="size-3.5" />}
        {synced ? "已同步" : "未同步"}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="多端同步 · 登录">
        <div className="flex flex-col gap-4 px-5 pb-8 pt-1">
          {synced ? (
            <>
              <p className="text-xs leading-relaxed text-muted-foreground">
                当前登录：<span className="font-medium text-foreground">{userEmail}</span>
                <br />
                任务的新增 / 完成 / 改期已在多端实时同步。
              </p>
              <Button variant="outline" onClick={async () => { await signOut(); setOpen(false); }} className="border-cat-blackhole/30 text-cat-blackhole hover:bg-cat-blackhole/10">
                <LogOut className="mr-1.5 size-3.5" />
                退出登录
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs leading-relaxed text-muted-foreground">
                用邮箱登录后，你的四象限任务与微复盘将同步到云端，PC 与手机端实时互通。
                无需密码——我们会发送一封魔法链接到你的邮箱。
              </p>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] text-subtle-foreground">邮箱地址</span>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                />
              </label>
              <Button
                onClick={submit}
                disabled={sending || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}
                className="bg-cat-deep/90 text-background hover:bg-cat-deep"
              >
                <Mail className="mr-1.5 size-3.5" />
                {sending ? "发送中…" : "发送登录链接"}
              </Button>
              <p className="text-[10px] leading-relaxed text-subtle-foreground">
                首次登录会引导你完成注册。演示数据可用 seed.sql 灌入。
              </p>
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}
