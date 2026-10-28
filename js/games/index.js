import { roulette } from './roulette.js';
import { bridge } from './bridge.js';
import { bomb } from './bomb.js';
import { poison } from './poison.js';
import { wheel } from './wheel.js';

export const GAMES = { roulette, bridge, bomb, poison, wheel };
export const GAME_IDS = Object.keys(GAMES);
