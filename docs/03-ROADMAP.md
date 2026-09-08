# Tibia Idle Global — Roadmap

> Documento 03 de 4. Ordem de construção e critérios de pronto.

---

## Princípio de sequenciamento

Construir na ordem do **risco decrescente**. O que pode invalidar o projeto vem
primeiro. Nada de UI bonita antes de saber que a simulação é determinística e
que os assets carregam no navegador.

Cada fase termina com algo **executável e verificável**, não com um documento.

---

## Fase 0 — Fundação (concluída)

| Item | Status |
|---|---|
| Inventário dos dois acervos | ✅ |
| Fórmulas de combate/XP/loot/skill mapeadas com referência de arquivo | ✅ |
| Formato dos assets decifrado (catálogo, LZMA, protobuf) | ✅ |
| Extração real de sprites validada (rat, dragon, player, item, efeito) | ✅ |
| Mecanismo de recoloração de outfit identificado | ✅ |
| `hunting_places.json` descoberto como espinha dorsal de conteúdo | ✅ |

Provas em `_probe_out/`, código em `tools/extractor/`.

---

## Fase 1 — Pipelines de conversão

**Objetivo:** transformar OTServer e cliente em JSON e atlas consumíveis.
**Risco que elimina:** "e se algum conteúdo não for extraível?"

### Pipeline de assets — concluído

- [x] `tools/extractor` industrializado: catálogo → protobuf → filtro → atlas WebP + JSON
- [x] Atlas de criaturas preservando camada base e máscara de recolorição
- [x] Verificação de round-trip: 4.500 sprites, zero divergência em pixel visível
- [x] Cópia e otimização dos PNGs de UI (119 MB → 8,9 MB)

Resultado: **25,3 MB** de assets, partindo de 2,9 GB brutos.

| Categoria | Conteúdo | Tamanho |
|---|---|---|
| creatures | 811 lookTypes, idle + moving, 2 direções | 8,1 MB |
| items | 7.286 itens pegáveis ou de mercado | 4,5 MB |
| effects / missiles | 243 + 76 | 0,6 MB |
| ui | 2.671 imagens | 8,9 MB |
| metadados JSON | | 3,2 MB |

### Pipeline de dados — concluído

- [x] Monorepo pnpm + TypeScript strict
- [x] `tools/datagen` com Lua VM (wasmoon) para os 1.802 monstros
- [x] Parser em stream de `items.xml`, cruzado com `appearances.dat`
- [x] Normalizar `hunting_places.json` → `hunts.json`
- [x] Parsear `vocations.xml`, `bestiary_charms.lua`, prey, stages
- [x] Tipos TS em `packages/data`

**Pronto:** `pnpm datagen` gera 1800 monstros, 131 hunts, 5113 itens, 11 vocações
e 25 charms. Os 289 monstros das hunts batem 100% com o servidor.

---

## Fase 2 — Núcleo de simulação

**Objetivo:** `packages/sim` determinístico e fiel.
**Risco que elimina:** o maior de todos — se o determinismo não se sustentar, a
arquitetura inteira cai.

- [x] PRNG com seed, `normal_random` e `uniform_random`
- [x] Fórmulas: `expForLevel`, dano melee/distance/mágico, mitigação, skill, loot
- [x] Loop de combate por tick com resistências e alvos
- [x] Consumo de supplies e política configurável
- [x] Stamina e multiplicadores de XP
- [x] `advance(session, ticks)` em lote
- [x] Settlement offline (mesmo código, teto 8 h grátis / 24 h VIP, 70% offline)
- [x] Teste de determinismo (mesmo seed, chunks diferentes)
- [x] Teste de calibração contra o `Xp/Hour` oficial

**Pronto:** 238 testes de simulação passando, incluindo determinismo, calibração XP/h e economia.

Esta é a fase mais longa e a que menos parece produzir resultado visível. É
também a que decide se o projeto funciona.

