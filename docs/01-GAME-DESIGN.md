# Tibia Idle Global — Game Design

> Documento 01 de 4. O que o jogo é, derivado da engenharia reversa da referência
> (`baiakidle.com/jogar`) e do que o nosso acervo permite.

---

## 1. Conceito

Um MMO idle de navegador, ambientado no Tibia global, onde o personagem caça
sozinho e continuamente. O jogador não controla movimento nem cada ataque — ele
toma **decisões de otimização**: onde caçar, o que equipar, quais consumíveis
levar, como investir pontos de meta-progressão.

O laço central é o *loop de hunt* do Tibia real, automatizado:

```
escolher hunt → caçar → consumir supplies → ganhar XP/loot
     ↑                                              │
     └──────── otimizar build e equipamento ────────┘
```

O que faz o jogador voltar não é o combate (é automático), é a **planilha**: o
Hunt Analyzer mostrando lucro por hora, e a pergunta constante "consigo melhorar
esse número?". É o mesmo prazer de otimizar hunt do Tibia, destilado.

**Público-alvo:** jogadores de Tibia (ativos e nostálgicos), majoritariamente
brasileiros. Idioma primário **pt-BR**, com i18n desde o início.

---

## 2. Análise da referência — Baiak Idle

Mapeei a interface da referência. Estrutura de features observada:

**Navegação principal**
`Helper · Cyclopedia · Arena · Progressão · Prey · Build · Forja · Imbuir ·
Codex · Charms · Daily · Armazém · Comércio · Mercador · Loja · Marketplace ·
Market · Social · Guild · Comunidade · VIP · Rank · Discord`

**HUD permanente**
- Stamina (42:00, igual ao Tibia) e percentual
- Boosts ativos, Skills
- **Hunt Analyzer**: Session, XP/h, XP Stack, XP Gain, Kills, Loot, Supplies, **Balance**
- **Loot Analyser** e **Supply Analyser**: valor em gold, por hora
- **Damage** e **Damage Taken**
- Party Hunt
- Backpack (8 slots), Loot Pouch, Supply Pouch

**Criação de personagem**
Gênero + vocação entre `Knight · Monk · Paladin · Sorcerer · Druid`. Knight
escolhe arma inicial (Machado / Espada / Clava). Nickname separado, trocável só
na loja.

**Detalhes reveladores de arquitetura**
- `CONEXÃO PERDIDA — Reconectando…` → **WebSocket persistente**
- `FILA DE ENTRADA — #— · Aguarde sua vez para entrar na hunt` → **hunts têm vagas limitadas com fila**
- `Obter Coins · Transfer · Convert · Resgatar` → moeda premium com conversão
- `Outfits · Montarias · Auras · Presets` → customização cosmética monetizada

### 2.1 Leitura crítica

O que a referência acerta e devemos copiar:

- **Analyzers como conteúdo principal.** Eles não são HUD acessório, são a tela
  principal. Correto: em um idle, o feedback numérico *é* a gameplay.
- **Stamina de 42h.** Herda do Tibia e cria um limite natural de sessão que
  protege a economia sem parecer arbitrário.
- **Fila de entrada.** Vaga limitada por hunt gera escolha real (esperar a hunt
  boa ou ir na pior agora) e, de quebra, limita carga no servidor. Elegante.

Onde vejo espaço para superar:

- A referência espreme ~23 itens de navegação numa barra só. Vamos consolidar em
  ~6 seções com sub-abas.
- Ela é PT-only. Nascer com i18n abre LatAm e Europa (o Tibia é forte na Polônia
  e na Suécia).
- Ela é 2D estática. Nós temos os sprites animados extraídos com frame groups
  idle/moving — dá pra ter uma cena de combate viva, que é diferencial visual real.
- **Progressão offline** não aparece clara na referência. É a feature mais
  esperada de um idle e um gancho de retenção forte.

---

## 3. Sistemas centrais

### 3.1 Personagem

Vocações do 15.25, com os multiplicadores reais de `vocations.xml`:

