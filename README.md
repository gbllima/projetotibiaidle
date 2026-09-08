# Tibia Idle Global

MMO idle de navegador construído sobre o Crystal Server 15.25 e os assets do
cliente Tibia. A simulação é determinística e compartilhada: o mesmo código
roda no servidor (autoridade) e no browser (animação).

## Como rodar

```powershell
pnpm install
pnpm datagen          # se os JSON em packages/data/generated/ ainda não existirem
pnpm --filter @tibia-idle/sim test
pnpm --filter @tibia-idle/server test

# dois terminais
pnpm --filter @tibia-idle/server dev    # API em :3000
pnpm --filter @tibia-idle/web dev       # UI em :5173
```

Os atlas de sprites ficam em `tools/extractor/out/assets/`. Se essa pasta
estiver vazia:

```powershell
pip install -r tools/extractor/requirements.txt
python tools/extractor/extract.py --all
python tools/extractor/copy_ui.py
```

## O que já existe

| Pacote | Papel |
|---|---|
| `packages/data` | 1800 monstros, 131 hunts, vocações, charms, itens |
| `packages/sim` | Combate, loot, XP, stamina, bestiary, supplies |
| `apps/server` | Contas, personagens, hunts, settlement offline, WebSocket |
| `apps/web` | Cliente: criação, hunts, analyzer, cena PixiJS |
| `tools/extractor` | Sprites do cliente → atlas WebP |
| `tools/datagen` | Lua/XML do servidor → JSON |

Documentação em [`docs/`](docs/README.md).
