# [Polybase](https://polybase.xyz) Client (Browser/Node)

A client to connect to the [Polybase decentralized database](https://polybase.xyz).


## Install Polybase

```bash
npm install @polybase/client
```
```bash
yarn add @polybase/client
```

## Initialize the SDK

```typescript
import Polybase from '@polybase/client'

const db = new Polybase({
  ...config
})
```

## Get a single record

You can read data once, by calling the `.record(id: string).get()` method on a collection.

```ts
const colRef = db.collection("org/places")
const record = await colRef.record("id").get()

const { id, ...data } = record
```


## Write data 

```ts
const colRef = db.collection("org/places")
const record = await colRef.record("london").call("setName", ["Name"])
```


# Tests

To run E2E tests, ensure that [Polybase](https://github.com/polybase/polybase) is running, and then run:

```
yarn test:e2e
```

# Doc

To generate the documentation for the project, run the following command:

```
  $ npm run doc
```

or

```
  $ yarn run doc
```

This will generate the documentation in the `doc` directory.
