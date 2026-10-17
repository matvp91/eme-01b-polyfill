// The polyfills integrators must provide (see README). Node lacks the Uint8Array base64/hex methods.
import 'core-js/modules/es.promise.with-resolvers';
import 'core-js/modules/es.typed-array.slice';
import 'core-js/modules/es.uint8-array.from-base64';
import 'core-js/modules/es.uint8-array.from-hex';
import 'core-js/modules/es.uint8-array.to-base64';
import 'core-js/modules/es.uint8-array.to-hex';
import 'core-js/modules/web.dom-exception.constructor';
