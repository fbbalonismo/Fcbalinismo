# Voe Pedra Azul — Vento em Camadas 🎈

App de previsão de vento em camadas para balonismo, em produção em **https://voe-pedra-azul.vercel.app**.

- Previsão de vento de 50 a 1800 m acima da base, em camadas de 100 m
- Trajetória de deriva do balão em mapa de satélite (tela cheia, rotação por gestos)
- Comparação dos modelos ECMWF, GFS e ICON (dados gratuitos Open-Meteo)
- Nascer/pôr do sol, temperatura, rajada, gráfico de chuva e placar de realismo dos modelos
- Upload público de GPX pós-voo com análise automática contra a previsão
- Local de decolagem configurável (padrão: base Voe Pedra Azul, Domingos Martins/ES)

## Primeiros passos (novo colaborador)

1. Instale o [Claude Code](https://claude.com/claude-code), o [Node.js](https://nodejs.org) e o git.
2. Clone e instale:
   ```bash
   git clone https://github.com/diegombraga/voe-pedra-azul.git
   cd voe-pedra-azul
   npm install
   ```
3. Abra o Claude Code na pasta (`claude`) e converse em português — toda a documentação técnica está em [`AGENTS.md`](AGENTS.md) e o Claude lê sozinho. O guia completo para quem não é programador está em [`ONBOARDING.md`](ONBOARDING.md).
4. Rodar local: `npm run dev` → http://localhost:3000

## Publicar mudanças

Todo push na branch `main` publica automaticamente em produção (Vercel). Antes de dar push, peça ao Claude para rodar `npm run build` e verificar no preview.

## Fluxo pós-voo

Exporte o GPX do Wikiloc (trilha → ⋯ → Exportar arquivo → GPX) e envie **direto no site**, na seção "Envie o GPX do seu voo" — a análise contra a previsão é automática e entra no histórico. No Claude Code também dá: anexe o arquivo e peça "compare este voo com a previsão".

## Regras do projeto

- Interface e respostas sempre em **português do Brasil**
- O app deve continuar **gratuito e sem manutenção** (Open-Meteo sem chave, Vercel hobby)
- Nunca remover o aviso *"Confirmar localmente antes da decolagem"* — a decisão de voo é sempre do piloto
