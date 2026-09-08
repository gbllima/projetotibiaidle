# Tibia Idle Global — Análise Técnica de Ativos

> Documento 00 de 4. Inventário e viabilidade técnica do que temos em mãos.
> **Status: pipeline de assets validado end-to-end com extração real de sprites.**

---

## 1. Resumo executivo

Temos dois acervos completos e complementares:

| Acervo | Conteúdo | Papel no projeto |
|---|---|---|
| `servidor/` | Crystal Server (fork Canary), protocolo **15.25** | Fonte da **verdade das regras**: fórmulas de dano, XP, loot, skills, e todo o conteúdo (1.802 monstros, ~44k itens, spells, charms, prey, imbuements) |
| `cliente pc/` | OTClient (linhagem mehah/Redemption) + assets oficiais Tibia 15.25 | Fonte da **verdade visual**: 304.658 sprites, 1.477 outfits, 243 efeitos, 76 missiles, + 2.200 PNGs de UI prontos |

**Conclusão da viabilidade: verde.** Não há bloqueio técnico. Todo o conteúdo necessário é extraível programaticamente, e eu já provei isso rodando o extrator (§3.4).

O achado mais valioso não é nem sprite nem fórmula: é o `hunting_places.json` (§4.3) — 131 spots de caça já balanceados pela CipSoft, com nível, XP/hora e loot/hora. Isso é literalmente o modelo de conteúdo de um jogo idle, pronto.

---

## 2. O servidor — Crystal Server 15.25

### 2.1 Estrutura

```
servidor/
├── src/                 # C++ — o motor. Fonte das fórmulas.
│   ├── creatures/       # player, monster, combat, condition, vocations, wheel
│   ├── items/weapons/   # fórmulas de dano de arma
│   ├── io/              # iobestiary (charms), ioprey
│   └── protobuf/        # appearances.proto  ← schema dos assets do cliente
├── data/
│   ├── items/items.xml  # 3,7 MB — ~44k itens
│   ├── XML/             # vocations, imbuements, mounts, outfits, familiars
│   ├── stages.lua       # estágios de XP / skill / magic level
│   └── scripts/         # spells, runes, systems (bestiary_charms.lua)
├── data-global/         # conteúdo do Tibia global
│   ├── monster/         # 1.802 arquivos .lua em 34 categorias
│   ├── npc/             # 1.112 arquivos
│   └── world/world.otbm # 52 MB — mapa global completo
└── config.lua           # rates
```

### 2.2 Fórmulas essenciais (extraídas do C++)

Estas são as fórmulas que precisamos reimplementar em TypeScript. Todas verificadas em código, com referência de arquivo.

**Experiência necessária por nível** — `player.cpp:4517`
```
expForLevel(L) = (((L - 6) × L + 17) × L - 12) / 6 × 100
```

**Dano de arma corpo a corpo** — `weapons.cpp:111`
```
maxDmg = round(0.085 × attackFactor × attackValue × attackSkill + level / 5)
minDmg = level / 5
dano   = normal_random(minDmg, maxDmg × voc.meleeDamageMultiplier)
```

**Dano à distância** — mesma forma, coeficiente `0.09` no lugar de `0.085`.

**Dano mágico** — `combat.cpp:43` + `tools.cpp:426`
```
base(L)      = floor((L + 1000) / step) + 50 × step - 450,
               onde step = floor((sqrt(2L + 2025) + 5) / 10)
levelFormula = base(level) × 2 + (magicLevel + specializedML) × 3
dano         = normal_random(levelFormula × mina + minb,
                             levelFormula × maxa + maxb)
```

**Cadeia de mitigação de dano** — `creature.cpp:875` (a ordem importa)
```
1. absorb%      →  dano -= round(dano × absorb% / 100)
2. defesa       →  dano -= uniform_random(defense / 2, defense)
3. armadura     →  dano -= uniform_random(armor / 2, armor - (armor % 2 + 1))
4. mitigation   →  dano -= dano × mitigation / 100
```

**Avanço de skill** — `vocation.cpp:376`
```
triesNecessárias(nível) = skillBase[skill] × multiplicador[skill] ^ (nível - 11)
skillBase = [50, 50, 50, 50, 30, 100, 20]   # fist club sword axe dist shield fishing
```

**Magic level** — `vocation.cpp:406`
```
manaNecessária(ml) = floor(1600 × manaMultiplier ^ (ml - 1))
```