---

## Fase 3 — Vertical slice jogável

**Objetivo:** um jogo tosco mas real, rodando local.
**Risco que elimina:** "isso é divertido?"

- [x] Fastify + WebSocket + SQLite (Postgres fica para a Fase 5)
- [x] Conta, personagem, criação com 5 vocações
- [x] Sessão de hunt com seed e settlement offline
- [x] Cliente React + PixiJS com sprites animados
- [x] Recoloração de outfit (máscara + canvas; shader GPU fica como polish)
- [x] Cena de combate: alvos, barras, números de dano
- [x] Hunt Analyzer (XP/h, Loot/h, Supply/h, Balance)
- [x] Equipamento, skills, upgrade de gear
- [x] Todas as 131 hunts, com unlock por nível
- [x] Restock automático de supplies ao entrar na hunt

**Pronto:** o jogo sobe em `http://localhost:5173` e o loop completo funciona.

**Aqui se decide continuar ou repensar.** Se o loop não prender por 30 min com o
Analyzer funcionando, o problema é de design e nenhuma feature extra resolve.

---

## Fase 4 — Profundidade

**Objetivo:** dar razão pra voltar amanhã.

- [x] Bestiary com contagem de kills e desbloqueios
- [x] Charms (25) listados com Charm Points do bestiary
- [x] Prey com 3 slots e rerolls
- [x] 131 hunts (escopo completo, não só 20)
- [x] Imbuements
- [x] Spells por vocação, com prioridade configurável
- [x] Loot Pouch e Supply Pouch com filtros
- [x] Onboarding dos 10 primeiros minutos (doc 01 §5)
- [x] UI completa com a arte do cliente (1.295 imagens oficiais no chrome)
- [x] i18n pt-BR / en (bandeiras BR/US no TopNav)

**Pronto quando:** um jogador tem objetivos claros por 10 h de jogo.

---

## Fase 5 — MMO

**Objetivo:** deixar de ser single-player com servidor.

- [x] Market player-to-player com auditoria
- [x] Rankings (nível, skill, bestiary, riqueza)
- [x] Guilds
- [x] Chat global e de guild, com moderação
- [x] Filas de hunt com vagas limitadas (8 por cave)
- [x] Party hunts (Duo, Party x4)

**Pronto quando:** a economia se sustenta com jogadores reais em teste fechado.

---

## Fase 6 — Beta e monetização

- [x] Loja de cosméticos (outfits, montarias, auras)
- [x] VIP
- [x] Pagamentos (pacotes + pedido Pix pendente + códigos de resgate; gateway real fica para o beta)
- [x] Painel de admin e moderação
- [x] Telemetria, métricas de retenção e economia
- [x] Testes de carga
- [x] Beta fechado → aberto (convites + chave no admin)

---

## Fase 7 — Endgame

- [x] Forge
- [x] Wheel of Destiny
- [x] Proficiências de arma
- [x] Bosstiary e boss slots
- [x] Arena PvP assíncrona
- [x] Hunts de 150 a 1100 (todas as 131)
- [x] Eventos sazonais (admin liga 2× XP / loot)

---

## Riscos de cronograma

| Risco | Sinal de alerta | Reação |
|---|---|---|
| Determinismo instável | `CORRECTION` aparecendo em teste | Parar tudo e resolver — é fundacional |
| Calibração não bate | XP/h fora de ±15% em várias hunts | Reavaliar se seguimos Crystal ou Tibia oficial |
| Atlas grande demais | >40 MB para as hunts do MVP | Cortar cobertura, aumentar compressão, lazy load agressivo |
| Escopo inflando | Fase 4 puxando features da 7 | Congelar backlog por fase |

---

## Regras de retenção (doc 01 §3.6 / §3.8) — concluídas

