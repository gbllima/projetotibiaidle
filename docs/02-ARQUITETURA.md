# Tibia Idle Global — Arquitetura Técnica

> Documento 02 de 4. Como construir. Decisões e justificativas.

---

## 1. A decisão central: simulação determinística compartilhada

Antes da stack, o problema que define tudo o resto.

Um idle MMO tem dois requisitos que aparentam ser contraditórios:

1. **O servidor precisa ser autoritativo.** Se o cliente calcular XP e loot, o
   jogo é hackeado no primeiro dia. Idle é o gênero mais fácil de burlar.
2. **O cliente precisa mostrar combate em tempo real.** Números de dano subindo,
   barras de vida, loot pipocando. Sem isso o jogo é uma planilha morta.

A solução ingênua — servidor faz tick a 1 Hz e transmite cada evento — não
escala. Com 10 mil jogadores simultâneos são 10 mil simulações por segundo mais
o tráfego de rede correspondente.

**A solução: simulação determinística com seed compartilhada.**

```
             packages/sim  (TypeScript puro, sem I/O, sem Date.now, sem Math.random)
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
   CLIENTE (browser)       SERVIDOR (Node)
   roda em tempo real      roda em lote, quando precisa
   para renderizar         para autorizar
```

O mesmo código, alimentado pelo mesmo `seed` e pelo mesmo estado inicial,
produz **exatamente a mesma sequência de eventos** nos dois lados.

Como funciona na prática:

1. Jogador entra numa hunt. Servidor gera `seed`, persiste o estado inicial e
   envia `{ seed, estadoInicial, tickInicial }`.
2. Cliente roda a simulação a 1 Hz e renderiza tudo — cada golpe, cada loot.
   O que ele mostra é a verdade, não um palpite.
3. Servidor **não** roda a 1 Hz. Ele avança o estado em lote quando precisa:
   a cada 30 s de checkpoint, quando o jogador age, ou ao desconectar.
4. Qualquer ação do jogador (trocar spell, sair) vira um evento com timestamp
   que entra na timeline determinística dos dois lados.

O que isso compra:

- Cliente com feedback instantâneo, sem latência
- Servidor com custo de CPU desacoplado do número de jogadores online
- Tráfego mínimo: alguns bytes por hunt, não por tick
- Cheating impossível — o cliente pode mentir para si mesmo, o servidor recalcula

O que isso exige (inegociável):

- `packages/sim` **puro**: sem `Math.random`, `Date.now`, `Set`/`Map` com ordem
  de iteração dependente de inserção não controlada, ou aritmética de ponto
  flutuante não determinística
- PRNG próprio com seed explícita (xoshiro128** ou PCG32)
- Suite de testes que roda N ticks e compara hashes entre Node e browser
- Versionamento da sim: mudou a fórmula, muda a versão, e sessões antigas
  são resolvidas com a versão em que começaram

Este é o alicerce. Se a determinismo quebrar, o jogo inteiro quebra — por isso
é a primeira coisa a construir e a mais testada.

---

## 2. Stack

| Camada | Escolha | Por quê |
|---|---|---|
| Linguagem | **TypeScript** em tudo | O compartilhamento da sim entre cliente e servidor só funciona com uma linguagem só. Isso vale mais do que o ganho de performance de Go/Rust. |
| Monorepo | **pnpm workspaces** + Turborepo | Compartilhar `sim` e `data` sem publicar pacote |
| Frontend | **React 19 + Vite** | Ecossistema, velocidade de build |
| Renderização | **PixiJS v8** (WebGL) | Sprites, atlas e shaders — precisamos de shader pra recolorir outfit |
| Estado (UI) | **Zustand** | Leve; o estado pesado vive na sim, não no React |
| Estilo | **TailwindCSS** | Iterar rápido com arte pré-existente |
| Servidor | **Node 24 + Fastify** | Maduro, rápido, TS nativo |
| Realtime | **WebSocket** (`ws` + protocolo binário) | A referência usa WS; é o certo |
| Banco | **PostgreSQL 17 + Drizzle ORM** | Relacional pra economia e mercado. Drizzle: SQL-first, tipado, sem mágica |
| Cache/filas | **Redis** | Sessões, filas de hunt, rankings (sorted sets), rate limit |
| Extração | **Python 3.14** | `lzma` na stdlib, Pillow — já validado funcionando |
| Deploy | Docker + Fly.io/Hetzner | Simples até precisar de mais |

**Sobre Node vs Go/Rust:** um servidor Go seria mais rápido por núcleo. Mas
perderíamos a simulação compartilhada, que é o que torna a arquitetura inteira
viável. Duplicar as fórmulas de combate em duas linguagens é garantia de
divergência sutil e bug irreproduzível. Node aguenta com folga o que
projetamos, e a sim em lote mantém a CPU baixa.

---

## 3. Estrutura do repositório

