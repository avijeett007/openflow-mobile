import { registerRootComponent } from 'expo';

import App from './app/App';

// Minimal classic entry (no expo-router yet). The C2 app agent may migrate to
// expo-router; `app/` currently holds a single placeholder screen.
registerRootComponent(App);
