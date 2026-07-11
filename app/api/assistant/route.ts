import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

// Assistente Claude do app: responde perguntas sobre as apurações (vento por
// camada, deriva do balão, comparação dos modelos, nowcast de chuva), podendo
// receber prints de tela (visão) — por exemplo para comparar com o app Windy.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "claude-opus-4-8";

const SYSTEM = `Você é o assistente do app "Voe Pedra Azul", uma ferramenta de previsão para voo de balão na base de Pedra Azul (Domingos Martins, ES).

O que o app apura:
- Vento em camadas de 100 m a 1800 m acima do solo (AGL), em nós/km-h, com direção (de onde vem) por camada.
- Trajetória de deriva do balão (para onde ele iria), assumindo subida de ~1 m/s.
- Três modelos meteorológicos comparados: ECMWF (Centro Europeu), GFS (NOAA/EUA) e ICON (DWD/Alemanha). Concordância entre eles indica confiança.
- Análise pós-voo: compara a trilha real (GPX/KML/IGC) com a previsão dos modelos, por faixa de altitude — erro de direção (°) e viés de vento (nós/km-h). "Viés negativo" = o modelo subestimou o vento.
- Nowcast de chuva combinando RainViewer (radar), Open-Meteo e AccuWeather MinuteCast, na escala: sem chuva, sereno, aproximação de nuvem, chuva leve, moderada, intensa+.

Como responder:
- Sempre em português do Brasil, direto e prático, com foco na decisão de voar ou não.
- Se o usuário mandar um print (de tela do próprio app ou de outro, como Windy, Windguru, Meteoblue), leia os números da imagem e compare com o que o app mostra; aponte divergências e o que elas significam para o voo.
- Explique termos quando útil (AGL, deriva, concordância, viés).
- Não invente números que não estejam nos dados ou na imagem. Se faltar dado, diga o que precisa.
- Seja conciso: comece pela conclusão (dá pra voar? o que observar?), depois o detalhe.`;

interface ClientMsg {
  role: "user" | "assistant";
  text: string;
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "Assistente não configurado (defina ANTHROPIC_API_KEY)." },
        { status: 503 }
      );
    }
    const body = await req.json();
    const history: ClientMsg[] = Array.isArray(body?.messages) ? body.messages : [];
    const image = body?.image as { data: string; mediaType: string } | undefined;
    const context = body?.context ? String(body.context).slice(0, 8000) : "";

    if (history.length === 0) {
      return NextResponse.json({ error: "Mensagem vazia" }, { status: 400 });
    }

    // Converte o histórico; anexa a imagem (se houver) à última mensagem do usuário.
    const messages: Anthropic.MessageParam[] = history.map((m, i) => {
      const isLast = i === history.length - 1;
      if (isLast && m.role === "user" && image?.data) {
        return {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: (image.mediaType || "image/png") as
                  | "image/png"
                  | "image/jpeg"
                  | "image/gif"
                  | "image/webp",
                data: image.data,
              },
            },
            { type: "text", text: m.text || "Analise esta imagem." },
          ],
        };
      }
      return { role: m.role, content: m.text };
    });

    const system = context
      ? `${SYSTEM}\n\nDados atuais do app (para referência nesta conversa):\n${context}`
      : SYSTEM;

    const client = new Anthropic();
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system,
      messages,
    });

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    return NextResponse.json({ text });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro no assistente" },
      { status: 500 }
    );
  }
}