```
tibia-idle/
├── apps/
│   ├── web/                    # React + Vite + PixiJS
│   └── server/                 # Fastify + WebSocket
├── packages/
│   ├── sim/                    # ◀ NÚCLEO — simulação determinística
│   │   ├── rng.ts              #   PRNG com seed
│   │   ├── formulas/           #   dano, xp, skill, loot, mitigação
│   │   ├── combat/             #   loop de rodada, condições, alvos
│   │   └── session.ts          #   avançar sessão de hunt N ticks
│   ├── data/                   # JSON gerado (monstros, itens, hunts, vocações)
│   ├── protocol/               # tipos e codec das mensagens WS
│   └── ui/                     # componentes compartilhados
├── tools/
│   ├── extractor/              # Python: assets → atlas + metadados
│   └── datagen/                # Node: Lua/XML → JSON
├── docs/
├── cliente pc/                 # fonte (não versionar os 130 MB)
└── servidor/                   # fonte (referência de regras)
```

Regra: `packages/sim` **não importa nada** de `apps/`. Dependências só apontam
para dentro.

---

## 4. Pipeline de assets

Já validado (doc 00 §3.4). Falta industrializar.

```
things/luminaris/
   ├── catalog-content.json ──┐
   ├── appearances-<sha>.dat ─┤
   └── *.bmp.lzma ────────────┘
              │
              ▼
   tools/extractor/  (Python)
     1. indexar catálogo               → mapa spriteId → (arquivo, tile)
     2. parsear protobuf               → objetos, outfits, efeitos, missiles
     3. filtrar pelo que é usado       → só o conteúdo referenciado
     4. descomprimir LZMA + recortar   → tiles RGBA
     5. empacotar atlas (MaxRects)     → PNG/WebP + JSON
              │
              ▼
   apps/web/public/assets/
     ├── atlas/creatures-{0..n}.webp + .json
     ├── atlas/items-{0..n}.webp + .json
     ├── atlas/effects-{0..n}.webp + .json
     └── ui/  (cópia direta dos PNGs do cliente)
```

**Filtragem é crítica.** São 304.658 sprites e 130 MB brutos. Extraímos só o
alcançável: os ~300 monstros das 131 hunts, os itens que realmente dropam ou são
vendidos, e os efeitos usados por spells. Estimativa: **15–25 MB de atlas**,
carregados por zona sob demanda.

### 4.1 Recoloração de outfit em shader

Já sabemos que a camada 1 é uma máscara com amarelo/vermelho/verde/azul puros
(doc 00 §3.5). Em vez de pré-renderizar combinações, um fragment shader:

```glsl
vec4 base = texture2D(uBase, vUv);
vec4 mask = texture2D(uMask, vUv);

vec3 tint = vec3(1.0);
if (mask.r > 0.5 && mask.g > 0.5)      tint = uHead;   // amarelo
else if (mask.r > 0.5)                 tint = uBody;   // vermelho
else if (mask.g > 0.5)                 tint = uLegs;   // verde
else if (mask.b > 0.5)                 tint = uFeet;   // azul

gl_FragColor = vec4(base.rgb * tint, base.a);
```

Custo zero, e libera as 133⁴ combinações de cor — que é onde cosmético vira receita.

---

## 5. Pipeline de dados

O conteúdo mora em Lua e XML. Precisa virar JSON tipado.

### 5.1 Monstros — usar Lua de verdade

**Não parsear com regex.** Os 1.802 arquivos usam concatenação `\z`,
constantes globais (`COMBAT_FIREDAMAGE`, `BESTY_RACE_MAMMAL`), variações de
schema (`monster.summons` vs `monster.summon.summons`) e comentários inline.
Regex vai funcionar em 95% e falhar silenciosamente nos 5% que importam.

Executar num interpretador Lua real com a API stubada:

```ts
// tools/datagen/monsters.ts  — usando wasmoon (Lua 5.4 em WASM)
lua.global.set('Game', {
  createMonsterType: (name: string) => ({
    register: (m: MonsterTable) => { collected.set(name, m) }
  })
})
// injetar todas as constantes COMBAT_*, BESTY_RACE_*, CONST_ME_*, RARITY_*
for (const file of monsterFiles) await lua.doString(readFileSync(file, 'utf8'))
```

Saída: 100% de fidelidade, e quebra ruidosamente se algo mudar. Mesma técnica
para `stages.lua`, `bestiary_charms.lua` e os spells.

### 5.2 Itens e demais XML

`items.xml` tem 3,7 MB e ~87 mil linhas — parser em stream (`sax`), não DOM.
Cruzar com `appearances.dat` pelo id para obter sprite e flags de mercado.
`vocations.xml` e `imbuements.xml` são pequenos, DOM serve.

### 5.3 Saída

```
packages/data/generated/
├── monsters.json     # 1.802 → filtrado para os usados
├── items.json        # cruzado com appearances
├── hunts.json        # de hunting_places.json, normalizado
├── vocations.json
├── spells.json
├── charms.json · prey.json · imbuements.json
└── index.d.ts        # tipos gerados
```

