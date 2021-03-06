import { createStore } from 'vuex'
import { helpModule } from './modules/help';
import { commandModule } from './modules/command';
import { statsModule } from './modules/stats';
import { pickupsModule } from './modules/pickups';
import { playersModule } from './modules/players';
import { RootState } from './types';

export default createStore<RootState>({
  state: {
  },
  getters: {
  },
  mutations: {
  },
  actions: {
  },
  modules: {
    'help': helpModule,
    'command': commandModule,
    'stats': statsModule,
    'pickups': pickupsModule,
    'players': playersModule
  }
})