**Loot** — `monstertype.lua:4` + `functions.lua:68`
```
factor    = config.factor × random(95..105) / 100
threshold = random(0, 100000) × 100 / max(1, rateLoot × scheduleLootRate)
dropa se  threshold < (loot.chance × factor)
```
Escala de chance: `100000` = 100%. Ou seja, `chance = 39410` no queijo do rato = 39,41%.

> **Atenção — desvios deste fork.** O Crystal Server tem overrides marcados como *"Vocation Adjustment"* que divergem do Tibia oficial: `attackFactor` fixo em `1.2` (`player.cpp:714`), escudo com +30% de defesa e spellbook +60% (`player.cpp:646`), e mitigação retrabalhada. Precisamos decidir conscientemente se seguimos o Crystal ou o Tibia oficial. **Recomendo seguir o Crystal**, porque é o que está consistente com todo o resto dos dados.

### 2.3 Vocações

11 vocações (ids 0–10), incluindo **Monk / Exalted Monk** — a vocação nova do Tibia 15.x, que o Baiak Idle também tem. Confirma que estamos na mesma base de versão que a referência.

| id | Vocação | gainHP | gainMana | gainCap | manaMultiplier |
|---|---|---|---|---|---|
| 1 | Sorcerer | 5 | 30 | 10 | 1.1 |
| 2 | Druid | 5 | 30 | 10 | 1.1 |
| 3 | Paladin | 10 | 15 | 20 | 1.4 |
| 4 | Knight | 15 | 5 | 25 | 3.0 |
| 9 | Monk | 10 | 10 | 25 | 1.3 |

Promoções (5–8, 10) mantêm os ganhos mas dobram `soulmax` e aceleram regeneração.

### 2.4 Formato dos monstros

Cada monstro é um módulo Lua autocontido. Exemplo real (`mammals/rat.lua`):

```lua
local mType = Game.createMonsterType("Rat")
local monster = {}
monster.experience = 5
monster.health     = 20
monster.outfit     = { lookType = 21, lookHead = 0, ... }
monster.raceId     = 21
monster.Bestiary   = { class = "Mammal", race = BESTY_RACE_MAMMAL,
                       toKill = 250, CharmsPoints = 5, Stars = 1, ... }
monster.loot = {
    { name = "gold coin", chance = 100000, maxCount = 4 },
    { id = 3607, chance = 39410 },  -- cheese
}
monster.attacks  = { { name = "melee", interval = 2000, chance = 100,
                       minDamage = 0, maxDamage = -8 } }
monster.defenses = { defense = 0, armor = 1, mitigation = 0.07 }
monster.elements = { { type = COMBAT_EARTHDAMAGE, percent = 20 }, ... }
mType:register(monster)
```

Tudo que o idle precisa está aqui: HP, XP, loot com probabilidade, dano, defesa, resistências elementares, e o bloco `Bestiary` que alimenta charms.

**Como parsear (decisão importante):** não usar regex. Executar os arquivos num interpretador Lua real com `Game.createMonsterType` stubado, e serializar a tabela resultante. É a única forma robusta — muitos arquivos usam concatenação (`\z`), condicionais e constantes globais. Detalhes no documento 02.

---

## 3. O cliente — assets oficiais Tibia 15.25

### 3.1 Formato

O cliente moderno abandonou o `.dat/.spr` clássico. Agora é:

```
cliente pc/things/luminaris/
├── catalog-content.json          # índice mestre — 5.214 entradas
├── appearances-<sha>.dat         # 5,0 MB — protobuf com TODOS os objetos
├── staticdata-<sha>.dat
├── map-<sha>.dat / staticmapdata-<sha>.dat
└── 6.273 × *.bmp.lzma            # folhas de sprites comprimidas (117 MB)
```

### 3.2 `catalog-content.json`

Array JSON heterogêneo. As 5.208 entradas de sprite têm este formato:

```json
{
  "type": "sprite",
  "file": "sprites-d656db...ce6be.bmp.lzma",
  "spritetype": 0,
  "firstspriteid": 0,
  "lastspriteid": 143,
  "area": 0
}
```

`spritetype` define o tamanho do tile. Toda folha descomprime para **384×384 BGRA de 32 bits**:

