/**
 * Utiltiy functions for use by other modules of @polybase/client.
 *
 * @module
 */

import { CollectionRecord } from './Record'
import type { CallArg, FieldTypes } from './types'
import { Root as AST, Property as ASTProperty, Collection as ASTCollection, CollectionAttribute, ObjectField } from '@polybase/polylang/dist/ast'

/**
 * Retrieve the Collection AST for the given id and ast.
 *
 * @param id  - the collection id.
 * @param ast  - the ast representing the schema of the collection.
 * @returns The prepared Collection AST.
 */
export function getCollectionASTFromId(id: string, ast: AST): ASTCollection | undefined {
  return getCollectionASTFromName(getCollectionShortNameFromId(id), ast)
}

/**
 * Retrieve the Collection AST for the given name and ast.
 *
 * @param name  - the collection name.
 * @param ast  - the ast representing the schema of the collection.
 * @returns The prepared Collection AST.
 */
export function getCollectionASTFromName(name: string, ast: AST): ASTCollection | undefined {
  const collections = ast.filter((n) => n.kind === 'collection') as ASTCollection[]
  return collections.find((n: ASTCollection) => n.name === name)
}

export function getCollectionProperties(collection: ASTCollection): ASTProperty[] {
  return collection.attributes.filter((a: CollectionAttribute) => a.kind === 'property') as ASTProperty[]
}

/**
 * Extracts the short collection name by removing the namespace prefix.
 *
 * @example
 * ```ts
 *  const shortName = 'ns/foo'
 *  console.log(shortName) // displays 'foo'
 * ```
 * @param id - the collection id.
 * @returns The short collection name.
 */
export function getCollectionShortNameFromId(id: string): string {
  const name = id.split('/').pop()
  if (!name) throw new Error(`Invalid collection id: ${id}`)
  return name
}

/**
 * Encodes the given byte array into a Base64 encoded string.
 *
 * @example
 * ```ts
 *  const text = 'Hello, world'
 *  const uint8Array = new Uint8Array(new TextEncoder().encode(text))
 *  const base64Encoded = encodeBase64(uint8Array)
 *  console.log(base64Encoded)  // displays 'SGVsbG8sIHdvcmxk'
 * ```
 * @param value - the byte arrey.
 * @returns The Base64 encoded string.
 */
export function encodeBase64(value: Uint8Array): string {
  return btoa(String.fromCharCode.apply(null, value as unknown as number[]))
}

/**
 * Decodes the given Base64 encoded string into a byte array.
 *
 * @example
 * ```ts
 * const base64Encoded =  'SGVsbG8sIHdvcmxk'
 * const decoder = new TextDecoder()
 * console.log(decoder.decode(decodeBase64(base64Encoded)) // displays 'Hello, world'
 * ```
 * @param value - the byte arrey.
 * @returns The Base64 encoded string.
 */
export function decodeBase64(value: string): Uint8Array {
  const binaryString = atob(value)

  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }

  return bytes
}

export function referenceArg(arg: CallArg): CallArg {
  if (arg instanceof CollectionRecord) return arg.reference()

  if (Array.isArray(arg)) {
    for (const i in arg) {
      arg[i] = referenceArg(arg[i]) as FieldTypes
    }
  }

  return arg
}

export function serializeValue(arg: CallArg): CallArg {
  if (arg instanceof Uint8Array) return encodeBase64(arg)
  arg = referenceArg(arg)
  return arg
}

export function deserializeRecord(data: Record<string, any>, properties: (ASTProperty | ObjectField)[]) {
  if (!data) return

  for (const property of properties) {
    switch (property.type.kind) {
      case 'primitive':
        switch (property.type.value) {
          case 'bytes':
            if (property.name in data) {
              data[property.name] = decodeBase64(data[property.name])
            }
        }
        break
      case 'object':
        deserializeRecord(data[property.name], property.type.fields)
        break
    }
  }
}

/**
 * Adds a key/value to a record, or creates an object with the key/value.
 *
 * @param key - the entry key.
 * @param value - the entry value.
 * @returns The updated (or newly-created) record.
 */
export function addKeyValue(key: string, value: any, obj?: Record<string, any>): Record<string, any> {
  const o = obj ?? {}
  o[key] = value
  return o
}

/**
 * Removes the given keys from the object, if the keys are present in the record.
 *
 * @param keys - the keys to remove.
 * @returns The updated record with the keys removed.
 */
export function removeKey(key: string, obj?: any): Record<string, any> {
  if (!obj || !isPlainObject(obj)) return {}
  for (const k of key) {
    if (k in obj) {
      delete obj[k]
    }
  }
  return obj
}

/**
 * Returns true if the object is a plain object.
 */
export function isPlainObject(val: any): val is Record<string, any> {
  return typeof val === 'object' && val.constructor === Object
}