Tudo determinístico e reprodutível: `pnpm datagen` regenera do zero. Os JSON
gerados **são** versionados (o build não pode depender de ter o OTServer na máquina).

---

## 6. Servidor

### 6.1 Modelo de sessão de hunt

```ts
interface HuntSession {
  id: string
  characterId: string
  huntId: string
  seed: bigint            // define toda a sequência de eventos
  startedAt: number       // tick absoluto
  lastSettledTick: number // até onde o servidor já autorizou
  snapshot: CharacterState
  actions: TimestampedAction[]  // mudanças do jogador na timeline
}
```

**Settle (liquidação):** avançar `lastSettledTick` até o tick atual rodando a
sim em lote, persistir o resultado. Acontece a cada ~30 s, em qualquer ação do
jogador, ao desconectar e ao reconectar.

O servidor nunca roda um loop a 1 Hz por jogador. Ele roda rajadas curtas de
milhares de ticks, o que é ordens de magnitude mais barato.

### 6.2 Progressão offline

Reconectou depois de 6 h? Rodar 21.600 ticks é desperdício. Para períodos longos
usamos **resolução analítica**: valor esperado de XP, loot e supplies por tick,
multiplicado pelo tempo, com variância amostrada de uma normal com a mesma seed.

Regras:
- Até 5 min → simulação exata em lote
- Acima disso → analítico, com stamina e teto de acumulação aplicados
- Teto: 8 h padrão, 24 h VIP; eficiência offline 70%

### 6.3 Protocolo WebSocket

Binário, não JSON — bem menos banda e parse mais rápido.

| Direção | Mensagem | Quando |
|---|---|---|
| S→C | `HUNT_START { seed, snapshot, tick }` | Entrou na hunt |
| S→C | `SETTLE { tick, estadoAutorizado }` | A cada ~30 s |
| S→C | `CORRECTION { estado }` | Divergência detectada (não deve acontecer) |
| C→S | `ACTION { tipo, tick, payload }` | Jogador agiu |
| S→C | `MARKET_UPDATE`, `CHAT`, `NOTIFY` | Eventos assíncronos |

O cliente só desenha o que sua própria sim produziu. `SETTLE` normalmente
confirma o que ele já mostrou; `CORRECTION` é o alarme de que o determinismo quebrou.

### 6.4 Escala

- Estado quente em Redis, frio em Postgres
- Sessões particionadas por hash do characterId entre processos worker
- Filas de hunt como Redis sorted sets
- Rankings como sorted sets, recalculados sob demanda
- Mercado é o único ponto que exige transação forte → Postgres com
  `SELECT ... FOR UPDATE`

Estimativa: um único worker aguenta milhares de sessões, porque o custo é
proporcional a *settles por segundo*, não a jogadores online.

---

## 7. Segurança

| Vetor | Defesa |
|---|---|
| Cliente forjar recompensa | Servidor recalcula tudo; cliente não envia resultados, só ações |
| Ações impossíveis | Validar contra o estado autorizado, nunca contra o que o cliente afirma |
| Speed hack | Ações carimbadas com tick; servidor rejeita fora da janela plausível |
| Bot / multi-conta | Detectável, mas num idle é menos crítico — o jogo já joga sozinho. Focar em limitar ganho por conta e por IP no mercado. |
| Exploit de mercado | Taxa de transação, limite de ordens, log de auditoria |
| Injeção | Drizzle parametrizado; validação com Zod em toda entrada |

Princípio: **o cliente é um renderizador e um preditor. Nunca uma fonte de verdade.**

---

## 8. Testes

O determinismo exige uma disciplina específica:

1. **Testes de fórmula** — cada fórmula portada tem caso de teste com valores
   conferidos contra o C++ original
2. **Teste de determinismo** — rodar 100 mil ticks em Node e no browser
   (Playwright), comparar hash do estado final. Roda em CI, bloqueia merge.
3. **Testes de calibração** — simular cada uma das 131 hunts por 1 h de tempo de
   jogo e verificar que o XP/hora fica dentro de ±15% do `Xp/Hour` oficial. Este
   é o nosso teste de balanceamento automatizado.
4. **Testes de economia** — simular mil jogadores por semanas e checar inflação
   de gold e Balance médio

O item 3 é o mais valioso: transforma balanceamento de opinião em teste que passa ou falha.

---

## 9. Decisões em aberto

Precisam de definição antes do código de produção:

1. **Fidelidade às fórmulas do Crystal** — seguimos os overrides do fork
   (`attackFactor` 1.2 etc.) ou o Tibia oficial? *Recomendo Crystal*, por
   consistência com o resto dos dados.
2. **Escopo do MVP** — quantas das 131 hunts entram no lançamento?
   *Recomendo 20*, cobrindo nível 8–150.
3. **Multi-personagem por conta** — sim, com slot extra pago?
4. **Reset sazonal** — o Baiak Idle resetou no lançamento oficial. Temporadas
   dão longevidade, mas afastam quem odeia perder progresso.
5. **PvP** — assíncrono (snapshot) ou nada no MVP?
