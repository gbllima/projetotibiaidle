/** Online training rooms — dummies use item-icons (never creature lookTypes). */

export interface TrainingDummyDef {
  id: string;
  name: string;
  description: string;
  itemId: number;
}

export interface TrainingProp {
  itemId: number;
  x: number;
  y: number;
  ground?: boolean;
}

export interface TrainingRoom {
  id: string;
  name: string;
  description: string;
  featuredDummyId: string;
  player: { x: number; y: number };
  placements: Array<{ dummyId: string; x: number; y: number }>;
  props: TrainingProp[];
}

export const TRAINING_DUMMIES: TrainingDummyDef[] = [
  { id: 'target-dummy', name: 'Target Dummy', description: 'Alvo mecânico de guild.', itemId: 15710 },
  { id: 'exercise-dummy', name: 'Exercise Dummy', description: 'Dummy de casa para armas de exercício.', itemId: 28558 },
  { id: 'ferumbras-dummy', name: 'Ferumbras Exercise Dummy', description: 'Dummy expert Ferumbras.', itemId: 28559 },
  { id: 'demon-dummy', name: 'Demon Exercise Dummy', description: 'Dummy demoníaco da Store.', itemId: 28561 },
  { id: 'monk-dummy', name: 'Monk Exercise Dummy', description: 'Dummy temático do monje.', itemId: 28563 },
  { id: 'wooden-dummy', name: 'Wooden Dummy', description: 'Boneco de madeira.', itemId: 50435 },
  { id: 'innocent-target', name: 'Innocent Target', description: 'Alvo para distance.', itemId: 15711 },
  { id: 'pharaoh-dummy', name: 'Pharaoh Dummy', description: 'Dummy decorativo egípcio.', itemId: 12047 },
  { id: 'hydromancer-dummy', name: 'Hydromancer Dummy', description: 'Dummy de hydromancer.', itemId: 12048 },
  { id: 'training-log', name: 'Training Log', description: 'Tronco de treino.', itemId: 50143 },
];

const dummiesById = new Map(TRAINING_DUMMIES.map((entry) => [entry.id, entry]));

export function trainingDummy(id: string): TrainingDummyDef | undefined {
  return dummiesById.get(id);
}

export const TRAINING_ROOMS: TrainingRoom[] = [
  {
    id: 'grand-hall',
    name: 'Salão de Treino',
    description: 'Sala premium — chão xadrez pedra/madeira, dummy central.',
    featuredDummyId: 'exercise-dummy',
    player: { x: 6, y: 9 },
    placements: [
      { dummyId: 'exercise-dummy', x: 6, y: 5 },
      { dummyId: 'wooden-dummy', x: 4, y: 5 },
      { dummyId: 'wooden-dummy', x: 8, y: 5 },
    ],
    props: [
      { itemId: 2921, x: 2, y: 2 },
      { itemId: 2921, x: 10, y: 2 },
      { itemId: 2366, x: 2, y: 8 },
      { itemId: 2367, x: 10, y: 8 },
    ],
  },
  {
    id: 'ferumbras-sanctum',
    name: 'Santuário Ferumbras',
    description: 'Sala sombria com Ferumbras Exercise Dummy central.',
    featuredDummyId: 'ferumbras-dummy',
    player: { x: 6, y: 9 },
    placements: [
      { dummyId: 'ferumbras-dummy', x: 6, y: 5 },
      { dummyId: 'pharaoh-dummy', x: 3, y: 4 },
      { dummyId: 'pharaoh-dummy', x: 9, y: 4 },
    ],
    props: [
      { itemId: 2921, x: 2, y: 2 },
      { itemId: 2921, x: 10, y: 2 },
    ],
  },
  {
    id: 'demon-pit',
    name: 'Fosso Demoníaco',
    description: 'Demon exercise dummies.',
    featuredDummyId: 'demon-dummy',
    player: { x: 6, y: 9 },
    placements: [
      { dummyId: 'demon-dummy', x: 6, y: 5 },
      { dummyId: 'hydromancer-dummy', x: 3, y: 4 },
      { dummyId: 'hydromancer-dummy', x: 9, y: 4 },
    ],
    props: [
      { itemId: 2921, x: 2, y: 2 },
      { itemId: 2921, x: 10, y: 2 },
    ],
  },
  {
    id: 'monk-dojo',
    name: 'Dojo do Monge',
    description: 'Monk dummies em tapete.',
    featuredDummyId: 'monk-dummy',
    player: { x: 6, y: 9 },
    placements: [
      { dummyId: 'monk-dummy', x: 6, y: 5 },
      { dummyId: 'monk-dummy', x: 4, y: 4 },
      { dummyId: 'monk-dummy', x: 8, y: 4 },
    ],
    props: [
      { itemId: 26119, x: 4, y: 7, ground: true },
      { itemId: 26119, x: 5, y: 7, ground: true },
      { itemId: 26119, x: 6, y: 7, ground: true },
      { itemId: 26119, x: 7, y: 7, ground: true },
      { itemId: 26119, x: 8, y: 7, ground: true },
    ],
  },
  {
    id: 'target-range',
    name: 'Campo de Alvos',
    description: 'Alvos para distance.',
    featuredDummyId: 'target-dummy',
    player: { x: 6, y: 9 },
    placements: [
      { dummyId: 'target-dummy', x: 6, y: 5 },
      { dummyId: 'innocent-target', x: 4, y: 3 },
      { dummyId: 'innocent-target', x: 8, y: 3 },
      { dummyId: 'training-log', x: 3, y: 6 },
      { dummyId: 'training-log', x: 9, y: 6 },
    ],
    props: [
      { itemId: 50139, x: 2, y: 8 },
      { itemId: 50139, x: 10, y: 8 },
    ],
  },
];

const roomsById = new Map(TRAINING_ROOMS.map((room) => [room.id, room]));

export function trainingRoom(id: string): TrainingRoom | undefined {
  return roomsById.get(id);
}
