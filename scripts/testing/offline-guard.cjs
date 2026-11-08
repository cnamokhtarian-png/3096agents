// Preloaded only by the offline simulator. A surprise network dependency must fail.
const deny = () => { throw new Error('ARIA_DRY_RUN_NETWORK_FORBIDDEN'); };
globalThis.fetch = deny;
require('node:http').request = deny;
require('node:http').get = deny;
require('node:https').request = deny;
require('node:https').get = deny;
require('node:net').Socket.prototype.connect = deny;
require('node:tls').connect = deny;
require('node:dgram').createSocket = deny;
