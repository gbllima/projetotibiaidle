import { useEffect, useState } from 'react';
import { canEquipFor, isEquipableItem } from '@tibia-idle/sim';
import { itemsById } from '@tibia-idle/data';
import { api } from '../api/client.js';
import type { CharacterView } from '../api/types.js';
import { OutfitModal } from './OutfitModal.js';
import { ItemSlot } from './ItemSlot.js';
import { WindowHead } from './WindowHead.js';

export function PartyMemberModal({ owner, memberId, mode, onClose, onCharacter }: { owner: CharacterView; memberId: number; mode: 'items' | 'appearance'; onClose: () => void; onCharacter: (character: CharacterView) => void }) {
  const [member, setMember] = useState<CharacterView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { let live = true; void api.character(memberId).then((result) => { if (live) setMember(result.character); }).catch((reason: Error) => { if (live) setError(reason.message); }); return () => { live = false; }; }, [memberId]);
  const update = async (body: Record<string, unknown>, equipment = false) => {
    setBusy(true); setError('');
    try {
      const result = await api.act(equipment ? owner.id : memberId, equipment ? { ...body, targetCharacterId: memberId } : body);
      const refreshed = await api.character(memberId); setMember(refreshed.character);
      onCharacter((await api.character(owner.id)).character);
      return result;
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível concluir.'); throw reason; }
    finally { setBusy(false); }
  };
  if (member && mode === 'appearance') return <OutfitModal character={member} busy={busy} onClose={onClose}
    onApply={async (draft) => { await update({ type: 'appearance', ...draft }); onClose(); }}
    onPresetSave={async (slot) => { await update({ type: 'preset-save', slot }); }}
    onPresetLoad={async (slot) => { const result = await update({ type: 'preset-load', slot }); return { ...result.character.appearance, addons: result.character.appearance.addons ?? 0 }; }} />;
  return <div className="modal" onClick={() => { if (!busy) onClose(); }}><div className="modal-card party-items-modal" role="dialog" aria-modal="true" aria-label="Itens do personagem" onClick={(event) => event.stopPropagation()}>
    <WindowHead title={member ? 'Itens · ' + member.name : 'Carregando personagem'} onClose={busy ? undefined : onClose} />
    <div className="modal-card-body">
      {error && <p role="alert" className="party-manager-error">{error}</p>}
      {member && <><h3>Equipamento</h3><div className="party-items-grid">{Object.entries(member.equipment).map(([slot, item]) => <div key={slot}><ItemSlot itemId={item.id} /><small>{item.name}</small><button type="button" disabled={busy} onClick={() => { void update({ type: 'unequip', slot }, true).catch(() => {}); }}>Remover</button></div>)}</div>
        <h3>Mochila da party</h3><div className="party-items-grid">{owner.backpackContents.map((stack) => {
          const item = itemsById.get(stack.itemId);
          return <div key={stack.itemId}><ItemSlot itemId={stack.itemId} count={stack.count} /><small>{stack.name}</small>{item && isEquipableItem(item) && <button type="button" disabled={busy || !canEquipFor(item, member.vocation.id, member.level)} onClick={() => { void update({ type: 'equip', itemId: stack.itemId, source: 'backpack' }, true).catch(() => {}); }}>Equipar</button>}</div>;
        })}</div>{!owner.backpackContents.length && <p>A mochila está vazia.</p>}
      </>}
    </div>
  </div></div>;
}
