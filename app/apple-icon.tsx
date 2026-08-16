import { ImageResponse } from "next/og";

// Ícone da tela inicial (iPhone "Adicionar à Tela de Início" e afins).
// Desenha um balão colorido sobre o céu, no tema do app.

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(160deg, #0a2036 0%, #1a4a73 100%)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          {/* envelope do balão */}
          <div
            style={{
              width: 108,
              height: 120,
              borderRadius: "50%",
              background: "linear-gradient(150deg, #F5A623 0%, #EF5D5D 48%, #57B7EA 100%)",
            }}
          />
          {/* corda */}
          <div style={{ width: 4, height: 12, background: "#c9d6e2" }} />
          {/* cesto */}
          <div style={{ width: 24, height: 16, background: "#7a5230", borderRadius: 3 }} />
        </div>
      </div>
    ),
    { ...size }
  );
}
