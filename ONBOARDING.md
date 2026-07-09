# Bem-vindo ao projeto Voe Pedra Azul 🎈

Este guia prepara o seu Claude Code para trabalhar no app de previsão de vento em camadas do balonismo Voe Pedra Azul.

## O que é este projeto

App web em produção em **https://voe-pedra-azul.vercel.app** que mostra, para a base de decolagem em Pedra Azul/ES:

- Previsão de vento em camadas de 100 m, de 50 até 1800 m acima da base
- Tabela no formato m | ft | de° | kt | para° com setas de direção
- Mapa de satélite com a trajetória de deriva prevista do balão e as referências por azimute (Rota do Carmo 0°, Aracê 90°, Reserva Água Branca 180°, São Paulinho de Aracê 230°, Caxixe 270°, Fazenda do Estado 330°)
- Comparação dos modelos meteorológicos ECMWF, GFS e ICON (dados gratuitos da Open-Meteo)

Tecnologia: Next.js + TypeScript, hospedado na Vercel. O deploy é automático: todo push na branch `main` atualiza o site em ~1 minuto.

## Primeiros passos (uma vez só)

1. Aceite o convite de colaborador do repositório GitHub `diegombraga/voe-pedra-azul` (chega por e-mail).
2. Clone o projeto:
   ```
   git clone https://github.com/diegombraga/voe-pedra-azul.git
   cd voe-pedra-azul
   npm install
   ```
3. Abra o Claude Code na pasta do projeto (`claude`). Toda a documentação técnica está em `AGENTS.md` — o Claude lê automaticamente.
4. Para rodar localmente: peça ao Claude "rode o app" ou execute `npm run dev` e abra http://localhost:3000.

## Fluxo pós-voo (o mais importante)

Depois de cada voo:

1. No app do Wikiloc: abra a trilha → menu ⋯ → **Exportar arquivo → GPX**.
2. No Claude Code, anexe o arquivo GPX e peça:
   > "Compare este voo com a previsão do app, faixa por faixa de altitude, e registre o resultado no histórico de validação."
3. O Claude segue o procedimento padronizado descrito em `AGENTS.md` (seção "Fluxo pós-voo") e adiciona o resultado ao histórico — com 3–4 voos acumulados dá para calibrar a velocidade prevista.

## Para evoluir o app

Peça em português normal, por exemplo:

- "Adiciona uma camada de 2000 m"
- "Muda o horário padrão para 05:30"
- "Adiciona uma nova referência no azimute 140° chamada X"
- "Ajusta a taxa de subida da deriva para 2 m/s"

As configurações operacionais (coordenadas, referências, camadas) ficam todas em `lib/config.ts`. Depois de qualquer mudança, peça ao Claude para **verificar no preview e fazer o build** antes de dar push — o push na `main` já publica em produção.

## Regras do projeto

- Interface e respostas sempre em **português do Brasil**
- O app deve continuar **gratuito e sem manutenção** (Open-Meteo sem chave, Vercel hobby)
- Nunca remover o aviso "Confirmar localmente antes da decolagem" — previsão é estimativa, a decisão de voo é sempre do piloto
