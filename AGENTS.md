<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Voe Pedra Azul — Previsão de vento em camadas para balonismo

App web usado pelo André (piloto de balão em Pedra Azul/ES) para planejar voos: mostra a previsão de vento em camadas de 100 m (50–1800 m acima da base) e desenha a trajetória de deriva do balão em mapa de satélite, comparando os modelos ECMWF, GFS e ICON.

**Idioma: sempre responda e escreva a interface em português do Brasil.** O usuário principal (André) não é programador — explique as coisas de forma simples, sem jargão.

## Produção

- URL: https://voe-pedra-azul.vercel.app
- Deploy automático: todo push na branch `main` do GitHub gera deploy em produção na Vercel (projeto `voe-pedra-azul`).
- Dados: API gratuita Open-Meteo (sem chave, sem custo, cache de 30 min).

## Arquitetura

- `lib/config.ts` — TODAS as configurações operacionais: coordenadas da base (ponto exato do André: -20.382314, -41.024572, elevação real 1062 m), referências por azimute (Rota do Carmo 0°, Aracê 90°, etc.), camadas-alvo, modelos, taxa de subida da deriva (1 m/s). Ajustes de local/referência são feitos aqui.
- `lib/openmeteo.ts` — busca e parse da API Open-Meteo (níveis de pressão 1000–700 hPa + vento a 10 m + rajada + temperatura + nascer do sol, 3 modelos em uma chamada). A elevação real é passada via parâmetro `elevation`.
- `lib/wind.ts` — interpolação do perfil de vento em componentes u/v para as camadas AGL, conversões (m/ft, de°/para°, kt) e cálculo da trajetória de deriva (vetores encadeados camada a camada).
- `app/api/forecast/route.ts` — rota que devolve tudo já calculado (revalidate 30 min).
- `app/api/chuva/route.ts` — registro de chuva observada (sem/leve/moderada/intensa); cada registro guarda snapshot do mm/h previsto pelos 3 modelos naquela hora e o GET devolve o placar de realismo. Armazenado no Vercel Blob (store `voe-dados`, prefixo `chuva/`).
- `app/api/voos/route.ts` — upload público de GPX: salva o arquivo no Blob (prefixo `voos/`), roda `lib/gpx.ts` (mesma análise padronizada do fluxo pós-voo, em TypeScript) e acumula a média de erro por modelo. Enviar até 2 dias após o voo (`past_days=2` na Open-Meteo).
- `lib/gpx.ts` — parse do GPX + análise por bandas de 100 m contra a previsão (é a versão automatizada do "Fluxo pós-voo" abaixo).
- Storage: Vercel Blob `voe-dados` (acesso público, token `BLOB_READ_WRITE_TOKEN` já em produção e no `.env.local` via `vercel env pull`).
- `app/page.tsx` — página única (client component) com o visual criado no Claude Design pelo Diego (identidade da marca Voe Pedra Azul, tema escuro, fontes Poppins/Manrope): hero com semáforo de decolagem (Bom para voar / Atenção / Não voar), cards de nascer do sol/preparação/decolagem ideal/temperatura, tabela de camadas com barras de intensidade, cards de modelo selecionáveis (distância + rumo da deriva), seção institucional e CTA de reserva. Os estilos ficam em `app/globals.css` (classes semânticas, responsivo <900px e <560px).
- `components/DriftMap.tsx` — mapa Leaflet (tiles de satélite Esri) com linhas de azimute, referências e polylines de deriva; o modelo ativo fica sólido e os demais tracejados; reenquadra sozinho via `FitDrift` (ResizeObserver — não remover, evita mapa deslocado). O mapa só monta depois que os dados chegam. Usa o plugin `leaflet-rotate` (girar com dois dedos + controle bússola) e tem modo tela cheia (`.map-full` na page, com fullscreen nativo + trava de paisagem quando o navegador permite — iPhone não suporta, lá é overlay fixo).

## Comandos

- Rodar local: `npm run dev` (http://localhost:3000)
- Build/checagem: `npm run build`
- Deploy: só dar push na `main` (ou `vercel deploy --prod`)

## Fluxo pós-voo: análise de GPX (IMPORTANTE)

Depois de cada voo, o André exporta o GPX do Wikiloc e pede a comparação com a previsão. O procedimento que já usamos (repetir sempre igual para os resultados serem comparáveis):

1. Parse do GPX (trackpoints: lat, lon, ele, time; horários em UTC — converter para America/Sao_Paulo, UTC-3).
2. Altura AGL = elevação GPS − 1062 m (elevação da base). Ignorar pontos abaixo de 50 m AGL e segmentos com velocidade < 2 kt (balão parado no chão).
3. Agrupar em faixas de 100 m; por faixa, somar deslocamento vetorial (dx leste, dy norte) e tempo → rumo real = atan2(dx, dy), velocidade real em kt.
4. Buscar a previsão da hora do voo em https://voe-pedra-azul.vercel.app/api/forecast e comparar por faixa: erro de direção (menor ângulo) e viés de velocidade por modelo.
5. Registrar o resultado no histórico abaixo (editar este arquivo) para acumular calibração.

## Histórico de validação

- **Voo 242 (09/07/2026, 06:59–08:00, máx 1517 m AGL):** direção — ECMWF erro médio 12°, GFS 11°, ICON 21° (rotação E→ENE acima de 1100 m prevista pelos 3). Velocidade — todos subestimaram: ECMWF −4,4 kt, GFS −5,7 kt, ICON −1,9 kt. Lição: vento real tende a vir mais forte que o previsto; ICON foi o melhor em intensidade e em direção acima de 1100 m; GFS/ECMWF melhores em direção abaixo de 1000 m.

Quando houver 3–4 voos analisados, considerar aplicar fator de correção de velocidade no app.
