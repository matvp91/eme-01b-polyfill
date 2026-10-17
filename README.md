# eme-01b-polyfill

Unprefixed [EME](https://www.w3.org/TR/encrypted-media/) (`navigator.requestMediaKeySystemAccess()`, `MediaKeys`,
`MediaKeySession`) on top of the webkit-prefixed
[EME v0.1b](https://dvcs.w3.org/hg/html-media/raw-file/eme-v0.1b/encrypted-media/encrypted-media.html) API, for
browsers that only have the latter: Chrome 38-41 and the Smart TV engines based on them.

Players such as hls.js only use unprefixed EME. With this polyfill installed, they can play DRM-protected streams on
those devices. Shaka Player ships its own set of polyfills; this one is inspired by Shaka's EME v0.1b polyfill, and works
without Shaka.

## Install

```sh
npm install eme-01b-polyfill
```

The package is an ES2015 module. Chrome 38-41 need ES5, so compile it along with the rest of your app. Setups that
skip `node_modules` when compiling, such as the common babel-loader `exclude: /node_modules/`, must include this
package, or it fails to parse on those devices.

## Usage with hls.js

hls.js reads `navigator.requestMediaKeySystemAccess` once, when it loads. Install the polyfill in a module that is
imported before hls.js:

```ts
// polyfills.ts
import { install } from 'eme-01b-polyfill';

install();
```

```ts
// main.ts
import './polyfills';
import Hls from 'hls.js';

const video = document.querySelector('video') as HTMLVideoElement;
const hls = new Hls({
  emeEnabled: true,
  drmSystems: {
    'com.widevine.alpha': { licenseUrl: 'https://license.example.com/widevine' },
  },
});
hls.attachMedia(video);
hls.loadSource('https://cdn.example.com/stream.m3u8');
```

Or pass the polyfilled function to hls.js, which works regardless of load order:

```ts
import Hls from 'hls.js';
import { install, requestMediaKeySystemAccess } from 'eme-01b-polyfill';

install();

const hls = new Hls({
  emeEnabled: true,
  requestMediaKeySystemAccessFunc: requestMediaKeySystemAccess,
  drmSystems: {
    'org.w3.clearkey': { licenseUrl: 'https://license.example.com/clearkey' },
  },
});
```

`install()` returns `true` once installed. On platforms with native unprefixed EME, or without EME v0.1b, it does
nothing and returns `false`.

## Required polyfills

The polyfill uses these APIs, which Chrome 38-41 lack. Load them first, for example from
[core-js](https://github.com/zloirock/core-js):

```ts
import 'core-js/modules/es.promise.with-resolvers'; // Chrome 119
import 'core-js/modules/es.typed-array.slice'; // Chrome 45
import 'core-js/modules/es.uint8-array.from-base64'; // Chrome 140
import 'core-js/modules/es.uint8-array.from-hex'; // Chrome 140
import 'core-js/modules/es.uint8-array.to-base64'; // Chrome 140
import 'core-js/modules/es.uint8-array.to-hex'; // Chrome 140
import 'core-js/modules/web.dom-exception.constructor'; // Chrome 46
```

## Limitations

- EME v0.1b reports no key statuses. The polyfill reports one status for all keys of a session, under the key IDs it
  finds in the init data (Widevine and PlayReady PSSH boxes, `keyids`). When it finds none, every key ID matches, and
  hls.js only picks up the status after its 1 second key status timeout.
- Only temporary sessions: configurations that require persistent state or other session types are rejected.
- `setServerCertificate()` resolves with `false`, as v0.1b has no server certificates.
- v0.1b keys live in the media pipeline, so they may not survive hls.js' `detachMedia()`.
- `event.target` of session events is an internal object, not the session.

## Development

```sh
npm run build      # ES2015 module and type declarations
npm test
npm run typecheck
npm run check      # Biome lint and format check; `npm run format` fixes
```

## License

Apache-2.0
