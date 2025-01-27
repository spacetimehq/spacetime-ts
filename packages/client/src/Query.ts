/**
 * @module
 * @see [Filter records](https://polybase.xyz/docs/read#filter-records)
 * @see [Pagination](https://polybase.xyz/docs/read#pagination)
 */

import { Client } from './Client'
import { Collection, QuerySnapshotRegister } from './Collection'
import { CollectionRecord, CollectionRecordResponse } from './Record'
import { SubscriptionFn, SubscriptionErrorFn } from './Subscription'
import {
  Request,
  RequestParams,
  QueryValue,
  QueryWhereOperator,
  QueryWhereKey,
  CollectionList,
  CollectionRecordSnapshotRegister,
  QueryResponseCursor,
  SenderRawListResponse,
} from './types'
import { Collection as ASTCollection } from '@polybase/polylang/dist/ast'
import { addKeyValue, removeKey } from './util'

export const QueryWhereOperatorMap: Record<QueryWhereOperator, QueryWhereKey> = {
  '>': '$gt',
  '<': '$lt',
  '>=': '$gte',
  '<=': '$lte',
  '==': '$eq',
}

export const QueryWhereOperatorRelationMap: Record<QueryWhereKey, QueryWhereKey> = {
  $gt: '$gte',
  $gte: '$gt',
  $lt: '$lte',
  $lte: '$lt',
  $eq: '$eq',
}

export class Query<T> {
  collection: Collection<T>
  private params: RequestParams
  private client: Client
  private onQuerySnapshotRegister: QuerySnapshotRegister<T>
  private onRecordSnapshotRegister: CollectionRecordSnapshotRegister<T>

  constructor(collection: Collection<T>, client: Client, onQuerySnapshotRegister: QuerySnapshotRegister<T>, onRecordSnapshotRegister: CollectionRecordSnapshotRegister<T>) {
    this.params = {}
    this.collection = collection
    this.client = client
    this.onQuerySnapshotRegister = onQuerySnapshotRegister
    this.onRecordSnapshotRegister = onRecordSnapshotRegister
  }

  sort = (field: string, direction?: 'asc' | 'desc') => {
    const q = this.clone()

    if (!q.params.sort) q.params.sort = []
    q.params.sort.push([field, direction ?? 'asc'])
    return q
  }

  limit = (limit: number) => {
    const q = this.clone()

    q.params.limit = limit
    return q
  }

  after = (after: string) => {
    this.params.after = after
    return this
  }

  before = (before: string) => {
    this.params.before = before
    return this
  }

  where = (field: string, op: QueryWhereOperator, value: QueryValue) => {
    const q = this.clone()

    const referencedValue =
      value instanceof CollectionRecord
        ? value.reference()
        : value

    if (!q.params.where) q.params.where = {}
    const apiOp = QueryWhereOperatorMap[op]
    q.params.where[field] = op === '=='
      ? referencedValue
      : addKeyValue(QueryWhereOperatorMap[op], referencedValue, removeKey(QueryWhereOperatorRelationMap[apiOp], q.params.where[field]))

    return q
  }

  get = async (): Promise<CollectionList<T>> => {
    const ast = await this.collection.getAST()
    const isReadPubliclyAccessible = await this.collection.isReadPubliclyAccessible()
    const sixtyMinutes = 60 * 60 * 1000

    const res = await this.client.request(this.request())
      .send<SenderRawListResponse<T>>(isReadPubliclyAccessible ? 'none' : 'required', sixtyMinutes)

    return new QueryResponse(this.collection, this.client, this.onQuerySnapshotRegister, this.onRecordSnapshotRegister, res.data, ast)
  }

  key = () => {
    return `query:${this.collection.id}?${JSON.stringify(this.params)}`
  }

  onSnapshot = (fn: SubscriptionFn<CollectionList<T>>, errFn?: SubscriptionErrorFn) => {
    return this.onQuerySnapshotRegister(this, fn, errFn)
  }

  request = (): Request => {
    return {
      url: `/collections/${encodeURIComponent(this.collection.id)}/records`,
      method: 'GET',
      params: this.params,
    }
  }

  clone = (): Query<T> => {
    const q = new Query<T>(this.collection, this.client, this.onQuerySnapshotRegister, this.onRecordSnapshotRegister)
    q.params = {
      ...this.params,
      sort: this.params.sort ? [...this.params.sort] : undefined,
      where: this.params.where ? { ...this.params.where } : undefined,
    }
    return q
  }
}

export class QueryResponse<T> extends Query<T> {
  data: CollectionRecordResponse<T>[]
  cursor: QueryResponseCursor

  constructor(collection: Collection<T>, client: Client, onQuerySnapshotRegister: QuerySnapshotRegister<T>, onRecordSnapshotRegister: CollectionRecordSnapshotRegister<T>, response: SenderRawListResponse<T>, ast: ASTCollection) {
    super(collection, client, onQuerySnapshotRegister, onRecordSnapshotRegister)
    const { data, cursor } = response
    this.data = data.map((record) => {
      return new CollectionRecordResponse(collection.id, record, ast, this.collection, client, onRecordSnapshotRegister)
    })
    this.cursor = cursor
  }

  async previous() {
    return this.before(this.cursor.before).get()
  }

  async next() {
    return this.after(this.cursor.after).get()
  }

  toJSON = () => {
    return {
      data: this.data,
      cursor: this.cursor,
    }
  }
}
