"use client";

import { useState } from "react";
import { Cloud, CloudOff, Loader2, LogOut, Mail, Lock, UserPlus, LogIn } from "lucide-react";
import { useFlow } from "@/components/flow-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 同步状态胶囊 + 登录面板（非侵入式，固定右上角，不破坏三层布局）
 * - synced=true：显示「已同步」，点开可查看账号 / 退出
 * - synced=false：显示「未同步」，点开可邮箱密码登录或注册
 */
export function SyncStatus() {
  const { synced, userEmail, signInWithPassword, signUpWithPassword, signOut } = useFlow();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const emailValid = EMAIL_RE.test(email.trim());
  const passwordValid = password.length >= 6;
  const canSubmit = emailValid && passwordValid && !busy;

  const reset = () => {
    setEmail("");
    setPassword("");
    setBusy(false);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const ok =
      mode === "signin"
        ? await signInWithPassword(email.trim(), password)
        : await signUpWithPassword(email.trim(), password);
    setBusy(false);
    if (ok) {
      reset();
      setOpen(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setPassword("");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px]",
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
              <div className="flex items-center gap-3 rounded-2xl border border-cat-rest/20 bg-cat-rest/[0.06] p-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-cat-rest/15">
                  <Cloud className="size-4 text-cat-rest" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-cat-rest">云端已连接</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{userEmail}</p>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                任务的新增 / 完成 / 改期已在手机与电脑端实时同步。
              </p>
              <Button
                variant="outline"
                onClick={async () => {
                  await signOut();
                  reset();
                  setOpen(false);
                }}
                className="border-cat-blackhole/30 text-cat-blackhole hover:bg-cat-blackhole/10"
              >
                <LogOut className="mr-1.5 size-3.5" />
                退出登录
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs leading-relaxed text-muted-foreground">
                登录后，你的四象限任务与微复盘将同步到云端，手机与电脑端实时互通。使用同一个邮箱账号即可跨设备访问。
              </p>

              {/* 登录 / 注册 切换 */}
              <div className="flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
                {(
                  [
                    { key: "signin" as Mode, label: "登录", icon: LogIn },
                    { key: "signup" as Mode, label: "注册", icon: UserPlus },
                  ] as const
                ).map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => switchMode(key)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-colors",
                      mode === key
                        ? "bg-cat-deep/90 text-background"
                        : "text-subtle-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="size-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] text-subtle-foreground">邮箱地址</span>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
                  <Input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="pl-9"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void submit();
                    }}
                  />
                </div>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] text-subtle-foreground">密码</span>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
                  <Input
                    type="password"
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === "signin" ? "输入密码" : "至少 6 位"}
                    className="pl-9"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void submit();
                    }}
                  />
                </div>
                {password.length > 0 && !passwordValid && (
                  <span className="text-[10px] text-cat-blackhole/80">密码至少 6 位</span>
                )}
              </label>

              <Button
                onClick={submit}
                disabled={!canSubmit}
                className="bg-cat-deep/90 text-background hover:bg-cat-deep"
              >
                {busy ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : mode === "signin" ? (
                  <LogIn className="mr-1.5 size-3.5" />
                ) : (
                  <UserPlus className="mr-1.5 size-3.5" />
                )}
                {busy
                  ? mode === "signin"
                    ? "登录中…"
                    : "注册中…"
                  : mode === "signin"
                    ? "登录"
                    : "注册并登录"}
              </Button>

              <p className="text-[10px] leading-relaxed text-subtle-foreground">
                {mode === "signin"
                  ? "首次使用请切换到「注册」创建账号。登录后两端数据自动合并同步。"
                  : "注册将创建新账号；若 Supabase 开启了邮箱验证，需查收邮件完成确认。"}
              </p>
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}