| Vocação | Papel | gainHP | gainMana | gainCap | Foco |
|---|---|---|---|---|---|
| Knight | Tank corpo a corpo | 15 | 5 | 25 | Sobrevive, loot alto, XP baixo |
| Monk | Tank de punhos | 10 | 10 | 25 | Híbrido, `meleeDamage ×1.3` |
| Paladin | Atirador | 10 | 15 | 20 | Equilibrado, gasta munição |
| Sorcerer | Mago de dano | 5 | 30 | 10 | XP alto, frágil, gasta mana |
| Druid | Mago de cura/dano | 5 | 30 | 10 | Sustain, bom em party |

Progressão: `expForLevel(L) = (((L-6)×L + 17)×L - 12) / 6 × 100`, com os estágios
de `stages.lua` (7× até lvl 8, decaindo até 2× após 101).

Skills sobem por uso, conforme a fórmula exponencial por vocação (doc 00 §2.2).
Em um idle isso funciona bem: o combate automático gera tries continuamente, e o
jogador vê as skills subindo sozinhas — dopamina passiva.

### 3.2 Hunts

**Cada entrada de `hunting_places.json` vira uma zona.** 131 zonas, nível 8 a
1100, com `Xp/Hour` oficial como âncora de balanceamento.

Estados de uma hunt:
```
Selecionar → [Fila, se lotada] → Ativa → (morte | stamina 0 | supplies 0 | sair)
```

A zona define: monstros presentes, nível recomendado, vocações adequadas,
supplies recomendados e drops valiosos. Entrar numa zona muito acima do nível =
morte rápida e prejuízo. Essa tensão risco/retorno é o coração da decisão.

**Balanceamento:** nossa simulação de combate roda com as fórmulas reais e é
calibrada até que o XP/hora resultante bata com o `Xp/Hour` do arquivo (±15%).
Isso nos dá uma curva de 1100 níveis validada sem trabalho de design manual.

### 3.3 Combate

Resolução por rodadas (~1 s de tempo de jogo). Por rodada:

1. Selecionar alvos (respeitando `targetDistance` e estratégias do monstro)
2. Ataque do jogador — arma ou spell, pela fórmula da vocação
3. Aplicar cadeia de mitigação do alvo (absorb → defesa → armadura → mitigation)
4. Aplicar resistências elementares (`monster.elements`)
5. Ataques dos monstros contra o jogador, mesma cadeia
6. Consumo automático de supplies conforme regras do jogador
7. Rolar loot dos mortos, aplicar XP com todos os multiplicadores
8. Tick de condições (DoT, haste, buffs)

Tudo com as fórmulas reais do Crystal Server. O que o jogador configura é a
**política**: qual spell priorizar, com quanto de HP tomar poção, quando fugir.

### 3.4 Supplies e economia

O que define um idle bem desenhado é o **Balance** — `loot − supplies`. Se for
sempre positivo, a economia infla. Se for sempre negativo, o jogador para.

- Consumo automático de potions, munição e runas conforme regras configuráveis
- Supply Pouch define o que levar; acabou = hunt encerra
- Loot Pouch com filtros (só valioso, só acima de X gold)
- Balance por hora em destaque permanente

Isso transforma o jogo num problema de otimização de margem, que é exatamente o
que jogadores de Tibia adoram.

### 3.5 Stamina

Regra do Tibia, direto de `player.lua:434`:

| Stamina | Multiplicador de XP |
|---|---|
| > 2340 min (39h) | **1,5×** |
| 841 – 2340 min | 1,0× |
| ≤ 840 min (14h) | 0,5× |
| 0 | **sem XP e sem loot** |

Máximo 42h, regenera offline. É o limitador de sessão e o motivo pra voltar amanhã.

### 3.6 Progressão offline

Ausente na referência; é o nosso diferencial de retenção.

- Ao reconectar, o servidor avança a mesma simulação por tick (determinística)
- Teto de acumulação: 8h grátis, 24h para VIP
- Eficiência offline em ~70% da online (XP e loot), para preservar valor da sessão ativa
- Tela de "enquanto você esteve fora": XP, loot, kills, supplies gastos

### 3.7 Meta-progressão

Todos estes já vêm parametrizados no servidor (doc 00 §4.2) — é adaptação, não
design do zero:

