// Warehouse/industrial prop catalogue: NAME -> [width, height, depth] in metres.
// Shared so the server can build collision boxes that exactly match the models
// the client renders (client/src/render/props.ts). Each prop is a DISTINCT model
// (no duplicates) for a varied industrial shooter map.

export type PropSize = [number, number, number];

export const PROP_SIZE: Record<string, PropSize> = {
  crateWood: [1.2, 1.2, 1.2],
  crateWoodLarge: [2.0, 2.0, 2.0],
  crateMetal: [1.4, 1.4, 1.4],
  crateStack: [2.2, 2.6, 1.6],
  barrelRed: [0.8, 1.1, 0.8],
  barrelBlue: [0.8, 1.1, 0.8],
  barrelStack: [1.8, 1.1, 1.8],
  container: [6.0, 2.6, 2.6],
  containerOpen: [6.0, 2.6, 2.6],
  containerStack: [6.0, 5.3, 2.6],
  palletStack: [1.4, 1.5, 1.1],
  shelfRack: [3.2, 4.0, 1.0],
  shelfStocked: [3.2, 4.0, 1.0],
  forklift: [1.5, 2.2, 3.0],
  pipeRack: [3.0, 2.0, 1.0],
  ventDuct: [1.0, 1.0, 4.0],
  hvacUnit: [2.2, 1.6, 2.2],
  controlPanel: [1.6, 2.0, 0.6],
  generator: [2.6, 1.6, 1.6],
  waterTank: [2.0, 3.2, 2.0],
  sandbagWall: [3.2, 1.0, 1.0],
  concreteBarrier: [2.2, 1.1, 0.8],
  tireStack: [1.7, 1.5, 1.7],
  plankPile: [2.6, 0.8, 1.4],
  workbench: [2.2, 1.2, 1.0],
  dumpster: [2.4, 1.6, 1.4],
  gasCylinders: [1.4, 1.7, 0.9],
  cableSpool: [1.8, 1.8, 1.8],
  sackStack: [1.6, 1.2, 1.6],
  machinePress: [2.2, 2.6, 1.8],
  serverRack: [1.2, 2.4, 0.9],
  cementMixer: [1.8, 2.0, 1.6],
};

export const PROP_NAMES = Object.keys(PROP_SIZE);