- [x] Offline 8 h grátis / 24 h VIP, com ~70% de XP e loot
- [x] Tela "Enquanto você esteve fora" (XP, loot, kills, supplies)
- [x] Stamina regenera fora de hunt (1 min a cada 3 min reais)
- [x] Hunts Duo / Party x4 exigem slots de party
- [x] Banner "CONEXÃO PERDIDA — Reconectando…"

## Cliente ao vivo (doc 02 §1 / §6.3) — concluído

- [x] Servidor envia o snapshot `live` da hunt (rng + tick + estado)
- [x] Browser roda o mesmo `advance` a cada 250 ms entre os pushes
- [x] Snapshot do servidor sempre vence — o cliente não manda resultado

## Polish da sessão — concluído

- [x] Loot, cura e level-up flutuam no viewport a cada tick
- [x] Loop religa a mesma hunt quando ela acaba sozinha
- [x] Settings (idioma + loop persistente)
- [x] Palavras de magia/cura no viewport (`exori ico`, `exura`)
- [x] Efeitos de hit/magia do atlas oficial
- [x] Log de combate no chat Geral (pt-BR / EN)
- [x] Mísseis de flecha/magia no viewport
- [x] Daily concede +10% XP por 2 horas
- [x] HUD HP/MP/XP no topo e ATK na hotbar
- [x] Raridade na backpack/loot, slot extra do pouch, presets de aparência
- [x] Primeira hunt é Venore Rotworm Cave
- [x] Wave 10 com caveira, banner e ciclo de 10 segmentos
- [x] Barras de skill com progresso real
- [x] Filtro de valor no Loot Pouch
- [x] Tutorial avança sozinho; guest reivindica a conta no jogo
- [x] Stamina no topo, rank de skill, online real, horas de supply, banner de evento
- [x] Custo de supplies na lista de hunts, splash TIBIA IDLE, aba Help, inspecionar item

## Fechamento do plano de jogo (após Fase 7)

- [x] Jogar agora (guest) e reivindicar conta depois — doc 01 §5
- [x] Paladin consome e restoca munição
- [x] Loja: outfits, montarias, auras, slot extra
- [x] Transfer de coins entre personagens
- [x] Bônus de XP de guild (+3%)
- [x] Party Hunt no dock esquerdo e proficiência no Build

## Extra pós-Fase 7 — Treino online (concluído)

Feature além do roadmap original; complementa o treino offline já existente.

- [x] Aba **Treino** no modal de Hunt (5 salas: Salão, Ferumbras, Demon Pit, Dojo, Campo de Alvos)
- [x] Dummies como sprites de item (`item-scenes`), sem nameplates
- [x] Míssil de exercise por skill (whirlwind / arrow / rod / wand) + POFF no dummy
- [x] Cadência Crystal: **2 s** com exercise weapon (+7 tries/carga), **8 s** no dummy grátis
- [x] Armas de exercise na loja (categoria Exercise, 500 cargas)
- [x] API `train-online` no servidor (`act` → bloqueia se estiver em hunt/fila)
- [x] Cena Pixi dedicada (`TrainingScene`) — supply pouch permanece visível ao entrar
- [x] Testes em `packages/sim/test/training.test.ts`

**Pronto quando:** o jogador treina skill/ML fora de hunt com feedback visual Tibia-like.

---

## Qualidade e regressões (março 2026)

- [x] Sim **238/238** — determinismo, calibração XP/h, wave packs, spells AOE, market NPC
- [x] Servidor **71/71** — API, systems, settlement offline
- [ ] Gateway Pix/cartão real (beta)
- [ ] Postgres quando a base crescer além do SQLite local
- [ ] Beta aberto com jogadores reais para validar economia e retenção

---

## O próximo passo concreto

1. Subir stack local: `pnpm dev` (web `:5173` + API `:3000`) — o proxy do Vite aponta `/api` para `127.0.0.1:3000`.
2. Pix/cartão fica para o final (não inventar gateway).
3. Postgres se a base crescer, e um beta com jogadores reais para validar a economia.
