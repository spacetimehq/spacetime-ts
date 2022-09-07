import { Client } from './Client'
import { SubscriptionFn, SubscriptionErrorFn } from './Subscription'
import {
  Request,
  RequestParams,
  CollectionDocument,
  BasicValue,
  QueryWhereOperator,
  QueryWhereKey,
} from './types'

export type QuerySnapshotRegister<T> = (q: Query<T>, fn: SubscriptionFn<CollectionDocument<T>[]>, errFn?: SubscriptionErrorFn) => (() => void)

export const QueryWhereOperatorMap: Record<QueryWhereOperator, QueryWhereKey> = {
  '>': '$gt',
  '<': '$lt',
  '>=': '$gte',
  '<=': '$lte',
  '==': '$eq',
}

export class Query<T> {
  private id: string
  private params: RequestParams
  private client: Client
  private onSnapshotRegister: QuerySnapshotRegister<T>

  constructor (id: string, client: Client, onSnapshotRegister: QuerySnapshotRegister<T>) {
    this.id = id
    this.params = {}
    this.client = client
    this.onSnapshotRegister = onSnapshotRegister
  }

  sort = (field: string, direction?: 'asc'|'desc') => {
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

  where = (field: string, op: QueryWhereOperator, value: string|number|boolean) => {
    const q = this.clone()

    if (!q.params.where) q.params.where = {}
    q.params.where[field] = op === '=='
      ? value
      : { [QueryWhereOperatorMap[op]]: value } as Record<QueryWhereKey, BasicValue>
    return q
  }

  get = async (): Promise<CollectionDocument<T>[]> => {
    const res = await this.client.request(this.request()).send()
    return res.data?.data
  }

  // TODO: validate query has required indexes
  validate = () => {}

  key = () => {
    return `query:${this.id}?${JSON.stringify(this.params)}`
  }

  onSnapshot = (fn: SubscriptionFn<CollectionDocument<T>[]>, errFn?: SubscriptionErrorFn) => {
    return this.onSnapshotRegister(this, fn, errFn)
  }

  request = (): Request => {
    return {
      url: `/${encodeURIComponent(this.id)}`,
      method: 'GET',
      params: this.params,
    }
  }

  private clone = (): Query<T> => {
    const q = new Query<T>(this.id, this.client, this.onSnapshotRegister)
    q.params = {
      ...this.params,
      sort: this.params.sort ? [...this.params.sort] : undefined,
      where: this.params.where ? { ...this.params.where } : undefined,
    }
    return q
  }
}
