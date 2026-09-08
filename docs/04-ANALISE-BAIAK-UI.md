# Análise de interface — Baiak Idle

Referência ao vivo: [https://baiakidle.com/jogar/](https://baiakidle.com/jogar/)

O Baiak Idle não é um site com “tema de RPG”. É o **cliente Tibia 12+** compactado num dashboard idle: chrome escuro, headers dourados, viewport quadrado no centro e mini-janelas empilhadas nas laterais.

## Grade

```
┌──────────────────────────────── topnav 52px ─────────────────────────────────┐
│ TIBIA IDLE  nome  gold  coins  [22 ícones]  BR US Discord Settings sair      │
├────────────┬──────────────────────────────────────────────┬──────────────────┤
│ 268px      │                  centro                      │ 268px            │
│ Stamina    │ hunt ▾   Wave ■■■■■□□□□☠   Loop  Decorar    │ Party Config     │
│ Boosts     │                                              │  HP / MP / XP    │
│ Skills     │           viewport 13×11 tiles               │  slots bloqueados│
│ Hunt An.   │                                              │ Backpack 0/8     │
│ Party Hunt │           chat: Geral Comunicados Help Market│ Loot Pouch 0/8   │
│ Damage     │           hotbar                             │ Supply Pouch     │
│ Dmg Taken  │                                              │                  │
│ Loot An.   │                                              │                  │
│ Supply An. │                                              │                  │
└────────────┴──────────────────────────────────────────────┴──────────────────┘
```

## Topo

Ordem dos ícones no site ao vivo:

Helper · Cyclopedia · Arena · Progressao · Prey · Build · Forja · Imbuir · Codex · Charms · Daily · Armazém · Comercio · Mercador · Loja · Marketplace · Market · Social · Guild · Comunidade · VIP · Rank · Discord · Settings · sair

Hunts **não** ficam numa lista permanente à esquerda. Abrem pelo seletor de hunt no centro. O **Helper** é automação (cura, poções, magias).

## Esquerda — analyzers (mini-janelas Tibia)

| Painel | Campos |
|---|---|
| Stamina | `HH:MM` + barra + % |
| Boosts | XP / dano / loot / defesa — `inativo` ou timer |
| Skills | Magic, Fist, Melee, Distance, Shielding |
| Hunt Analyzer | Session, XP/h, XP Stack, XP Gain, Kills, Loot, Supplies, Balance |
| Party Hunt | placeholder até party existir |
| Damage | Session, total, /h |
| Damage Taken | Session, total |
| Loot Analyser | Session, Gold value, Per hour |
| Supply Analyser | Session, Gold value, Per hour |

Loot em dourado, supplies em vermelho, balance na cor do lucro/prejuízo.

## Centro

- Nome da hunt como seletor (abre Helper)
- Wave em **10 segmentos**; o último é caveira (boss)
- **Loop** verde quando ligado + **Decorar**
- Viewport **quadrado**, sprites oficiais, player no meio, efeitos de hit/magia e mísseis
- Palavras de magia (`exori ico`, `exura`) e números de dano flutuando
- Chat com abas Geral / Comunicados / Help / Market e log de combate no Geral
- Hotbar: vocação (EK/RP/MS/ED/EM) + ataque

## Direita

- Party: nome, vocação, level, HP/MP/XP; slots extra bloqueados (10.000 gold / 75 coins)
- Backpack 8 slots · Organizar / Raridade
- Loot Pouch 8 slots · venda / +slot
- Supply Pouch 8 slots

Não há bloco grande de “Equipamento” como coluna principal.

## Overlays do site

- **CRIE SEU PERSONAGEM** — Masculino/Feminino, Knight/Monk/Paladin/Sorcerer/Druid, arma do Knight (Machado/Espada/Clava)
- Cyclopedia: Items / Bestiary / Bosstiary / Character
- Loja: Obter Coins / Transfer / Convert / Resgatar
- Aparência: Outfits / Montarias / Auras / Presets
- Fila de entrada, conexão perdida, loading `BAIAK IDLE`

## Sistemas implementados

Prey, Charms, Forja, Imbuir, Daily, Armazém, Comércio/Mercador, Loja (coins/VIP/rename/resgatar), Market/Marketplace, Guild, Social, Rank, Arena, Cyclopedia (Bosstiary com slots), Codex, Build, Progressão (Wheel), Decorar, party slots, chat persistente, fila de entrada, admin, predição local da hunt (tick 250 ms), loot/cura no viewport, Loop que religa a cave. Gateway Pix/cartão fica para o final.