| Sistema | Mecânica | Fonte |
|---|---|---|
| **Bestiary** | Matar N de uma espécie desbloqueia info e rende Charm Points | bloco `Bestiary` de cada monstro |
| **Charms** | 25 charms; gastar pontos para efeitos passivos por espécie | `bestiary_charms.lua` |
| **Prey** | 3 slots, bônus de dano/defesa/XP/loot por espécie | `2×estrelas+5` / `+10` |
| **Imbuements** | 3 tiers em equipamento, com custo e duração | `imbuements.xml` |
| **Forge** | Fundir itens; monstros influenciados dão mais XP e loot | `monster.cpp:2667` |
| **Wheel of Destiny** | Árvore de perks pós-nível 50 | `player_wheel.cpp` |
| **Proficiências** | Perks por tipo de arma | `proficiencies.json` |

Ordem de introdução recomendada: **Bestiary → Charms → Prey → Imbuements →
Forge → Wheel**. Cada um entra quando o anterior começa a saturar, escalonando o
endgame em vez de despejar tudo de uma vez.

### 3.8 Social

- **Market** — leilão player-to-player, o coração da economia
- **Guilds** — com hunts de guild e ranking
- **Party hunts** — hunts que exigem 2 ou 4 jogadores (o arquivo já marca `Duo` e `Party x4`)
- **Rankings** — nível, skill, bestiary, riqueza
- **Arena** — PvP assíncrono contra snapshot do build adversário

### 3.9 Monetização

Ética e sem pay-to-win direto, seguindo o modelo do próprio Tibia:

- **Cosméticos**: outfits, montarias, auras (nós já temos 1.477 outfits extraíveis)
- **VIP**: mais tempo offline acumulável, terceiro slot de prey, +% XP moderado
- **Conveniência**: rerolls de prey, slots de personagem, mudança de nickname
- **Coins** com conversão para gold via mercado regulado

Não vender poder bruto. Em jogo com ranking e mercado, isso mata a economia e a
comunidade — e a comunidade *é* o produto num MMO idle.

---

## 4. Estrutura de interface

Consolidando os 23 itens da referência em 6 seções:

```
┌─ TOPO: HP/Mana · Stamina · Nível/XP · Gold · Coins ──────────────┐
├──────────────┬───────────────────────────────┬──────────────────┤
│  PERSONAGEM  │      CENA DE COMBATE          │    ANALYZERS     │
│  Equipamento │   (sprites animados)          │  Hunt: XP/h      │
│  Skills      │   Alvo · barras de vida       │  Loot: gold/h    │
│  Inventário  │   Números de dano flutuando   │  Supply: gold/h  │
│              │   Log de combate              │  Balance ◀ herói │
├──────────────┴───────────────────────────────┴──────────────────┤
│  Caçar · Personagem · Progressão · Mercado · Social · Loja       │
└──────────────────────────────────────────────────────────────────┘
```

- **Caçar** — mapa de zonas, fila, configuração de supplies e loot
- **Personagem** — equipamento, skills, spells, aparência
- **Progressão** — Bestiary, Charms, Prey, Imbuements, Forge, Wheel
- **Mercado** — Market, NPCs, Armazém
- **Social** — Guild, ranking, party, arena
- **Loja** — coins, VIP, cosméticos

Arte: os ~2.350 PNGs de UI do cliente (doc 00 §3.7) dão a moldura autêntica do
Tibia de graça. Layout moderno e responsivo, arte clássica.

---

## 5. Primeira sessão do jogador

Os 10 primeiros minutos decidem retenção:

1. Criar personagem (gênero, vocação, nome) — sem fricção, sem cadastro antes
2. Primeira hunt guiada (Rotworms) começa **automaticamente**
3. Primeiro kill em <5s, com número de dano e loot visíveis
4. Level up em ~30s
5. Apresentar o Hunt Analyzer: "você está lucrando X gold/hora"
6. Primeira decisão real: comprar equipamento melhor ou guardar
7. Desbloquear Bestiary com o 10º kill
8. Explicar stamina e progressão offline — e aí sim pedir cadastro para salvar

Regra: **nunca bloquear o jogador antes de ele ver o loop funcionando.**

---

## 6. O que fica fora do escopo inicial

Deliberadamente adiado, para não afundar o MVP:

- Mapa navegável (o `world.otbm` de 52 MB é tentador, mas caçar é abstrato num idle)
- NPCs com diálogo (1.112 arquivos — vira loja simples no MVP)
- Casas, quests com script, raids
- PvP em tempo real
- Cliente mobile nativo (web responsivo primeiro)