| spritetype | Tile | Grade | Sprites/folha | Folhas |
|---|---|---|---|---|
| 0 | 32×32 | 12×12 | 144 | 379 |
| 1 | 32×64 | 12×6 | 72 | 62 |
| 2 | 64×32 | 6×12 | 72 | 61 |
| 3 | 64×64 | 6×6 | 36 | **4.706** |

Sempre confiar em `lastspriteid - firstspriteid + 1`, porque a última folha de uma faixa é parcial.

Os ~1.066 arquivos `.bmp.lzma` que sobram (`satellite-*`, `minimap-*`) são tiles de minimapa, fora do catálogo.

### 3.3 O container `.bmp.lzma`

Formato CIP, com uma pegadinha. Layout verificado byte a byte:

```
offset  tam  conteúdo
[0]     24   padding 0x00
[24]     8   metadados (varia por arquivo)
[32]     5   propriedades LZMA1 (lc/lp/pb + dict_size)
[37]     8   uint64 LE — tamanho COMPRIMIDO  ← não é o descomprimido!
[45]     N   stream LZMA1 cru
```

A pegadinha: vários documentos da comunidade dizem que o campo em `[37]` é o tamanho *descomprimido*. **Não é.** É o comprimido. O BMP resultante tem sempre 589.946 bytes.

### 3.4 Validação executada

Escrevi e rodei um extrator (`tools/extractor/probe_appearances.py`). Resultado real:

```
appearances: objects=44324  outfits=1477  effects=243  missiles=76
spritetype 0/1/2/3: todos descomprimem  → BM 384x384 32bpp
rat_21.png          4 tiles, 4 não-vazios
dragon_34.png       4 tiles, 4 não-vazios
player_male_128.png 8 tiles, 8 não-vazios
item_goldcoin_3031  ok
effect_1.png        6 frames
```

Os PNGs de prova estão em `_probe_out/`. Os sprites saem limpos e corretos.

### 3.5 Recoloração de outfits — resolvido

A extração do looktype 128 (jogador masculino) revelou o mecanismo exato. Os sprite IDs vêm **intercalados**: `[dir0_camada0, dir0_camada1, dir1_camada0, dir1_camada1, ...]`.

A camada 1 é uma **máscara de template** pintada com quatro cores puras:

| Cor da máscara | Parte |
|---|---|
| Amarelo `#FFFF00` | cabeça |
| Vermelho `#FF0000` | corpo |
| Verde `#00FF00` | pernas |
| Azul `#0000FF` | pés |

Para colorir: para cada pixel da máscara, multiplicar a cor escolhida pelo pixel correspondente da camada 0 e compor por cima. A paleta são 133 cores (grade 7×19) geradas por conversão HSI.

**Recomendação: fazer isso num shader WebGL em tempo real**, não pré-renderizar. Pré-renderizar 133⁴ combinações é inviável; o shader custa quase nada e dá liberdade total de customização — que é justamente onde jogos assim monetizam.

### 3.6 Índice de sprite (fórmula geral)

```
index = ((((((phase % numPhases)
          × pattern_depth  + z)      # montaria
          × pattern_height + y)      # addon
          × pattern_width  + x)      # direção (0=N 1=L 2=S 3=O)
          × layers         + layer)  # 0=base, 1=máscara
          × tileHeight     + h)
          × tileWidth      + w)
```

### 3.7 UI pronta para uso

`assets_unpacked/data/images/` tem **~2.350 PNGs** de interface do Tibia, utilizáveis direto no browser sem decodificação nenhuma:

| Pasta | PNGs | Uso |
|---|---|---|
| `game/destiny_wheel` | 605 | Wheel of Destiny |
| `game/cyclopedia` | 145 | Bestiary, Charms, Character |
| `game/imbuing` | 100 | Imbuements |
| `game/prey` | 65 | Prey |
| `game/topbar` | 62 | HUD |
| `game/analyzer` | 58 | **Hunt/Loot/Supply Analyzer** |
| `ui/` | 418 | Molduras, botões, janelas |

Isso economiza meses de arte e garante que o jogo *pareça* Tibia de verdade.

---

## 4. Dados de conteúdo aproveitáveis

### 4.1 Monstros — 1.802

| Categoria | Qtd | | Categoria | Qtd |
|---|---|---|---|---|
| quests | 730 | | bosses | 95 |
| humanoids | 92 | | mammals | 80 |
| humans | 78 | | magicals | 64 |
| undeads | 64 | | vermins | 62 |
| winter_update_2025 | 57 | | raids | 55 |
| reptiles | 42 | | aquatics | 40 |
| demons | 39 | | dragons | 17 |

