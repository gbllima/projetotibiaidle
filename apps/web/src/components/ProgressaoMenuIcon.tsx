import type { CSSProperties } from 'react';
import { uiUrl } from '../ui/chrome.js';
import { progressaoIconClass, type ProgressaoMenuId } from '../ui/progressaoIcons.js';

export function ProgressaoMenuIcon({
  id,
  icon,
  tone,
}: {
  id: ProgressaoMenuId;
  icon: string;
  tone: string;
}) {
  return (
    <span
      className={`progressao-menu-icon ${progressaoIconClass(id)}`}
      style={{ '--prog-tone': tone } as CSSProperties}
    >
      <img src={uiUrl(icon)} alt="" />
    </span>
  );
}
