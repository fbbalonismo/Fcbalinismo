"use client";

// Página para recuperar dados de um app anterior: cole o texto de /api/voos e
// de /api/chuva do app antigo e clique em importar. Os dados entram na base
// deste app (adiciona sem apagar; ignora o que já existe).

import { useState } from "react";

function Importer({
  titulo,
  ajuda,
  endpoint,
}: {
  titulo: string;
  ajuda: string;
  endpoint: string;
}) {
  const [texto, setTexto] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function enviar() {
    setBusy(true);
    setMsg(null);
    try {
      const data = JSON.parse(texto);
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, confirm: "voe-import" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Falhou");
      setMsg(`✓ Importados: ${j.importados} · já existiam: ${j.pulados} · total agora: ${j.totalAgora}`);
    } catch (e) {
      setMsg(`Erro: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: "#112c46", border: "1px solid rgba(87,183,234,.18)", borderRadius: 16, padding: 20, marginBottom: 20 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{titulo}</h2>
      <p style={{ fontSize: 13, color: "#9fb6cb", marginBottom: 12 }}>{ajuda}</p>
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Cole aqui o texto JSON…"
        spellCheck={false}
        style={{
          width: "100%",
          minHeight: 140,
          fontFamily: "monospace",
          fontSize: 12,
          padding: 10,
          borderRadius: 10,
          border: "1px solid rgba(87,183,234,.25)",
          background: "#0a1724",
          color: "#eaf2fb",
          resize: "vertical",
        }}
      />
      <button
        onClick={enviar}
        disabled={busy || !texto.trim()}
        style={{
          marginTop: 10,
          padding: "10px 18px",
          borderRadius: 10,
          border: "none",
          background: busy ? "#345" : "#57B7EA",
          color: "#0A1724",
          fontWeight: 700,
          cursor: busy ? "default" : "pointer",
        }}
      >
        {busy ? "Importando…" : "Importar"}
      </button>
      {msg && <p style={{ marginTop: 10, fontSize: 13, color: msg.startsWith("✓") ? "#7ED957" : "#EF5D5D" }}>{msg}</p>}
    </div>
  );
}

export default function ImportarPage() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 20px", color: "#eaf2fb" }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 8 }}>Recuperar dados</h1>
      <p style={{ fontSize: 14, color: "#9fb6cb", marginBottom: 24 }}>
        Abra o app antigo (já logado), acesse os endereços abaixo, copie <b>todo</b> o texto e cole no campo
        correspondente. Só adiciona — não apaga nada, e ignora o que já existe.
      </p>

      <Importer
        titulo="Voos"
        ajuda="Cole o texto de voe-pedra-azul.vercel.app/api/voos"
        endpoint="/api/voos/import"
      />
      <Importer
        titulo="Registros de chuva"
        ajuda="Cole o texto de voe-pedra-azul.vercel.app/api/chuva"
        endpoint="/api/chuva/import"
      />

      <p style={{ fontSize: 13, color: "#9fb6cb", marginTop: 8 }}>
        Depois de importar, volte para a <a href="/" style={{ color: "#57B7EA" }}>página inicial</a> — os voos e o
        placar de chuva já aparecem.
      </p>
    </div>
  );
}
