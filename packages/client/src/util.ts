import { CollectionRecord } from './Record'
import type { CallArg, FieldTypes } from './types'
import { Root as AST, Property as ASTProperty, Collection as ASTCollection, CollectionAttribute, ObjectField } from '@polybase/polylang/dist/ast'

export function getCollectionASTFromId(id: string, ast: AST): ASTCollection | undefined {
  return getCollectionASTFromName(getCollectionShortNameFromId(id), ast)
}

export function getCollectionASTFromName(name: string, ast: AST): ASTCollection | undefined {
  const collections = ast.filter((n) => n.kind === 'collection') as ASTCollection[]
  return collections.find((n: ASTCollection) => n.name === name)
}

export function getCollectionProperties(collection: ASTCollection): ASTProperty[] {
  return collection.attributes.filter((a: CollectionAttribute) => a.kind === 'property') as ASTProperty[]
}

export function getCollectionShortNameFromId(id: string): string {
  const name = id.split('/').pop()
  if (!name) throw new Error(`Invalid collection id: ${id}`)
  return name
}

export function encodeBase64(value: Uint8Array): string {
  // safe base64 encoding which works even with larger arrays
  // see https://github.com/mathiasbynens/base64/issues/13
  // solution inspired by https://github.com/WebReflection/uint8-to-base64/blob/master/esm/index.js
  const output = [];
  for (let i = 0; i < value.length; i++)
    output.push(String.fromCharCode(value[i]));
  return btoa(output.join(''));
}

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

// Adds a key/value to a record, or creates an object with the key/value
export function addKeyValue(key: string, value: any, obj?: Record<string, any>): Record<string, any> {
  const o = obj ?? {}
  o[key] = value
  return o
}

// Removes given keys from the object
export function removeKey(key: string, obj?: any): Record<string, any> {
  if (!obj || !isPlainObject(obj)) return {}
  for (const k of key) {
    if (k in obj) {
      delete obj[k]
    }
  }
  return obj
}

// Returns true if the object is a plain object
export function isPlainObject(val: any): val is Record<string, any> {
  return typeof val === 'object' && val.constructor === Object
}
