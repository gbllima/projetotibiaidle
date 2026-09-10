import type { CharacterView } from '../api/types.js';
import { itemsById } from '@tibia-idle/data';
import { PAPERDOLL_SLOTS } from '../ui/paperdollSlots.js';
import { ItemSlot } from './ItemSlot.js';
import { WindowHead } from './WindowHead.js';

type Props = {
  character: CharacterView;
  busy?: boolean;
  onClose: () => void;
};

export function PartyItemsModal({ character, busy = false, onClose }: Props) {
  const backpack = character.backpackContents ?? [];
  const capacity = character.backpackCapacity ?? backpack.length;

  return <div className="modal" onClick={onClose}>
    <div className="modal-card party-items-modal" onClick={(event) => event.stopPropagation()}>
      <WindowHead title={`Itens — ${character.name}`} onClose={onClose} closeLabel="Fechar" />
      <div className="party-items-body">
        <section className="party-items-equipment" aria-label={`Equipamentos de ${character.name}`}>
          <div className="party-items-paperdoll">
            {PAPERDOLL_SLOTS.map((slot) => {
              const equipped = character.equipment?.[slot.id];
              return <div className={`paper-slot ${slot.area}`} key={slot.id} title={equipped?.name ?? slot.id}>
                <ItemSlot
                  itemId={equipped?.id}
                  label={equipped?.name}
                  compact
                  emptyLabel={slot.id === 'necklace' ? 'Amuleto' : slot.id === 'ring' ? 'Anel' : slot.id === 'ammo' ? 'Berloque' : undefined}
                />
              </div>;
            })}
          </div>
          <div className="party-items-stats">
            <span>Soul <b>{character.soul ?? 0}</b></span>
            <span>Cap <b>{Math.round(character.stats?.capacity ?? 0)}</b></span>
          </div>
        </section>

        <section className="party-items-backpack">
          <div className="party-items-tabs">
            <button type="button" className="on">Backpack</button>
            <button type="button" disabled>Loot Pouch</button>
            <button type="button" disabled>Store Inbox</button>
          </div>
          <p>Backpack {backpack.length} / {capacity} — itens guardados pelo personagem.</p>
          <div className="party-items-grid">
            {Array.from({ length: Math.max(20, Math.min(40, capacity)) }, (_, index) => {
              const stack = backpack[index];
              return <ItemSlot
                key={stack ? `party-bp-${stack.itemId}-${index}` : `party-bp-empty-${index}`}
                itemId={stack?.itemId}
                count={stack?.count ?? 0}
                label={stack?.name ?? (stack ? itemsById.get(stack.itemId)?.name : undefined)}
                compact
              />;
            })}
          </div>
        </section>
      </div>
      <footer className="party-items-footer">
        <button type="button" className="btn" disabled={busy} onClick={onClose}>Fechar</button>
      </footer>
    </div>
  </div>;
}