### 4.2 Sistemas de meta-progressão já parametrizados

| Sistema | Onde | O que já temos |
|---|---|---|
| **Charms** | `data/scripts/systems/bestiary_charms.lua` | 25 charms com `percent`, `chance[3]`, `points[3]` |
| **Prey** | `src/io/ioprey.cpp` | `dano = 2×estrelas+5`, `defesa = 2×estrelas+10`, `xp/loot = 3×estrelas+10` |
| **Imbuements** | `data/XML/imbuements.xml` | 3 tiers (Basic/Intricate/Powerful) com preço, duração e % por efeito |
| **Bestiary** | bloco `Bestiary` de cada monstro | `toKill`, `FirstUnlock`, `SecondUnlock`, `CharmsPoints`, `Stars` |
| **Forge** | `monster.cpp:2667` | HP `×(1 + (15×stack+35)/100)`, dano `×(1.35 + (stack-1)×0.1)` |
| **Wheel** | `src/creatures/players/wheel/` | fórmula de mitigação, gems |
| **Stamina** | `data/libs/functions/player.lua:434` | >2340min = 1.5×, 841–2340 = 1.0×, ≤840 = 0.5×, 0 = sem XP |

### 4.3 `hunting_places.json` — a espinha dorsal do idle

`cliente pc/assets_unpacked/data/json/hunting_places.json` — **131 spots**, balanceados oficialmente:

```json
{
  "Name": "Kha'labal Terramites Cave",
  "Level": "8",
  "Type": ["Solo", "Duo"],
  "Xp/Hour": "80K",
  "Loot/Hour": "2K",
  "Vocation": ["Knight", "Paladin", "Druid", "Sorcerer", "Monk"],
  "RecommendedImbues": { "Knight": ["Strike", "Vampirism", "Void"] },
  "RecommendedSupplies": { "Paladin": ["Health Potion", "Arrow", "spear"] },
  "ValuableDrops": ["Gold Coin", "Terramite Eggs", ...],
  "Monsters": [{ "Name": "Terramite", "Resistances": "Fire: 120%, ..." }]
}
```

Cobertura: **nível 8 a 1100**, XP/hora de **5K a 12KK**, 289 monstros distintos, com variantes Solo / Duo / Party x4.

Por que isso é decisivo: em um idle, o desafio de design é a curva de progressão — quanto o jogador ganha por hora em cada estágio. A CipSoft já resolveu isso ao longo de 25 anos, e o arquivo entrega a curva pronta. **Cada hunting place vira uma zona de caça idle**, e `Xp/Hour` vira a âncora de balanceamento contra a qual calibramos nossa simulação de combate.

Complementos: `markers.json` (~41k marcadores de mapa) e `proficiencies.json` (árvores de perks de arma do 15.30).

---

## 5. Riscos e mitigações

| Risco | Sev. | Mitigação |
|---|---|---|
| Parsear 1.802 Lua com regex quebra | Alta | Executar em Lua VM real (`wasmoon`/`lupa`) com API stubada |
| Payload de sprites grande demais | Alta | Extrair só o que é usado (~300 monstros, não 1.477 outfits); atlas WebP; carregar sob demanda por zona |
| Cheating (idle = alvo fácil) | Alta | Servidor 100% autoritativo; cliente nunca calcula recompensa |
| Divergência Crystal × Tibia oficial | Média | Documentar e fixar a decisão agora (§2.2) |
| Direitos autorais CipSoft | Média | Assets são da CipSoft. Mesmo status legal do Baiak Idle e de qualquer OTServer — é tolerado, não licenciado. Decisão de negócio, não técnica. |
| Simular milhares de jogadores online | Média | Tick em lote + resolução analítica offline (documento 02) |

---

## 6. Conclusão

Nada bloqueia. Temos o motor de regras, o conteúdo, a arte e a curva de progressão — e o pipeline de extração está provado funcionando.

O trabalho real não é descobrir como extrair, é **construir os dois pipelines de conversão** (assets → atlas, Lua/XML → JSON) e depois **reimplementar as fórmulas em TypeScript** dentro de um servidor autoritativo.

Próximos documentos: `01-GAME-DESIGN.md`, `02-ARQUITETURA.md`, `03-ROADMAP.md`.
