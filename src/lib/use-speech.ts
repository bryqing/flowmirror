"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 语音输入 hook（浏览器原生 Web Speech API）
 * - 仅 Chrome / Edge / Safari 支持；Firefox 不支持，自动降级隐藏麦克风
 * - 需 HTTPS 或 localhost（当前 localhost 满足）
 * - 实时中文转录，边听边填入
 *
 * 返回 { supported, listening, error, start, stop }
 */
export function useSpeech(onResult: (text: string) => void) {
  // 支持度初值固定为 false：SSR 与客户端首帧一致（都 false），挂载后再异步检测。
  // 这是 React 18/19 官方支持的 hydration 后更新模式，不会触发 Hydration 报错。
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition));
  }, []);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<SpeechRecognition | null>(null);
  const onResultRef = useRef(onResult);

  // 同步最新的回调（避免渲染期更新 ref）
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const SR =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!SR) {
      setError("当前浏览器不支持语音识别，请用 Chrome / Edge / Safari");
      return;
    }

    const rec = new SR();
    rec.lang = "zh-CN";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    // 实时转录：中间结果也回填，实现"边听边出字"
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
      }
      onResultRef.current(text);
    };

    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("麦克风权限被拒绝，请在浏览器设置中允许");
      } else if (e.error !== "no-speech") {
        setError(`语音识别出错：${e.error}`);
      }
      setListening(false);
    };

    rec.onend = () => {
      setListening(false);
    };

    recRef.current = rec;
    setError(null);
    try {
      rec.start();
      setListening(true);
    } catch {
      setError("无法启动语音识别");
    }
  }, []);

  // 卸载时释放
  useEffect(() => {
    return () => {
      recRef.current?.stop();
    };
  }, []);

  return { supported, listening, error, start, stop };
}
