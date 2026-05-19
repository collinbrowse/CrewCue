# @crewcue/platform-client

Pure TypeScript: action single-flight, notice bus, JSON error catalog. No React.

## Error catalog

Edit copy in [`errors/en.json`](errors/en.json). Reference keys from code via `getErrorMessage('locationUnavailable')` or `mapApiError(err)`.

## ActionRegistry

```ts
const registry = createActionRegistry();
await registry.run('map:center-user', 'replace', async (signal) => { ... });
```

Policies: `ignoreIfBusy` | `lock` | `replace`.

## NoticeBus

```ts
const bus = createNoticeBus();
bus.presentTransient({ fingerprint: 'map:location', catalogKey: 'locationUnavailable' });
bus.subscribe((state) => { ... });
```

At most one transient notice; a new transient replaces the previous.

## Phases

See [PHASES.md](./PHASES.md).
