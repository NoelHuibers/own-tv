/* The dashboard's entry point, bundled into app.js. Same start order as the former
   separate scripts: the TV bridge first, then the dashboard. */

import { startDashboard } from './app';
import { createBridge } from './bridge';

startDashboard(createBridge());
