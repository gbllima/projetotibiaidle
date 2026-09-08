# Extrator de assets

Converte os assets do cliente Tibia 15.25 em atlas WebP + metadados JSON
prontos para o navegador.

Só depende de Pillow. O protobuf é lido por um leitor de wire format próprio
(`tibia/wire.py`), o que elimina codegen e a dependência do runtime protobuf.

```powershell
pip install -r tools/extractor/requirements.txt

python tools/extractor/extract.py --all      # atlas de criaturas, itens, efeitos
python tools/extractor/copy_ui.py            # arte de interface do cliente
python tools/extractor/verify.py             # round-trip + previews
```

## Saída

`tools/extractor/out/assets/`

| Arquivo | Conteúdo | Tamanho |
|---|---|---|
| `creatures-*.webp` + `.json` | 811 lookTypes de monstro, idle + moving, 2 direções | 8,1 MB |
| `items-*.webp` + `.json` | 7.286 itens (pegáveis ou de mercado) | 4,5 MB |
| `effects-*.webp` + `.json` | 243 efeitos de magia | 0,5 MB |
| `missiles-*.webp` + `.json` | 76 projéteis | 0,1 MB |
| `ui/**` | 2.671 imagens de interface | 8,9 MB |
| | **total** | **~25 MB** |

Partindo de 2,9 GB de sprites brutos e 119 MB de UI.

## Escopo e como mudá-lo

O padrão é o que o jogo precisa, não tudo o que existe.

- **Criaturas** — todos os lookTypes encontrados em `servidor/data-global/monster`,
  direções sul e oeste (`--directions 2 3`). Sul serve para retratos de bestiário,
  oeste para a cena de combate. Para as quatro direções: `--directions 0 1 2 3`
  (~2,5× maior). Para todas as direções e padrões: `--directions` sem argumentos.
- **Itens** — objetos com flag `take` ou categoria de mercado. Exclui decoração
  de mapa, que é a maior parte dos 44.324 objetos.
- **Efeitos e projéteis** — todos.

## Formato dos metadados

```jsonc
{
  "version": 1,
  "category": "creatures",
  "directions": [2, 3],
  "atlas": {
    "pages": ["creatures-0.webp", ...],
    "pageSize": 2048,
    "frames": { "3843": [0, 128, 64, 64, 64] },  // [página, x, y, w, h]
    "emptySprites": [...],
    "stats": {...}
  },
  "entries": {
    "21": {                        // lookType do Rat
      "groups": {
        "0": { /* idle   */ },
        "1": {                     // moving
          "patternWidth": 4,       // direções
          "patternHeight": 1,      // addons
          "patternDepth": 1,       // montaria
          "layers": 1,             // 2 = tem máscara de recolorição
          "frames": 8,
          "phases": [[300, 300], ...],
          "sprites": [3847, 3848, ...]
        }
      }
    }
  }
}
```

Os metadados guardam o `SpriteInfo` **completo** — todas as dimensões de padrão
e a lista inteira de `sprites` — mesmo quando só algumas direções foram
empacotadas. Assim a fórmula de índice padrão do OTClient continua válida no
renderizador, e ampliar o escopo depois muda só o atlas, nunca o contrato dos
metadados. Sprite sem frame no atlas = não empacotado; o renderizador ignora.

### Índice de sprite

```
index = ((((fase % frames)
        × patternDepth  + montaria)
        × patternHeight + addon)
        × patternWidth  + direção)   // 0=N 1=L 2=S 3=O
        × layers        + camada     // 0=base, 1=máscara
```

### Recolorição de outfit

Quando `layers >= 2`, a camada 1 é uma máscara com quatro cores puras:
amarelo = cabeça, vermelho = corpo, verde = pernas, azul = pés. Multiplicar a
cor escolhida pelo pixel da camada 0. `verify.py` traz uma implementação de
referência em CPU (`recolor`); em produção isso vira um fragment shader.

## Módulos

| Arquivo | Responsabilidade |
|---|---|
| `tibia/wire.py` | Leitor de protobuf wire format |
| `tibia/catalog.py` | `catalog-content.json`, descompressão LZMA, recorte de tiles |
| `tibia/appearances.py` | Parser do `appearances.dat` |
| `tibia/atlas.py` | Empacotamento em grade, dedupe por hash, saída WebP |
| `extract.py` | CLI principal |
| `copy_ui.py` | Arte de interface → WebP |
| `verify.py` | Round-trip e previews |
| `analyze.py` | Relatório de volume por categoria |
| `scan_looktypes.py` | Escaneia lookTypes dos monstros e dimensiona o atlas |

## Notas de implementação

**O container `.bmp.lzma`.** O campo uint64 em `[37:45]` é o tamanho
**comprimido**, não o descomprimido. Vários guias da comunidade dizem o
contrário; passar o valor errado faz o decodificador raw falhar sem mensagem
útil. Layout completo em `tibia/catalog.py`.

**Empacotamento em grade, não MaxRects.** Todo tile do Tibia é 32×32, 32×64,
64×32 ou 64×64. Uma grade uniforme por classe de tamanho empacota com 100% de
aproveitamento em tempo linear; um packer de retângulos genérico seria pior e
muito mais lento.

**Sprites não são recortados (trim).** O alinhamento de renderização depende do
tile completo, e as margens transparentes praticamente somem na compressão.

**WebP lossless zera o RGB de pixels totalmente transparentes.** Comparação byte
a byte com a fonte acusa diferença mesmo quando o resultado visível é idêntico.
`verify.py` compara só pixels visíveis — foi exatamente isso que gerou um falso
negativo de 100% na primeira execução.
