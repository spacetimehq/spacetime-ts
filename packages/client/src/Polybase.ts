/**
 * <p>The Polybase Client SDK.</p>
 *
 * <p>The Polybase module is how we communicate with the Polybase service.
 * @see [Getting Started](https://polybase.xyz/docs/get-started)
 *</p>
 *
 * @module
 */

import { parse } from '@polybase/polylang'
import axios from 'axios'
import { Client } from './Client'
import { Collection } from './Collection'
import { PolybaseError, createError } from './errors'
import { CollectionMeta, Sender, Signer } from './types'

/**
 * Configuration for the Polybase Client.
 */
export interface PolybaseConfig {
  /**
   * The baseURL of the Polybase service.
   * @example
   * ```
   * https://testnet.polybase.xyz/v0
   * ```
   */
  baseURL: string
  /**
   * The unique identifier of the Client.
   * @example
   * ```
   * polybase@ts/client:v0
   * ```
   */
  clientId: string
  /**
   * The default namespace for the Client.
   * @example
   * ```
   * "pk/0x1fda4bead8bc2e85d4de75694b893de5dfb0fbe69e8ed1d2531c805db483ba350ea28d4b1c7acf6171d902586e439a04f23cb0827b08a29cbdf3dd0e5c994ec0/MyClient"
   * ```
   */
  defaultNamespace?: string
  sender: Sender
  signer?: Signer
}

const defaultConfig = {
  baseURL: 'https://testnet.polybase.xyz/v0',
  clientId: 'polybase@ts/client:v0',
  sender: axios,
}

/**
 * The Polybase Client.
 */
export class Polybase {
  private config: PolybaseConfig
  private client: Client
  private collections: Record<string, Collection<any>> = {}

  constructor(config?: Partial<PolybaseConfig>) {
    this.config = Object.assign({}, defaultConfig, config)
    const { clientId, baseURL } = this.config
    this.client = new Client(
      this.config.sender,
      this.config.signer,
      { clientId, baseURL },
    )
  }

  /**
   * Retrieves the collection with the given path.
   *
   * @param path - the fully-qualified path to the collection.
   * @returns The given {@link Collection} instance.
   */
  collection<T = any>(path: string): Collection<T> {
    const rp = this.getResolvedPath(path)
    if (this.collections[rp]) return this.collections[rp]
    const c = new Collection<T>(rp, this.client)
    this.collections[rp] = c
    return c
  }

  private getResolvedPath = (path: string) => {
    if (path.startsWith('/')) return path.substring(1)
    return this.config.defaultNamespace ? `${this.config.defaultNamespace}/${path}` : path
  }

  private setCollectionCode = async <T>(data: Pick<CollectionMeta, 'id' | 'code'>): Promise<Collection<T>> => {
    const id = data.id
    const col = this.collection('Collection')

    try {
      // Checks that the collection exists
      await this.collection(id).getMeta()

      // Updates the collection code
      await col.record(id).call('updateCode', [data.code])
    } catch (e: any) {
      if (e && typeof e === 'object' &&
        e instanceof PolybaseError &&
        (e.reason === 'collection/not-found' || e.reason === 'record/not-found')
      ) {
        await this.collection('Collection').create([id, data.code])
      } else {
        throw e
      }
    }

    return this.collection<T>(data.id)
  }

  /**
   * Applies the given schema to the database, creating new collections and adding existing collections.
   *
   * @param schema: The schema to apply.
   * @param namespace: The namespace for the collection.
   * @returns An array of {@link Collection} instances.
   */
  applySchema = async (schema: string, namespace?: string): Promise<Collection<any>[]> => {
    const collections = []
    const ns = (namespace ?? this.config.defaultNamespace)
    if (!ns) {
      throw createError('collection/invalid-id', { message: 'Namespace is missing' })
    }

    const [, root] = await parse(schema, ns)

    // We already manually prepend the namespace to the collection name,
    // so we need a client without a default namespace.
    const polybaseWithoutNamespace = new Polybase({
      ...this.config,
      defaultNamespace: undefined,
    })

    for (const node of root) {
      if (node.kind !== 'collection') continue

      collections.push(polybaseWithoutNamespace.setCollectionCode({
        id: ns + '/' + node.name,
        code: schema,
      }))
    }

    return await Promise.all(collections)
  }

  signer = (fn: Signer) => {
    this.client.signer = fn
    this.config.signer = fn
  }
}
