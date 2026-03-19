/** SQLite-backed localStorage for native - survives OTA updates better than AsyncStorage */
import 'expo-sqlite/localStorage/install';

import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
