# Tibia Idle Global — Documentação

MMO idle de navegador ambientado no Tibia global, construído sobre dois acervos
já existentes neste repositório: um OTServer Crystal 15.25 (regras e conteúdo) e
um cliente OTClient com os assets oficiais do Tibia 15.25 (arte).

## Documentos

| # | Documento | Conteúdo |
|---|---|---|
| 00 | [Análise Técnica](00-ANALISE-TECNICA.md) | Inventário dos acervos, fórmulas do servidor, formato dos assets, validação do pipeline |
| 01 | [Game Design](01-GAME-DESIGN.md) | Conceito, análise da referência, sistemas, UI, primeira sessão |
| 02 | [Arquitetura](02-ARQUITETURA.md) | Simulação determinística compartilhada, stack, pipelines, servidor, segurança |
| 03 | [Roadmap](03-ROADMAP.md) | Fases, critérios de pronto, riscos |

## Estado atual

Fases 0–7 jogáveis. Guest, loja cosmética, guild, Party Hunt e cena de combate
com sprites, efeitos e log no chat. Pix/cartão fica para o final.

```powershell
pnpm --filter @tibia-idle/server dev    # http://127.0.0.1:3000
pnpm --filter @tibia-idle/web dev       # http://localhost:5173
```

## Decisões fixadas

| Decisão | Escolha |
|---|---|
| Fonte das fórmulas | **Crystal Server**, incluindo os overrides do fork |
| Escopo de conteúdo | **Todas as 131 hunts**, nível 8 a 1100 |
| Direções de sprite | Sul (retratos) e Oeste (combate) |

## As três coisas que mais importam

1. **`packages/sim` precisa ser determinístico.** Cliente e servidor rodam o
   mesmo código com a mesma seed. É o que permite combate em tempo real com
   servidor autoritativo e custo baixo. Doc 02 §1.
2. **`hunting_places.json` é a espinha dorsal.** 131 hunts balanceadas pela
   CipSoft, nível 8 a 1100, com XP/hora oficial. É a curva de progressão e o
   teste automatizado de balanceamento. Doc 00 §4.3.
3. **Parsear Lua com Lua, não com regex.** São 1.802 monstros com sintaxe
   variada. Doc 02 §5.1.
