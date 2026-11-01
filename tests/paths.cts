// Tests run compiled, from build/node/tests; these point back into the repository.
import path = require('node:path');

/** The repository root. */
export const ROOT = path.resolve(__dirname, '../../..');
/** Where tsc puts the compiled TV helpers, tools and tests. */
export const BUILD = path.join(ROOT, 'build/node');
