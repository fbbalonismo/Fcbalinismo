"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Assistente Claude embutido: pergunte sobre as apurações (vento, deriva,
// modelos, chuva) e anexe prints de tela (do app ou de outros, como Windy).

interface Msg {
  role: "user" | "assistant";
  text: string;
}
interface PendingImage {
  data: string; // base64 puro (sem prefixo data:)
  mediaType: string;
  preview: string; // dataURL para o thumbnail
}

export default function Assistant({ context }: { context?: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<PendingImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, open]);

  const pickImage = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const base64 = dataUrl.split(",")[1] ?? "";
      setImage({ data: base64, mediaType: file.type, preview: dataUrl });
    };
    reader.readAsDataURL(file);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if ((!text && !image) || busy) return;
    setError(null);
    const userMsg: Msg = { role: "user", text: text || "Analise este print." };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    const sentImage = image;
    setImage(null);
    setBusy(true);
    try {
      const r = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          image: sentImage ? { data: sentImage.data, mediaType: sentImage.mediaType } : undefined,
          context,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Falha no assistente");
      setMessages((m) => [...m, { role: "assistant", text: j.text || "(sem resposta)" }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  }, [input, image, busy, messages, context]);

  return (
    <>
      <button className="assist-fab" onClick={() => setOpen((o) => !o)} aria-label="Assistente">
        {open ? "✕" : "💬 Perguntar ao Claude"}
      </button>

      {open && (
        <div className="assist-panel" role="dialog" aria-label="Assistente Claude">
          <div className="assist-head">
            <strong>Assistente de voo</strong>
            <span className="assist-sub">Pergunte sobre vento, chuva, modelos — ou mande um print</span>
          </div>

          <div className="assist-list" ref={listRef}>
            {messages.length === 0 && (
              <div className="assist-empty">
                Ex.: “Dá pra voar amanhã às 6h?”, “Compare este print do Windy com a previsão”, “O que é viés de vento
                negativo?”
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`assist-msg assist-${m.role}`}>
                {m.text}
              </div>
            ))}
            {busy && <div className="assist-msg assist-assistant assist-typing">Analisando…</div>}
            {error && <div className="assist-err">{error}</div>}
          </div>

          {image && (
            <div className="assist-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.preview} alt="anexo" />
              <button onClick={() => setImage(null)} aria-label="Remover">
                ×
              </button>
            </div>
          )}

          <div className="assist-input">
            <button className="assist-attach" onClick={() => fileRef.current?.click()} title="Anexar print" disabled={busy}>
              📎
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pickImage(f);
                e.target.value = "";
              }}
            />
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Escreva sua pergunta…"
              rows={2}
              disabled={busy}
            />
            <button className="assist-send" onClick={send} disabled={busy || (!input.trim() && !image)}>
              Enviar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
